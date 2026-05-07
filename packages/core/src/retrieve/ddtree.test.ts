import { describe, it, expect } from "vitest";
import { exploreDDTree } from "./ddtree.js";
import type { ScoreFn, ParentResolver, CommitResolver } from "./ddtree.js";
import type { Commit } from "../types.js";

/** Build a fake commit. We only care about hash for tree shape; everything
 *  else is filled with throwaway values to satisfy the type. */
function makeCommit(hash: string, parents: string[] = []): Commit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    authorName: "Test",
    authorEmail: "test@example.com",
    authorDate: "2025-01-01T00:00:00Z",
    committerDate: "2025-01-01T00:00:00Z",
    subject: `commit ${hash}`,
    body: "",
    files: [],
    parents,
  };
}

/** Build resolvers from a flat list of commits. */
function makeResolvers(commits: Commit[]): {
  parents: ParentResolver;
  commits: CommitResolver;
} {
  const byHash = new Map(commits.map((c) => [c.hash, c]));
  return {
    parents: (h) => byHash.get(h)?.parents ?? [],
    commits: (h) => byHash.get(h),
  };
}

describe("exploreDDTree — basic ancestry walk", () => {
  it("explores root → 3 parents and accepts all under generous budget", () => {
    // Tree:  A -> B, C, D    (A has three parents)
    const a = makeCommit("A", ["B", "C", "D"]);
    const b = makeCommit("B", []);
    const c = makeCommit("C", []);
    const d = makeCommit("D", []);
    const { parents, commits } = makeResolvers([a, b, c, d]);

    // Constant score 1.0 — everything stays well above the floor.
    const score: ScoreFn = () => 1;

    const result = exploreDDTree(["A"], score, parents, commits, {
      budget: 5,
      maxDepth: 6,
      scoreFloor: 0.05,
    });

    expect(result.budgetUsed).toBe(4);
    expect(result.accepted.map((n) => n.commit.hash).sort()).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
    expect(result.visited.every((n) => n.status === "accepted")).toBe(true);
  });

  it("records parent hash for each non-root accepted node", () => {
    const a = makeCommit("A", ["B"]);
    const b = makeCommit("B", []);
    const { parents, commits } = makeResolvers([a, b]);
    const r = exploreDDTree(["A"], () => 1, parents, commits, { budget: 5 });
    const accB = r.accepted.find((n) => n.commit.hash === "B");
    expect(accB?.parent).toBe("A");
    const accA = r.accepted.find((n) => n.commit.hash === "A");
    expect(accA?.parent).toBeUndefined();
  });
});

describe("exploreDDTree — pruning", () => {
  it("prunes deep nodes when depth >= maxDepth", () => {
    // Linear chain A -> B -> C -> D -> E
    const chain = ["A", "B", "C", "D", "E"].map((h, i, arr) =>
      makeCommit(h, arr[i + 1] ? [arr[i + 1]!] : []),
    );
    const { parents, commits } = makeResolvers(chain);

    const r = exploreDDTree(["A"], () => 1, parents, commits, {
      budget: 100,
      maxDepth: 2, // accept depths 0, 1; prune at depth 2
      scoreFloor: 0,
    });

    const acc = r.accepted.map((n) => `${n.commit.hash}@${n.depth}`).sort();
    expect(acc).toEqual(["A@0", "B@1"]);
    const prunedDepth = r.visited.filter((n) => n.status === "pruned-depth");
    expect(prunedDepth.map((n) => n.commit.hash)).toEqual(["C"]);
  });

  it("prunes nodes whose score falls below the scoreFloor", () => {
    // A -> B; score decays exponentially with depth.
    const a = makeCommit("A", ["B"]);
    const b = makeCommit("B", []);
    const { parents, commits } = makeResolvers([a, b]);

    // depth 0 -> 1.0, depth 1 -> 0.01 (below floor 0.05)
    const score: ScoreFn = (_c, depth) => Math.pow(0.01, depth);

    const r = exploreDDTree(["A"], score, parents, commits, {
      budget: 100,
      maxDepth: 6,
      scoreFloor: 0.05,
    });

    expect(r.accepted.map((n) => n.commit.hash)).toEqual(["A"]);
    const floored = r.visited.filter((n) => n.status === "pruned-floor");
    expect(floored.map((n) => n.commit.hash)).toEqual(["B"]);
  });

  it("marks remaining heap as pruned-budget when budget exhausted", () => {
    // Wide tree: root A with parents B,C,D,E,F (5 parents).
    const a = makeCommit("A", ["B", "C", "D", "E", "F"]);
    const others = ["B", "C", "D", "E", "F"].map((h) => makeCommit(h, []));
    const { parents, commits } = makeResolvers([a, ...others]);

    // Distinct scores so only the highest-score parents get accepted first.
    const scoreMap: Record<string, number> = { A: 1, B: 0.9, C: 0.8, D: 0.7, E: 0.6, F: 0.5 };
    const score: ScoreFn = (c) => scoreMap[c.hash]!;

    const r = exploreDDTree(["A"], score, parents, commits, {
      budget: 3, // accept A + 2 best parents; rest -> pruned-budget
      maxDepth: 6,
      scoreFloor: 0,
    });

    expect(r.budgetUsed).toBe(3);
    expect(r.accepted.map((n) => n.commit.hash)).toEqual(["A", "B", "C"]);
    const budgetPruned = r.visited.filter((n) => n.status === "pruned-budget");
    expect(budgetPruned.map((n) => n.commit.hash).sort()).toEqual([
      "D",
      "E",
      "F",
    ]);
  });
});

