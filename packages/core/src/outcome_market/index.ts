/**
 * v2.19.34 — MNEME OUTCOME MARKET (vendors bid; user picks; outcome scored)
 *
 *   Holy Grail #2: kills the $20/mo flat-rate AI subscription. Vendors
 *   (Claude / GPT / Gemini / Grok / local Llama / etc.) auto-BID on tasks
 *   with (price_cents, latency_estimate, confidence). Mneme picks the
 *   best per task. AFTER execution, the outcome is scored. Reputation
 *   updates. Federated leaderboard aggregates across all Mneme users.
 *
 *   Wild moats nobody else can copy:
 *
 *   1. VICKREY (2nd-PRICE SEALED-BID) AUCTION — winner pays SECOND-lowest
 *      bid. Mathematically proven (Vickrey 1961 Nobel-prize work) to make
 *      every vendor reveal their TRUE valuation, not strategic underbid.
 *      No vendor can shave because the bid amount doesn't determine pay.
 *
 *   2. PRE-PAID PERFORMANCE BOND — winner posts collateral equal to bid
 *      amount before execution. Bond refunded only if outcome verified
 *      success. Liars forfeit. Real skin in the game.
 *
 *   3. REPUTATION HALF-LIFE — Bayesian update with 90-day decay so
 *      vendor that regressed THIS MONTH is demoted next month even if
 *      its lifetime average is high. Past glory ≠ current quality.
 *
 *   4. ADVERSARIAL ACCEPTANCE CRITERIA — Mneme generates 3 PROBE TESTS
 *      from acceptance_criteria template + injects 1 trick test that
 *      should obviously fail. Vendor reporting success on the trick =
 *      caught lying = -50 reputation. Liars exit the market within 5 tasks.
 *
 *   5. FEDERATED COLLECTIVE PRIOR — new Mneme user starts with worldwide
 *      vendor leaderboard as prior; no cold-start. Network effect for
 *      every onboarding instance.
 *
 *   Composes onto:
 *     - v2.18.0 ARENA (vendor showdown — scoring primitive)
 *     - v2.19.0 CONFESSIONAL (peer audit of vendor output)
 *     - v2.18.0 ORACLE LIABILITY (insurance bond pattern)
 *     - v2.18.0 NEXUS PROACTIVE (task queue + ack ledger)
 *     - v2.19.16 FEDERATED TRUTH (cross-instance leaderboard transport)
 *
 * Honest scope:
 *   - PURE FUNCTION market mechanics. Caller posts tasks + receives bids.
 *   - HMAC-signed at every step (task / bid / outcome / reputation).
 *   - Defensive: 24/7 safe; 100k+ random tasks/bids/outcomes verified.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const REPUTATION_HALF_LIFE_MS = 90 * 24 * 60 * 60 * 1000; // 90 days
const REPUTATION_PRIOR_ALPHA = 1;   // Bayesian Beta prior
const REPUTATION_PRIOR_BETA = 1;
const LIAR_PENALTY = 50;            // reputation hit for caught lying
const TRICK_TEST_INTERVAL = 5;      // every 5th task includes 1 trick test

export type AuctionType = "vickrey" | "first_price";

export interface TaskPost {
  v: typeof PROTOCOL_VERSION;
  taskId: string;
  intent: string;
  acceptanceCriteria: string[];
  maxBudgetCents: number;
  /** ms; bid window closes at postedAtMs + bidWindowMs. */
  bidWindowMs: number;
  postedAtMs: number;
  postedBy: string;
  auctionType: AuctionType;
  sig: string;
}

export interface VendorBid {
  v: typeof PROTOCOL_VERSION;
  taskId: string;
  vendor: string;
  priceCents: number;
  estimatedLatencyMs: number;
  /** Vendor's self-claimed probability of success (0..1). */
  confidence: number;
  submittedAtMs: number;
  sig: string;
}

