/**
 * Mneme DNA — the 8 math formulas (F1–F8) of the 16-strand code search engine.
 *
 * Each formula is a PURE function. Deterministic. Same inputs → same output.
 * No I/O, no LLMs, no global state. The whole module is a math library.
 *
 * The formulas compose with Mneme atoms (HMRA, Hebbian, atrophy, regret,
 * federation, audit) to produce ranking signals that other code-search
 * engines simply cannot compute.
 *
 *   F1. QRS  — Quantum Resonance Score (quadratic form)
 *   F2. HWC  — Hebbian-Weighted Cosine
 *   F3. ADB  — Atrophy-Decay Boost
 *   F4. TBP  — Tribal Bayesian Posterior
 *   F5. RED  — Regret Echo Distance
 *   F6. TPS  — Time-Phase Score
 *   F7. CC   — Compositional Confidence
 *   F8. MF   — Mutant Fitness
 *
 * Wisdom check: each formula is a real mathematical object — quadratic
 * form, log-weighted cosine, exponential decay, Beta-Binomial conjugate,
 * Euclidean distance, sinusoidal phase, Wilson lower bound, weighted
 * harmonic mean. Nothing made up. Just composed in a way no other tool
 * does.
 */

// ─── F1. Quantum Resonance Score (QRS) ────────────────────────────────
//
// QRS(file, query) = ψ_f^T · H_q · ψ_f
//
// Borrowed notation from quantum mechanics but it's pure linear algebra:
// a quadratic form ψ^T H ψ where ψ is the file's feature vector and H
// is a symmetric (Hermitian-like) operator constructed from the query.
//
// Why useful: the operator H_q can encode arbitrary cross-feature
// interactions — e.g., "files where embedding similarity AND ast-proximity
// are jointly high" — that linear scoring functions cannot express.

export interface QRSInput {
  /** File feature vector (e.g., concat of embedding, atrophy, age, freshness). */
  fileVector: number[];
  /** Query operator — must be a square matrix matching fileVector length. */
  queryOperator: number[][];
}

/**
 * Compute the Quantum Resonance Score. Throws on dimension mismatch
 * (fail-loud — bad caller config should not silently produce 0).
 */
export function qrs(input: QRSInput): number {
  const psi = input.fileVector;
  const H = input.queryOperator;
  const n = psi.length;
  if (H.length !== n) {
    throw new Error(`QRS: operator size ${H.length} does not match vector size ${n}`);
  }
  for (const row of H) {
    if (row.length !== n) {
      throw new Error(`QRS: non-square operator (row length ${row.length} ≠ ${n})`);
    }
  }
  // ψ^T H ψ = Σ_i Σ_j ψ_i * H_ij * ψ_j
  let s = 0;
  for (let i = 0; i < n; i++) {
    let rowSum = 0;
    const Hi = H[i]!;
    for (let j = 0; j < n; j++) rowSum += Hi[j]! * psi[j]!;
    s += psi[i]! * rowSum;
  }
  return s;
}

// ─── F2. Hebbian-Weighted Cosine (HWC) ────────────────────────────────
//
// HWC(q, c) = cos(q, c) × log(1 + h(q, c))
//
// Cosine similarity scaled by log(1 + co-activation count). Pairs of
// (query terms, code terms) that historically co-occurred in successful
// searches strengthen the similarity over time — Hebb's law applied to
// IR ranking.

export interface HWCInput {
  queryEmbedding: number[];
  codeEmbedding: number[];
  /** Number of times these two have co-activated (audit log). */
  coActivationCount: number;
}

export function hwc(input: HWCInput): number {
  const cos = cosineSimilarity(input.queryEmbedding, input.codeEmbedding);
  const hebbBoost = Math.log(1 + Math.max(0, input.coActivationCount));
  // We multiply cosine by (1 + hebbBoost) so that even when h=0 the score
  // still equals cosine — backward-compatible with non-Hebbian retrieval.
  return cos * (1 + hebbBoost);
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`HWC: embedding dims differ ${a.length} vs ${b.length}`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / Math.sqrt(na * nb);
}

// ─── F3. Atrophy-Decay Boost (ADB) ────────────────────────────────────
//
// ADB(file) = R(file) × (1 - A(file)/100)^α
//
// Stale code (high atrophy) gets exponentially downranked. α controls
// how aggressively. α=1 is linear. α>1 punishes stale code more.

