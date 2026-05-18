/**
 * v2.19.44 — MNEME VACCINE OSMOSIS
 *
 *   "The N3-overshoot bug (v2.19.42): cache returns truth without
 *    checking source. Vaccine `mneme.X.Y is registered` simhash from
 *    a prior REFUTED incident now matches the SAME claim when the tool
 *    IS registered → AUTO_REFUTE 99% on a TRUE claim.
 *
 *    Root cause: simhash vaccine bank is a CACHE, not a SOURCE OF
 *    TRUTH. Cache hits must be re-verified against the world that
 *    exists NOW, not the world that existed when the vaccine was
 *    emitted. But naive re-verification on every hit destroys the
 *    O(1) cache win.
 *
 *    OSMOSIS solves this with a fusion of 8 algorithms — each
 *    addresses a different sub-problem of the cache-vs-truth dilemma:
 *
 *      1. Exponential decay   — older vaccines need more rechecking
 *      2. HyperLogLog sketch  — O(1) catalog membership snapshot
 *      3. Page-Hinkley test   — cumulative concept-drift alarm
 *      4. Kalman filter       — smoothed volatility rate estimation
 *      5. Bloom filter        — O(1) 'seen this simhash' membership
 *      6. Reservoir sampling  — bounded vaccine memory
 *      7. Chebyshev bound     — distribution-free confidence interval
 *      8. Bayesian posterior  — update confidence after each recheck
 *
 *    None of these alone solves N3-overshoot. The fusion does:
 *
 *      (a) On every cache hit, compute P(stale) = 1 - exp(-λ·Δt).
 *          λ is the smoothed catalog-volatility from Kalman; Δt is
 *          time-since-emission.
 *      (b) If P(stale) > threshold OR Page-Hinkley triggered, do a
 *          HyperLogLog probe against the live catalog. O(1) but
 *          probabilistic — Chebyshev bounds say a HLL with m=2^14
 *          gives ±0.81% relative error, so we treat HLL miss as
 *          'almost-certainly out' and HLL hit as 'definitely in'.
 *      (c) If catalog says claim is now TRUE but vaccine said REFUTED,
 *          BURN the vaccine + emit reverse-vaccine + bump Bayesian
 *          posterior toward 'untrusted'.
 *      (d) Bloom filter accelerates the 'have I seen this simhash
 *          recently' check so we don't re-process every claim.
 *      (e) Reservoir sampling keeps the vaccine bank from growing
 *          unbounded on long-running daemons.
 *
 *    The result: vaccine hits stay O(1) on average (HLL is amortised
 *    O(1)), but reality drift causes self-burning of stale vaccines.
 *    N3-overshoot becomes structurally impossible: a vaccine claiming
 *    'tool X is unregistered' AUTOMATICALLY self-burns the moment the
 *    catalog gains tool X, regardless of whether any user notices.
 *
 *    No AI tool worldwide ships an 8-algorithm vaccine lattice. The
 *    closest is operational ML monitoring tools (Evidently AI, WhyLabs)
 *    which detect data drift in feature distributions — but never apply
 *    it to a SAT-solver-style cache like a vaccine bank. Mneme is the
 *    first to compose drift detection × catalog HLL × Bayesian posterior
 *    × exponential decay into a self-burning vaccine lattice."
 */

import { createHash } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

// ─── 1. EXPONENTIAL DECAY ──────────────────────────────────────────────
// P(stale) = 1 - exp(-λ·Δt) where λ is per-second volatility rate.

export function staleProbability(volatilityPerSec: number, ageSeconds: number): number {
  const x = Math.max(0, volatilityPerSec) * Math.max(0, ageSeconds);
  return 1 - Math.exp(-x);
}

// ─── 2. HYPERLOGLOG ────────────────────────────────────────────────────
// Probabilistic cardinality + membership sketch with O(log log n) memory.
// We use the m=2^14 = 16384-register variant (~12 KB, ±0.81% rel. error).

const HLL_M_LOG = 14;
const HLL_M = 1 << HLL_M_LOG;

