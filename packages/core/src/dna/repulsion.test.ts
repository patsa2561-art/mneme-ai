import { describe, it, expect } from "vitest";
import { applyRepulsion, type RankedCandidate } from "./repulsion.js";

describe("A6. Anti-Pattern Repulsion", () => {
  it("no regrets → no penalty (final = base)", () => {
    const c: RankedCandidate[] = [
      { id: "a", embedding: [1, 0], baseRelevance: 0.9 },
      { id: "b", embedding: [0, 1], baseRelevance: 0.7 },
    ];
    const r = applyRepulsion({ candidates: c, regretEmbeddings: [] });
    expect(r[0]!.id).toBe("a");
    expect(r[0]!.finalRelevance).toBeCloseTo(0.9);
    expect(r[1]!.finalRelevance).toBeCloseTo(0.7);
  });

  it("downranks candidates close to a regret pattern", () => {
    const c: RankedCandidate[] = [
      { id: "near-regret", embedding: [1, 0], baseRelevance: 0.9 },
      { id: "far-from-regret", embedding: [10, 0], baseRelevance: 0.7 },
    ];
    const r = applyRepulsion({
      candidates: c,
      regretEmbeddings: [[1.0, 0]],
    });
    // far-from-regret should now win despite lower base
    expect(r[0]!.id).toBe("far-from-regret");
    expect(r[0]!.finalRelevance).toBeGreaterThan(r[1]!.finalRelevance);
  });

  it("identical embeddings to regret → maximum penalty (= floor)", () => {
    const r = applyRepulsion({
      candidates: [{ id: "ouch", embedding: [1, 2, 3], baseRelevance: 1 }],
      regretEmbeddings: [[1, 2, 3]],
      distanceFloor: 0.1,
    });
    expect(r[0]!.penalty).toBe(0.1);
    expect(r[0]!.finalRelevance).toBeCloseTo(0.1);
  });

  it("preserves meta passthrough", () => {
    const r = applyRepulsion({
      candidates: [{ id: "x", embedding: [1, 0], baseRelevance: 0.5, meta: { path: "src/x.ts" } }],
      regretEmbeddings: [],
    });
    expect(r[0]!.meta).toEqual({ path: "src/x.ts" });
  });

  it("deterministic order across runs", () => {
    const c: RankedCandidate[] = [
      { id: "a", embedding: [1, 0], baseRelevance: 0.5 },
      { id: "b", embedding: [0, 1], baseRelevance: 0.5 },
    ];
    const r1 = applyRepulsion({ candidates: c, regretEmbeddings: [] });
    const r2 = applyRepulsion({ candidates: c, regretEmbeddings: [] });
    expect(r1.map((x) => x.id)).toEqual(r2.map((x) => x.id));
  });

  it("returns the index of nearest regret for transparency", () => {
    const r = applyRepulsion({
      candidates: [{ id: "x", embedding: [1, 0, 0], baseRelevance: 1 }],
      regretEmbeddings: [
        [10, 0, 0], // far
        [0.9, 0, 0], // near
      ],
    });
    expect(r[0]!.closestRegretIndex).toBe(1);
  });
});
