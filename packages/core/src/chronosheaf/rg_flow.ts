/**
 * v2.19.47 — CHRONOSHEAF P2-b · Renormalization Group flow.
 *
 *   Math foundation (Wilson / Kadanoff, 1971):
 *
 *     For a scale s ∈ ℝ⁺ and a Hamiltonian (or generic "system state")
 *     H_s, the RG operator R_b shifts the scale by a factor b:
 *
 *       H_{s + log b} = R_b · H_s,   R_b R_{b'} = R_{bb'}.
 *
 *     Fixed points H* satisfying R_b H* = H* for some b are
 *     SCALE-INVARIANT — they survive every coarse-graining step.
 *     Operators (degrees of freedom) split into RELEVANT (eigenvalue
 *     |λ| > 1, grow under flow → matter at every scale), MARGINAL
 *     (|λ| = 1, neither grow nor decay), IRRELEVANT (|λ| < 1, vanish
 *     under flow → noise that washes out).
 *
 *   AI-memory mapping (PAIN-002 scale-mismatch + PAIN-003 drift-surface):
 *
 *     A coarse-graining is an aggregation step on tool catalog data:
 *
 *       state s_0 = full catalog list (~700 tool names)
 *       R_2 s_0  = family-grouped (governor/fossil/...) (~20 groups)
 *       R_2² s_0 = category-grouped (memory/audit/meta...) (9 cats)
 *       R_2³ s_0 = single "all tools" scalar (1 number)
 *
 *     Fixed points of this flow are descriptors that DON'T change as we
 *     zoom out — they're the right-detail-level for any consumer.
 *     The skinny capabilities tool from v2.19.41 is a hand-rolled
 *     RG fixed point at scale 2 (category-grouped); CHRONOSHEAF lets
 *     callers pick any scale by passing `b`.
 *
 *   Implementation: linear coarse-graining on vector-valued states,
 *   eigendecomposition via power iteration for the relevance classifier.
 *   Pure-function; no fancy numerics required for the AI-memory use case
 *   because catalog states are small (≤ 1000 dims).
 */

export interface RGState {
  /** Numeric state vector at scale s. */
  vector: number[];
  /** Scale exponent (log_b of physical scale). */
  scale: number;
  /** Optional label for human inspection. */
  label?: string;
}

export interface RGStep {
  /** From-scale → to-scale (factor b). */
  factor: number;
  /** Aggregator that merges groups of size `factor` into one component. */
  aggregator: "mean" | "sum" | "max" | "min";
}

/** Apply a single RG step: aggregate groups of `factor` adjacent components. */
export function rgStep(s: RGState, step: RGStep): RGState {
  const b = Math.max(1, Math.floor(step.factor));
  if (b <= 1) return { ...s, scale: s.scale + 1 };
  const out: number[] = [];
  for (let i = 0; i < s.vector.length; i += b) {
    const block = s.vector.slice(i, Math.min(i + b, s.vector.length));
    let v: number;
    switch (step.aggregator) {
      case "sum":  v = block.reduce((a, x) => a + x, 0); break;
      case "max":  v = Math.max(...block); break;
      case "min":  v = Math.min(...block); break;
      case "mean":
      default:     v = block.reduce((a, x) => a + x, 0) / block.length; break;
    }
    out.push(v);
  }
  const result: RGState = { vector: out, scale: s.scale + Math.log2(b) };
  if (s.label !== undefined) result.label = s.label;
  return result;
}

/** Iterate the RG flow until the state stops changing (fixed point) or N steps. */
export function rgFixedPoint(s0: RGState, step: RGStep, maxIter = 50, tol = 1e-12): {
  state: RGState; iterations: number; reachedFixedPoint: boolean;
} {
  let cur = s0;
  for (let i = 0; i < maxIter; i++) {
    const next = rgStep(cur, step);
    if (vecClose(cur.vector, next.vector, tol)) {
      return { state: next, iterations: i + 1, reachedFixedPoint: true };
    }
    if (next.vector.length <= 1) {
      return { state: next, iterations: i + 1, reachedFixedPoint: true };
    }
    cur = next;
  }
  return { state: cur, iterations: maxIter, reachedFixedPoint: false };
}

function vecClose(a: number[], b: number[], tol: number): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (Math.abs((a[i] ?? 0) - (b[i] ?? 0)) > tol) return false;
  return true;
}

/**
 * Classify operators by their behaviour under the linearised RG flow.
 * We treat the state vector as a perturbation around the fixed point and
 * estimate the leading eigenvalue via power iteration on (R_b)' (linear
 * approximation).
 */
export type Relevance = "relevant" | "marginal" | "irrelevant";

export function classifyRelevance(
  s0: RGState,
  step: RGStep,
  perturbation: number[],
  iterations = 20,
): { eigenvalue: number; class: Relevance } {
  // Apply RG `iterations` times to the perturbation only; measure growth.
  let cur: number[] = [...perturbation];
  let firstNorm = vecNorm(cur);
  if (firstNorm < 1e-15) return { eigenvalue: 0, class: "irrelevant" };
  void s0; // RG flow linearised about fixed point — only step shape matters
  let lastNorm = firstNorm;
  let lastRatio = 1;
  for (let k = 0; k < iterations; k++) {
    const next = rgStep({ vector: cur, scale: 0 }, step).vector;
    const nNorm = vecNorm(next);
    if (nNorm < 1e-15) { lastRatio = 0; break; }
    lastRatio = nNorm / lastNorm;
    cur = next;
    lastNorm = nNorm;
    if (cur.length <= 1) break;
  }
  // Eigenvalue λ ≈ growth ratio per iteration.
  const eigenvalue = lastRatio;
  let cls: Relevance;
  if (eigenvalue > 1 + 1e-3) cls = "relevant";
  else if (eigenvalue < 1 - 1e-3) cls = "irrelevant";
  else cls = "marginal";
  return { eigenvalue, class: cls };
}

function vecNorm(v: number[]): number {
  let s = 0;
  for (const x of v) s += x * x;
  return Math.sqrt(s);
}

/**
 * AI-memory specific: given a catalog snapshot (one number per tool —
 * e.g. recent invocation count), find the SMALLEST scale b at which
 * coarse-graining yields ≤ targetSize components. Used by the skinny-
 * capabilities surface to pick the right family-grouping automatically.
 */
export function smallestScaleForBudget(
  s0: RGState,
  step: RGStep,
  targetSize: number,
  maxIter = 50,
): { state: RGState; iterations: number } {
  let cur = s0;
  for (let i = 0; i < maxIter; i++) {
    if (cur.vector.length <= targetSize) return { state: cur, iterations: i };
    cur = rgStep(cur, step);
  }
  return { state: cur, iterations: maxIter };
}
