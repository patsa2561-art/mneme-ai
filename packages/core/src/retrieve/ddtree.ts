/**
 * DDTree — Best-First Search through a commit ancestor tree.
 *
 * Inspired by KAT-0B's DDTree (a BinaryHeap-driven candidate exploration
 * loop bounded by an exploration budget). Mneme uses it under `mneme why`
 * to walk *back* through parent commits looking for the deepest plausible
 * "this is why X exists" answer — strictly better than flat semantic
 * retrieval, which can't follow causal ancestry.
 *
 * Semantics:
 *   1. Caller supplies a `scoreFn(commit, depth, parentScore)` — typically
 *      relevance × depth-decay × parent-score.
 *   2. We maintain a max-heap keyed by score and pop the best candidate
 *      until either the budget is exhausted or the heap is empty.
 *   3. Each pop is classified: accepted, pruned-floor, pruned-depth, or
 *      pruned-budget (for nodes still on the heap when budget runs out).
 *   4. Parents of an accepted node are scored and pushed back in.
 *
 * Heap implementation: a simple binary max-heap on a flat array. We avoid
 * Node v22's experimental `node:priority-queue` for portability — Mneme
 * supports Node 18+. See `MaxHeap` below.
 *
 * Cycle handling: merge commits can — in theory — produce diamond-shaped
 * ancestry where the same hash appears twice. We track a `visited` Set so
 * each commit is processed at most once (the first/highest-score path wins).
 */
import type { Commit } from "../types.js";

export interface DDTreeOptions {
  /** Max nodes to explore (controls cost). Default 32. */
  budget?: number;
  /** Max depth from root before pruning. Default 6. */
  maxDepth?: number;
  /** Score floor — nodes below this are pruned. Default 0.05. */
  scoreFloor?: number;
}

export interface DDTreeNode {
  commit: Commit;
  depth: number;
  /** Combined score: relevance × decay-by-depth × parent score. */
  score: number;
  /** Parent commit hash (the *child* in graph terms — i.e. the node we
   *  expanded from to reach this commit). Undefined for root nodes. */
  parent?: string;
  /** Why this node was pruned, or "accepted". */
  status: "accepted" | "pruned-floor" | "pruned-depth" | "pruned-budget";
}

export interface DDTreeResult {
  /** All explored nodes with verdict (in pop order). */
  visited: DDTreeNode[];
  /** Accepted nodes only, sorted by score (highest first). */
  accepted: DDTreeNode[];
  budgetUsed: number;
}

/** Score function: relevance × decay-by-depth × log_priors etc. Caller provides. */
export type ScoreFn = (commit: Commit, depth: number, parentScore: number) => number;

/** Look up a commit's parent hashes. Caller provides (typically from store). */
export type ParentResolver = (hash: string) => string[];

/** Look up a commit by hash. Caller provides. */
export type CommitResolver = (hash: string) => Commit | undefined;

interface HeapItem {
  hash: string;
  depth: number;
  score: number;
  parent?: string;
}

/**
 * Simple binary max-heap on score. Stable enough for our needs — when two
 * nodes tie on score, insertion order roughly wins (heap structure means
 * "roughly", not "strictly", but this is fine for exploration).
 */
class MaxHeap {
  private data: HeapItem[] = [];

  get size(): number {
    return this.data.length;
  }

  push(item: HeapItem): void {
    this.data.push(item);
    this.siftUp(this.data.length - 1);
  }

  pop(): HeapItem | undefined {
    const n = this.data.length;
    if (n === 0) return undefined;
    const top = this.data[0]!;
    const last = this.data.pop()!;
    if (n > 1) {
      this.data[0] = last;
      this.siftDown(0);
    }
    return top;
  }

  /** Drain remaining items (for "pruned-budget" reporting). */
  drain(): HeapItem[] {
    const out = [...this.data];
    this.data = [];
    return out;
  }

  private siftUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[parent]!.score >= this.data[i]!.score) break;
      [this.data[parent], this.data[i]] = [this.data[i]!, this.data[parent]!];
      i = parent;
    }
  }

  private siftDown(i: number): void {
    const n = this.data.length;
    while (true) {
      const l = 2 * i + 1;
      const r = 2 * i + 2;
      let best = i;
      if (l < n && this.data[l]!.score > this.data[best]!.score) best = l;
      if (r < n && this.data[r]!.score > this.data[best]!.score) best = r;
      if (best === i) break;
      [this.data[best], this.data[i]] = [this.data[i]!, this.data[best]!];
      i = best;
    }
  }
}

/**
 * Best-First Search through commit ancestors. See module docstring.
 *
 * Returns every node we touched (with verdict), the sorted list of
 * accepted nodes, and how much of the budget we consumed.
 */
export function exploreDDTree(
  rootHashes: string[],
  scoreFn: ScoreFn,
  parents: ParentResolver,
  commits: CommitResolver,
  opts: DDTreeOptions = {},
): DDTreeResult {
  const budget = opts.budget ?? 32;
  const maxDepth = opts.maxDepth ?? 6;
  const scoreFloor = opts.scoreFloor ?? 0.05;

  const heap = new MaxHeap();
  const visited: DDTreeNode[] = [];
  const seen = new Set<string>(); // cycle / diamond protection
  let budgetUsed = 0;

  // Seed: each root scored with parentScore=1 (no prior).
  for (const hash of rootHashes) {
    const c = commits(hash);
    if (!c) continue;
    const score = scoreFn(c, 0, 1);
    heap.push({ hash, depth: 0, score });
  }

  while (heap.size > 0 && budgetUsed < budget) {
    const item = heap.pop()!;
    if (seen.has(item.hash)) continue; // cycle / diamond
    seen.add(item.hash);

    const commit = commits(item.hash);
    if (!commit) continue;

    budgetUsed++;

    // Floor check first — cheap and short-circuits deep pruning.
    if (item.score < scoreFloor) {
      visited.push({
        commit,
        depth: item.depth,
        score: item.score,
        parent: item.parent,
        status: "pruned-floor",
      });
      continue;
    }

    // Depth check.
    if (item.depth >= maxDepth) {
      visited.push({
        commit,
        depth: item.depth,
        score: item.score,
        parent: item.parent,
        status: "pruned-depth",
      });
      continue;
    }

    // Accept and expand.
    visited.push({
      commit,
      depth: item.depth,
      score: item.score,
      parent: item.parent,
      status: "accepted",
    });

    const childDepth = item.depth + 1;
    for (const parentHash of parents(item.hash)) {
      if (seen.has(parentHash)) continue;
      const parentCommit = commits(parentHash);
      if (!parentCommit) continue;
      const childScore = scoreFn(parentCommit, childDepth, item.score);
      heap.push({
        hash: parentHash,
        depth: childDepth,
        score: childScore,
        parent: item.hash,
      });
    }
  }

  // Anything still in the heap when we hit the budget wall is "pruned-budget".
  for (const leftover of heap.drain()) {
    if (seen.has(leftover.hash)) continue;
    const c = commits(leftover.hash);
    if (!c) continue;
    visited.push({
      commit: c,
      depth: leftover.depth,
      score: leftover.score,
      parent: leftover.parent,
      status: "pruned-budget",
    });
  }

  const accepted = visited
    .filter((n) => n.status === "accepted")
    .sort((a, b) => b.score - a.score);

  return { visited, accepted, budgetUsed };
}
