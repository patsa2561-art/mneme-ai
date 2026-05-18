/**
 * v2.19.48 — CHRONOSHEAF P3 · base space + presheaf.
 *
 *   Math formalism (P3 spec verbatim):
 *
 *     X = G × T × S
 *
 *     where:
 *       G = commit DAG (partial order on commit shas)
 *       T = wall-clock time (continuous ℝ, modelled as ms since epoch)
 *       S = scale axis (file ⊂ module ⊂ package ⊂ repo ⊂ org, 5 levels)
 *
 *     Open sets U ⊆ X are tuples (commit-cone, time-interval, scale-band).
 *     A commit-cone is the down-set of a commit in G (all ancestors).
 *
 *     Presheaf F: Open(X)ᵒᵖ → Vec_ℝ assigns to each open U the set of
 *     locally consistent beliefs over claims relevant to U. Restriction
 *     map ρ_{U⊃V}: F(U) → F(V) is "if I believe B over U I must
 *     believe B over V" — projection onto the smaller open set.
 *
 *   Implementation notes (performance + accuracy + safety):
 *
 *     - All open-set operations are pure-function + idempotent.
 *     - Commit-cone membership uses cached transitive closure to amortise
 *       O(1) lookup after first traversal.
 *     - Scale axis is a 5-band ordinal enum so subset checks are O(1).
 *     - Time intervals are half-open [t_start, t_end) for clean union /
 *       intersection algebra.
 *     - Error handling: every constructor validates inputs; every accessor
 *       returns a typed Result rather than throwing on missing data.
 */

export type CommitSha = string;
export type TimeMs = number;

export const SCALE_BANDS = ["file", "module", "package", "repo", "org"] as const;
export type ScaleBand = typeof SCALE_BANDS[number];

/** Bidirectional commit DAG with ancestor-set memoisation. */
export class CommitDag {
  private parents = new Map<CommitSha, ReadonlySet<CommitSha>>();
  private ancestorCache = new Map<CommitSha, Set<CommitSha>>();

  /** Add a commit with its parent list (may be empty for root). */
  addCommit(sha: CommitSha, parents: ReadonlyArray<CommitSha>): void {
    if (typeof sha !== "string" || sha.length === 0) {
      throw new TypeError(`CommitDag.addCommit: invalid sha "${sha}"`);
    }
    this.parents.set(sha, new Set(parents));
    // Invalidate ancestor cache for sha + descendants (cheap: clear all).
    this.ancestorCache.clear();
  }

  /** All ancestors of sha (including sha itself). Cached. */
  cone(sha: CommitSha): ReadonlySet<CommitSha> {
    if (this.ancestorCache.has(sha)) return this.ancestorCache.get(sha)!;
    const visited = new Set<CommitSha>();
    const stack: CommitSha[] = [sha];
    while (stack.length > 0) {
      const cur = stack.pop()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const ps = this.parents.get(cur);
      if (ps) for (const p of ps) if (!visited.has(p)) stack.push(p);
    }
    this.ancestorCache.set(sha, visited);
    return visited;
  }

  /** Whether ancestor is in the ancestor-cone of descendant. */
  isAncestorOf(ancestor: CommitSha, descendant: CommitSha): boolean {
    return this.cone(descendant).has(ancestor);
  }

  size(): number { return this.parents.size; }
}

/** Half-open time interval [start, end). */
export interface TimeInterval {
  startMs: TimeMs;
  endMs: TimeMs;
}

export function makeInterval(startMs: TimeMs, endMs: TimeMs): TimeInterval {
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    throw new TypeError(`makeInterval: non-finite bounds [${startMs}, ${endMs})`);
  }
  if (endMs < startMs) {
    throw new RangeError(`makeInterval: empty/inverted interval [${startMs}, ${endMs})`);
  }
  return { startMs, endMs };
}

export function intervalContains(iv: TimeInterval, t: TimeMs): boolean {
  return t >= iv.startMs && t < iv.endMs;
}

export function intervalIntersect(a: TimeInterval, b: TimeInterval): TimeInterval | null {
  const s = Math.max(a.startMs, b.startMs);
  const e = Math.min(a.endMs, b.endMs);
  return s < e ? { startMs: s, endMs: e } : null;
}

/** Ordinal index of a scale band (file=0, module=1, ...). */
export function scaleIndex(s: ScaleBand): number { return SCALE_BANDS.indexOf(s); }

/** Scale band a ⊆ b ⟺ idx(a) ≤ idx(b). */
export function scaleSubset(a: ScaleBand, b: ScaleBand): boolean {
  return scaleIndex(a) <= scaleIndex(b);
}

/**
 * Open set in X = G × T × S — a triple (commit-cone-root, time-interval, scale).
 * Closed under finite intersection (intersection of two opens is an open).
 */
export interface OpenSet {
  /** Identifier for the open set (deterministic id from contents). */
  id: string;
  /** Root commit defining the down-set on G. */
  commitConeRoot: CommitSha;
  /** Time interval on T. */
  time: TimeInterval;
  /** Scale band on S — the scale at which the open is observed. */
  scale: ScaleBand;
}

export function openSetId(root: CommitSha, time: TimeInterval, scale: ScaleBand): string {
  return root + "@" + time.startMs + "-" + time.endMs + "/" + scale;
}

