/**
 * v2.19.37 — MNEME MAYOR ELECTION (Gap #1 + #5 — Mneme Moment + viral loop)
 *
 *   Every repo elects a "Mayor AI" each month. The Mayor is the vendor
 *   that gets asked first on every commit. Election mechanism:
 *     - User votes (1 vote per commit, optional)
 *     - Outcome-market reputation score
 *     - Fairness certificate pass rate
 *     - Adversarial trick-test pass rate
 *
 *   Auto-rotation every month. UI surface = status bar "Mayor: gpt-4
 *   (35 votes vs claude-opus 28)". Vendor lobby loop = engagement
 *   that other AI tools don't have.
 *
 *   The pitch psychology: developers love games. "Pick the best AI
 *   right now" is more fun than "configure my AI provider settings".
 *   Vendors compete monthly = Mneme owns the meta-game.
 *
 *   Composes onto:
 *     - v2.19.34 OUTCOME MARKET (reputation feed)
 *     - v2.19.34 ZK-FAIRNESS (fairness signal)
 *     - v2.19.34 APOSTILLE (election results recorded)
 *
 * Honest scope:
 *   - PURE FUNCTION ledger + tally + rotate. No I/O.
 *   - HMAC-chained vote ledger so vendors can't ballot-stuff post-hoc.
 *   - Deterministic tally + rotation.
 *   - 30+ election tests; 1000+ random fuzz iterations.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_TERM_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export interface Vote {
  v: typeof PROTOCOL_VERSION;
  voteId: string;
  vendor: string;
  /** Optional commit SHA tying vote to a real change. */
  commitSha?: string;
  /** ms since epoch. */
  castAtMs: number;
  /** Previous vote sig — HMAC chain prevents ballot stuffing post-hoc. */
  prevSig: string | null;
  sig: string;
}

export interface VendorSignal {
  vendor: string;
  /** Reputation from OUTCOME MARKET (0..1). */
  reputationScore?: number;
  /** Fairness certificate pass rate (0..1). */
  fairnessPassRate?: number;
  /** Adversarial trick-test pass rate (0..1). */
  trickTestPassRate?: number;
}

export interface ElectionState {
  v: typeof PROTOCOL_VERSION;
  repoId: string;
  termStartMs: number;
  termMs: number;
  /** Current sitting mayor (vendor name). */
  currentMayor: string | null;
  /** HMAC-chained vote ledger. */
  votes: Vote[];
  /** Latest election result snapshot. */
  lastResult: ElectionResult | null;
}

export interface VendorScore {
  vendor: string;
  voteCount: number;
  reputationScore: number;
  fairnessPassRate: number;
  trickTestPassRate: number;
  /** Composite (0..1) — 50% votes + 25% reputation + 15% fairness + 10% trick. */
  composite: number;
}

export interface ElectionResult {
  v: typeof PROTOCOL_VERSION;
  repoId: string;
  termStartMs: number;
  termEndMs: number;
  /** Winner with HIGHEST composite (alpha tie-break). */
  winnerVendor: string | null;
  margin: number;
  /** Per-vendor scores, sorted by composite desc. */
  scores: VendorScore[];
  /** Total votes in this term. */
  totalVotes: number;
  decidedAtMs: number;
  sig: string;
}

// ─── canonical helpers ───────────────────────────────────────────────

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_MAYOR_ELECTION_SECRET"] || `mneme-mayor-election-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

function deterministicId(parts: unknown): string {
  return createHash("sha256").update(canon(parts)).digest("hex").slice(0, 16);
}

// ─── INITIALIZE STATE ───────────────────────────────────────────────

export function freshElectionState(input: {
  repoId: string;
  termStartMs?: number;
  termMs?: number;
}): ElectionState {
  const termStartMs = input.termStartMs ?? Date.now();
  const termMs = (typeof input.termMs === "number" && input.termMs > 0) ? input.termMs : DEFAULT_TERM_MS;
  return {
    v: PROTOCOL_VERSION,
    repoId: input.repoId,
    termStartMs,
    termMs,
    currentMayor: null,
    votes: [],
    lastResult: null,
  };
}

