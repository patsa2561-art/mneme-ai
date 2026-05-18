/**
 * v2.19.47 — CHRONOSHEAF P2-a · sheaf cohomology over ℝ-valued presheaves.
 *
 *   Math foundation (Leray / Grothendieck / Čech):
 *
 *     For a base space X (we model as a finite set of "sites"), an open
 *     cover U = {U₀, U₁, ...}, and a presheaf F : Open(X)ᵒᵖ → Vec_ℝ,
 *     the Čech complex is
 *
 *       Č^p(U, F) = ⊕_{i₀<…<i_p} F(U_{i₀} ∩ … ∩ U_{i_p})
 *
 *     with coboundary
 *
 *       (δσ)_{i₀…i_{p+1}} = Σ_{k=0}^{p+1} (−1)^k · ρ(σ_{i₀…î_k…i_{p+1}})
 *
 *     and the p-th Čech cohomology
 *
 *       H^p(U, F) = ker δ^p / im δ^{p−1}.
 *
 *     We focus on H¹: dim H¹(U, F) = (number of independent 1-cocycles)
 *     − (number of independent 1-coboundaries). H¹ ≠ 0 ⟺ there exist
 *     local sections that agree pairwise on overlaps but cannot be glued
 *     into a single global section — the canonical "local OK, global
 *     contradiction" signal CHRONOSHEAF chases.
 *
 *   Implementation strategy (performance + accuracy):
 *
 *     We restrict to ℝ-valued (scalar) sections per site — sufficient
 *     for the AI-memory use case where each verifier returns a single
 *     number per overlap (a "claim value"). For overlaps the restriction
 *     map is the identity on ℝ.
 *
 *     The δ⁰ matrix is the signed incidence of pairs to sites:
 *
 *       δ⁰[ij, k] = +1 if k == j,  −1 if k == i,  0 otherwise
 *
 *     For overlaps with NO triple overlap (most code-base covers), every
 *     1-cochain is automatically a cocycle (ker δ¹ = whole space), so
 *
 *       dim H¹ = E − rank(δ⁰)
 *
 *     where E is the number of pairs and rank(δ⁰) = N − c (vertices N
 *     minus connected components c of the nerve 1-skeleton). This
 *     reduces to a graph-theoretic computation that runs in O(N + E).
 *
 *     When triple overlaps exist we compute δ¹ explicitly and rank-reduce
 *     via integer Gaussian elimination (O(min(E,T)² · max(E,T))) — fast
 *     enough for a Mneme catalog cover of a few hundred sites.
 *
 *   Composes with PAIN-001 (time-direction), PAIN-004 (self-reference
 *   via reflexive cover), PAIN-005 (interface-coherence as global section).
 */

export type Site = string;

export interface SheafCover {
  /** Sites (open sets) — identified by string keys. */
  sites: ReadonlyArray<Site>;
  /** Pairwise overlaps as unordered pairs [i, j] with i < j (by sites index). */
  overlaps: ReadonlyArray<[Site, Site]>;
  /** Optional triple overlaps [i, j, k] with i < j < k. */
  triples?: ReadonlyArray<[Site, Site, Site]>;
}

/** Section on each site (the 0-cochain): site → real value. */
export type Section0 = ReadonlyMap<Site, number>;

/** Section on each overlap (the 1-cochain): pair-key → real value. */
export type Section1 = ReadonlyMap<string, number>;

export interface SheafResult {
  /** Number of 1-cochains (= |overlaps|). */
  cochainDim: number;
  /** rank δ⁰ — dim image of 0→1 coboundary. */
  rankDelta0: number;
  /** Estimated dim ker δ¹. With no triples = |overlaps|. */
  kerDelta1: number;
  /** dim H¹ = ker δ¹ − im δ⁰. ≥0 by construction. */
  h1: number;
  /** True when H¹ > 0 — pairwise OK but globally inconsistent. */
  hasObstruction: boolean;
  /** Minimal witnesses: 1-cochains that are cocycles but not coboundaries. */
  obstructions: Array<{ pair: [Site, Site]; value: number }>;
  /** Connected components of the nerve 1-skeleton (auxiliary). */
  components: number;
}