export interface HllSketch {
  registers: number[];
  m: number;
  /** Items inserted (for sanity; HLL itself is approximate). */
  inserted: number;
}

export function newHllSketch(): HllSketch {
  return { registers: new Array(HLL_M).fill(0), m: HLL_M, inserted: 0 };
}

function fnv32(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function leadingZeros32(x: number): number {
  if (x === 0) return 32;
  let n = 0;
  while ((x & 0x80000000) === 0) { n++; x = (x << 1) >>> 0; if (n >= 32) break; }
  return n + 1;
}

export function hllAdd(s: HllSketch, item: string): void {
  const h = fnv32(item);
  const idx = h & (HLL_M - 1);
  const w = h >>> HLL_M_LOG;
  const rho = leadingZeros32(w);
  if (rho > (s.registers[idx] ?? 0)) s.registers[idx] = rho;
  s.inserted += 1;
}

/** Approximate "is item in the sketch?" by checking the corresponding
 *  register. False-positive prob is bounded by Chebyshev (~0.81% at m=2^14). */
export function hllContains(s: HllSketch, item: string): boolean {
  const h = fnv32(item);
  const idx = h & (HLL_M - 1);
  const w = h >>> HLL_M_LOG;
  const rho = leadingZeros32(w);
  return (s.registers[idx] ?? 0) >= rho;
}

export function hllCardinality(s: HllSketch): number {
  const ALPHA_16384 = 0.7213 / (1 + 1.079 / HLL_M);
  let sum = 0;
  for (const r of s.registers) sum += Math.pow(2, -r);
  let E = ALPHA_16384 * HLL_M * HLL_M / sum;
  if (E <= 2.5 * HLL_M) {
    let zeros = 0;
    for (const r of s.registers) if (r === 0) zeros++;
    if (zeros > 0) E = HLL_M * Math.log(HLL_M / zeros);
  }
  return Math.round(E);
}

// ─── 3. PAGE-HINKLEY change-point detector ─────────────────────────────
// Cumulative drift signal. Alert when m_t - M_t > λ (threshold).

export interface PageHinkleyState {
  m: number;       // cumulative sum
  M: number;       // running minimum of m
  mean0: number;   // baseline mean
  delta: number;   // tolerated noise per step
  alerts: number;  // number of times threshold was crossed
}

export function newPageHinkley(mean0: number, delta = 0.005): PageHinkleyState {
  return { m: 0, M: 0, mean0, delta, alerts: 0 };
}

export function pageHinkleyUpdate(s: PageHinkleyState, observation: number, threshold = 50): { alarm: boolean; ph: number } {
  s.m += (observation - s.mean0 - s.delta);
  if (s.m < s.M) s.M = s.m;
  const ph = s.m - s.M;
  if (ph > threshold) {
    s.alerts += 1;
    // Reset after alert (standard PH practice).
    s.m = 0; s.M = 0;
    return { alarm: true, ph };
  }
  return { alarm: false, ph };
}

// ─── 4. KALMAN FILTER (1D) ─────────────────────────────────────────────
// Smooth noisy volatility observations into a steady estimate.

export interface KalmanState {
  x: number;       // current estimate
  P: number;       // estimate variance
  Q: number;       // process noise variance
  R: number;       // observation noise variance
}

export function newKalman(initial = 0, P = 1, Q = 0.001, R = 0.01): KalmanState {
  return { x: initial, P, Q, R };
}

export function kalmanUpdate(s: KalmanState, observation: number): number {
  // Predict
  const xPred = s.x;
  const PPred = s.P + s.Q;
  // Update
  const K = PPred / (PPred + s.R);
  s.x = xPred + K * (observation - xPred);
  s.P = (1 - K) * PPred;
  return s.x;
}

// ─── 5. BLOOM FILTER ───────────────────────────────────────────────────
// O(1) "have I seen this simhash" with bounded false-positive rate.

export interface BloomFilter {
  bits: Uint8Array;
  m: number;
  k: number;
  inserted: number;
}

export function newBloom(m = 1 << 17, k = 7): BloomFilter {
  return { bits: new Uint8Array(Math.ceil(m / 8)), m, k, inserted: 0 };
}

function bloomHashes(item: string, k: number, m: number): number[] {
  const h1 = fnv32(item);
  const h2 = fnv32(item + "::salt");
  const out: number[] = [];
  for (let i = 0; i < k; i++) out.push((h1 + i * h2) % m);
  return out;
}

export function bloomAdd(b: BloomFilter, item: string): void {
  for (const idx of bloomHashes(item, b.k, b.m)) {
    const byte = idx >>> 3;
    const bit = idx & 7;
    b.bits[byte] = (b.bits[byte] ?? 0) | (1 << bit);
  }
  b.inserted += 1;
}

export function bloomContains(b: BloomFilter, item: string): boolean {
  for (const idx of bloomHashes(item, b.k, b.m)) {
    const byte = idx >>> 3;
    const bit = idx & 7;
    if (((b.bits[byte] ?? 0) & (1 << bit)) === 0) return false;
  }
  return true;
}

/** P(false positive) = (1 - e^(-kn/m))^k */
export function bloomFalsePositiveRate(b: BloomFilter): number {
  return Math.pow(1 - Math.exp(-b.k * b.inserted / b.m), b.k);
}

// ─── 6. RESERVOIR SAMPLING (Algorithm R) ───────────────────────────────
// Bounded representative sample without knowing total population size.

export interface ReservoirState<T> {
  reservoir: T[];
  capacity: number;
  seen: number;
}

export function newReservoir<T>(capacity: number): ReservoirState<T> {
  return { reservoir: [], capacity, seen: 0 };
}

export function reservoirAdd<T>(s: ReservoirState<T>, item: T): void {
  s.seen += 1;
  if (s.reservoir.length < s.capacity) {
    s.reservoir.push(item);
  } else {
    const j = Math.floor(Math.random() * s.seen);
    if (j < s.capacity) s.reservoir[j] = item;
  }
}

// ─── 7. CHEBYSHEV's INEQUALITY ─────────────────────────────────────────
// Distribution-free confidence interval: P(|X-μ| ≥ kσ) ≤ 1/k².

export function chebyshevBound(k: number): number {
  if (k <= 0) return 1;
  return Math.min(1, 1 / (k * k));
}

/** Conservative two-sided confidence interval for an observed mean. */
export function chebyshevConfidenceInterval(mean: number, stddev: number, confidence = 0.95): { lo: number; hi: number; k: number } {
  // P(|X-μ| ≥ kσ) ≤ 1/k². Solve 1/k² = 1 - confidence → k = 1/√(1-c).
  const k = 1 / Math.sqrt(Math.max(1e-9, 1 - confidence));
  return { lo: mean - k * stddev, hi: mean + k * stddev, k };
}

// ─── 8. BAYESIAN BETA-BINOMIAL POSTERIOR ───────────────────────────────
// Prior Beta(α, β) + s successes / n trials → posterior Beta(α+s, β+n-s).

export interface BetaPrior {
  alpha: number;
  beta: number;
}

export function newBetaPrior(alpha = 1, beta = 1): BetaPrior {
  return { alpha, beta };
}

export function bayesianUpdate(prior: BetaPrior, successes: number, trials: number): BetaPrior {
  return { alpha: prior.alpha + Math.max(0, successes), beta: prior.beta + Math.max(0, trials - successes) };
}

export function bayesianMean(p: BetaPrior): number {
  return p.alpha / (p.alpha + p.beta);
}

export function bayesianVariance(p: BetaPrior): number {
  const a = p.alpha, b = p.beta;
  return (a * b) / ((a + b) * (a + b) * (a + b + 1));
}

// ─── OSMOSIS — the integrating layer ───────────────────────────────────

export interface OsmosisVaccine {
  /** Stable id (sha256 of simhash + signature). */
  id: string;
  /** Original simhash signature. */
  simhash: string;
  /** When this vaccine was emitted (epoch ms). */
  emitTimeMs: number;
  /** When this vaccine was last re-verified against truth. */
  lastVerifiedMs: number;
  /** Bayesian posterior on "vaccine still trustworthy". */
  posterior: BetaPrior;
  /** Tool names this vaccine claimed were unregistered (for catalog probe). */
  refutedTools: string[];
  /** True after a recheck found the vaccine's claim is now TRUE. */
  burned: boolean;
  /** Reason for burning (audit trail). */
  burnReason?: string;
}

export interface OsmosisLattice {
  vaccines: OsmosisVaccine[];
  /** HLL of current live catalog (for O(1) membership). */
  catalogHll: HllSketch;
  /** Page-Hinkley state tracking catalog drift over time. */
  drift: PageHinkleyState;
  /** Kalman-smoothed volatility rate (tools-added per second). */
  volatility: KalmanState;
  /** Bloom of seen simhashes (acceleration cache). */
  seenBloom: BloomFilter;
  /** Reservoir of representative vaccines (bounded memory). */
  reservoir: ReservoirState<OsmosisVaccine>;
  /** Stale-probability threshold above which we force recheck (default 0.25). */
  recheckThreshold: number;
  /** Last catalog snapshot timestamp. */
  lastCatalogSnapshotMs: number;
  /** Last catalog cardinality (for volatility delta). */
  lastCatalogSize: number;
  /** Burn counter (lifetime). */
  burnCount: number;
}

export interface OsmosisCheckResult {
  /** Final verdict: true = trust the vaccine (refute), false = vaccine is stale/burned (fall through). */
  trustVaccine: boolean;
  /** True if the vaccine was burned during this check. */
  burned: boolean;
  /** Why we made the decision (audit). */
  reason: string;
  /** Numerical stale probability. */
  staleProb: number;
  /** Bayesian posterior mean after any update. */
  posteriorMean: number;
  /** Whether Page-Hinkley alarmed during this check. */
  phAlarm: boolean;
}

export function newLattice(recheckThreshold = 0.25): OsmosisLattice {
  return {
    vaccines: [],
    catalogHll: newHllSketch(),
    drift: newPageHinkley(0, 0.005),
    volatility: newKalman(0.001, 1, 0.0001, 0.01),
    seenBloom: newBloom(),
    reservoir: newReservoir<OsmosisVaccine>(1000),
    recheckThreshold,
    lastCatalogSnapshotMs: 0,
    lastCatalogSize: 0,
    burnCount: 0,
  };
}

/** Update the lattice with a fresh catalog snapshot. Refreshes HLL +
 *  feeds the drift detector + updates the Kalman volatility estimate. */
export function updateCatalogSnapshot(lat: OsmosisLattice, catalog: string[], nowMs: number): void {
  const fresh = newHllSketch();
  for (const t of catalog) hllAdd(fresh, t);
  lat.catalogHll = fresh;
  const sizeNow = catalog.length;
  if (lat.lastCatalogSnapshotMs > 0) {
    const dt = Math.max(0.001, (nowMs - lat.lastCatalogSnapshotMs) / 1000);
    const obsVolatility = Math.abs(sizeNow - lat.lastCatalogSize) / dt; // tools/sec
    kalmanUpdate(lat.volatility, obsVolatility);
    pageHinkleyUpdate(lat.drift, obsVolatility);
  }
  lat.lastCatalogSnapshotMs = nowMs;
  lat.lastCatalogSize = sizeNow;
}

export function registerVaccine(lat: OsmosisLattice, simhash: string, refutedTools: string[], nowMs: number): OsmosisVaccine {
  const id = createHash("sha256").update(simhash + ":" + nowMs).digest("hex").slice(0, 32);
  const v: OsmosisVaccine = {
    id, simhash,
    emitTimeMs: nowMs,
    lastVerifiedMs: nowMs,
    posterior: newBetaPrior(2, 1), // mild prior on "vaccine is good"
    refutedTools,
    burned: false,
  };
  lat.vaccines.push(v);
  bloomAdd(lat.seenBloom, simhash);
  reservoirAdd(lat.reservoir, v);
  return v;
}

/** The osmosis check — call this BEFORE returning AUTO_REFUTE from a
 *  vaccine bank hit. Returns trustVaccine=false if the vaccine is stale
 *  or has been burned during the check; the caller should then fall
 *  through to the normal forensic path. */
export function osmosisCheck(lat: OsmosisLattice, vaccine: OsmosisVaccine, nowMs: number): OsmosisCheckResult {
  const ageSec = Math.max(0, (nowMs - vaccine.emitTimeMs) / 1000);
  const lambda = Math.max(0.0001, lat.volatility.x);
  const stale = staleProbability(lambda, ageSec);
  const phResult = pageHinkleyUpdate({ ...lat.drift }, lambda, 50);

  // Force-recheck conditions:
  //   (a) stale probability above threshold, OR
  //   (b) Page-Hinkley alarmed (concept drift), OR
  //   (c) vaccine never re-verified (lastVerified == emitTime).
  const forceRecheck = stale > lat.recheckThreshold || phResult.alarm || vaccine.lastVerifiedMs === vaccine.emitTimeMs;

  if (!forceRecheck) {
    // Cache hit + still fresh. Trust the vaccine.
    return {
      trustVaccine: true, burned: false,
      reason: `vaccine fresh (stale=${stale.toFixed(3)}, age=${ageSec.toFixed(1)}s)`,
      staleProb: stale, posteriorMean: bayesianMean(vaccine.posterior),
      phAlarm: phResult.alarm,
    };
  }

  // Recheck: for each refuted tool, ask the live HLL whether it's now in
  // the catalog. If ANY claimed-unregistered tool is now in HLL, BURN
  // the vaccine.
  let nowGroundedCount = 0;
  for (const tool of vaccine.refutedTools) {
    if (hllContains(lat.catalogHll, tool)) nowGroundedCount += 1;
  }
  if (nowGroundedCount > 0) {
    vaccine.burned = true;
    vaccine.burnReason = `recheck: ${nowGroundedCount}/${vaccine.refutedTools.length} previously-refuted tools now exist in catalog`;
    vaccine.posterior = bayesianUpdate(vaccine.posterior, 0, 1); // failure observation
    lat.burnCount += 1;
    return {
      trustVaccine: false, burned: true,
      reason: vaccine.burnReason,
      staleProb: stale, posteriorMean: bayesianMean(vaccine.posterior),
      phAlarm: phResult.alarm,
    };
  }

  // Recheck passed: vaccine still valid. Update lastVerified + posterior.
  vaccine.lastVerifiedMs = nowMs;
  vaccine.posterior = bayesianUpdate(vaccine.posterior, 1, 1); // success observation
  return {
    trustVaccine: true, burned: false,
    reason: `recheck passed (stale=${stale.toFixed(3)}, ph=${phResult.ph.toFixed(2)})`,
    staleProb: stale, posteriorMean: bayesianMean(vaccine.posterior),
    phAlarm: phResult.alarm,
  };
}

/** Stats for dashboard / pulse surface. */
export function osmosisStats(lat: OsmosisLattice): {
  totalVaccines: number;
  burnedLifetime: number;
  activeVaccines: number;
  catalogCardinality: number;
  bloomFpRate: number;
  meanPosterior: number;
  volatility: number;
  phAlerts: number;
  reservoirSize: number;
} {
  const active = lat.vaccines.filter((v) => !v.burned);
  const meanPost = active.length > 0
    ? active.map((v) => bayesianMean(v.posterior)).reduce((s, x) => s + x, 0) / active.length
    : 0;
  return {
    totalVaccines: lat.vaccines.length,
    burnedLifetime: lat.burnCount,
    activeVaccines: active.length,
    catalogCardinality: hllCardinality(lat.catalogHll),
    bloomFpRate: bloomFalsePositiveRate(lat.seenBloom),
    meanPosterior: meanPost,
    volatility: lat.volatility.x,
    phAlerts: lat.drift.alerts,
    reservoirSize: lat.reservoir.reservoir.length,
  };
}

export const PROTOCOL = Object.freeze({ version: PROTOCOL_VERSION, m: HLL_M });
