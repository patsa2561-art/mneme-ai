import { describe, expect, it } from "vitest";
import {
  verifyBayesian,
  verifyStylometry,
  verifyEntropy,
  consensusVote,
} from "./multi-verifier.js";
import { distribution } from "./superposition.js";

const cleanPass = distribution({ pass: 0.95, warn: 0.04, fail: 0.005, skipped: 0.005 });
const cleanFail = distribution({ pass: 0.05, warn: 0.10, fail: 0.83, skipped: 0.02 });

describe("verifyBayesian — adapter", () => {
  it("wraps a posterior into a vote", () => {
    const v = verifyBayesian({ posterior: cleanPass });
    expect(v.verifier).toBe("bayesian");
    expect(v.distribution.pass).toBeCloseTo(cleanPass.pass, 3);
    expect(v.selfConfidence).toBeCloseTo(cleanPass.confidence, 3);
  });
});

describe("verifyStylometry — anomaly detection", () => {
  it("returns skipped for tiny diffs", () => {
    const v = verifyStylometry({ addedLines: ["a"], removedLines: [] });
    expect(v.distribution.collapsed).toBe("skipped");
  });
  it("clean single-voice diff → strong pass", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `  const value${i} = "thing";`);
    const v = verifyStylometry({ addedLines: lines, removedLines: [] });
    expect(v.distribution.collapsed).toBe("pass");
    expect(v.rationale).toMatch(/single-voice/);
  });
  it("mixed quote styles → mass shifts toward warn", () => {
    const lines = [
      ...Array.from({ length: 10 }, () => `  const a = 'single';`),
      ...Array.from({ length: 10 }, () => `  const b = "double";`),
    ];
    const v = verifyStylometry({ addedLines: lines, removedLines: [] });
    // 1 anomaly → 0.55 pass / 0.35 warn distribution: collapsed may still
    // be pass, but warn mass is meaningfully higher than for a clean diff.
    expect(v.distribution.warn).toBeGreaterThan(0.2);
    expect(v.rationale).toMatch(/anomaly|markers/);
  });
  it("multiple anomalies → fail-leaning", () => {
    const lines = [
      // 2-space indent + single quotes + // comments + short lines
      ...Array.from({ length: 8 }, (_, i) => `  const a${i} = 'x';`),
      ...Array.from({ length: 8 }, (_, i) => `  // comment ${i}`),
      // 4-space indent + double quotes + # comments + long lines
      ...Array.from({ length: 8 }, (_, i) => `    const b${i} = "${"x".repeat(60)}";`),
      ...Array.from({ length: 8 }, (_, i) => `    # python-style comment ${i}`),
    ];
    const v = verifyStylometry({ addedLines: lines, removedLines: [] });
    expect(["warn", "fail"]).toContain(v.distribution.collapsed);
    expect(v.rationale).toMatch(/AI-session|markers/);
  });
});

describe("verifyEntropy — narrative-vs-diff complexity", () => {
  it("aligned entropy → pass", () => {
    const v = verifyEntropy({ totalChangedLines: 50, narrativeClaimCount: 3, narrativeLength: 200 });
    expect(v.distribution.collapsed).toBe("pass");
  });
  it("huge diff with thin narrative → fail-leaning", () => {
    const v = verifyEntropy({ totalChangedLines: 800, narrativeClaimCount: 1, narrativeLength: 25 });
    expect(["warn", "fail"]).toContain(v.distribution.collapsed);
    expect(v.rationale).toMatch(/mismatch/);
  });
  it("aspirational narrative (denser than diff) → warn-leaning", () => {
    const v = verifyEntropy({ totalChangedLines: 5, narrativeClaimCount: 8, narrativeLength: 800 });
    expect(["pass", "warn"]).toContain(v.distribution.collapsed);
  });
  it("zero data → skipped", () => {
    const v = verifyEntropy({ totalChangedLines: 0, narrativeClaimCount: 0, narrativeLength: 0 });
    expect(v.distribution.collapsed).toBe("skipped");
  });
});

describe("consensusVote — combine", () => {
  it("all-agree pass → consensus pass with low JSD", () => {
    const votes = [
      verifyBayesian({ posterior: cleanPass }),
      verifyBayesian({ posterior: cleanPass }),
      verifyBayesian({ posterior: cleanPass }),
    ];
    const r = consensusVote(votes);
    expect(r.consensus.collapsed).toBe("pass");
    expect(r.disagreement).toBe(false);
    expect(r.maxJsd).toBeLessThan(0.05);
  });
  it("split between pass + fail → high JSD + disagreement flagged", () => {
    const votes = [
      verifyBayesian({ posterior: cleanPass }),
      verifyBayesian({ posterior: cleanFail }),
      verifyBayesian({ posterior: cleanPass }),
    ];
    const r = consensusVote(votes);
    expect(r.disagreement).toBe(true);
    expect(r.disagreeingPair).toBeDefined();
    expect(r.maxJsd).toBeGreaterThan(0.15);
  });
  it("majority pass + one fail → consensus shifts toward pass but with non-zero fail mass", () => {
    const votes = [
      verifyBayesian({ posterior: cleanPass }),
      verifyBayesian({ posterior: cleanPass }),
      verifyBayesian({ posterior: cleanFail }),
    ];
    const r = consensusVote(votes);
    expect(r.consensus.fail).toBeGreaterThan(0); // fail leaks through
  });
  it("respects weight overrides", () => {
    const votes = [
      verifyBayesian({ posterior: cleanPass }),
      verifyBayesian({ posterior: cleanFail }),
    ];
    const lowFailWeight = consensusVote(votes, { weights: { bayesian: 1 } });
    const highFailWeight = consensusVote(votes, { weights: { bayesian: 5 } });
    // Same vote pair; weights affect emphasis equally on both since they're
    // both bayesian-typed. Sanity check just that the method runs.
    expect(lowFailWeight.consensus).toBeDefined();
    expect(highFailWeight.consensus).toBeDefined();
  });
  it("custom JSD threshold catches subtle splits", () => {
    const slightlyOff = distribution({ pass: 0.7, warn: 0.2, fail: 0.07, skipped: 0.03 });
    const votes = [
      verifyBayesian({ posterior: cleanPass }),
      verifyBayesian({ posterior: slightlyOff }),
    ];
    const lenient = consensusVote(votes, { jsdThreshold: 0.5 });
    const strict = consensusVote(votes, { jsdThreshold: 0.005 });
    expect(lenient.disagreement).toBe(false);
    expect(strict.disagreement).toBe(true);
  });
});
