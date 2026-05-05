import { describe, it, expect } from "vitest";
import { backtest, classifyVerdict, badge } from "./backtest.js";

describe("backtest — confusion matrix counts", () => {
  it("perfect predictor — all TP, no FP/FN", () => {
    const r = backtest([
      { id: "a", predicted: true, actual: true },
      { id: "b", predicted: true, actual: true },
      { id: "c", predicted: false, actual: false },
      { id: "d", predicted: false, actual: false },
    ]);
    expect(r.truePositives).toBe(2);
    expect(r.falsePositives).toBe(0);
    expect(r.trueNegatives).toBe(2);
    expect(r.falseNegatives).toBe(0);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(1);
    expect(r.f1).toBe(1);
  });

  it("worst predictor — all FP and FN", () => {
    const r = backtest([
      { id: "a", predicted: true, actual: false },
      { id: "b", predicted: true, actual: false },
      { id: "c", predicted: false, actual: true },
      { id: "d", predicted: false, actual: true },
    ]);
    expect(r.truePositives).toBe(0);
    expect(r.precision).toBe(0);
    expect(r.recall).toBe(0);
    expect(r.f1).toBe(0);
  });

  it("balanced realistic case", () => {
    // 14 samples, 6 predicted high-risk, 4 of those actually had incidents
    // 8 predicted clean, 2 actually had incidents
    // Total positives: 6 (4 + 2)
    const samples = [
      { id: "1", predicted: true, actual: true },
      { id: "2", predicted: true, actual: true },
      { id: "3", predicted: true, actual: true },
      { id: "4", predicted: true, actual: true },
      { id: "5", predicted: true, actual: false },
      { id: "6", predicted: true, actual: false },
      { id: "7", predicted: false, actual: true },
      { id: "8", predicted: false, actual: true },
      { id: "9", predicted: false, actual: false },
      { id: "10", predicted: false, actual: false },
      { id: "11", predicted: false, actual: false },
      { id: "12", predicted: false, actual: false },
      { id: "13", predicted: false, actual: false },
      { id: "14", predicted: false, actual: false },
    ];
    const r = backtest(samples);
    expect(r.precision).toBeCloseTo(4 / 6, 4);
    expect(r.recall).toBeCloseTo(4 / 6, 4);
    expect(r.f1).toBeCloseTo(4 / 6, 4);
    expect(r.baseRate).toBeCloseTo(6 / 14, 4);
    expect(r.lift).toBeCloseTo((4 / 6) / (6 / 14), 4);
  });
});

describe("backtest — edge cases", () => {
  it("empty input returns zeros + no-edge verdict", () => {
    const r = backtest([]);
    expect(r.n).toBe(0);
    expect(r.precision).toBe(0);
    expect(r.recall).toBe(0);
    expect(r.f1).toBe(0);
    expect(r.verdict).toBe("no-edge");
  });

  it("no positive predictions → precision = 0 (avoids div by zero)", () => {
    const r = backtest([
      { id: "1", predicted: false, actual: false },
      { id: "2", predicted: false, actual: true },
    ]);
    expect(r.precision).toBe(0);
  });

  it("no actual positives → recall = 0", () => {
    const r = backtest([
      { id: "1", predicted: true, actual: false },
      { id: "2", predicted: false, actual: false },
    ]);
    expect(r.recall).toBe(0);
  });
});

describe("classifyVerdict — tier from lift × precision × recall", () => {
  it("strong-edge for high precision + recall + 2.5× lift", () => {
    expect(classifyVerdict(3, 0.7, 0.6, 20)).toBe("strong-edge");
  });

  it("real-edge for moderate metrics", () => {
    expect(classifyVerdict(1.8, 0.5, 0.4, 20)).toBe("real-edge");
  });

  it("weak for lift ≥ 1.1 only", () => {
    expect(classifyVerdict(1.2, 0.3, 0.3, 20)).toBe("weak");
  });

  it("no-edge for too-small samples", () => {
    expect(classifyVerdict(5, 0.9, 0.9, 4)).toBe("no-edge");
  });

  it("no-edge when no lift over random", () => {
    expect(classifyVerdict(0.9, 0.3, 0.3, 20)).toBe("no-edge");
  });
});

describe("badge — one-line summary string", () => {
  it("includes F1, lift, and n", () => {
    const r = backtest([
      { id: "1", predicted: true, actual: true },
      { id: "2", predicted: true, actual: false },
      { id: "3", predicted: false, actual: false },
      { id: "4", predicted: false, actual: false },
      { id: "5", predicted: false, actual: false },
    ]);
    const b = badge(r);
    expect(b).toMatch(/F1 = \d/);
    expect(b).toMatch(/× lift/);
    expect(b).toMatch(/n=5/);
  });
});

describe("backtest — conclusion text adapts to verdict", () => {
  it("no-edge mentions sample size for small n", () => {
    const r = backtest([{ id: "1", predicted: true, actual: true }]);
    expect(r.conclusion.toLowerCase()).toContain("sample");
  });

  it("strong-edge says 'trust' or 'real predictive'", () => {
    // build samples with strong edge: lift ≥ 2.5, precision ≥ 0.6, recall ≥ 0.5
    const samples = [
      ...Array.from({ length: 8 }, (_, i) => ({ id: `tp${i}`, predicted: true, actual: true })),
      ...Array.from({ length: 2 }, (_, i) => ({ id: `fp${i}`, predicted: true, actual: false })),
      ...Array.from({ length: 4 }, (_, i) => ({ id: `fn${i}`, predicted: false, actual: true })),
      ...Array.from({ length: 36 }, (_, i) => ({ id: `tn${i}`, predicted: false, actual: false })),
    ];
    const r = backtest(samples);
    expect(r.verdict).toBe("strong-edge");
    expect(r.conclusion.toLowerCase()).toMatch(/trust|strong/);
  });
});
