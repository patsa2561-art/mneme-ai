/**
 * v1.94.0 -- QX-SUPERNOVA · QUANTUM CORE
 * The Probability Collapse Matrix.
 *
 * Replace CPU/GPU mental model: instead of evaluating ONE hypothesis,
 * the Quantum Core takes N hypotheses with a multi-signal vector each,
 * fuses signals into a posterior, and COLLAPSES to the winner with a
 * measurable margin + entropy reading.
 *
 * Why this is not vapor:
 *   1. Bayes fusion of independent signals is a real, well-known math
 *      operation. We just give it a cosmic name + plug it into Mneme.
 *   2. Margin + entropy let downstream code REFUSE to commit when the
 *      collapse is too uncertain — instead of guessing, return UNCERTAIN.
 *   3. Pure functions. Deterministic. Unit-testable. Same inputs → same
 *      collapse forever.
 *
 *   "When computation becomes a cosmic event."
 */

export type SignalVector = Record<string, number>;

export interface Hypothesis<T = unknown> {
  /** Stable id for telemetry. */
  id: string;
  /** The candidate value being scored. */
  value: T;
  /** Prior probability before signals are fused. 0..1. Default 1/N. */
  prior?: number;
  /** Per-axis scores 0..1. Higher = more supportive of this hypothesis. */
  signals: SignalVector;
}

export interface CollapseOptions {
  /** Per-axis weights. Default: each axis weighted equally (1.0). */
  weights?: Record<string, number>;
  /** Floor on posterior to avoid log(0). Default 1e-9. */
  epsilon?: number;
  /** If margin < this, verdict is UNCERTAIN. Default 0.05. */
  uncertaintyMargin?: number;
}

export type CollapseVerdict = "COLLAPSED" | "UNCERTAIN" | "DEGENERATE";

export interface CollapseResult<T = unknown> {
  verdict: CollapseVerdict;
  winner: Hypothesis<T> | null;
  /** Posterior of the winner, 0..1. */
  posterior: number;
  /** posterior(winner) - posterior(runner-up). High margin = confident. */
  margin: number;
  /** Shannon entropy across all posteriors. Lower = more confident. */
  entropy: number;
  /** Normalized entropy (entropy / log2(N)) — 0..1. */
  entropyNormalized: number;
  /** All hypotheses sorted by posterior desc, each with the fused score. */
  ranked: Array<Hypothesis<T> & { posterior: number }>;
  /** Reason string for UNCERTAIN / DEGENERATE verdicts. */
  reason?: string;
}

/** Core algorithm: fuse signals × weights × prior into a posterior, then
 *  collapse to the winner with margin + entropy report.
 *
 *  Math: posterior_i ∝ prior_i × Π_axis ( signal_i,axis ^ weight_axis )
 *  Normalized so Σ posteriors = 1. Entropy computed over normalized vec.
 */
export function collapseProbabilityMatrix<T>(
  hypotheses: readonly Hypothesis<T>[],
  opts: CollapseOptions = {},
): CollapseResult<T> {
  const epsilon = opts.epsilon ?? 1e-9;
  const uncertaintyMargin = opts.uncertaintyMargin ?? 0.05;
  const N = hypotheses.length;

  if (N === 0) {
    return {
      verdict: "DEGENERATE",
      winner: null,
      posterior: 0,
      margin: 0,
      entropy: 0,
      entropyNormalized: 0,
      ranked: [],
      reason: "no hypotheses provided",
    };
  }

  // Collect all axis names that show up anywhere.
  const axes = new Set<string>();
  for (const h of hypotheses) for (const k of Object.keys(h.signals)) axes.add(k);

  // Determine weights — default 1.0 for every axis the caller didn't override.
  const weights: Record<string, number> = {};
  for (const a of axes) weights[a] = opts.weights?.[a] ?? 1.0;

  // Compute unnormalized posterior for each hypothesis.
  // Use log-space for numerical stability with many axes.
  const logScores: number[] = hypotheses.map((h) => {
    const prior = h.prior ?? 1 / N;
    let logP = Math.log(Math.max(prior, epsilon));
    for (const axis of axes) {
      const signal = h.signals[axis] ?? 0.5; // missing signal = neutral 0.5
      const w = weights[axis] ?? 1.0;
      // Map signal in [0,1] to a probability factor. signal=1 → factor=1,
      // signal=0 → factor=epsilon. weight scales the influence.
      const factor = Math.max(signal, epsilon);
      logP += w * Math.log(factor);
    }
    return logP;
  });

  // Normalize via log-sum-exp for stability.
  const maxLog = Math.max(...logScores);
  const expShifted = logScores.map((l) => Math.exp(l - maxLog));
  const sum = expShifted.reduce((a, b) => a + b, 0);
  const posteriors = expShifted.map((e) => e / sum);

  // Pair with hypotheses + sort.
  const paired = hypotheses.map((h, i) => ({ ...h, posterior: posteriors[i]! }));
  const ranked = [...paired].sort((a, b) => b.posterior - a.posterior);

  // Shannon entropy.
  let entropy = 0;
  for (const p of posteriors) {
    if (p > 0) entropy -= p * Math.log2(p);
  }
  const entropyMax = Math.log2(Math.max(N, 1)) || 1;
  const entropyNormalized = entropy / entropyMax;

  const winner = ranked[0]!;
  const runnerUp = ranked[1];
  const margin = runnerUp ? winner.posterior - runnerUp.posterior : winner.posterior;

  // Verdict logic
  if (N === 1) {
    return {
      verdict: "DEGENERATE",
      winner,
      posterior: winner.posterior,
      margin: 1,
      entropy: 0,
      entropyNormalized: 0,
      ranked,
      reason: "single hypothesis — collapse is trivial",
    };
  }
  if (margin < uncertaintyMargin) {
    return {
      verdict: "UNCERTAIN",
      winner,
      posterior: winner.posterior,
      margin,
      entropy,
      entropyNormalized,
      ranked,
      reason: `margin ${margin.toFixed(4)} < threshold ${uncertaintyMargin}`,
    };
  }
  return {
    verdict: "COLLAPSED",
    winner,
    posterior: winner.posterior,
    margin,
    entropy,
    entropyNormalized,
    ranked,
  };
}

/** Re-collapse with adjusted weights — used by the re-engineer loop to
 *  tune signal weights based on benchmark feedback. */
export function recollapseWithWeights<T>(
  hypotheses: readonly Hypothesis<T>[],
  weights: Record<string, number>,
  opts: Omit<CollapseOptions, "weights"> = {},
): CollapseResult<T> {
  return collapseProbabilityMatrix(hypotheses, { ...opts, weights });
}

/** Compute a confidence score 0..1 from a CollapseResult. Used by
 *  callers that just want a single number. */
export function confidenceOf(r: CollapseResult<unknown>): number {
  if (r.verdict === "DEGENERATE") return 0.5;
  // Confidence = posterior × (1 - normalized entropy) — favors high
  // posterior AND low overall ambiguity.
  return r.posterior * (1 - r.entropyNormalized);
}