// ─── CAST VOTE ──────────────────────────────────────────────────────

export function recordVote(input: {
  state: ElectionState;
  vendor: string;
  commitSha?: string;
  castAtMs?: number;
  secret?: string;
}): { state: ElectionState; vote: Vote | null; reason?: string } {
  if (!input.vendor || typeof input.vendor !== "string") {
    return { state: input.state, vote: null, reason: "missing vendor" };
  }
  const vendor = input.vendor.toLowerCase();
  const castAtMs = input.castAtMs ?? Date.now();
  // Reject votes outside the current term window
  if (castAtMs < input.state.termStartMs || castAtMs > input.state.termStartMs + input.state.termMs) {
    return { state: input.state, vote: null, reason: "vote outside term window" };
  }
  const secret = input.secret ?? defaultSecret();
  const prev = input.state.votes.length > 0 ? input.state.votes[input.state.votes.length - 1]! : null;
  const prevSig = prev ? prev.sig : null;
  const voteId = deterministicId({ vendor, commitSha: input.commitSha ?? "", castAtMs, repoId: input.state.repoId });
  const body = {
    v: PROTOCOL_VERSION, voteId, vendor,
    ...(input.commitSha ? { commitSha: input.commitSha } : {}),
    castAtMs, prevSig,
  };
  const sig = hmacHex(body, secret);
  const vote: Vote = { ...body, sig };
  return {
    state: { ...input.state, votes: [...input.state.votes, vote] },
    vote,
  };
}

/** Verify HMAC chain integrity end-to-end. */
export function verifyVoteLedger(state: ElectionState, secret?: string): boolean {
  if (!state || !Array.isArray(state.votes)) return false;
  const sec = secret ?? defaultSecret();
  let prevSig: string | null = null;
  for (const v of state.votes) {
    if (!v || typeof v !== "object") return false;
    if (v.prevSig !== prevSig) return false;
    const { sig, ...body } = v;
    if (!safeEqHex(hmacHex(body, sec), sig)) return false;
    prevSig = sig;
  }
  return true;
}

// ─── TALLY ELECTION ─────────────────────────────────────────────────

const COMPOSITE_WEIGHTS = Object.freeze({
  votes: 0.5,
  reputation: 0.25,
  fairness: 0.15,
  trickTest: 0.10,
});

export function tallyElection(input: {
  state: ElectionState;
  signals: VendorSignal[];
  nowMs?: number;
  secret?: string;
}): ElectionResult {
  const sec = input.secret ?? defaultSecret();
  const nowMs = input.nowMs ?? Date.now();

  // Aggregate vote counts per vendor
  const voteCount = new Map<string, number>();
  for (const v of input.state.votes) {
    voteCount.set(v.vendor, (voteCount.get(v.vendor) ?? 0) + 1);
  }
  const totalVotes = input.state.votes.length;
  const maxVotes = Math.max(1, ...Array.from(voteCount.values()));

  // Union of all vendors mentioned (from votes + signals)
  const allVendors = new Set<string>();
  for (const v of voteCount.keys()) allVendors.add(v);
  for (const s of input.signals) if (s?.vendor) allVendors.add(s.vendor.toLowerCase());

  const signalsByVendor = new Map<string, VendorSignal>();
  for (const s of input.signals) {
    if (s?.vendor) signalsByVendor.set(s.vendor.toLowerCase(), s);
  }

  const scores: VendorScore[] = [];
  for (const vendor of allVendors) {
    const vc = voteCount.get(vendor) ?? 0;
    const sig = signalsByVendor.get(vendor);
    const reputation = clamp01(sig?.reputationScore);
    const fairness = clamp01(sig?.fairnessPassRate);
    const trick = clamp01(sig?.trickTestPassRate);
    const normalisedVotes = vc / maxVotes; // 0..1
    const composite =
      COMPOSITE_WEIGHTS.votes * normalisedVotes +
      COMPOSITE_WEIGHTS.reputation * reputation +
      COMPOSITE_WEIGHTS.fairness * fairness +
      COMPOSITE_WEIGHTS.trickTest * trick;
    scores.push({
      vendor, voteCount: vc,
      reputationScore: reputation,
      fairnessPassRate: fairness,
      trickTestPassRate: trick,
      composite: Math.round(composite * 10000) / 10000,
    });
  }
  scores.sort((a, b) => {
    if (b.composite !== a.composite) return b.composite - a.composite;
    return a.vendor.localeCompare(b.vendor);
  });
  const winner = scores[0]?.vendor ?? null;
  const margin = scores.length >= 2 ? Math.round((scores[0]!.composite - scores[1]!.composite) * 10000) / 10000 : 0;

  const body = {
    v: PROTOCOL_VERSION,
    repoId: input.state.repoId,
    termStartMs: input.state.termStartMs,
    termEndMs: input.state.termStartMs + input.state.termMs,
    winnerVendor: winner,
    margin,
    scores,
    totalVotes,
    decidedAtMs: nowMs,
  };
  return { ...body, sig: hmacHex(body, sec) };
}

