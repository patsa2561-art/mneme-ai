import { describe, it, expect } from "vitest";
import { checkStat, statGuardBench, statGuardGauntlet, FALLACIES, STAT_CORPUS } from "./index.js";

describe("v3.116 · STATGUARD — statistical-misinterpretation guard (Greenland 2016)", () => {
  it("gauntlet is 100", () => {
    expect(statGuardGauntlet().score).toBe(100);
  });

  it("MEASURED: catches every documented fallacy (recall) with zero false flags (precision)", () => {
    const b = statGuardBench();
    expect(b.recall).toBe(1);
    expect(b.precision).toBe(1);
    expect(b.falseFlags).toBe(0);
  });

  it("flags the classic CI misinterpretation but NOT its correct form", () => {
    expect(checkStat("There is a 95% probability the true value lies within this confidence interval.").verdict).toBe("MISINTERPRETATION");
    expect(checkStat("95% of such intervals over repeated samples contain the true value.").verdict).toBe("CLEAN");
  });

  it("flags p>0.05 ⇒ no effect, and gives a correction + Greenland citation", () => {
    const r = checkStat("The result was not significant (p > 0.05), so there is no effect.");
    expect(r.verdict).toBe("MISINTERPRETATION");
    expect(r.hits[0]!.ref).toMatch(/Greenland/);
    expect(r.hits[0]!.correct.length).toBeGreaterThan(5);
  });

  it("stays CLEAN on non-statistical / correct text (never invents a problem)", () => {
    expect(checkStat("The function returns the sum of two integers.").verdict).toBe("CLEAN");
    expect(checkStat("The estimate was 1.2 (95% CI 0.9-1.6); compatible with both no effect and a moderate increase.").verdict).toBe("CLEAN");
  });

  it("every fallacy carries a why + correction + Greenland ref", () => {
    for (const f of FALLACIES) { expect(f.why.length).toBeGreaterThan(10); expect(f.correct.length).toBeGreaterThan(5); expect(f.ref).toMatch(/Greenland/); }
    expect(STAT_CORPUS.filter((c) => c.expect === null).length).toBeGreaterThan(3); // has correct controls
  });

  it("is total on hostile input", () => {
    expect(() => checkStat(null as never)).not.toThrow();
    expect(checkStat("").verdict).toBe("CLEAN");
  });
});
