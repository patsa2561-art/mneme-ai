/**
 * QSAC Tech 1 — Verdict Superposition tests.
 *
 * Two layers of guarantees:
 *   1. Every distribution is a valid PMF (sums to 1, all non-negative)
 *   2. Each soft-scorer maps boundary inputs to sensible verdicts
 */
import { describe, expect, it } from "vitest";
import {
  distribution,
  combineDistributions,
  scoreBehavioralParity,
  scoreApiContractDrift,
  scoreTestPassRate,
  scorePerfRegression,
  scoreAiNarrative,
  confidencePill,
  formatDistribution,
  MAX_ENTROPY,
} from "./superposition.js";

const sumsTo1 = (d: { pass: number; warn: number; fail: number; skipped: number }) =>
  Math.abs(d.pass + d.warn + d.fail + d.skipped - 1) < 1e-6;

describe("distribution() — PMF invariants", () => {
  it("sums to 1.0", () => {
    expect(sumsTo1(distribution({ pass: 1, warn: 0, fail: 0, skipped: 0 }))).toBe(true);
    expect(sumsTo1(distribution({ pass: 0.5, warn: 0.3, fail: 0.1, skipped: 0.1 }))).toBe(true);
    expect(sumsTo1(distribution({ pass: 5, warn: 3, fail: 1, skipped: 1 }))).toBe(true); // unnormalised input
  });
  it("never returns negative values", () => {
    const d = distribution({ pass: -1, warn: -0.5, fail: 0, skipped: 0 });
    expect(d.pass).toBeGreaterThanOrEqual(0);
    expect(d.warn).toBeGreaterThanOrEqual(0);
  });
  it("computes argmax + confidence correctly", () => {
    const d = distribution({ pass: 0.95, warn: 0.04, fail: 0.005, skipped: 0.005 });
    expect(d.collapsed).toBe("pass");
    expect(d.confidence).toBeGreaterThan(0.94);
  });
  it("computes entropy = 0 for delta distribution + max for uniform", () => {
    const delta = distribution({ pass: 1, warn: 0, fail: 0, skipped: 0 });
    expect(delta.entropy).toBeCloseTo(0, 1);
    const uniform = distribution({ pass: 1, warn: 1, fail: 1, skipped: 1 });
    expect(uniform.entropy).toBeCloseTo(MAX_ENTROPY, 1);
  });
});

describe("scoreBehavioralParity", () => {
  it("0 samples → skipped", () => {
    const d = scoreBehavioralParity({ samples: 0, mismatches: 0, critical: 0 });
    expect(d.collapsed).toBe("skipped");
  });
  it("0 mismatches → strong pass", () => {
    const d = scoreBehavioralParity({ samples: 5, mismatches: 0, critical: 0 });
    expect(d.collapsed).toBe("pass");
    expect(d.confidence).toBeGreaterThan(0.9);
  });
  it("any critical → strong fail", () => {
    const d = scoreBehavioralParity({ samples: 10, mismatches: 1, critical: 1 });
    expect(d.collapsed).toBe("fail");
  });
  it("partial mismatches → distribution spread", () => {
    const d = scoreBehavioralParity({ samples: 10, mismatches: 5, critical: 0 });
    expect(d.collapsed).not.toBe("skipped");
    expect(d.entropy).toBeGreaterThan(0.1); // not collapsed to delta
  });
});

describe("scoreApiContractDrift", () => {
  it("no exports → skipped", () => {
    const d = scoreApiContractDrift({ removed: 0, added: 0, changedSignatures: 0, totalExports: 0 });
    expect(d.collapsed).toBe("skipped");
  });
  it("pure additions → pass", () => {
    const d = scoreApiContractDrift({ removed: 0, added: 3, changedSignatures: 0, totalExports: 100 });
    expect(d.collapsed).toBe("pass");
  });
  it("≥5% breakage → fail", () => {
    const d = scoreApiContractDrift({ removed: 5, added: 0, changedSignatures: 1, totalExports: 100 });
    expect(d.collapsed).toBe("fail");
    expect(d.confidence).toBeGreaterThan(0.5);
  });
  it("small breakage → warn", () => {
    const d = scoreApiContractDrift({ removed: 1, added: 0, changedSignatures: 0, totalExports: 100 });
    expect(d.collapsed).toBe("warn");
  });
});

