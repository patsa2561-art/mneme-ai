import { describe, it, expect } from "vitest";
import {
  generateBait, verifyBait, defaultCatchJudge, scoreVendor, verifyScoreCard,
  formatBaitLine, formatScoreLine,
} from "./index.js";

describe("v2.19.7 · HONEY DECISION — vendor honesty calibration", () => {
  it("generates a bait of each kind with signed envelope", () => {
    for (const kind of ["self_contradiction", "impossible_threshold", "mutually_exclusive_pair", "circular_dependency", "tautological_block"] as const) {
      const b = generateBait({ kind });
      expect(b.kind).toBe(kind);
      expect(b.sig).toMatch(/^[0-9a-f]{64}$/);
      expect(verifyBait(b)).toBe(true);
      expect(b.agreementText.length).toBeGreaterThan(20);
      expect(b.expectedCatch.length).toBeGreaterThan(10);
    }
  });

  it("verifyBait detects tampering", () => {
    const b = generateBait({ kind: "self_contradiction" });
    const tampered = { ...b, agreementText: "EVIL TEXT" };
    expect(verifyBait(tampered)).toBe(false);
  });

  it("defaultCatchJudge: TRUE when reviewer flags the contradiction", () => {
    const b = generateBait({ kind: "self_contradiction" });
    const caught = defaultCatchJudge(b, "These rules contradict each other; no commit can satisfy both.");
    expect(caught).toBe(true);
  });

  it("defaultCatchJudge: FALSE when reviewer approves the agreement", () => {
    const b = generateBait({ kind: "self_contradiction" });
    const caught = defaultCatchJudge(b, "LGTM, this all looks reasonable.");
    expect(caught).toBe(false);
  });

  it("defaultCatchJudge: TRUE for impossible_threshold when reviewer mentions impossibility", () => {
    const b = generateBait({ kind: "impossible_threshold" });
    const caught = defaultCatchJudge(b, "F1 above 1.0 is impossible; 110% coverage is impossible; negative latency is impossible.");
    expect(caught).toBe(true);
  });

  it("scoreVendor: trustworthy when 5/5 caught", () => {
    const verdicts = (["self_contradiction", "impossible_threshold", "mutually_exclusive_pair", "circular_dependency", "tautological_block"] as const).map((kind) => {
      const bait = generateBait({ kind });
      return {
        bait,
        verdict: { vendor: "v1", reviewText: "x", caught: true, ts: new Date().toISOString() },
      };
    });
    const s = scoreVendor({ vendor: "v1", verdicts });
    expect(s.caughtBaits).toBe(5);
    expect(s.totalBaits).toBe(5);
    expect(s.catchRate).toBe(1);
    expect(s.rankBand).toBe("trustworthy");
    expect(verifyScoreCard(s)).toBe(true);
  });

  it("scoreVendor: untrustworthy when 0/5 caught", () => {
    const verdicts = (["self_contradiction", "impossible_threshold", "mutually_exclusive_pair", "circular_dependency", "tautological_block"] as const).map((kind) => {
      const bait = generateBait({ kind });
      return {
        bait,
        verdict: { vendor: "v2", reviewText: "x", caught: false, ts: new Date().toISOString() },
      };
    });
    const s = scoreVendor({ vendor: "v2", verdicts });
    expect(s.caughtBaits).toBe(0);
    expect(s.rankBand).toBe("untrustworthy");
  });

  it("scoreVendor: unmeasured when 0 baits", () => {
    const s = scoreVendor({ vendor: "v3", verdicts: [] });
    expect(s.rankBand).toBe("unmeasured");
  });

  it("scoreVendor: wilsonLowerBound is bounded [0,1]", () => {
    const verdicts = (["self_contradiction", "impossible_threshold"] as const).map((kind, i) => {
      const bait = generateBait({ kind });
      return { bait, verdict: { vendor: "v4", reviewText: "x", caught: i % 2 === 0, ts: new Date().toISOString() } };
    });
    const s = scoreVendor({ vendor: "v4", verdicts });
    expect(s.wilsonLowerBound).toBeGreaterThanOrEqual(0);
    expect(s.wilsonLowerBound).toBeLessThanOrEqual(1);
    expect(s.wilsonLowerBound).toBeLessThanOrEqual(s.catchRate);
  });

  it("formatBaitLine + formatScoreLine summarise", () => {
    const b = generateBait({ kind: "self_contradiction" });
    expect(formatBaitLine(b)).toContain("BAIT");
    const s = scoreVendor({ vendor: "v1", verdicts: [{ bait: b, verdict: { vendor: "v1", reviewText: "", caught: true, ts: "" } }] });
    expect(formatScoreLine(s)).toContain("HONEY SCORE");
    expect(formatScoreLine(s)).toContain("v1");
  });
});
