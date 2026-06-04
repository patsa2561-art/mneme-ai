import { describe, it, expect } from "vitest";
import { collapse, argmaxConfidence, pluralityVote, canonAnswer, prismGauntlet } from "./index.js";

describe("PRISM — superposition reasoning with interference collapse", () => {
  it("gauntlet scores 100 (A/B beats argmax + ≥plurality · constructive · destructive · Born · abstain · consensus · deterministic · total)", () => {
    const g = prismGauntlet();
    expect(g.score).toBe(100);
    expect(g.checks.every((c) => c.pass)).toBe(true);
    // the measured A/B: prism strictly beats confidence-argmax on the target regime
    expect(g.ab.prismAcc).toBeGreaterThan(g.ab.argmaxAcc);
    expect(g.ab.prismAcc).toBeGreaterThanOrEqual(g.ab.pluralityAcc);
  });

  it("constructive interference: many weak-but-agreeing outweigh one strong-isolated (argmax gets it wrong)", () => {
    const branches = [
      { id: "1", answer: "42", confidence: 0.34 }, { id: "2", answer: "42", confidence: 0.34 }, { id: "3", answer: "42", confidence: 0.34 },
      { id: "4", answer: "99", confidence: 0.9 },
    ];
    const r = collapse(branches);
    expect(r.answer).toBe("42");
    expect(r.collapsed).toBe(true);
    expect(argmaxConfidence(branches)).toBe("99"); // the naive baseline is fooled
  });

  it("destructive interference: refuters subtract amplitude, suppressing a heavily-refuted answer", () => {
    const r = collapse([
      { id: "1", answer: "A", confidence: 0.9 },
      { id: "2", answer: "A", confidence: 0.85, stance: "refute" },
      { id: "3", answer: "A", confidence: 0.6, stance: "refute" },
      { id: "4", answer: "B", confidence: 0.5 },
    ]);
    expect(r.answer).toBe("B");
  });

  it("SUPERPOSED abstention: a genuine 50/50 split never collapses to a confident pick", () => {
    const r = collapse([{ id: "1", answer: "left", confidence: 0.7 }, { id: "2", answer: "right", confidence: 0.7 }]);
    expect(r.superposed).toBe(true);
    expect(r.collapsed).toBe(false);
  });

  it("Born rule: outcome probabilities sum to 1", () => {
    const r = collapse([{ id: "1", answer: "P", confidence: 0.5 }, { id: "2", answer: "Q", confidence: 0.5 }, { id: "3", answer: "R", confidence: 0.3 }]);
    expect(Math.abs(r.ranked.reduce((s, o) => s + o.prob, 0) - 1)).toBeLessThan(1e-9);
  });

  it("plurality is fooled by many-weak-wrong; prism (confidence-weighted) is not", () => {
    const branches = [
      { id: "a", answer: "safe", confidence: 0.9 }, { id: "b", answer: "safe", confidence: 0.88 },
      { id: "c", answer: "danger", confidence: 0.1 }, { id: "d", answer: "danger", confidence: 0.12 }, { id: "e", answer: "danger", confidence: 0.08 },
    ];
    expect(pluralityVote(branches)).toBe("danger"); // counts 3 > 2
    expect(collapse(branches).answer).toBe("safe");  // amplitude-weighted
  });

  it("is total: empty / blank / out-of-range never throws", () => {
    expect(collapse([]).answer).toBeNull();
    expect(() => collapse([{ id: "x", answer: "", confidence: 2 }])).not.toThrow();
    expect(canonAnswer('  "Yes." ')).toBe("yes");
  });
});
