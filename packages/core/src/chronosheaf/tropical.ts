/**
 * v2.19.47 — CHRONOSHEAF P2-f · tropical semiring (max-plus algebra).
 *
 *   Math foundation (Maslov / Litvinov / Pin):
 *
 *     The tropical (max-plus) semiring (ℝ ∪ {−∞}, ⊕, ⊗) replaces
 *
 *       a ⊕ b = max(a, b)
 *       a ⊗ b = a + b
 *       0_⊕   = −∞
 *       1_⊗   = 0
 *
 *     Linear algebra over this semiring computes shortest / longest paths
 *     in weighted graphs WITHOUT iteration: matrix product A ⊗ B has
 *     entry (A ⊗ B)_{ij} = max_k (A_{ik} + B_{kj}). The "tropical
 *     polynomial" min/max of sums is exactly the Bellman-Ford fixed
 *     point. Inference in tropical algebra is shortest-path inference
 *     in polyhedral fans — and the BOTTLENECK edge (the one that
 *     determines the max) is always uniquely identifiable: there is
 *     ONE critical edge whose perturbation perturbs the result, the
 *     rest are slack. This makes tropical inference INTERPRETABLE in
 *     a way that real-number ML rarely is.
 *
 *   AI-memory mapping (PAIN-005 interface-coherence + PAIN-006
 *   confidence):
 *
 *     Verifier chains compose tropically. If verifier A returns confidence
 *     c_A and B returns c_B and we combine sequentially, the
 *     bottleneck is min(c_A, c_B) — exactly a tropical operation. The
 *     critical edge tells you which verifier is the weakest link, which
 *     gives an interpretable explanation for any composite confidence
 *     number (PAIN-006 fix: instead of "60%" we say "60% limited by
 *     verifier B which scored 60%; raise B to raise overall").
 *
 *   Implementation: graph as adjacency map; Bellman-Ford with critical-
 *   edge tracking. Pure-function; O(V·E).
 */

export const TROPICAL_ZERO = -Infinity;     // 0 in (R∪{-∞}, ⊕)
export const TROPICAL_ONE  = 0;             // 1 in (R∪{-∞}, ⊗)

/** Tropical addition: a ⊕ b = max(a, b). */
export function tropicalAdd(a: number, b: number): number { return Math.max(a, b); }
/** Tropical multiplication: a ⊗ b = a + b. */
export function tropicalMul(a: number, b: number): number { return a + b; }

/** Graph for tropical shortest/longest path. */
export interface TropicalGraph {
  nodes: ReadonlyArray<string>;
  /** Directed edges: from → [{to, weight}]. */
  edges: ReadonlyMap<string, ReadonlyArray<{ to: string; weight: number; label?: string }>>;
}

export interface TropicalPathResult {
  source: string;
  target: string;
  /** Optimal value (sum of weights along the best path). */
  value: number;
  /** Sequence of nodes in the path. */
  path: string[];
  /** Sequence of edges with their weights. */
  edges: Array<{ from: string; to: string; weight: number; label?: string }>;
  /** The CRITICAL (bottleneck) edge — the one whose perturbation changes the result. */
  criticalEdge: { from: string; to: string; weight: number; label?: string } | null;
}

/**
 * Longest-path computation (semiring with ⊕ = max). For shortest-path,
 * negate all weights first. We do not allow positive cycles (would
 * diverge); throws if detected.
 */
export function tropicalLongestPath(graph: TropicalGraph, source: string, target: string): TropicalPathResult | null {
  // Bellman-Ford on the max-plus semiring.
  const dist = new Map<string, number>();
  const pred = new Map<string, { from: string; weight: number; label?: string }>();
  for (const n of graph.nodes) dist.set(n, TROPICAL_ZERO);
  dist.set(source, TROPICAL_ONE);
  const V = graph.nodes.length;
  let changed = true; let iters = 0;
  while (changed && iters < V) {
    changed = false; iters++;
    for (const [u, out] of graph.edges) {
      const du = dist.get(u) ?? TROPICAL_ZERO;
      if (du === TROPICAL_ZERO) continue;
      for (const { to, weight, label } of out) {
        const candidate = tropicalMul(du, weight);
        const dv = dist.get(to) ?? TROPICAL_ZERO;
        if (candidate > dv) {
          dist.set(to, candidate);
          const p: { from: string; weight: number; label?: string } = { from: u, weight };
          if (label !== undefined) p.label = label;
          pred.set(to, p);
          changed = true;
        }
      }
    }
  }
  // Detect positive cycles: one more pass; if anything improves, throw.
  for (const [u, out] of graph.edges) {
    const du = dist.get(u) ?? TROPICAL_ZERO;
    if (du === TROPICAL_ZERO) continue;
    for (const { to, weight } of out) {
      if (tropicalMul(du, weight) > (dist.get(to) ?? TROPICAL_ZERO)) {
        throw new Error(`tropicalLongestPath: positive cycle reachable through ${u}→${to}`);
      }
    }
  }
  const targetVal = dist.get(target);
  if (targetVal === undefined || targetVal === TROPICAL_ZERO) return null;
  // Reconstruct path.
  const reverseNodes: string[] = [target];
  const reverseEdges: TropicalPathResult["edges"] = [];
  let cur = target;
  let safety = 0;
  while (cur !== source && safety++ < V + 1) {
    const p = pred.get(cur); if (!p) return null;
    const edge: { from: string; to: string; weight: number; label?: string } = { from: p.from, to: cur, weight: p.weight };
    if (p.label !== undefined) edge.label = p.label;
    reverseEdges.push(edge);
    reverseNodes.push(p.from);
    cur = p.from;
  }
  const path = reverseNodes.reverse();
  const edges = reverseEdges.reverse();
  // Critical edge: the one with the smallest weight along the path
  // (the bottleneck under min-of-sums). Equivalently, the edge whose
  // ε-perturbation perturbs the path value 1:1 (slack-free edge).
  let critical: TropicalPathResult["criticalEdge"] = null;
  let minWeight = Infinity;
  for (const e of edges) {
    if (e.weight < minWeight) { minWeight = e.weight; critical = e; }
  }
  return { source, target, value: targetVal, path, edges, criticalEdge: critical };
}

/**
 * Verifier chain composition. Each verifier outputs a confidence
 * c ∈ [0, 1]; chain confidence = min over the chain (worst-link).
 * Returns the chain value PLUS the critical verifier so we can
 * explain WHY confidence is what it is (PAIN-006 interpretability).
 */
export function verifierChainConfidence(
  chain: ReadonlyArray<{ id: string; confidence: number }>,
): { chainConfidence: number; criticalVerifier: { id: string; confidence: number } | null } {
  if (chain.length === 0) return { chainConfidence: 1, criticalVerifier: null };
  let worst = chain[0]!;
  for (const v of chain) if (v.confidence < worst.confidence) worst = v;
  return { chainConfidence: worst.confidence, criticalVerifier: worst };
}
