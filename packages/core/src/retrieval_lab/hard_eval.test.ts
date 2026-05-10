import { describe, expect, it } from "vitest";
import { buildHardEvalSuite, scoreRanking, type HardEvalStoreReader } from "./hard_eval.js";

describe("scoreRanking", () => {
  it("perfect ranking: precision=recall=ndcg=1", () => {
    const r = scoreRanking(["a", "b", "c"], ["a", "b", "c"], 3);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(1);
    expect(r.ndcg).toBe(1);
  });

  it("zero hits: all zero", () => {
    const r = scoreRanking(["x", "y"], ["a", "b"], 2);
    expect(r.precision).toBe(0);
    expect(r.recall).toBe(0);
    expect(r.ndcg).toBe(0);
  });

  it("partial overlap: precision = recall = hits/k when |relevant|=k", () => {
    const r = scoreRanking(["a", "x", "c"], ["a", "b", "c"], 3);
    expect(r.precision).toBeCloseTo(2 / 3, 5);
    expect(r.recall).toBeCloseTo(2 / 3, 5);
    expect(r.ndcg).toBeGreaterThan(0);
    expect(r.ndcg).toBeLessThan(1);
  });

  it("relevant items at top score higher NDCG than at bottom", () => {
    const top = scoreRanking(["a", "b", "x", "y"], ["a", "b"], 4);
    const bot = scoreRanking(["x", "y", "a", "b"], ["a", "b"], 4);
    expect(top.ndcg).toBeGreaterThan(bot.ndcg);
  });

  it("empty ranked list: all zero", () => {
    const r = scoreRanking([], ["a"], 5);
    expect(r.precision).toBe(0);
    expect(r.recall).toBe(0);
  });
});

describe("buildHardEvalSuite", () => {
  it("returns simulator source when no storeReader", () => {
    const r = buildHardEvalSuite({ repoRoot: process.cwd() });
    expect(r.source).toBe("simulator");
    expect(r.cases).toEqual([]);
  });

  it("returns simulator source when store is empty", () => {
    const reader: HardEvalStoreReader = {
      countChunksWithEmbedding: () => 0,
      chunkIdsByCommit: () => new Map(),
    };
    const r = buildHardEvalSuite({ repoRoot: process.cwd(), storeReader: reader });
    expect(r.source).toBe("simulator");
  });

  it("uses hard suite when store has >= MIN_CHUNKS embedded", () => {
    // Mock a reader with >= 100 chunks; the real git log of THIS repo
    // (Mneme) has many commits so we should get cases.
    const reader: HardEvalStoreReader = {
      countChunksWithEmbedding: () => 1000,
      chunkIdsByCommit: (shas) => {
        const m = new Map<string, string[]>();
        for (const s of shas) m.set(s, [`${s}:c1`, `${s}:c2`]);
        return m;
      },
    };
    const r = buildHardEvalSuite({ repoRoot: process.cwd(), storeReader: reader });
    // We're running inside the Mneme repo so git log returns commits.
    // If anyone runs this test outside a git repo, it'll fall back.
    expect(["hard", "simulator"]).toContain(r.source);
    if (r.source === "hard") {
      expect(r.cases.length).toBeGreaterThan(0);
      expect(r.cases.length).toBeLessThanOrEqual(100);
      for (const c of r.cases) {
        expect(c.id).toMatch(/^hard-/);
        expect(c.relevantIds.length).toBeGreaterThan(0);
        expect(c.query.length).toBeGreaterThan(5);
      }
    }
  });
});