describe("exploreDDTree — robustness", () => {
  it("handles a cycle in the parent graph without looping forever", () => {
    // Pathological: A -> B, B -> A (cycle).
    const a = makeCommit("A", ["B"]);
    const b = makeCommit("B", ["A"]);
    const { parents, commits } = makeResolvers([a, b]);

    const r = exploreDDTree(["A"], () => 1, parents, commits, {
      budget: 100,
      maxDepth: 10,
      scoreFloor: 0,
    });

    // Should terminate; each node visited once.
    expect(r.accepted.map((n) => n.commit.hash).sort()).toEqual(["A", "B"]);
    expect(r.budgetUsed).toBe(2);
  });

  it("handles a diamond (merge) — same hash reachable two ways, processed once", () => {
    // A -> B, A -> C, both B and C -> D.
    const a = makeCommit("A", ["B", "C"]);
    const b = makeCommit("B", ["D"]);
    const c = makeCommit("C", ["D"]);
    const d = makeCommit("D", []);
    const { parents, commits } = makeResolvers([a, b, c, d]);

    const r = exploreDDTree(["A"], () => 1, parents, commits, {
      budget: 100,
      maxDepth: 10,
      scoreFloor: 0,
    });

    const dCount = r.visited.filter((n) => n.commit.hash === "D").length;
    expect(dCount).toBe(1);
    expect(r.accepted.map((n) => n.commit.hash).sort()).toEqual([
      "A",
      "B",
      "C",
      "D",
    ]);
  });

  it("ignores root hashes that don't resolve to a commit", () => {
    const a = makeCommit("A", []);
    const { parents, commits } = makeResolvers([a]);

    const r = exploreDDTree(["MISSING", "A"], () => 1, parents, commits, {
      budget: 5,
    });
    expect(r.accepted.map((n) => n.commit.hash)).toEqual(["A"]);
  });

  it("returns an empty result when no roots resolve", () => {
    const { parents, commits } = makeResolvers([]);
    const r = exploreDDTree(["NOPE"], () => 1, parents, commits);
    expect(r.accepted).toEqual([]);
    expect(r.visited).toEqual([]);
    expect(r.budgetUsed).toBe(0);
  });

  it("orders accepted by score descending", () => {
    const a = makeCommit("A", ["B", "C"]);
    const b = makeCommit("B", []);
    const c = makeCommit("C", []);
    const { parents, commits } = makeResolvers([a, b, c]);
    const scores: Record<string, number> = { A: 0.5, B: 0.9, C: 0.7 };
    const r = exploreDDTree(["A"], (cm) => scores[cm.hash]!, parents, commits, {
      budget: 5,
      scoreFloor: 0,
    });
    const order = r.accepted.map((n) => n.commit.hash);
    expect(order).toEqual(["B", "C", "A"]);
  });
});