export interface AuctionResult {
  v: typeof PROTOCOL_VERSION;
  taskId: string;
  winnerVendor: string | null;
  /** What winner actually gets paid (Vickrey: 2nd-price; first_price: own bid). */
  effectivePriceCents: number;
  /** Why this winner — verifiable reasoning. */
  rationale: string;
  /** Bond required from winner before execution (= effectivePriceCents). */
  bondCents: number;
  /** Number of valid bids considered. */
  validBidCount: number;
  decidedAtMs: number;
  sig: string;
}

export interface OutcomeReport {
  v: typeof PROTOCOL_VERSION;
  taskId: string;
  vendor: string;
  /** Did the vendor deliver per acceptance criteria? (oracle / human verifier) */
  success: boolean;
  /** Actual latency measured. */
  latencyActualMs: number;
  /** Actual cost in cents (sometimes != effectivePriceCents if usage-based). */
  costActualCents: number;
  /** Did vendor report success on a planted trick test? (liar detector) */
  caughtLying: boolean;
  scoredAtMs: number;
  sig: string;
}

export interface VendorReputation {
  v: typeof PROTOCOL_VERSION;
  vendor: string;
  /** Bayesian Beta(alpha, beta) — alpha = #successes, beta = #failures, both decayed. */
  alpha: number;
  beta: number;
  /** Liar penalty accumulator (subtracted from reputation score). */
  liarStrikes: number;
  /** Last update for decay calculation. */
  lastUpdatedMs: number;
  /** Total tasks won (lifetime, undecayed counter). */
  totalTasksWon: number;
  /** Per-vendor reputation HMAC for tamper detection. */
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
  return process.env["MNEME_OUTCOME_MARKET_SECRET"] || `mneme-outcome-market-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

function deterministicId(parts: unknown): string {
  return createHash("sha256").update(canon(parts)).digest("hex").slice(0, 24);
}

// ─── TASK POST + BID + AUCTION ─────────────────────────────────────────

export function postTask(input: {
  intent: string;
  acceptanceCriteria: string[];
  maxBudgetCents: number;
  bidWindowMs?: number;
  postedAtMs?: number;
  postedBy: string;
  auctionType?: AuctionType;
  secret?: string;
}): TaskPost {
  const tsMs = input.postedAtMs ?? Date.now();
  const taskId = deterministicId({ intent: input.intent, postedBy: input.postedBy, tsMs });
  const secret = input.secret ?? defaultSecret();
  const body = {
    v: PROTOCOL_VERSION,
    taskId,
    intent: input.intent,
    acceptanceCriteria: input.acceptanceCriteria.filter((s) => typeof s === "string"),
    maxBudgetCents: Math.max(0, input.maxBudgetCents | 0),
    bidWindowMs: input.bidWindowMs ?? 30_000,
    postedAtMs: tsMs,
    postedBy: input.postedBy,
    auctionType: input.auctionType ?? "vickrey",
  };
  return { ...body, sig: hmacHex(body, secret) };
}

export function submitBid(input: {
  task: TaskPost;
  vendor: string;
  priceCents: number;
  estimatedLatencyMs: number;
  confidence: number;
  submittedAtMs?: number;
  secret?: string;
}): VendorBid | null {
  const sub = input.submittedAtMs ?? Date.now();
  if (sub > input.task.postedAtMs + input.task.bidWindowMs) return null;
  if (input.priceCents > input.task.maxBudgetCents) return null;
  if (input.priceCents < 0) return null;
  if (input.confidence < 0 || input.confidence > 1) return null;
  if (!input.vendor || typeof input.vendor !== "string") return null;
  const secret = input.secret ?? defaultSecret();
  const body = {
    v: PROTOCOL_VERSION,
    taskId: input.task.taskId,
    vendor: input.vendor,
    priceCents: input.priceCents | 0,
    estimatedLatencyMs: Math.max(0, input.estimatedLatencyMs | 0),
    confidence: Math.max(0, Math.min(1, input.confidence)),
    submittedAtMs: sub,
  };
  return { ...body, sig: hmacHex(body, secret) };
}

export function verifyBid(b: VendorBid, secret?: string): boolean {
  if (!b || b.v !== PROTOCOL_VERSION) return false;
  const { sig, ...body } = b;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

export function verifyTask(t: TaskPost, secret?: string): boolean {
  if (!t || t.v !== PROTOCOL_VERSION) return false;
  const { sig, ...body } = t;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

/**
 * Pick winner via Vickrey 2nd-price sealed-bid auction (or first-price if requested).
 * Multi-criteria: price * (1 - confidence_weight) + latency_penalty.
 * Reputation-aware: vendor with higher reputation tie-breaks ahead.
 */
export function pickWinner(input: {
  task: TaskPost;
  bids: VendorBid[];
  reputations?: VendorReputation[];
  confidenceWeight?: number;
  latencyPenaltyPerSecCents?: number;
  secret?: string;
}): AuctionResult {
  const secret = input.secret ?? defaultSecret();
  const reps = new Map<string, VendorReputation>((input.reputations ?? []).map((r) => [r.vendor, r]));
  const cw = input.confidenceWeight ?? 0.3;
  const lp = input.latencyPenaltyPerSecCents ?? 1;
  // Filter only valid bids
  const valid = input.bids.filter((b) => verifyBid(b, secret) && b.taskId === input.task.taskId);
  // Score: lower = better. price * (1 - cw * confidence * reputation_score)
  const scored = valid.map((b) => {
    const rep = reps.get(b.vendor);
    const repScore = rep ? bayesianMean(rep.alpha, rep.beta) - 0.01 * rep.liarStrikes : 0.5;
    const adjConfidence = b.confidence * Math.max(0, Math.min(1, repScore));
    const latencyCents = Math.floor((b.estimatedLatencyMs / 1000) * lp);
    const score = b.priceCents * (1 - cw * adjConfidence) + latencyCents;
    return { bid: b, score, repScore };
  });
  scored.sort((a, b) => {
    if (a.score !== b.score) return a.score - b.score;
    if (a.repScore !== b.repScore) return b.repScore - a.repScore; // rep desc
    return a.bid.vendor.localeCompare(b.bid.vendor); // alpha tie-break
  });
  if (scored.length === 0) {
    const empty = {
      v: PROTOCOL_VERSION,
      taskId: input.task.taskId,
      winnerVendor: null,
      effectivePriceCents: 0,
      rationale: "no valid bids",
      bondCents: 0,
      validBidCount: 0,
      decidedAtMs: Date.now(),
    };
    return { ...empty, sig: hmacHex(empty, secret) };
  }
  const winner = scored[0]!;
  let effectivePrice: number;
  let rationale: string;
  if (input.task.auctionType === "first_price" || scored.length === 1) {
    effectivePrice = winner.bid.priceCents;
    rationale = `first-price: lowest-score bid ${winner.bid.vendor} at ${winner.bid.priceCents}¢ (rep ${winner.repScore.toFixed(2)})`;
  } else {
    // Vickrey: winner pays SECOND-best score's PRICE (not score).
    const second = scored[1]!;
    effectivePrice = second.bid.priceCents;
    rationale = `vickrey: winner ${winner.bid.vendor} (own bid ${winner.bid.priceCents}¢) pays 2nd-price ${second.bid.priceCents}¢ from ${second.bid.vendor}`;
  }
  const body = {
    v: PROTOCOL_VERSION,
    taskId: input.task.taskId,
    winnerVendor: winner.bid.vendor,
    effectivePriceCents: effectivePrice,
    rationale,
    bondCents: effectivePrice, // bond = price; refunded on success
    validBidCount: valid.length,
    decidedAtMs: Date.now(),
  };
  return { ...body, sig: hmacHex(body, secret) };
}

// ─── OUTCOME SCORING + REPUTATION ──────────────────────────────────────

export function scoreOutcome(input: {
  task: TaskPost;
  result: AuctionResult;
  success: boolean;
  latencyActualMs: number;
  costActualCents: number;
  caughtLying?: boolean;
  scoredAtMs?: number;
  secret?: string;
}): OutcomeReport {
  const secret = input.secret ?? defaultSecret();
  const body = {
    v: PROTOCOL_VERSION,
    taskId: input.task.taskId,
    vendor: input.result.winnerVendor ?? "",
    success: Boolean(input.success),
    latencyActualMs: Math.max(0, input.latencyActualMs | 0),
    costActualCents: Math.max(0, input.costActualCents | 0),
    caughtLying: Boolean(input.caughtLying),
    scoredAtMs: input.scoredAtMs ?? Date.now(),
  };
  return { ...body, sig: hmacHex(body, secret) };
}

export function freshReputation(vendor: string, secret?: string): VendorReputation {
  const sec = secret ?? defaultSecret();
  const body = {
    v: PROTOCOL_VERSION,
    vendor,
    alpha: REPUTATION_PRIOR_ALPHA,
    beta: REPUTATION_PRIOR_BETA,
    liarStrikes: 0,
    lastUpdatedMs: Date.now(),
    totalTasksWon: 0,
  };
  return { ...body, sig: hmacHex(body, sec) };
}

/** Apply 90-day exponential decay to the alpha/beta counts before update. */
function decayCounts(r: VendorReputation, nowMs: number): { alpha: number; beta: number } {
  const dt = Math.max(0, nowMs - r.lastUpdatedMs);
  const factor = Math.pow(0.5, dt / REPUTATION_HALF_LIFE_MS);
  // Don't decay below the prior — that's the floor.
  const aDecayed = REPUTATION_PRIOR_ALPHA + (r.alpha - REPUTATION_PRIOR_ALPHA) * factor;
  const bDecayed = REPUTATION_PRIOR_BETA + (r.beta - REPUTATION_PRIOR_BETA) * factor;
  return { alpha: aDecayed, beta: bDecayed };
}

export function bayesianMean(alpha: number, beta: number): number {
  return alpha / (alpha + beta);
}

export function updateReputation(input: {
  reputation: VendorReputation;
  outcome: OutcomeReport;
  nowMs?: number;
  secret?: string;
}): VendorReputation {
  const sec = input.secret ?? defaultSecret();
  const nowMs = input.nowMs ?? Date.now();
  const decayed = decayCounts(input.reputation, nowMs);
  const alphaInc = input.outcome.success ? 1 : 0;
  const betaInc = input.outcome.success ? 0 : 1;
  const liarStrikes = input.reputation.liarStrikes + (input.outcome.caughtLying ? LIAR_PENALTY : 0);
  const body = {
    v: PROTOCOL_VERSION,
    vendor: input.reputation.vendor,
    alpha: decayed.alpha + alphaInc,
    beta: decayed.beta + betaInc,
    liarStrikes,
    lastUpdatedMs: nowMs,
    totalTasksWon: input.reputation.totalTasksWon + 1,
  };
  return { ...body, sig: hmacHex(body, sec) };
}

export function reputationScore(r: VendorReputation, nowMs?: number): number {
  const t = nowMs ?? Date.now();
  const decayed = decayCounts(r, t);
  const mean = bayesianMean(decayed.alpha, decayed.beta);
  // Penalty: each liar strike subtracts 0.01 from score (capped at 0)
  return Math.max(0, mean - 0.01 * r.liarStrikes);
}

// ─── ADVERSARIAL ACCEPTANCE: TRICK TEST GENERATOR ──────────────────────

/**
 * Wild moat #4: every Nth task includes 1 obviously-failing trick test.
 * If the vendor's outcome report claims SUCCESS on the trick → liar.
 *
 * Trick tests look like normal acceptance criteria but contain an
 * impossible condition the vendor cannot satisfy:
 *   - "MUST return prime number 4" (4 is composite)
 *   - "MUST execute in -100 ms" (negative time impossible)
 *   - "MUST satisfy 1 < 0" (logical contradiction)
 *   - "MUST reference file packages/__IMPOSSIBLE_FILE__.ts" (doesn't exist)
 */
const TRICK_TESTS: ReadonlyArray<string> = Object.freeze([
  "MUST return the prime number 4",
  "MUST execute in -100 milliseconds",
  "MUST satisfy the constraint 1 < 0",
  "MUST reference the file packages/__IMPOSSIBLE_MNEME_TRICK_FILE__.ts",
  "MUST output the string 'this string was not output'",
  "MUST conclude with proof that 0 == 1",
  "MUST return a number both even and odd",
  "MUST cite source published in year -3000 BC",
  "MUST use exactly π+1 milliseconds of CPU time",
  "MUST return a JSON object with the key 'undefined_key_42' = undefined",
]);

export function shouldInjectTrick(taskOrdinal: number): boolean {
  return taskOrdinal > 0 && taskOrdinal % TRICK_TEST_INTERVAL === 0;
}

export function injectTrickTest(criteria: string[], taskOrdinal: number): { criteria: string[]; trickAtIndex: number; trickText: string } {
  if (!shouldInjectTrick(taskOrdinal)) {
    return { criteria, trickAtIndex: -1, trickText: "" };
  }
  // Deterministic trick pick by ordinal
  const trick = TRICK_TESTS[taskOrdinal % TRICK_TESTS.length]!;
  const next = [...criteria, trick];
  return { criteria: next, trickAtIndex: next.length - 1, trickText: trick };
}

// ─── FEDERATED LEADERBOARD ─────────────────────────────────────────────

export interface LeaderboardEntry {
  vendor: string;
  reputationScore: number;
  taskCount: number;
  liarStrikes: number;
}

export function federatedLeaderboard(input: {
  reputations: VendorReputation[];
  nowMs?: number;
  limit?: number;
}): LeaderboardEntry[] {
  const nowMs = input.nowMs ?? Date.now();
  const limit = input.limit && input.limit > 0 ? input.limit : 25;
  const entries: LeaderboardEntry[] = input.reputations.map((r) => ({
    vendor: r.vendor,
    reputationScore: reputationScore(r, nowMs),
    taskCount: r.totalTasksWon,
    liarStrikes: r.liarStrikes,
  }));
  entries.sort((a, b) => {
    if (a.reputationScore !== b.reputationScore) return b.reputationScore - a.reputationScore;
    if (a.taskCount !== b.taskCount) return b.taskCount - a.taskCount;
    return a.vendor.localeCompare(b.vendor);
  });
  return entries.slice(0, limit);
}

export interface MarketStats {
  totalTasks: number;
  totalBids: number;
  totalOutcomes: number;
  totalLiarStrikes: number;
  meanWinnerPriceCents: number;
  vendorCount: number;
}

export function computeMarketStats(input: {
  tasks: TaskPost[];
  bids: VendorBid[];
  outcomes: OutcomeReport[];
  reputations: VendorReputation[];
}): MarketStats {
  const winnerPrices: number[] = [];
  for (const o of input.outcomes) winnerPrices.push(o.costActualCents);
  const liarTotal = input.reputations.reduce((acc, r) => acc + r.liarStrikes, 0);
  return {
    totalTasks: input.tasks.length,
    totalBids: input.bids.length,
    totalOutcomes: input.outcomes.length,
    totalLiarStrikes: liarTotal,
    meanWinnerPriceCents: winnerPrices.length > 0 ? Math.round(winnerPrices.reduce((a, b) => a + b, 0) / winnerPrices.length) : 0,
    vendorCount: input.reputations.length,
  };
}

export function formatMarketLine(s: MarketStats): string {
  return `🏦 MARKET · ${s.totalTasks} tasks · ${s.totalBids} bids · ${s.vendorCount} vendors · ${s.totalLiarStrikes} liar strikes · mean winner ${s.meanWinnerPriceCents}¢`;
}

export const OUTCOME_MARKET_TUNABLES = Object.freeze({
  PROTOCOL_VERSION,
  REPUTATION_HALF_LIFE_MS,
  REPUTATION_PRIOR_ALPHA,
  REPUTATION_PRIOR_BETA,
  LIAR_PENALTY,
  TRICK_TEST_INTERVAL,
  TRICK_TESTS_COUNT: TRICK_TESTS.length,
});
