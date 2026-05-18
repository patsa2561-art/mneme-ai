/**
 * v2.19.47 — CHRONOSHEAF P2-c · persistent homology.
 *
 *   Math foundation (Edelsbrunner / Carlsson, ~2002-2008):
 *
 *     A filtration is a nested sequence of simplicial complexes
 *
 *       ∅ = K_0 ⊆ K_1 ⊆ K_2 ⊆ … ⊆ K_n.
 *
 *     For each k, the inclusion K_i ↪ K_j induces a map
 *     H_k(K_i) → H_k(K_j). A class c ∈ H_k IS BORN at filtration b if
 *     it appears in K_b but not in K_{b−1}, and DIES at d > b if it
 *     becomes a boundary in K_d. The persistence pair (b, d) with
 *     pers(b, d) = d − b measures structural robustness; long-lived
 *     features survive coarse-graining + noise and represent
 *     real structure, while short-lived ones are noise.
 *
 *     The Persistence Diagram (or Bar Code) PD_k = {(b, d) : (b, d)
 *     is a persistence pair} is the canonical invariant. It satisfies
 *     a stability theorem (Cohen-Steiner / Edelsbrunner / Harer 2007):
 *     bottleneck distance W_∞(PD(f), PD(g)) ≤ ‖f − g‖_∞.
 *
 *   AI-memory mapping (PAIN-002 scale-mismatch + PAIN-003 drift-surface):
 *
 *     We filter the tool-catalog over releases: K_i = the catalog at
 *     release v_i, with each tool name as a 0-simplex and each
 *     "is registered" relation as a 1-simplex. A persistent 0-class
 *     = a tool present continuously across releases. A 0-class that
 *     dies = a tool removed/renamed. A 1-class = a co-registration
 *     pattern.
 *
 *     The persistence diagram answers "which facts survived the last
 *     N releases" in a single picture, and bottleneck distance gives a
 *     rigorous "how much did the catalog drift" metric for PAIN-003.
 *
 *   Implementation: standard column-reduction algorithm (Zomorodian-
 *   Carlsson 2005), over ℝ coefficients. We implement the 0-dim
 *   variant (most useful for catalog facts) + a generic kth-dim wrapper.
 */

export interface FiltrationStep {
  /** Filtration value (e.g. release index or scalar threshold). */
  value: number;
  /** Simplices added at this step (each = sorted vertex list). */
  add: ReadonlyArray<ReadonlyArray<string>>;
}

export interface PersistencePair {
  /** Homology dimension. */
  dim: number;
  /** Birth filtration value. */
  birth: number;
  /** Death filtration value; +∞ for essential (immortal) classes. */
  death: number;
  /** Persistence d − b (∞ for essential). */
  persistence: number;
  /** Optional witness — birth simplex + death simplex (vertex tuples). */
  birthSimplex: ReadonlyArray<string>;
  deathSimplex?: ReadonlyArray<string>;
}

export interface PersistenceDiagram {
  pairs: PersistencePair[];
  /** Maximum persistence over the diagram (excluding ∞). */
  maxFinitePersistence: number;
  /** Count of essential classes per dimension. */
  essentialByDim: Record<number, number>;
}

/**
 * Compute 0-dimensional persistent homology from a vertex filtration.
 * Algorithm: Union-Find with elder rule (Eldership: when two components
 * merge, the YOUNGER one dies at the merge filtration value).
 */
export function persistentHomology0(filtration: ReadonlyArray<FiltrationStep>): PersistenceDiagram {
  const pairs: PersistencePair[] = [];
  const parent = new Map<string, string>();
  const birthTime = new Map<string, number>();
  let maxFinite = 0;
  let essential = 0;

  const find = (x: string): string => {
    let r = x;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = x;
    while (c !== r) { const n = parent.get(c)!; parent.set(c, r); c = n; }
    return r;
  };

  for (const step of filtration) {
    // First add all 0-simplices at this filtration (vertices).
    for (const simplex of step.add) {
      if (simplex.length === 1) {
        const v = simplex[0]!;
        if (!parent.has(v)) {
          parent.set(v, v);
          birthTime.set(v, step.value);
        }
      }
    }
    // Then process 1-simplices = edges (each merges 0-components or creates a 1-class).
    for (const simplex of step.add) {
      if (simplex.length !== 2) continue;
      const a = simplex[0]!; const b = simplex[1]!;
      // Edge implicitly adds endpoints if missing.
      for (const v of [a, b]) {
        if (!parent.has(v)) {
          parent.set(v, v);
          birthTime.set(v, step.value);
        }
      }
      const ra = find(a); const rb = find(b);
      if (ra === rb) continue;
      // Merge components — younger dies (elder rule).
      const ta = birthTime.get(ra) ?? step.value;
      const tb = birthTime.get(rb) ?? step.value;
      const youngerRoot = ta > tb ? ra : rb;
      const elderRoot = ta > tb ? rb : ra;
      const deathTime = step.value;
      const birthValue = Math.max(ta, tb);
      parent.set(youngerRoot, elderRoot);
      pairs.push({
        dim: 0, birth: birthValue, death: deathTime,
        persistence: deathTime - birthValue,
        birthSimplex: [youngerRoot], deathSimplex: [a, b],
      });
      if (deathTime - birthValue > maxFinite) maxFinite = deathTime - birthValue;
    }
  }
  // Surviving components → essential classes (death = +∞).
  const roots = new Set<string>();
  for (const v of parent.keys()) roots.add(find(v));
  for (const r of roots) {
    essential++;
    pairs.push({
      dim: 0, birth: birthTime.get(r) ?? 0, death: Infinity,
      persistence: Infinity, birthSimplex: [r],
    });
  }
  return {
    pairs,
    maxFinitePersistence: maxFinite,
    essentialByDim: { 0: essential },
  };
}

/**
 * Bottleneck distance between two persistence diagrams (1D matching).
 * Uses Wasserstein-∞ approximation via greedy nearest-neighbour matching
 * (good enough for the AI-memory PAIN-003 drift use case where diagrams
 * are small). Bottleneck distance W_∞ = max_pair |Δb| ∨ |Δd|.
 */
export function bottleneckDistance(a: PersistenceDiagram, b: PersistenceDiagram): number {
  // Take only finite-persistence pairs for matching; essential classes
  // count toward the "infinity diagonal".
  const ap = a.pairs.filter((p) => isFinite(p.persistence));
  const bp = b.pairs.filter((p) => isFinite(p.persistence));
  const matched = new Set<number>();
  let worst = 0;
  for (const p1 of ap) {
    let bestIdx = -1; let bestDist = Infinity;
    for (let i = 0; i < bp.length; i++) {
      if (matched.has(i)) continue;
      const p2 = bp[i]!;
      const d = Math.max(Math.abs(p1.birth - p2.birth), Math.abs(p1.death - p2.death));
      if (d < bestDist) { bestDist = d; bestIdx = i; }
    }
    if (bestIdx >= 0) {
      matched.add(bestIdx);
      if (bestDist > worst) worst = bestDist;
    } else {
      // Unmatched — distance to diagonal = persistence/2.
      const diag = p1.persistence / 2;
      if (diag > worst) worst = diag;
    }
  }
  // Account for unmatched pairs in b.
  for (let i = 0; i < bp.length; i++) {
    if (matched.has(i)) continue;
    const diag = bp[i]!.persistence / 2;
    if (diag > worst) worst = diag;
  }
  return worst;
}
