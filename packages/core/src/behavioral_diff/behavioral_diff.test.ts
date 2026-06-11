import { describe, it, expect } from "vitest";
import { textChangeRatio, classifyBehavioralDiff, behavioralDiffGauntlet } from "./index.js";

describe("behavioral_diff", () => {
  it("gauntlet is 100", () => expect(behavioralDiffGauntlet().score).toBe(100));

  it("textChangeRatio: identical=0, disjoint≈1, one-token small", () => {
    expect(textChangeRatio("a b c", "a b c")).toBe(0);
    expect(textChangeRatio("a b c", "x y z")).toBeGreaterThan(0.9);
    const r = textChangeRatio("a b c d", "a b c e"); expect(r).toBeGreaterThan(0); expect(r).toBeLessThan(0.5);
  });

  it("NOISE: big text change + behavior preserved", () => {
    const bd = classifyBehavioralDiff([{ name: "x", textPct: 0.7, verdict: "PRESERVED" }]);
    expect(bd.entries[0].klass).toBe("NOISE");
    expect(bd.reviewSet.length).toBe(0);
  });

  it("SILENT-RISK: tiny text change + behavior changed", () => {
    const bd = classifyBehavioralDiff([{ name: "x", textPct: 0.04, verdict: "CHANGED" }]);
    expect(bd.entries[0].klass).toBe("SILENT-RISK");
    expect(bd.reviewSet[0].klass).toBe("SILENT-RISK");
  });

  it("review set = changed + unknown, silent-risk first; excludes noise/preserved", () => {
    const bd = classifyBehavioralDiff([
      { name: "noise", textPct: 0.7, verdict: "PRESERVED" },
      { name: "silent", textPct: 0.03, verdict: "CHANGED" },
      { name: "unk", textPct: 0.5, verdict: "UNKNOWN" },
      { name: "safe", textPct: 0.05, verdict: "PRESERVED" },
    ]);
    expect(bd.reviewSet[0].name).toBe("silent");
    expect(bd.reviewSet.some((e) => e.name === "unk")).toBe(true);
    expect(bd.reviewSet.some((e) => e.name === "noise" || e.name === "safe")).toBe(false);
  });

  it("never throws on garbage", () => {
    expect(() => classifyBehavioralDiff(null as never)).not.toThrow();
    expect(() => textChangeRatio(null as never, null as never)).not.toThrow();
    expect(classifyBehavioralDiff([]).total).toBe(0);
  });
});
