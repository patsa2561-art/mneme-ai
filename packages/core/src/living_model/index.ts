/**
 * v2.16.0 — MNEME LIVING MODEL
 *
 *   "Promote INFRA AS AI from per-host primitive to a real distributed
 *    Living Model. Anti-entropy sync between hosts + causal inference
 *    over the gossiped patterns + federated query."
 *
 * Phase 1 primitives (v2.16): the three abstractions a fully-distributed
 * inference layer needs.
 *
 *   1. anti-entropy sync — Merkle-tree summary of local observations;
 *      peers compare summaries and exchange only the diff
 *   2. causal inference — given pairs of observations (event A at host X,
 *      event B at host Y), compute correlation + lead/lag + a naive
 *      Granger-causality-ish score
 *   3. federated query — given a question + a list of peer digests,
 *      route the query to peers most likely to have matching observations
 *
 * v2.17+ will wire these into a real gossip protocol. v2.16 ships the
 * pure primitives, fully testable.
 */

import { createHash, createHmac } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export interface Observation {
  id: string;
  ts: string;
  host: string;
  kind: string;
  subject: string;
  detail?: string;
}

// ====== Anti-entropy ======

/** Build a Merkle-tree summary: log2 levels of sha256 nodes over the
 *  ID list. Compact, comparable, and reveals only the IDs in DIFF. */
export interface MerkleSummary {
  v: typeof PROTOCOL_VERSION;
  host: string;
  total: number;
  root: string;
  /** Sorted list of leaf ids for diff exchange (ids ARE NOT secret, the
   *  contents stay local). */
  leafIds: string[];
}

export function buildMerkleSummary(host: string, observations: Observation[]): MerkleSummary {
  const ids = observations.map((o) => o.id).sort();
  if (ids.length === 0) return { v: PROTOCOL_VERSION, host, total: 0, root: createHash("sha256").update("").digest("hex"), leafIds: [] };
  // Layered hashing
  let layer = ids.map((id) => createHash("sha256").update(id).digest("hex"));
  while (layer.length > 1) {
    const next: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const a = layer[i]!;
      const b = layer[i + 1] ?? a;
      next.push(createHash("sha256").update(a + b).digest("hex"));
    }
    layer = next;
  }
  return { v: PROTOCOL_VERSION, host, total: ids.length, root: layer[0]!, leafIds: ids };
}

/** Diff two summaries: which ids does the LOCAL host need to request from
 *  the PEER? Pure set difference on leafIds. */
export function diffSummaries(local: MerkleSummary, peer: MerkleSummary): { toFetch: string[]; toSend: string[]; rootsMatch: boolean } {
  const localSet = new Set(local.leafIds);
  const peerSet = new Set(peer.leafIds);
  const toFetch = peer.leafIds.filter((id) => !localSet.has(id));
  const toSend = local.leafIds.filter((id) => !peerSet.has(id));
  return { toFetch, toSend, rootsMatch: local.root === peer.root };
}

// ====== Causal inference (naive) ======

export interface CausalPair {
  ts: string; // ISO
  /** Tag of the cause hypothesis. */
  cause: string;
  /** Tag of the effect hypothesis. */
  effect: string;
  /** Optional numeric value associated. */
  value?: number;
}

export interface CausalScore {
  cause: string;
  effect: string;
  /** Pearson-style correlation over aligned numeric series, if values
   *  were supplied. Otherwise null. */
  correlation: number | null;
  /** Mean lead time of cause before effect, in seconds. Negative = effect
   *  precedes cause (i.e., reversed direction). */
  meanLeadSeconds: number | null;
  /** Naive "is the cause→effect direction more frequent than effect→cause?"
   *  vote ratio: 0..1 where 0.5 = ambiguous. */
  directionalityVote: number;
  /** Sample size used. */
  samples: number;
  /** Tamper-evident sig (caller passes secret). */
  sig: string;
}

function corr(xs: number[], ys: number[]): number | null {
  if (xs.length !== ys.length || xs.length < 3) return null;
  const meanX = xs.reduce((a, b) => a + b, 0) / xs.length;
  const meanY = ys.reduce((a, b) => a + b, 0) / ys.length;
  let num = 0, dx2 = 0, dy2 = 0;
  for (let i = 0; i < xs.length; i++) {
    const dx = xs[i]! - meanX, dy = ys[i]! - meanY;
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy;
  }
  const denom = Math.sqrt(dx2 * dy2);
  return denom === 0 ? 0 : num / denom;
}