export interface ADBInput {
  baseRelevance: number;
  /** Atrophy score 0..100. Higher = more stale. */
  atrophyScore: number;
  /** Decay exponent. Default 1.5 (gentle penalty). */
  alpha?: number;
}

export function adb(input: ADBInput): number {
  const a = Math.min(100, Math.max(0, input.atrophyScore));
  const alpha = input.alpha ?? 1.5;
  if (alpha < 0) throw new Error("ADB: alpha must be >= 0");
  const decayFactor = Math.pow(1 - a / 100, alpha);
  return input.baseRelevance * decayFactor;
}

// ─── F4. Tribal Bayesian Posterior (TBP) ──────────────────────────────
//
// P(file | query, F) ∝ P(query | file) × Beta(α_F+1, β_F+1)
//
// Combines local likelihood with federation-derived Beta prior. Beta
// distribution mean = α/(α+β), gives a smoothed estimate that's
// well-behaved with few observations.

export interface TBPInput {
  /** Local likelihood — e.g., HWC score or BM25 score. */
  localLikelihood: number;
  /** Federation upvotes for this pattern (k-anonymized). */
  federationUpvotes: number;
  /** Federation downvotes. */
  federationDownvotes: number;
}

export function tbp(input: TBPInput): number {
  // Beta(α+1, β+1) mean = (α+1)/(α+β+2). Add 1 to each to keep prior
  // well-defined when both votes are 0 (uninformative prior).
  const a = Math.max(0, input.federationUpvotes) + 1;
  const b = Math.max(0, input.federationDownvotes) + 1;
  const priorMean = a / (a + b);
  return input.localLikelihood * priorMean;
}

/** Variance of the Beta posterior — useful for surfacing confidence. */
export function tbpVariance(upvotes: number, downvotes: number): number {
  const a = Math.max(0, upvotes) + 1;
  const b = Math.max(0, downvotes) + 1;
  const sum = a + b;
  return (a * b) / (sum * sum * (sum + 1));
}

// ─── F5. Regret Echo Distance (RED) ───────────────────────────────────
//
// RED(file) = min_{r in regrets} dist(emb(file), emb(r))
//
// Distance in embedding space to the nearest known regret pattern.
// Lower RED = closer to a past mistake = candidate for downranking.
// The penalty is bounded so a perfect match (distance 0) doesn't zero
// out an otherwise relevant result entirely.

export interface REDInput {
  fileEmbedding: number[];
  regretEmbeddings: number[][];
}

export interface REDResult {
  /** Minimum distance to any regret. Infinity if no regrets supplied. */
  distance: number;
  /** Index of the closest regret in input.regretEmbeddings (-1 if none). */
  closestRegretIndex: number;
  /** Penalty multiplier in [0,1]. Multiply base relevance by this. */
  penaltyMultiplier: number;
}

export function red(input: REDInput, distanceFloor = 0.2): REDResult {
  if (input.regretEmbeddings.length === 0) {
    return { distance: Infinity, closestRegretIndex: -1, penaltyMultiplier: 1 };
  }
  let minDist = Infinity;
  let minIdx = -1;
  for (let i = 0; i < input.regretEmbeddings.length; i++) {
    const r = input.regretEmbeddings[i]!;
    if (r.length !== input.fileEmbedding.length) {
      throw new Error(`RED: embedding dim mismatch (file=${input.fileEmbedding.length}, regret[${i}]=${r.length})`);
    }
    let d = 0;
    for (let j = 0; j < r.length; j++) {
      const diff = input.fileEmbedding[j]! - r[j]!;
      d += diff * diff;
    }
    d = Math.sqrt(d);
    if (d < minDist) {
      minDist = d;
      minIdx = i;
    }
  }
  // Penalty scales smoothly: at distance ≥ 1 (cosine-normalized embedding
  // max distance in orthogonal hemisphere), penalty ≈ 1 (no penalty).
  // At distance ≤ floor, penalty = floor (capped).
  const penalty = Math.max(distanceFloor, Math.min(1, minDist));
  return { distance: minDist, closestRegretIndex: minIdx, penaltyMultiplier: penalty };
}

// ─── F6. Time-Phase Score (TPS) ───────────────────────────────────────
//
// TPS(file, query) = R(file) × phase(file_age_days, query_age_days)
//
// "Recent query for recent code" resonates. "Old query for foundational
// code" resonates. Mismatched temporal phases cancel.
//
// We use a smooth bell function centered on the alignment between file
// age and query age in log-space. This prevents both "always boost recent"
// and "always boost old" — the alignment matters.