describe("scoreTestPassRate", () => {
  it("no test command → skipped", () => {
    const d = scoreTestPassRate({ beforePassed: 0, beforeFailed: 0, afterPassed: 0, afterFailed: 0, testCommandAvailable: false });
    expect(d.collapsed).toBe("skipped");
  });
  it("any new failure → fail", () => {
    const d = scoreTestPassRate({ beforePassed: 100, beforeFailed: 0, afterPassed: 99, afterFailed: 1, testCommandAvailable: true });
    expect(d.collapsed).toBe("fail");
  });
  it("test count grows + clean → pass", () => {
    const d = scoreTestPassRate({ beforePassed: 100, beforeFailed: 0, afterPassed: 110, afterFailed: 0, testCommandAvailable: true });
    expect(d.collapsed).toBe("pass");
    expect(d.confidence).toBeGreaterThan(0.85);
  });
  it("test count shrinks → warn", () => {
    const d = scoreTestPassRate({ beforePassed: 100, beforeFailed: 0, afterPassed: 80, afterFailed: 0, testCommandAvailable: true });
    expect(d.collapsed).toBe("warn");
  });
});

describe("scorePerfRegression", () => {
  it("no baseline → skipped", () => {
    const d = scorePerfRegression({ deltaPercent: 0, beforeMs: 0, afterMs: 0, haveBaseline: false });
    expect(d.collapsed).toBe("skipped");
  });
  it("0% delta → pass", () => {
    const d = scorePerfRegression({ deltaPercent: 0, beforeMs: 100, afterMs: 100, haveBaseline: true });
    expect(d.collapsed).toBe("pass");
  });
  it("30% slowdown → fail", () => {
    const d = scorePerfRegression({ deltaPercent: 30, beforeMs: 100, afterMs: 130, haveBaseline: true });
    expect(d.collapsed).toBe("fail");
  });
  it("12% slowdown → warn (smooth boundary)", () => {
    const d = scorePerfRegression({ deltaPercent: 12, beforeMs: 100, afterMs: 112, haveBaseline: true });
    expect(d.collapsed).toBe("warn");
  });
});

describe("scoreAiNarrative", () => {
  it("0 checks → skipped", () => {
    const d = scoreAiNarrative({ totalChecks: 0, contradictions: 0, unverifiable: 0, confirmed: 0 });
    expect(d.collapsed).toBe("skipped");
  });
  it("any contradiction → fail-leaning", () => {
    const d = scoreAiNarrative({ totalChecks: 5, contradictions: 1, unverifiable: 0, confirmed: 4 });
    expect(d.collapsed).toBe("fail");
  });
  it("all confirmed → strong pass", () => {
    const d = scoreAiNarrative({ totalChecks: 5, contradictions: 0, unverifiable: 0, confirmed: 5 });
    expect(d.collapsed).toBe("pass");
    expect(d.confidence).toBeGreaterThan(0.85);
  });
});

describe("combineDistributions (product-of-experts)", () => {
  it("returns skipped when no inputs", () => {
    const d = combineDistributions([]);
    expect(d.collapsed).toBe("skipped");
  });
  it("one fail axis pulls down all-pass siblings", () => {
    const allPass = scoreBehavioralParity({ samples: 5, mismatches: 0, critical: 0 });
    const oneFail = scoreApiContractDrift({ removed: 10, added: 0, changedSignatures: 0, totalExports: 100 });
    const combined = combineDistributions([allPass, allPass, oneFail, allPass]);
    // Geometric mean of probabilities — one low value pulls all combined
    // probabilities down. Confidence in pass drops below the all-pass case.
    expect(combined.confidence).toBeLessThan(allPass.confidence);
    // Fail mass is small but non-zero (geometric mean preserves it)
    expect(combined.fail).toBeGreaterThan(0.005);
  });
  it("all-pass distributions combine to pass", () => {
    const allPass = scoreBehavioralParity({ samples: 5, mismatches: 0, critical: 0 });
    const combined = combineDistributions([allPass, allPass, allPass, allPass, allPass]);
    expect(combined.collapsed).toBe("pass");
  });
  it("respects weights", () => {
    const pass = scoreBehavioralParity({ samples: 5, mismatches: 0, critical: 0 });
    const fail = scoreApiContractDrift({ removed: 50, added: 0, changedSignatures: 0, totalExports: 100 });
    // Heavy weight on the fail axis should pull combined toward fail
    const lowFailWeight = combineDistributions([pass, fail], [10, 1]);
    const highFailWeight = combineDistributions([pass, fail], [1, 10]);
    expect(highFailWeight.fail).toBeGreaterThan(lowFailWeight.fail);
  });
});

describe("confidencePill + formatDistribution", () => {
  it("returns high for tight pass distribution", () => {
    const d = scoreApiContractDrift({ removed: 0, added: 0, changedSignatures: 0, totalExports: 100 });
    expect(confidencePill(d)).toBe("high");
  });
  it("returns medium / low for fuzzier distributions", () => {
    const d = scoreBehavioralParity({ samples: 10, mismatches: 5, critical: 0 });
    expect(["medium", "low"]).toContain(confidencePill(d));
  });
  it("formatDistribution renders amplitudes", () => {
    const d = scoreApiContractDrift({ removed: 0, added: 0, changedSignatures: 0, totalExports: 100 });
    const s = formatDistribution(d);
    expect(s).toMatch(/\|pass⟩/);
  });
});
