/**
 * Mneme DNA — formula tests. Every formula's edge cases + invariants.
 *
 * Pattern:
 *   • Happy path: known inputs, hand-verified output
 *   • Boundary: 0, 1, infinity, empty
 *   • Invariants: symmetry, monotonicity, scale invariance where applicable
 *   • Determinism: same inputs always produce same output
 *   • Error paths: bad dimensions, negative where invalid, etc.
 */

import { describe, it, expect } from "vitest";
import {
  qrs,
  hwc,
  adb,
  tbp,
  tbpVariance,
  red,
  tps,
  cc,
  wilsonLowerBound,
  mf,
  DNA_FORMULAS,
} from "./formulas.js";

// ─── F1. QRS ─────────────────────────────────────────────────────────

describe("F1. QRS — Quantum Resonance Score", () => {
  it("identity operator returns squared norm", () => {
    const r = qrs({
      fileVector: [1, 2, 3],
      queryOperator: [
        [1, 0, 0],
        [0, 1, 0],
        [0, 0, 1],
      ],
    });
    expect(r).toBe(1 + 4 + 9); // 14
  });

  it("zero operator returns 0", () => {
    const r = qrs({
      fileVector: [5, 5, 5],
      queryOperator: [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0],
      ],
    });
    expect(r).toBe(0);
  });

  it("zero vector returns 0", () => {
    const r = qrs({ fileVector: [0, 0], queryOperator: [[1, 1], [1, 1]] });
    expect(r).toBe(0);
  });

  it("captures cross-feature interaction (off-diagonal)", () => {
    // Operator [[0,1],[1,0]] makes ψ^T H ψ = 2*ψ_0*ψ_1
    const r = qrs({ fileVector: [3, 4], queryOperator: [[0, 1], [1, 0]] });
    expect(r).toBe(24);
  });

  it("throws on dimension mismatch", () => {
    expect(() => qrs({ fileVector: [1, 2], queryOperator: [[1, 0, 0]] })).toThrow(/operator size/);
  });

  it("throws on non-square operator", () => {
    expect(() => qrs({ fileVector: [1, 2], queryOperator: [[1, 2], [1, 2, 3]] })).toThrow(/non-square/);
  });

  it("is deterministic for the same inputs", () => {
    const v = [0.3, -0.5, 1.2];
    const H = [[1, 0.2, 0], [0.2, 1, -0.1], [0, -0.1, 1]];
    expect(qrs({ fileVector: v, queryOperator: H })).toBe(qrs({ fileVector: v, queryOperator: H }));
  });
});

// ─── F2. HWC ─────────────────────────────────────────────────────────

describe("F2. HWC — Hebbian-Weighted Cosine", () => {
  it("equals cosine when co-activation is 0", () => {
    const r = hwc({ queryEmbedding: [1, 0], codeEmbedding: [1, 0], coActivationCount: 0 });
    expect(r).toBeCloseTo(1);
  });

  it("orthogonal embeddings → 0 regardless of Hebb count", () => {
    const r = hwc({ queryEmbedding: [1, 0], codeEmbedding: [0, 1], coActivationCount: 1000 });
    expect(r).toBe(0);
  });

  it("Hebb boost scales correctly with log(1+n)", () => {
    const a = hwc({ queryEmbedding: [1, 0], codeEmbedding: [1, 0], coActivationCount: 0 });
    const b = hwc({ queryEmbedding: [1, 0], codeEmbedding: [1, 0], coActivationCount: 9 });
    // a = 1 * (1 + log(1)) = 1
    // b = 1 * (1 + log(10)) ≈ 1 + 2.302
    expect(a).toBeCloseTo(1);
    expect(b).toBeCloseTo(1 + Math.log(10));
  });

  it("zero embeddings → 0", () => {
    const r = hwc({ queryEmbedding: [0, 0], codeEmbedding: [1, 1], coActivationCount: 5 });
    expect(r).toBe(0);
  });

  it("throws on dim mismatch", () => {
    expect(() => hwc({ queryEmbedding: [1, 0], codeEmbedding: [1], coActivationCount: 0 })).toThrow();
  });

  it("clamps negative co-activation count at 0", () => {
    const r = hwc({ queryEmbedding: [1, 0], codeEmbedding: [1, 0], coActivationCount: -5 });
    expect(r).toBeCloseTo(1);
  });
});

// ─── F3. ADB ─────────────────────────────────────────────────────────

