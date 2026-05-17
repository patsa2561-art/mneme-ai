/**
 * v2.19.27 — MNEME DREAMSPACE · FEDERATE (stage 6 of 6)
 *
 *   "tools ที่ elite ใน 100+ instances → 'blessed'
 *    shared via cosmic.mneme-ai.space/dreamspace
 *    ผู้ใช้ใหม่ download starter pack จาก top 100 dreamt-born tools
 *    ⇒ Mneme network effect ที่ไม่มี framework ไหนมี"
 *                                          — user audit, 2026-05-17
 *
 *   Diagnosis: GESTATION proposes; EVOLUTION selects; PROBE measures;
 *   CARTOGRAPHER maps; PAIR scores complementarity. All locally. The
 *   network effect kicks in when ELITE tools spread across instances.
 *
 *   FEDERATE composes onto v2.19.16 FEDERATED TRUTH GRAVITY. Each
 *   instance HMAC-signs an EliteAttestation for tools whose local
 *   fitness >= threshold. Quorum across instances → "blessed" tag.
 *   Starter pack export = top-N blessed tools, downloadable by new
 *   users.
 *
 *   Composes onto:
 *     - v2.19.16 FEDERATED TRUTH GRAVITY (cross-attestation pattern)
 *     - v2.19.27 PROBE (local fitness source)
 *     - v2.19.26 EVOLUTION (lifecycle bands; only MATURE eligible)
 *     - v2.19.9 WRAPPER_GENESPLICING (blessed tools = composer recipes
 *       that any instance can apply)
 *
 * Honest scope:
 *   - PURE FUNCTION attestation + quorum. Caller does the actual
 *     network sync via v2.19.16 mesh/nexus transport.
 *   - Eligibility gate: only MATURE tools (v2.19.26 EVOLUTION) with
 *     local fitness >= threshold get attested.
 *   - HMAC-signed attestations; forged attestations dropped on verify.
 *   - Quorum bands match v2.19.16: unanimous / supermajority / majority
 *     / minority / conflict / orphan.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_MIN_FITNESS = 0.7;

export interface EliteAttestation {
  v: typeof PROTOCOL_VERSION;
  /** Pseudonymous instance id from v2.19.16 FEDERATED. */
  instanceId: string;
  /** Tool the instance attests is elite locally. */
  toolName: string;
  /** Local fitness score 0..1 (from PROBE). */
  localFitness: number;
  /** Local use count (from CONSEQUENCE / EVOLUTION). */
  localUseCount: number;
  /** ts of the attestation (ms). */
  ts: number;
  sig: string;
}

export type BlessingBand = "unanimous" | "supermajority" | "majority" | "minority" | "conflict" | "orphan";

export interface BlessingQuorum {
  v: typeof PROTOCOL_VERSION;
  toolName: string;
  totalAttestations: number;
  validAttestations: number;
  forgedDropped: number;
  meanFitness: number;
  totalUseCount: number;
  band: BlessingBand;
  /** Convenience: is the tool blessed (band ∈ {unanimous, supermajority})? */
  isBlessed: boolean;
  sig: string;
}

export interface StarterPackEntry {
  toolName: string;
  band: BlessingBand;
  meanFitness: number;
  attestationCount: number;
}