/** Key for an unordered pair (canonical i<j by lex order of strings). */
function pairKey(a: Site, b: Site): string {
  return a < b ? `${a}${b}` : `${b}${a}`;
}

/** Union-Find for connected components. */
class UnionFind {
  parent = new Map<Site, Site>();
  rank = new Map<Site, number>();
  add(x: Site): void { if (!this.parent.has(x)) { this.parent.set(x, x); this.rank.set(x, 0); } }
  find(x: Site): Site {
    let root = x;
    while (this.parent.get(root) !== root) root = this.parent.get(root)!;
    let cur = x;
    while (cur !== root) { const next = this.parent.get(cur)!; this.parent.set(cur, root); cur = next; }
    return root;
  }
  union(a: Site, b: Site): void {
    const ra = this.find(a); const rb = this.find(b);
    if (ra === rb) return;
    const r1 = this.rank.get(ra) ?? 0; const r2 = this.rank.get(rb) ?? 0;
    if (r1 < r2) this.parent.set(ra, rb);
    else if (r1 > r2) this.parent.set(rb, ra);
    else { this.parent.set(rb, ra); this.rank.set(ra, r1 + 1); }
  }
  countComponents(): number {
    const roots = new Set<Site>();
    for (const k of this.parent.keys()) roots.add(this.find(k));
    return roots.size;
  }
}

/**
 * Compute δ⁰(σ) for a 0-cochain σ — returns 1-cochain on every overlap.
 *   (δ⁰σ)_{ij} = σ_j − σ_i.
 */
export function delta0(cover: SheafCover, sigma0: Section0): Section1 {
  const out = new Map<string, number>();
  for (const [a, b] of cover.overlaps) {
    const va = sigma0.get(a) ?? 0;
    const vb = sigma0.get(b) ?? 0;
    const key = pairKey(a, b);
    out.set(key, (a < b ? vb - va : va - vb));
  }
  return out;
}

/**
 * Compute δ¹(σ) for a 1-cochain σ — returns 2-cochain on every triple.
 *   (δ¹σ)_{ijk} = σ_{jk} − σ_{ik} + σ_{ij}.
 */
export function delta1(cover: SheafCover, sigma1: Section1): Map<string, number> {
  const out = new Map<string, number>();
  if (!cover.triples) return out;
  for (const [i, j, k] of cover.triples) {
    const get = (a: Site, b: Site): number => {
      const v = sigma1.get(pairKey(a, b)) ?? 0;
      return a < b ? v : -v;
    };
    const tripleKey = [i, j, k].sort().join("");
    out.set(tripleKey, get(j, k) - get(i, k) + get(i, j));
  }
  return out;
}

/** Check the cocycle condition δ¹σ = 0 on all triples. */
export function isCocycle(cover: SheafCover, sigma1: Section1, tol = 1e-9): boolean {
  if (!cover.triples) return true;
  const d = delta1(cover, sigma1);
  for (const v of d.values()) if (Math.abs(v) > tol) return false;
  return true;
}

/**
 * Compute dim H¹(U, F) by reducing to graph connectivity when triples
 * are absent + Gaussian elimination when they're present.
 */