export function makeOpen(root: CommitSha, time: TimeInterval, scale: ScaleBand): OpenSet {
  if (typeof root !== "string" || root.length === 0) {
    throw new TypeError(`makeOpen: invalid commit "${root}"`);
  }
  if (!SCALE_BANDS.includes(scale)) {
    throw new TypeError(`makeOpen: invalid scale "${scale}"`);
  }
  return { id: openSetId(root, time, scale), commitConeRoot: root, time, scale };
}

/**
 * Intersection of two opens. Uses CommitDag to find the latest-common-
 * ancestor (LCA) of the two roots; if no shared ancestor exists, the
 * intersection is empty (null).
 *
 *   open(r1, [s1,e1), b1) ∩ open(r2, [s2,e2), b2)
 *     = open(LCA(r1, r2), [max(s1,s2), min(e1,e2)), min(b1, b2))
 *
 * Returns null when either time-intervals are disjoint OR no common
 * ancestor exists in the DAG.
 */
export function intersectOpens(dag: CommitDag, a: OpenSet, b: OpenSet): OpenSet | null {
  const time = intervalIntersect(a.time, b.time);
  if (!time) return null;
  // LCA via cone-intersection on the DAG.
  const coneA = dag.cone(a.commitConeRoot);
  const coneB = dag.cone(b.commitConeRoot);
  let lca: CommitSha | null = null;
  // Walk the shared set; the LCA is the one whose own cone is the
  // largest subset of the intersection (deepest commit).
  let largestConeSize = 0;
  for (const sha of coneA) {
    if (!coneB.has(sha)) continue;
    const cs = dag.cone(sha).size;
    if (cs > largestConeSize) { largestConeSize = cs; lca = sha; }
  }
  if (lca === null) return null;
  const scale = scaleIndex(a.scale) <= scaleIndex(b.scale) ? a.scale : b.scale;
  return makeOpen(lca, time, scale);
}

/** Belief value carried by the presheaf at an open: a finite-dim ℝ vector. */
export type BeliefVector = ReadonlyArray<number>;

/**
 * Presheaf F: Open(X)ᵒᵖ → Vec_ℝ.
 *
 * Backed by a Map keyed by openSetId. The restriction map ρ_{U⊃V} is
 * a linear operator from ℝ^|claims(U)| → ℝ^|claims(V)|; in this
 * implementation we restrict by intersecting claim sets (vectors
 * indexed by the SAME claim list across opens that contain a
 * specific claim).
 *
 * Errors:
 *   - assignSection rejects non-finite values OR length mismatches with
 *     the registered claim cardinality.
 *   - sectionAt returns Result rather than throwing on missing key.
 */
export class Presheaf {
  private sections = new Map<string, BeliefVector>();
  private claimsByOpen = new Map<string, ReadonlyArray<string>>();

  /** Register the claim set whose belief values an open carries. */
  registerClaims(open: OpenSet, claims: ReadonlyArray<string>): void {
    if (!Array.isArray(claims)) throw new TypeError("registerClaims: claims must be an array");
    this.claimsByOpen.set(open.id, [...claims]);
  }

  /** Assign a belief vector to an open. Vector length must match registered claim count. */
  assignSection(open: OpenSet, belief: BeliefVector): void {
    const claims = this.claimsByOpen.get(open.id);
    if (!claims) throw new Error(`Presheaf.assignSection: no claims registered for ${open.id}`);
    if (belief.length !== claims.length) {
      throw new RangeError(`Presheaf.assignSection: belief length ${belief.length} ≠ claims ${claims.length} for ${open.id}`);
    }
    for (const v of belief) {
      if (!Number.isFinite(v)) {
        throw new RangeError(`Presheaf.assignSection: non-finite value in belief for ${open.id}`);
      }
    }
    this.sections.set(open.id, [...belief]);
  }

  /** Look up a section. Returns null when missing — never throws. */
  sectionAt(open: OpenSet): BeliefVector | null {
    return this.sections.get(open.id) ?? null;
  }

  /** Claims known at an open. */
  claimsAt(open: OpenSet): ReadonlyArray<string> {
    return this.claimsByOpen.get(open.id) ?? [];
  }

  /**
   * Restriction map ρ_{U⊃V}: F(U) → F(V).
   * Implementation: for each claim in V's claim set, find its position
   * in U's claim set and copy the value. Claims in V but not in U get
   * 0 (default-untracked).
   */
  restrict(uOpen: OpenSet, vOpen: OpenSet): BeliefVector | null {
    const uBelief = this.sectionAt(uOpen);
    if (!uBelief) return null;
    const uClaims = this.claimsAt(uOpen);
    const vClaims = this.claimsAt(vOpen);
    if (vClaims.length === 0) return [];
    const uIndex = new Map<string, number>();
    uClaims.forEach((c, i) => uIndex.set(c, i));
    const out: number[] = new Array(vClaims.length).fill(0);
    for (let j = 0; j < vClaims.length; j++) {
      const k = uIndex.get(vClaims[j]!);
      if (k !== undefined) out[j] = uBelief[k] ?? 0;
    }
    return out;
  }

  /** Number of opens with assigned sections. */
  size(): number { return this.sections.size; }
}