export interface TPSInput {
  baseRelevance: number;
  fileAgeDays: number;
  queryAgeDays: number;
  /** Width of the resonance bell (in log-days). Default 1.5. */
  sigma?: number;
}

export function tps(input: TPSInput): number {
  const sigma = input.sigma ?? 1.5;
  if (sigma <= 0) throw new Error("TPS: sigma must be > 0");
  // Use log(1 + days) to handle 0-day case gracefully
  const fAge = Math.log(1 + Math.max(0, input.fileAgeDays));
  const qAge = Math.log(1 + Math.max(0, input.queryAgeDays));
  const diff = fAge - qAge;
  // Gaussian bell: exp(-(diff/sigma)^2). Returns ≈1 when ages aligned,
  // → 0 when they're far apart in log-space.
  const phase = Math.exp(-(diff * diff) / (sigma * sigma));
  return input.baseRelevance * phase;
}

// ─── F7. Compositional Confidence (CC) ────────────────────────────────
//
// CC = WilsonLB(success, total) × HebbianStrength(query, result)
//
// Wilson 95% lower bound on a proportion (used by Reddit / HN). Combined
// with Hebbian co-activation strength for a calibrated final score.

export interface CCInput {
  successCount: number;
  totalCount: number;
  hebbianStrength: number;
  /** Wilson z-score. 1.96 = 95% CI default. */
  z?: number;
}

export function cc(input: CCInput): number {
  const wilson = wilsonLowerBound(input.successCount, input.totalCount, input.z ?? 1.96);
  const hebb = Math.max(0, input.hebbianStrength);
  return wilson * hebb;
}

export function wilsonLowerBound(positive: number, total: number, z = 1.96): number {
  if (total === 0) return 0;
  const phat = positive / total;
  const denom = 1 + (z * z) / total;
  const numer = phat + (z * z) / (2 * total) - z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * total)) / total);
  return Math.max(0, numer / denom);
}

// ─── F8. Mutant Fitness (MF) ──────────────────────────────────────────
//
// Fit(strategy) = Σ (CTR_i × TTUR_i^(-1)) / N
//
// Genetic-algorithm fitness for index strategies. CTR = click-through
// rate (or AI-tool-call success rate). TTUR = time to useful result.
// High fitness = many successful clicks AND fast time-to-useful.

export interface MFSample {
  /** Click-through rate in [0,1]. */
  ctr: number;
  /** Time to useful result, in seconds. Must be > 0. */
  ttur: number;
}

export interface MFInput {
  samples: MFSample[];
  /** Floor for ttur (avoids divide-by-tiny-numbers). Default 0.1s. */
  tturFloor?: number;
}

export function mf(input: MFInput): number {
  if (input.samples.length === 0) return 0;
  const floor = input.tturFloor ?? 0.1;
  let total = 0;
  for (const s of input.samples) {
    const ctr = Math.min(1, Math.max(0, s.ctr));
    const ttur = Math.max(floor, s.ttur);
    total += ctr / ttur;
  }
  return total / input.samples.length;
}

// ─── Catalog (for surfacing in CLI / docs) ────────────────────────────

export const DNA_FORMULAS = [
  { code: "F1", fn: "qrs", fullName: "Quantum Resonance Score", purpose: "Quadratic form: file-vector projected through query-operator. Encodes cross-feature interactions linear scores cannot." },
  { code: "F2", fn: "hwc", fullName: "Hebbian-Weighted Cosine", purpose: "Cosine similarity boosted by past co-activation between query terms and code terms." },
  { code: "F3", fn: "adb", fullName: "Atrophy-Decay Boost", purpose: "Exponential downrank for stale code. α controls aggressiveness." },
  { code: "F4", fn: "tbp", fullName: "Tribal Bayesian Posterior", purpose: "Local likelihood × federation Beta-Binomial prior. K-anonymous cross-repo voting." },
  { code: "F5", fn: "red", fullName: "Regret Echo Distance", purpose: "Euclidean distance to nearest known regret pattern. Closer = bigger penalty." },
  { code: "F6", fn: "tps", fullName: "Time-Phase Score", purpose: "Gaussian resonance between file age and query age in log-space." },
  { code: "F7", fn: "cc", fullName: "Compositional Confidence", purpose: "Wilson 95% lower-bound success rate × Hebbian strength. Calibrated final score." },
  { code: "F8", fn: "mf", fullName: "Mutant Fitness", purpose: "Genetic-algorithm fitness. CTR ÷ time-to-useful-result. Drives index strategy evolution." },
] as const;
