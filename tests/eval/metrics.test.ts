import { describe, it, expect } from "vitest";
import { recallAtK, precisionAtK, reciprocalRank, ndcgAtK, aggregate, evaluate } from "./metrics.js";

describe("recallAtK", () => {
  it("perfect retrieval at k = 1", () => {
    expect(recallAtK(["A"], new Set(["A"]), 1)).toBe(1);
  });
  it("misses outside k", () => {
    expect(recallAtK(["X", "Y", "A"], new Set(["A"]), 2)).toBe(0);
  });
  it("returns 1 when no relevant docs and no retrievals", () => {
    expect(recallAtK([], new Set(), 5)).toBe(1);
  });
  it("returns 0 when no relevant docs but something retrieved", () => {
    expect(recallAtK(["X"], new Set(), 5)).toBe(0);
  });
});

describe("precisionAtK", () => {
  it("returns hit rate within top-k", () => {
    expect(precisionAtK(["A", "X", "B"], new Set(["A", "B"]), 3)).toBeCloseTo(2 / 3, 6);
  });
  it("0 when nothing retrieved", () => {
    expect(precisionAtK([], new Set(["A"]), 5)).toBe(0);
  });
});

describe("reciprocalRank", () => {
  it("1/1 when first hit at rank 1", () => {
    expect(reciprocalRank(["A", "B"], new Set(["A"]), 5)).toBe(1);
  });
  it("1/3 when first hit at rank 3", () => {
    expect(reciprocalRank(["X", "Y", "A"], new Set(["A"]), 5)).toBeCloseTo(1 / 3, 6);
  });
  it("0 when not in top-k", () => {
    expect(reciprocalRank(["X", "Y", "Z"], new Set(["A"]), 3)).toBe(0);
  });
});

describe("ndcgAtK", () => {
  it("1.0 when retrieved order matches relevance perfectly", () => {
    expect(ndcgAtK(["A", "B"], new Set(["A", "B"]), 10)).toBeCloseTo(1, 6);
  });
  it("0 when no hits", () => {
    expect(ndcgAtK(["X", "Y"], new Set(["A"]), 10)).toBe(0);
  });
  it("less than 1 when relevant docs are placed lower", () => {
    const score = ndcgAtK(["X", "A"], new Set(["A"]), 10);
    expect(score).toBeLessThan(1);
    expect(score).toBeGreaterThan(0);
  });
});

describe("aggregate + evaluate", () => {
  it("computes mean across queries", () => {
    const rows = [
      evaluate(["A"], new Set(["A"]), "q1"),
      evaluate(["X", "A"], new Set(["A"]), "q2"),
    ];
    const agg = aggregate(rows);
    expect(agg.numQueries).toBe(2);
    expect(agg.mrr).toBeCloseTo((1 + 0.5) / 2, 6);
  });

  it("treats negative queries (no relevant doc) as a hit when retrieved is empty", () => {
    const row = evaluate([], new Set(), "neg");
    expect(row.hit).toBe(true);
  });
});