describe("F3. ADB — Atrophy-Decay Boost", () => {
  it("atrophy=0 → unchanged", () => {
    expect(adb({ baseRelevance: 0.8, atrophyScore: 0 })).toBeCloseTo(0.8);
  });

  it("atrophy=100 → fully decayed (0)", () => {
    expect(adb({ baseRelevance: 0.8, atrophyScore: 100 })).toBe(0);
  });

  it("higher alpha = harsher decay for medium atrophy", () => {
    const gentle = adb({ baseRelevance: 1, atrophyScore: 50, alpha: 1 });
    const harsh = adb({ baseRelevance: 1, atrophyScore: 50, alpha: 3 });
    expect(harsh).toBeLessThan(gentle);
  });

  it("default alpha=1.5", () => {
    const r = adb({ baseRelevance: 1, atrophyScore: 50 });
    // (1 - 0.5)^1.5 = 0.5^1.5 ≈ 0.354
    expect(r).toBeCloseTo(Math.pow(0.5, 1.5), 5);
  });

  it("clamps atrophy outside [0,100]", () => {
    expect(adb({ baseRelevance: 1, atrophyScore: -5 })).toBeCloseTo(1);
    expect(adb({ baseRelevance: 1, atrophyScore: 150 })).toBe(0);
  });

  it("throws on negative alpha", () => {
    expect(() => adb({ baseRelevance: 1, atrophyScore: 50, alpha: -0.5 })).toThrow();
  });
});

// ─── F4. TBP ─────────────────────────────────────────────────────────

describe("F4. TBP — Tribal Bayesian Posterior", () => {
  it("uninformative prior (0 votes) gives mean 0.5", () => {
    const r = tbp({ localLikelihood: 1, federationUpvotes: 0, federationDownvotes: 0 });
    expect(r).toBeCloseTo(0.5);
  });

  it("strong upvotes boost the score", () => {
    const noVotes = tbp({ localLikelihood: 1, federationUpvotes: 0, federationDownvotes: 0 });
    const upvoted = tbp({ localLikelihood: 1, federationUpvotes: 99, federationDownvotes: 0 });
    expect(upvoted).toBeGreaterThan(noVotes);
    expect(upvoted).toBeLessThan(1); // never exceeds local likelihood
  });

  it("strong downvotes drag the score down", () => {
    const downvoted = tbp({ localLikelihood: 1, federationUpvotes: 0, federationDownvotes: 99 });
    expect(downvoted).toBeLessThan(0.5);
  });

  it("variance decreases as votes accumulate", () => {
    expect(tbpVariance(0, 0)).toBeGreaterThan(tbpVariance(50, 50));
    expect(tbpVariance(50, 50)).toBeGreaterThan(tbpVariance(500, 500));
  });

  it("clamps negative vote counts at 0", () => {
    const r = tbp({ localLikelihood: 1, federationUpvotes: -5, federationDownvotes: -5 });
    expect(r).toBeCloseTo(0.5);
  });
});

// ─── F5. RED ─────────────────────────────────────────────────────────

describe("F5. RED — Regret Echo Distance", () => {
  it("no regrets → distance Infinity, penalty 1", () => {
    const r = red({ fileEmbedding: [1, 2], regretEmbeddings: [] });
    expect(r.distance).toBe(Infinity);
    expect(r.penaltyMultiplier).toBe(1);
  });

  it("identical to a regret → distance 0, max penalty", () => {
    const r = red({ fileEmbedding: [1, 2, 3], regretEmbeddings: [[1, 2, 3]] }, 0.1);
    expect(r.distance).toBe(0);
    expect(r.penaltyMultiplier).toBe(0.1); // floor
    expect(r.closestRegretIndex).toBe(0);
  });

  it("finds the closest regret across multiple", () => {
    const r = red({
      fileEmbedding: [1, 0, 0],
      regretEmbeddings: [
        [10, 0, 0], // dist 9
        [0.9, 0, 0], // dist 0.1
        [-1, 0, 0], // dist 2
      ],
    });
    expect(r.closestRegretIndex).toBe(1);
    expect(r.distance).toBeCloseTo(0.1);
  });

  it("distance ≥ 1 → no penalty (multiplier = 1)", () => {
    const r = red({ fileEmbedding: [10, 0], regretEmbeddings: [[0, 0]] });
    expect(r.penaltyMultiplier).toBe(1);
  });

  it("throws on dim mismatch", () => {
    expect(() => red({ fileEmbedding: [1, 2], regretEmbeddings: [[1, 2, 3]] })).toThrow();
  });
});

// ─── F6. TPS ─────────────────────────────────────────────────────────

