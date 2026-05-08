import { describe, expect, it } from "vitest";
import { cosineSim, dotProductNormalized, normaliseInPlace } from "./index.js";

function f32(...xs: number[]): Float32Array {
  return Float32Array.from(xs);
}

describe("vector kernels", () => {
  describe("cosineSim", () => {
    it("returns 1 for identical unit vectors", () => {
      const v = f32(1, 0, 0, 0);
      expect(cosineSim(v, v)).toBeCloseTo(1, 5);
    });
    it("returns 0 for orthogonal vectors", () => {
      expect(cosineSim(f32(1, 0, 0, 0), f32(0, 1, 0, 0))).toBeCloseTo(0, 5);
    });
    it("returns -1 for anti-parallel vectors", () => {
      expect(cosineSim(f32(1, 0, 0, 0), f32(-1, 0, 0, 0))).toBeCloseTo(-1, 5);
    });
    it("returns 0 for length mismatch", () => {
      expect(cosineSim(f32(1, 2), f32(1, 2, 3))).toBe(0);
    });
    it("handles unrolled-tail (length not divisible by 4)", () => {
      // 5 dims — exercises both block + tail
      const a = f32(1, 0, 0, 0, 1);
      const b = f32(0, 0, 0, 0, 1);
      // dot=1, |a|=√2, |b|=1 → 1/√2
      expect(cosineSim(a, b)).toBeCloseTo(1 / Math.sqrt(2), 5);
    });
    it("matches a naïve reference impl over random vectors", () => {
      const rand = (n: number) => Float32Array.from({ length: n }, () => Math.random() * 2 - 1);
      const ref = (a: Float32Array, b: Float32Array) => {
        let d = 0, na = 0, nb = 0;
        for (let i = 0; i < a.length; i++) { d += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
        return d / (Math.sqrt(na) * Math.sqrt(nb));
      };
      for (const dim of [1, 4, 7, 16, 100, 384]) {
        const a = rand(dim);
        const b = rand(dim);
        expect(cosineSim(a, b)).toBeCloseTo(ref(a, b), 4);
      }
    });
  });

  describe("dotProductNormalized + normaliseInPlace", () => {
    it("equals cosineSim after both vectors are normalised", () => {
      const a = f32(3, 4, 0, 0);   // |a| = 5
      const b = f32(0, 5, 0, 0);   // |b| = 5
      const cosine = cosineSim(a, b);
      normaliseInPlace(a);
      normaliseInPlace(b);
      expect(dotProductNormalized(a, b)).toBeCloseTo(cosine, 5);
    });
    it("normaliseInPlace makes |v|=1", () => {
      const v = f32(3, 4);
      normaliseInPlace(v);
      const len = Math.hypot(v[0]!, v[1]!);
      expect(len).toBeCloseTo(1, 5);
    });
    it("normaliseInPlace is a no-op on zero vector", () => {
      const v = f32(0, 0, 0, 0);
      normaliseInPlace(v);
      expect(Array.from(v)).toEqual([0, 0, 0, 0]);
    });
    it("dotProductNormalized handles tail length", () => {
      const a = f32(0.5, 0.5, 0.5, 0.5, 0.5);
      const b = f32(1, 0, 0, 0, 0);
      // 5×0.5 = 0.5 (pre-normalisation; this test just checks the loop logic)
      expect(dotProductNormalized(a, b)).toBeCloseTo(0.5, 5);
    });
  });
});
