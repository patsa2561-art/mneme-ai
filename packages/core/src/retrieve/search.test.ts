import { describe, it, expect } from "vitest";
import { cosine, reciprocalRankFusion } from "./search.js";
import type { CommitChunk } from "../types.js";

const chunk = (id: string, hash = "h"): CommitChunk => ({
  id,
  commitHash: hash,
  kind: "subject",
  text: `text-${id}`,
});

describe("cosine", () => {
  it("is 1 for identical vectors", () => {
    const v = Float32Array.from([1, 2, 3]);
    expect(cosine(v, v)).toBeCloseTo(1, 6);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosine(Float32Array.from([1, 0]), Float32Array.from([0, 1]))).toBeCloseTo(0, 6);
  });

  it("is -1 for opposite vectors", () => {
    expect(cosine(Float32Array.from([1, 1]), Float32Array.from([-1, -1]))).toBeCloseTo(-1, 6);
  });

  it("is invariant to magnitude", () => {
    const a = Float32Array.from([1, 2, 3]);
    const b = Float32Array.from([2, 4, 6]);
    expect(cosine(a, b)).toBeCloseTo(1, 6);
  });

  it("returns 0 for zero vector (no NaN)", () => {
    const a = Float32Array.from([0, 0, 0]);
    const b = Float32Array.from([1, 1, 1]);
    expect(cosine(a, b)).toBe(0);
  });

  it("returns 0 for mismatched length", () => {
    const a = Float32Array.from([1, 2, 3]);
    const b = Float32Array.from([1, 2]);
    expect(cosine(a, b)).toBe(0);
  });

  it("matches hand-calculated value", () => {
    // a·b = 1*4 + 2*5 = 14;  |a| = √5;  |b| = √41
    const a = Float32Array.from([1, 2]);
    const b = Float32Array.from([4, 5]);
    const expected = 14 / (Math.sqrt(5) * Math.sqrt(41));
    expect(cosine(a, b)).toBeCloseTo(expected, 6);
  });
});

describe("reciprocalRankFusion", () => {
  const cfg = { lexicalWeight: 0.5, semanticWeight: 0.5, k: 60 };

  it("fuses and ranks by combined score", () => {
    const lex = [
      { chunk: chunk("A"), rank: 1, raw: 0 },
      { chunk: chunk("B"), rank: 2, raw: 0 },
    ];
    const sem = [
      { chunk: chunk("B"), rank: 1, raw: 0 },
      { chunk: chunk("A"), rank: 2, raw: 0 },
    ];
    const out = reciprocalRankFusion(lex, sem, cfg);
    expect(out).toHaveLength(2);
    // both A and B appear in both lists; both should have equal symmetric scores
    expect(out[0]!.score).toBeCloseTo(out[1]!.score, 6);
  });

  it("rewards results that appear in both rankings", () => {
    const lex = [
      { chunk: chunk("A"), rank: 1, raw: 0 },
      { chunk: chunk("X"), rank: 2, raw: 0 },
    ];
    const sem = [
      { chunk: chunk("A"), rank: 1, raw: 0 },
      { chunk: chunk("Y"), rank: 2, raw: 0 },
    ];
    const out = reciprocalRankFusion(lex, sem, cfg);
    expect(out[0]!.chunk.id).toBe("A");
    // A is in both lists; X and Y are each only in one
    const a = out.find((r) => r.chunk.id === "A")!;
    const x = out.find((r) => r.chunk.id === "X")!;
    expect(a.score).toBeGreaterThan(x.score);
  });

  it("respects asymmetric weights", () => {
    const lex = [{ chunk: chunk("LEX_ONLY"), rank: 1, raw: 0 }];
    const sem = [{ chunk: chunk("SEM_ONLY"), rank: 1, raw: 0 }];
    const out = reciprocalRankFusion(lex, sem, {
      lexicalWeight: 0.9,
      semanticWeight: 0.1,
      k: 60,
    });
    expect(out[0]!.chunk.id).toBe("LEX_ONLY");
  });

  it("returns higher score for rank 1 than rank 100 (monotonicity)", () => {
    const lex = [
      { chunk: chunk("FIRST"), rank: 1, raw: 0 },
      { chunk: chunk("LAST"), rank: 100, raw: 0 },
    ];
    const out = reciprocalRankFusion(lex, [], cfg);
    const first = out.find((r) => r.chunk.id === "FIRST")!;
    const last = out.find((r) => r.chunk.id === "LAST")!;
    expect(first.score).toBeGreaterThan(last.score);
  });

  it("handles empty inputs", () => {
    expect(reciprocalRankFusion([], [], cfg)).toEqual([]);
  });

  it("k=60 (TREC default) is the standard RRF constant", () => {
    const lex = [{ chunk: chunk("A"), rank: 1, raw: 0 }];
    const out = reciprocalRankFusion(lex, [], { lexicalWeight: 1, semanticWeight: 0, k: 60 });
    // 1 / (60 + 1) = 1/61
    expect(out[0]!.score).toBeCloseTo(1 / 61, 6);
  });
});
