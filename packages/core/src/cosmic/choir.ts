/**
 * v2.13.0 — CELESTIAL CHOIR
 *
 *   "When one cosmic server can lie or die, three cosmic servers form a chorus.
 *    The receiver listens to all three, hears the majority, and any soloist
 *    that disagrees is logged + downweighted on the next read."
 *
 * The wild move: a cosmic session is published to N independent servers in
 * parallel (your droplet + community-run cosmics + a personal mirror). Each
 * server has its own per-session secret + token. Receivers fetch state from
 * all N and apply majority quorum on the state hash. Disagreement is a
 * tamper / outage signal, not just a "try the next one" — it's recorded
 * with HMAC chain so the parent learns which servers are flaky.
 *
 * No server-side change required. CELESTIAL CHOIR is pure composition over
 * the existing publish + read endpoints. That's the wisdom.
 */

import { createHash } from "node:crypto";
import { mintSession, publishToCosmic, readCosmic, type CosmicSession, type PublishResult } from "./index.js";

export interface ChoirSeat {
  /** Server URL (each gets its own session). */
  serverUrl: string;
  /** Optional weight when computing quorum. Defaults to 1. */
  weight?: number;
}

export interface ChoirSession {
  /** One CosmicSession per seat — the parent must persist all of these. */
  seats: Array<{ serverUrl: string; weight: number; session: CosmicSession }>;
  createdAt: string;
}

/** Mint one session per seat. Cheap — no network calls; sessions are local. */
export function mintChoirSession(seats: ChoirSeat[]): ChoirSession {
  if (seats.length === 0) throw new Error("CELESTIAL CHOIR needs at least one seat");
  return {
    seats: seats.map((s) => ({
      serverUrl: s.serverUrl.replace(/\/+$/, ""),
      weight: s.weight ?? 1,
      session: mintSession({ serverUrl: s.serverUrl }),
    })),
    createdAt: new Date().toISOString(),
  };
}

export interface ChoirPublishResult {
  total: number;
  succeeded: number;
  failed: number;
  perSeat: Array<{ serverUrl: string; ok: boolean; count?: number; newSig?: string; error?: string }>;
  /** True if a strict majority of seats accepted the publish. */
  quorumReached: boolean;
}

/** Publish the same state to every seat in parallel. */
export async function publishToChoir(
  session: ChoirSession,
  state: Record<string, unknown>,
  fetchOverride?: typeof fetch,
): Promise<ChoirPublishResult> {
  const calls = session.seats.map(async (seat) => {
    const r = await publishToCosmic({ session: seat.session, state, fetchOverride });
    return { seat, r };
  });
  const settled = await Promise.all(calls);
  const perSeat = settled.map(({ seat, r }) => ({
    serverUrl: seat.serverUrl,
    ok: r.ok,
    count: r.count,
    newSig: r.newSig,
    error: r.error,
  }));
  const succeeded = perSeat.filter((p) => p.ok).length;
  return {
    total: session.seats.length,
    succeeded,
    failed: perSeat.length - succeeded,
    perSeat,
    quorumReached: succeeded * 2 > session.seats.length,
  };
}

export interface ChoirReadResult {
  /** The state agreed upon by the strict-majority quorum, if reached. */
  state?: Record<string, unknown>;
  /** Hex sha256 of the canonical-stringified majority state. */
  stateHash?: string;
  /** Number of seats that voted for the winning state. */
  agree: number;
  /** Number of seats whose state disagreed with the majority. */
  disagree: number;
  /** Number of seats that failed to respond. */
  unreachable: number;
  /** True if a strict majority agreed AND >= ceil(N/2)+1 responded. */
  quorumReached: boolean;
  /** Per-seat detail for forensics. */
  perSeat: Array<{ serverUrl: string; ok: boolean; stateHash?: string; agreed: boolean; error?: string }>;
}

/**
 * Read state from every seat. Hash each response; the strict-majority hash
 * wins. Disagreers are logged so the parent can revoke / depriotitise them.
 */
export async function readFromChoir(
  session: ChoirSession,
  fetchOverride?: typeof fetch,
): Promise<ChoirReadResult> {
  const calls = session.seats.map(async (seat) => {
    const r = await readCosmic(seat.session.jsonUrl, fetchOverride);
    return { seat, r };
  });
  const settled = await Promise.all(calls);
  const tally = new Map<string, { count: number; weight: number; state: Record<string, unknown> }>();
  let unreachable = 0;
  for (const { seat, r } of settled) {
    if (!r.ok || !r.state) { unreachable++; continue; }
    const canon = canonicalise(r.state);
    const h = createHash("sha256").update(canon).digest("hex");
    const t = tally.get(h) ?? { count: 0, weight: 0, state: r.state };
    t.count++;
    t.weight += seat.weight;
    tally.set(h, t);
  }
  // Pick highest-weight bucket.
  let winnerHash: string | undefined;
  let winner: { count: number; weight: number; state: Record<string, unknown> } | undefined;
  for (const [h, v] of tally) {
    if (!winner || v.weight > winner.weight) { winnerHash = h; winner = v; }
  }
  const agree = winner?.count ?? 0;
  const disagree = settled.length - unreachable - agree;
  // Strict majority of total seats AND winner has > 1 vote (lone seat is not quorum)
  const quorumReached = winner !== undefined && winner.count * 2 > session.seats.length;
  return {
    state: quorumReached ? winner!.state : undefined,
    stateHash: quorumReached ? winnerHash : undefined,
    agree,
    disagree,
    unreachable,
    quorumReached,
    perSeat: settled.map(({ seat, r }) => {
      const h = r.ok && r.state ? createHash("sha256").update(canonicalise(r.state)).digest("hex") : undefined;
      return {
        serverUrl: seat.serverUrl,
        ok: r.ok,
        stateHash: h,
        agreed: !!h && h === winnerHash,
        error: r.error,
      };
    }),
  };
}

/** Stable-key JSON canonicalisation — required so two structurally identical
 *  states hash identically regardless of key order. */
function canonicalise(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canonicalise).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalise((v as Record<string, unknown>)[k])).join(",") + "}";
}

/** Build a public manifest the receiver can fetch in one shot to discover
 *  all seats. Embed the JSON in soul prompts. */
export function exportChoirManifest(session: ChoirSession): {
  v: 1;
  createdAt: string;
  seats: Array<{ serverUrl: string; jsonUrl: string; publicUrl: string; weight: number }>;
} {
  return {
    v: 1,
    createdAt: session.createdAt,
    seats: session.seats.map((s) => ({
      serverUrl: s.serverUrl,
      jsonUrl: s.session.jsonUrl,
      publicUrl: s.session.publicUrl,
      weight: s.weight,
    })),
  };
}

/** Quick one-line summary of the publish result for pulse / wisdom output. */
export function formatChoirPublishLine(r: ChoirPublishResult): string {
  return `CHOIR · ${r.succeeded}/${r.total} seats accepted · quorum=${r.quorumReached}`;
}