describe("F6. TPS — Time-Phase Score", () => {
  it("ages perfectly aligned → no decay", () => {
    const r = tps({ baseRelevance: 1, fileAgeDays: 30, queryAgeDays: 30 });
    expect(r).toBeCloseTo(1);
  });

  it("ages far apart in log-space → strong decay", () => {
    const aligned = tps({ baseRelevance: 1, fileAgeDays: 7, queryAgeDays: 7 });
    const misaligned = tps({ baseRelevance: 1, fileAgeDays: 7, queryAgeDays: 3650 });
    expect(misaligned).toBeLessThan(aligned * 0.2);
  });

  it("0-day case handled gracefully (no log(0))", () => {
    const r = tps({ baseRelevance: 1, fileAgeDays: 0, queryAgeDays: 0 });
    expect(r).toBeCloseTo(1);
  });

  it("smaller sigma = sharper resonance peak", () => {
    const wide = tps({ baseRelevance: 1, fileAgeDays: 7, queryAgeDays: 30, sigma: 3 });
    const narrow = tps({ baseRelevance: 1, fileAgeDays: 7, queryAgeDays: 30, sigma: 0.5 });
    expect(narrow).toBeLessThan(wide);
  });

  it("throws on non-positive sigma", () => {
    expect(() => tps({ baseRelevance: 1, fileAgeDays: 1, queryAgeDays: 1, sigma: 0 })).toThrow();
  });
});

// ─── F7. CC ──────────────────────────────────────────────────────────

describe("F7. CC — Compositional Confidence", () => {
  it("wilsonLowerBound is conservative for small samples", () => {
    expect(wilsonLowerBound(5, 5)).toBeLessThan(1);
    expect(wilsonLowerBound(5, 5)).toBeGreaterThan(0);
  });

  it("wilsonLowerBound approaches 1 for large unanimous samples", () => {
    expect(wilsonLowerBound(1000, 1000)).toBeGreaterThan(0.99);
  });

  it("cc multiplies Wilson by Hebbian", () => {
    const r = cc({ successCount: 80, totalCount: 100, hebbianStrength: 2 });
    const expected = wilsonLowerBound(80, 100) * 2;
    expect(r).toBeCloseTo(expected);
  });

  it("zero hebbianStrength → 0", () => {
    expect(cc({ successCount: 100, totalCount: 100, hebbianStrength: 0 })).toBe(0);
  });

  it("clamps negative hebbianStrength at 0", () => {
    expect(cc({ successCount: 100, totalCount: 100, hebbianStrength: -5 })).toBe(0);
  });

  it("0/0 success → wilson 0 → cc 0", () => {
    expect(cc({ successCount: 0, totalCount: 0, hebbianStrength: 1 })).toBe(0);
  });
});

// ─── F8. MF ──────────────────────────────────────────────────────────

describe("F8. MF — Mutant Fitness", () => {
  it("empty samples → 0", () => {
    expect(mf({ samples: [] })).toBe(0);
  });

  it("higher CTR + lower TTUR = higher fitness", () => {
    const slow = mf({ samples: [{ ctr: 0.5, ttur: 5 }] });
    const fast = mf({ samples: [{ ctr: 0.5, ttur: 0.5 }] });
    expect(fast).toBeGreaterThan(slow);
  });

  it("clamps CTR to [0,1]", () => {
    const r1 = mf({ samples: [{ ctr: 1.5, ttur: 1 }] });
    const r2 = mf({ samples: [{ ctr: 1, ttur: 1 }] });
    expect(r1).toBe(r2);
  });

  it("respects tturFloor (no divide-by-zero)", () => {
    const r = mf({ samples: [{ ctr: 1, ttur: 0 }], tturFloor: 0.5 });
    expect(r).toBe(2); // 1 / 0.5 = 2
  });

  it("averages across samples", () => {
    const r = mf({
      samples: [
        { ctr: 1, ttur: 1 },
        { ctr: 0, ttur: 1 },
      ],
    });
    expect(r).toBeCloseTo(0.5); // (1 + 0) / 2
  });
});

// ─── Catalog ─────────────────────────────────────────────────────────

describe("DNA_FORMULAS catalog", () => {
  it("declares exactly 8 formulas", () => {
    expect(DNA_FORMULAS).toHaveLength(8);
  });

  it("codes are F1..F8", () => {
    expect(DNA_FORMULAS.map((f) => f.code).sort()).toEqual(["F1", "F2", "F3", "F4", "F5", "F6", "F7", "F8"]);
  });

  it("each entry has fullName + purpose", () => {
    for (const f of DNA_FORMULAS) {
      expect(f.fullName.length).toBeGreaterThan(5);
      expect(f.purpose.length).toBeGreaterThan(20);
    }
  });
});