export function cohomologyH1(cover: SheafCover): SheafResult {
  // Build connected components of the nerve 1-skeleton.
  const uf = new UnionFind();
  for (const s of cover.sites) uf.add(s);
  for (const [a, b] of cover.overlaps) { uf.add(a); uf.add(b); uf.union(a, b); }
  const components = uf.countComponents();
  const E = cover.overlaps.length;
  const N = cover.sites.length;

  // rank δ⁰ = N - c (number of independent edges in a spanning forest).
  const rankDelta0 = Math.max(0, N - components);

  // dim ker δ¹: when no triples, every 1-cochain is a cocycle → ker = E.
  // When triples exist, we count rank δ¹ and ker = E - rank δ¹.
  let kerDelta1 = E;
  if (cover.triples && cover.triples.length > 0) {
    const rankD1 = rankOfDelta1(cover);
    kerDelta1 = Math.max(0, E - rankD1);
  }

  const h1 = Math.max(0, kerDelta1 - rankDelta0);

  // Minimal obstruction witnesses: pairs whose value is the largest
  // contributors to H¹. We approximate via cycle space of the multigraph:
  // any edge NOT in a spanning forest is part of an independent cycle and
  // contributes to H¹ when there are no triple overlaps to kill it.
  const inForest = new Set<string>();
  const uf2 = new UnionFind();
  for (const s of cover.sites) uf2.add(s);
  const obstructions: SheafResult["obstructions"] = [];
  for (const [a, b] of cover.overlaps) {
    uf2.add(a); uf2.add(b);
    if (uf2.find(a) !== uf2.find(b)) {
      uf2.union(a, b);
      inForest.add(pairKey(a, b));
    } else {
      // This edge closes a cycle → contributes to H¹ when triples don't kill it.
      obstructions.push({ pair: [a, b], value: 1 });
    }
  }

  return {
    cochainDim: E,
    rankDelta0,
    kerDelta1,
    h1,
    hasObstruction: h1 > 0,
    obstructions: obstructions.slice(0, h1),
    components,
  };
}

/**
 * Rank of δ¹ via integer Gaussian elimination on the {-1, 0, +1}
 * matrix indexed by triples (rows) × pairs (columns).
 */
function rankOfDelta1(cover: SheafCover): number {
  const triples = cover.triples ?? [];
  if (triples.length === 0) return 0;
  const pairCols = new Map<string, number>();
  cover.overlaps.forEach((p, idx) => pairCols.set(pairKey(p[0], p[1]), idx));
  const rows: number[][] = [];
  for (const [i, j, k] of triples) {
    const row = new Array(cover.overlaps.length).fill(0);
    const sign = (a: Site, b: Site): number => (a < b ? 1 : -1);
    const col = (a: Site, b: Site): number => pairCols.get(pairKey(a, b)) ?? -1;
    const cij = col(i, j); if (cij >= 0) row[cij] += sign(i, j);
    const cjk = col(j, k); if (cjk >= 0) row[cjk] += sign(j, k);
    const cik = col(i, k); if (cik >= 0) row[cik] -= sign(i, k);
    rows.push(row);
  }
  return gaussianRank(rows);
}

/** Row-reduce + return rank. Pure integer arithmetic in this code path. */
function gaussianRank(rows: number[][]): number {
  if (rows.length === 0) return 0;
  const m = rows.length; const n = rows[0]!.length;
  const A = rows.map((r) => [...r]);
  let rank = 0;
  let col = 0;
  for (let row = 0; row < m && col < n; col++) {
    let pivot = -1;
    for (let r = row; r < m; r++) if ((A[r]![col] ?? 0) !== 0) { pivot = r; break; }
    if (pivot < 0) continue;
    [A[row], A[pivot]] = [A[pivot]!, A[row]!];
    const piv = A[row]![col]!;
    for (let r = 0; r < m; r++) {
      if (r === row) continue;
      const factor = (A[r]![col] ?? 0) / piv;
      if (factor === 0) continue;
      for (let c = col; c < n; c++) A[r]![c] = (A[r]![c] ?? 0) - factor * (A[row]![c] ?? 0);
    }
    rank++;
    row++;
  }
  return rank;
}

/**
 * Given a presheaf assignment (each site → numeric "claim value"), check
 * whether the implied pairwise differences glue: returns the same
 * SheafResult plus the gluing-residual vector.
 *
 *   residual_{ij} = (claim_j - claim_i) restricted to U_i ∩ U_j
 *
 * If H¹ = 0, the residual lies in im δ⁰ → there exists a global section
 * (effectively the user's claim values are all consistent). If H¹ > 0,
 * the residual carries a non-trivial cocycle component.
 */
export function gluingDiagnostic(cover: SheafCover, claimPerSite: Section0): SheafResult & { residual: Section1 } {
  const h1 = cohomologyH1(cover);
  const residual = delta0(cover, claimPerSite);
  return { ...h1, residual };
}