export function inferCausal(pairs: CausalPair[], opts: { secret?: string } = {}): CausalScore {
  if (pairs.length === 0) {
    return { cause: "", effect: "", correlation: null, meanLeadSeconds: null, directionalityVote: 0, samples: 0, sig: "" };
  }
  const cause = pairs[0]!.cause;
  const effect = pairs[0]!.effect;

  // Group pairs into adjacent cause/effect occurrences (within same minute
  // window). Compute time deltas.
  const sorted = pairs.slice().sort((a, b) => a.ts.localeCompare(b.ts));
  const causeTimes: number[] = [];
  const effectTimes: number[] = [];
  const causeVals: number[] = [];
  const effectVals: number[] = [];
  for (const p of sorted) {
    const t = new Date(p.ts).getTime();
    if (!Number.isFinite(t)) continue;
    if (p.cause === cause) { causeTimes.push(t); if (p.value !== undefined) causeVals.push(p.value); }
    if (p.effect === effect) { effectTimes.push(t); if (p.value !== undefined) effectVals.push(p.value); }
  }

  // Lead time: for each effect, find the most recent cause within 1h.
  // Average the (effect - cause) deltas.
  const leads: number[] = [];
  let forwardCount = 0, reverseCount = 0;
  for (const eT of effectTimes) {
    let best = -Infinity;
    for (const cT of causeTimes) {
      if (cT <= eT && eT - cT <= 3600 * 1000) best = Math.max(best, cT);
    }
    if (best > -Infinity) {
      const delta = (eT - best) / 1000;
      leads.push(delta);
      // Same-instant observations are ambiguous (delta === 0) — don't
      // count toward either direction. Only count strictly-ordered pairs.
      if (delta > 0) forwardCount++;
      else if (delta < 0) reverseCount++;
    }
  }
  const meanLead = leads.length > 0 ? leads.reduce((a, b) => a + b, 0) / leads.length : null;
  const totalVotes = forwardCount + reverseCount;
  const directionalityVote = totalVotes === 0 ? 0.5 : forwardCount / totalVotes;

  // Correlation when both series have aligned values
  const minLen = Math.min(causeVals.length, effectVals.length);
  const correlation = minLen >= 3 ? corr(causeVals.slice(0, minLen), effectVals.slice(0, minLen)) : null;

  const body = { cause, effect, correlation, meanLeadSeconds: meanLead, directionalityVote, samples: pairs.length };
  const sig = createHmac("sha256", opts.secret ?? "mneme-living-model-default").update(JSON.stringify(body)).digest("hex");
  return { ...body, sig };
}

// ====== Federated query routing ======

export interface PeerHint {
  host: string;
  /** Tags this peer commonly emits — used to route the query. */
  knownSubjects?: string[];
  knownKinds?: string[];
}

export interface RouteQueryInput {
  subject: string;
  kind?: string;
  peers: PeerHint[];
  maxPeers?: number;
}

export interface RouteQueryResult {
  /** Peer routing decision: ordered list of (peer, why) tuples. */
  recommendations: Array<{ peer: string; score: number; reason: string }>;
  /** Optional fallback: query EVERY peer if confidence is low. */
  fallback: "narrow" | "broadcast";
}

export function routeFederatedQuery(input: RouteQueryInput): RouteQueryResult {
  const max = input.maxPeers ?? 3;
  const subjectLower = input.subject.toLowerCase();
  const kindLower = (input.kind ?? "").toLowerCase();
  const scored = input.peers.map((p) => {
    let score = 0;
    const reasons: string[] = [];
    if (p.knownSubjects?.some((s) => s.toLowerCase().includes(subjectLower) || subjectLower.includes(s.toLowerCase()))) {
      score += 0.6; reasons.push(`subject match`);
    }
    if (kindLower && p.knownKinds?.some((k) => k.toLowerCase() === kindLower)) {
      score += 0.4; reasons.push(`kind match`);
    }
    if (score === 0) reasons.push("no specific hint");
    return { peer: p.host, score: Math.round(score * 100) / 100, reason: reasons.join(" + ") };
  }).sort((a, b) => b.score - a.score).slice(0, max);

  const topScore = scored[0]?.score ?? 0;
  return {
    recommendations: scored,
    fallback: topScore >= 0.6 ? "narrow" : "broadcast",
  };
}

export function formatLivingModelLine(s: MerkleSummary): string {
  return `LIVING · ${s.host} · ${s.total} obs · root=${s.root.slice(0, 12)}`;
}
