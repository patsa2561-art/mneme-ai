/**
 * v2.19.47 — CHRONOSHEAF P2-e · Wasserstein optimal transport.
 *
 *   Math foundation (Monge 1781 / Kantorovich 1942):
 *
 *     For two probability measures μ, ν on a metric space (X, d), and a
 *     cost function c(x, y) = d(x, y)^p, the p-Wasserstein distance is
 *
 *       W_p(μ, ν) = ( inf_{γ ∈ Π(μ, ν)} ∫ d(x, y)^p dγ(x, y) )^(1/p)
 *
 *     where Π(μ, ν) is the set of couplings (joint measures with given
 *     marginals). For p = 1 on the real line this reduces to
 *
 *       W_1(μ, ν) = ∫|F_μ(t) − F_ν(t)| dt
 *
 *     (the L¹ distance between cumulative distribution functions —
 *     trivial to compute exactly).
 *
 *     For higher-dimensional or general supports we use Sinkhorn (Cuturi
 *     2013): regularise the LP with an entropy penalty
 *
 *       W_ε(μ, ν) = min_γ ⟨γ, C⟩ − ε · H(γ)
 *
 *     and solve via iterative scaling u ← μ ⊘ Kv, v ← ν ⊘ K^T u where
 *     K = exp(−C / ε). Converges in O(n²/ε) iterations to a Wasserstein
 *     distance approximation.
 *
 *   AI-memory mapping (PAIN-003 drift-surface + PAIN-006 confidence):
 *
 *     The "distance between two catalog snapshots" is a 1D EMD on
 *     tool-name multiset distributions; the cost of moving evidence
 *     across modules (e.g. governor ↔ fossil ↔ ganglion) is the
 *     ground-metric. We use Wasserstein to score drift between
 *     releases (PAIN-003: 685→699→711 → bottleneck distance =
 *     concrete drift number), and to compare two posterior
 *     distributions when the support overlaps but is unequal.
 *
 *   Implementation: 1D exact W_1 in O(n log n); Sinkhorn for general
 *   case in O(n² · iter); both are pure-function + numerically stable.
 */

/** Discrete measure on a finite support: {value: weight}. Weights sum to total mass. */
export type DiscreteMeasure = ReadonlyMap<string, number>;

/**
 * Exact 1-Wasserstein distance between two distributions on a sorted
 * real line. Supports are given as Maps { coordinate (string-of-num) → mass }.
 * Returns the L1 distance between cumulative distribution functions.
 *
 * Both measures must have equal total mass (else throws). The cost
 * is intrinsic Euclidean distance on the value axis.
 */
export function wasserstein1D(mu: DiscreteMeasure, nu: DiscreteMeasure): number {
  const coords = new Set<number>();
  const muNum = new Map<number, number>();
  const nuNum = new Map<number, number>();
  for (const [k, v] of mu) { const n = Number(k); coords.add(n); muNum.set(n, v); }
  for (const [k, v] of nu) { const n = Number(k); coords.add(n); nuNum.set(n, v); }
  const sortedCoords = Array.from(coords).sort((a, b) => a - b);
  // Check total mass close enough.
  const sum = (m: Map<number, number>): number => { let s = 0; for (const v of m.values()) s += v; return s; };
  const sm = sum(muNum); const sn = sum(nuNum);
  if (Math.abs(sm - sn) > 1e-9 * Math.max(1, sm, sn)) {
    throw new Error(`wasserstein1D: unequal total mass (μ=${sm}, ν=${sn})`);
  }
  // Compute the L1 distance between CDFs by Riemann sum over sorted coords.
  let cdfMu = 0; let cdfNu = 0; let total = 0;
  for (let i = 0; i < sortedCoords.length; i++) {
    cdfMu += muNum.get(sortedCoords[i]!) ?? 0;
    cdfNu += nuNum.get(sortedCoords[i]!) ?? 0;
    if (i + 1 < sortedCoords.length) {
      const dx = sortedCoords[i + 1]! - sortedCoords[i]!;
      total += Math.abs(cdfMu - cdfNu) * dx;
    }
  }
  return total;
}

/** Cost matrix between two finite supports. */
export type CostMatrix = ReadonlyArray<ReadonlyArray<number>>;

/**
 * Sinkhorn iteration for entropic OT. Returns the approximate OT cost
 * + the coupling matrix π. ε controls regularisation; lower ε = closer
 * to true Wasserstein but slower convergence.
 */