export interface StarterPack {
  v: typeof PROTOCOL_VERSION;
  entries: StarterPackEntry[];
  topN: number;
  builtAt: number;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_DREAMSPACE_FEDERATE_SECRET"] || `mneme-dreamspace-federate-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/**
 * Issue an EliteAttestation for a tool. Refuses if fitness < threshold
 * (we never attest mediocre tools). Caller-supplied instanceId from
 * v2.19.16 FEDERATED identity.
 */
export function attestElite(input: {
  instanceId: string;
  toolName: string;
  localFitness: number;
  localUseCount: number;
  ts?: number;
  minFitness?: number;
  secret?: string;
}): EliteAttestation | null {
  const min = input.minFitness ?? DEFAULT_MIN_FITNESS;
  if (input.localFitness < min) return null;
  const body: Omit<EliteAttestation, "sig"> = {
    v: PROTOCOL_VERSION,
    instanceId: input.instanceId,
    toolName: input.toolName,
    localFitness: input.localFitness,
    localUseCount: input.localUseCount,
    ts: input.ts ?? Date.now(),
  };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function verifyAttestation(a: EliteAttestation, secret?: string): boolean {
  const { sig, ...body } = a;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

/**
 * Aggregate N attestations for a single tool into a BlessingQuorum.
 *
 * Bands (proportions of validAttestations / totalInstances):
 *   unanimous     : >= 0.95
 *   supermajority : >= 0.67
 *   majority      : >= 0.51
 *   minority      : >= 0.10
 *   conflict      : > 0  and < 0.10
 *   orphan        : 0 attestations
 *
 * Forged attestations (failed HMAC verify) are dropped silently and
 * counted in `forgedDropped`. One-vote-per-instance: duplicates from
 * same instanceId keep the latest by ts.
 */
export function aggregateBlessing(input: {
  toolName: string;
  attestations: EliteAttestation[];
  totalInstancesKnown: number;
  secret?: string;
}): BlessingQuorum {
  const sec = input.secret ?? defaultSecret();
  // Drop forged
  const valid: EliteAttestation[] = [];
  let forgedDropped = 0;
  for (const a of input.attestations) {
    if (a.toolName !== input.toolName) continue;
    if (!verifyAttestation(a, sec)) { forgedDropped++; continue; }
    valid.push(a);
  }
  // One-vote-per-instance: keep latest ts
  const byInstance = new Map<string, EliteAttestation>();
  for (const a of valid) {
    const prev = byInstance.get(a.instanceId);
    if (!prev || a.ts > prev.ts) byInstance.set(a.instanceId, a);
  }
  const deduped = Array.from(byInstance.values());
  const totalUseCount = deduped.reduce((s, a) => s + a.localUseCount, 0);
  const meanFitness = deduped.length === 0
    ? 0
    : deduped.reduce((s, a) => s + a.localFitness, 0) / deduped.length;

  const proportion = input.totalInstancesKnown === 0
    ? 0
    : deduped.length / input.totalInstancesKnown;

  let band: BlessingBand;
  if (deduped.length === 0) band = "orphan";
  else if (proportion >= 0.95) band = "unanimous";
  else if (proportion >= 0.67) band = "supermajority";
  else if (proportion >= 0.51) band = "majority";
  else if (proportion >= 0.10) band = "minority";
  else band = "conflict";

  const isBlessed = band === "unanimous" || band === "supermajority";

  const body: Omit<BlessingQuorum, "sig"> = {
    v: PROTOCOL_VERSION,
    toolName: input.toolName,
    totalAttestations: input.attestations.length,
    validAttestations: deduped.length,
    forgedDropped,
    meanFitness,
    totalUseCount,
    band,
    isBlessed,
  };
  const sig = hmacHex(body, sec);
  return { ...body, sig };
}

export function verifyBlessingQuorum(q: BlessingQuorum, secret?: string): boolean {
  const { sig, ...body } = q;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

/**
 * Export a starter pack of top-N blessed tools — downloaded by new
 * users on first install. Sorted by isBlessed first, then meanFitness
 * desc, then validAttestations desc.
 */
export function exportStarterPack(input: {
  quorums: BlessingQuorum[];
  topN?: number;
  builtAt?: number;
  secret?: string;
}): StarterPack {
  const topN = input.topN ?? 100;
  const sorted = [...input.quorums].sort((a, b) => {
    if (a.isBlessed !== b.isBlessed) return a.isBlessed ? -1 : 1;
    if (b.meanFitness !== a.meanFitness) return b.meanFitness - a.meanFitness;
    return b.validAttestations - a.validAttestations;
  });
  const entries: StarterPackEntry[] = sorted.slice(0, topN).map((q) => ({
    toolName: q.toolName,
    band: q.band,
    meanFitness: q.meanFitness,
    attestationCount: q.validAttestations,
  }));
  const body: Omit<StarterPack, "sig"> = {
    v: PROTOCOL_VERSION,
    entries,
    topN,
    builtAt: input.builtAt ?? Date.now(),
  };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function verifyStarterPack(p: StarterPack, secret?: string): boolean {
  const { sig, ...body } = p;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

export const BLESSING_EMOJI: Record<BlessingBand, string> = {
  unanimous: "🏆",
  supermajority: "🥇",
  majority: "🥈",
  minority: "🥉",
  conflict: "⚖",
  orphan: "🌌",
};

export function formatQuorumLine(q: BlessingQuorum): string {
  return `${BLESSING_EMOJI[q.band]} FEDERATE ${q.toolName} · ${q.band} (${q.validAttestations}/${q.validAttestations + q.forgedDropped} valid · meanFit=${(q.meanFitness * 100).toFixed(0)}%)`;
}

export function formatStarterPackLine(p: StarterPack): string {
  const blessed = p.entries.filter((e) => e.band === "unanimous" || e.band === "supermajority").length;
  return `🌍 STARTER-PACK · top-${p.topN} · ${p.entries.length} total · ${blessed} blessed`;
}