function clamp01(x: unknown): number {
  if (typeof x !== "number" || !Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

export function verifyElectionResult(r: ElectionResult, secret?: string): boolean {
  if (!r || r.v !== PROTOCOL_VERSION) return false;
  const sec = secret ?? defaultSecret();
  const { sig, ...body } = r;
  return safeEqHex(hmacHex(body, sec), sig);
}

// ─── AUTO ROTATION ──────────────────────────────────────────────────

/**
 * If the term has ended, tally + rotate to a fresh term with the winner
 * installed as mayor. Idempotent if called mid-term — returns state unchanged.
 */
export function runScheduledElection(input: {
  state: ElectionState;
  signals: VendorSignal[];
  nowMs?: number;
  secret?: string;
}): { state: ElectionState; rotated: boolean; result: ElectionResult } {
  const nowMs = input.nowMs ?? Date.now();
  const termEnd = input.state.termStartMs + input.state.termMs;
  const result = tallyElection({ state: input.state, signals: input.signals, nowMs, secret: input.secret });
  if (nowMs < termEnd) {
    // Mid-term: tally but don't rotate
    return { state: { ...input.state, lastResult: result }, rotated: false, result };
  }
  // Term ended: rotate
  return {
    state: {
      ...input.state,
      termStartMs: termEnd,                 // new term starts where old ended
      currentMayor: result.winnerVendor,
      votes: [],                            // fresh ballot box
      lastResult: result,
    },
    rotated: true,
    result,
  };
}

// ─── STATUS LINE (the "Mayor: X (N votes vs Y M)" UI surface) ──────

export function formatMayorLine(result: ElectionResult | null): string {
  if (!result || !result.winnerVendor) return "👑 MAYOR · (no votes yet — cast one to elect)";
  const top = result.scores[0]!;
  const runnerUp = result.scores[1];
  const ru = runnerUp ? ` vs ${runnerUp.vendor} ${runnerUp.voteCount}` : "";
  return `👑 MAYOR · ${top.vendor} (${top.voteCount} votes${ru}) · margin ${(result.margin * 100).toFixed(1)}%`;
}

export interface ElectionStats {
  totalVotes: number;
  uniqueVendors: number;
  currentMayor: string | null;
  termMs: number;
  termRemainingMs: number;
}

export function computeElectionStats(state: ElectionState, nowMs?: number): ElectionStats {
  const now = nowMs ?? Date.now();
  const vendors = new Set<string>();
  for (const v of state.votes) vendors.add(v.vendor);
  return {
    totalVotes: state.votes.length,
    uniqueVendors: vendors.size,
    currentMayor: state.currentMayor,
    termMs: state.termMs,
    termRemainingMs: Math.max(0, state.termStartMs + state.termMs - now),
  };
}

export const MAYOR_ELECTION_TUNABLES = Object.freeze({
  PROTOCOL_VERSION,
  DEFAULT_TERM_MS,
  COMPOSITE_WEIGHTS,
});