export function sinkhorn(
  mu: ReadonlyArray<number>,
  nu: ReadonlyArray<number>,
  C: CostMatrix,
  opts: { epsilon?: number; maxIter?: number; tol?: number } = {},
): { cost: number; coupling: number[][]; iterations: number; converged: boolean } {
  const epsilon = Math.max(1e-9, opts.epsilon ?? 0.05);
  const maxIter = Math.max(1, opts.maxIter ?? 200);
  const tol = Math.max(1e-12, opts.tol ?? 1e-8);
  const n = mu.length; const m = nu.length;
  if (C.length !== n || C[0]!.length !== m) throw new Error("sinkhorn: cost matrix shape mismatch");
  // K = exp(-C / ε)
  const K: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array(m);
    for (let j = 0; j < m; j++) row[j] = Math.exp(-(C[i]![j] ?? 0) / epsilon);
    K.push(row);
  }
  const u = new Array(n).fill(1);
  const v = new Array(m).fill(1);
  let iter = 0; let converged = false;
  for (; iter < maxIter; iter++) {
    let maxDelta = 0;
    // u_i = μ_i / (K v)_i
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < m; j++) s += K[i]![j]! * v[j]!;
      const newU = (mu[i] ?? 0) / Math.max(1e-300, s);
      maxDelta = Math.max(maxDelta, Math.abs(newU - u[i]!));
      u[i] = newU;
    }
    // v_j = ν_j / (Kᵀ u)_j
    for (let j = 0; j < m; j++) {
      let s = 0;
      for (let i = 0; i < n; i++) s += K[i]![j]! * u[i]!;
      const newV = (nu[j] ?? 0) / Math.max(1e-300, s);
      maxDelta = Math.max(maxDelta, Math.abs(newV - v[j]!));
      v[j] = newV;
    }
    if (maxDelta < tol) { converged = true; break; }
  }
  // π_{ij} = u_i K_{ij} v_j
  const coupling: number[][] = [];
  let cost = 0;
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < m; j++) {
      const pi = u[i]! * K[i]![j]! * v[j]!;
      row.push(pi);
      cost += pi * (C[i]![j] ?? 0);
    }
    coupling.push(row);
  }
  return { cost, coupling, iterations: iter + 1, converged };
}

/**
 * Catalog-snapshot distance: takes two arrays of tool names and returns
 * the W_1 distance under the "intra-family free / inter-family unit cost"
 * metric. Used by PAIN-003 drift-surface analysis.
 */
export function catalogDrift(snapA: ReadonlyArray<string>, snapB: ReadonlyArray<string>): number {
  // Group by family (first 2 dots).
  const familyOf = (name: string): string => {
    const parts = name.split(".");
    return parts.length >= 2 ? `${parts[0]}.${parts[1]}` : name;
  };
  const histA = new Map<string, number>();
  const histB = new Map<string, number>();
  for (const n of snapA) histA.set(familyOf(n), (histA.get(familyOf(n)) ?? 0) + 1);
  for (const n of snapB) histB.set(familyOf(n), (histB.get(familyOf(n)) ?? 0) + 1);
  const families = Array.from(new Set([...histA.keys(), ...histB.keys()])).sort();
  if (families.length === 0) return 0;
  // Convert to vectors aligned on the family axis.
  const muVec = families.map((f) => histA.get(f) ?? 0);
  const nuVec = families.map((f) => histB.get(f) ?? 0);
  // Cost matrix: 0 within same family, 1 across. We treat family axis as
  // a flat string set (no ground geometry) → entropic OT collapses to
  // mass-shift count, equivalent to total-variation × 1.
  const sumMu = muVec.reduce((a, x) => a + x, 0);
  const sumNu = nuVec.reduce((a, x) => a + x, 0);
  if (sumMu === 0 || sumNu === 0) return Math.max(sumMu, sumNu);
  const muN = muVec.map((x) => x / sumMu);
  const nuN = nuVec.map((x) => x / sumNu);
  // Total variation distance × max(sumMu, sumNu) approximates the W_1
  // "mass that needs to move" interpretation.
  let tv = 0;
  for (let i = 0; i < families.length; i++) tv += Math.abs((muN[i] ?? 0) - (nuN[i] ?? 0));
  return (tv / 2) * Math.max(sumMu, sumNu);
}
