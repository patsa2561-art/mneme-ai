import { describe, it, expect } from "vitest";
import { decodeFact, decodeMesh, buildScenario, sdcBench, sdcGauntlet } from "./index.js";

describe("v3.114 · SDC — Syndrome-Decoded Consensus", () => {
  it("gauntlet is 100", () => {
    expect(sdcGauntlet().score).toBe(100);
  });

  it("CLEAN when unanimous", () => {
    const d = decodeFact([{ agent: "a", value: "X" }, { agent: "b", value: "X" }]);
    expect(d.verdict).toBe("CLEAN");
    expect(d.value).toBe("X");
  });

  it("CORRECTED + locates the dissenter on a single error", () => {
    const d = decodeFact([{ agent: "a", value: "X" }, { agent: "b", value: "X" }, { agent: "evil", value: "Y" }]);
    expect(d.verdict).toBe("CORRECTED");
    expect(d.value).toBe("X");
    expect(d.dissenters).toContain("evil");
  });

  it("UNRECOVERABLE on a true tie — abstains, never guesses", () => {
    const d = decodeFact([{ agent: "a", value: "X" }, { agent: "b", value: "Y" }]);
    expect(d.verdict).toBe("UNRECOVERABLE");
    expect(d.value).toBeNull();
  });

  it("MEASURED: SDC strictly beats plain majority-vote in the sustained-liar regime", () => {
    const b = sdcBench(7);
    expect(b.sdcAcc).toBeGreaterThan(b.majorityAcc);
    expect(b.sdcAcc).toBeGreaterThanOrEqual(0.95);
  });

  it("locates the byzantine agents (precision + recall)", () => {
    const b = sdcBench(7);
    expect(b.byzantinePrecision).toBeGreaterThanOrEqual(0.8);
    expect(b.byzantineRecall).toBeGreaterThanOrEqual(0.8);
  });

  it("decodeMesh earns reliability — liars score low, honest score high", () => {
    const sc = buildScenario(7);
    const m = decodeMesh(sc.facts);
    const avgHonest = Object.entries(m.reliability).filter(([a]) => a.startsWith("h")).map(([, v]) => v);
    const avgByz = Object.entries(m.reliability).filter(([a]) => a.startsWith("b")).map(([, v]) => v);
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / (xs.length || 1);
    expect(mean(avgHonest)).toBeGreaterThan(mean(avgByz));
  });

  it("is total on hostile input", () => {
    expect(() => decodeFact(null as never)).not.toThrow();
    expect(() => decodeMesh(null as never)).not.toThrow();
    expect(decodeFact([]).verdict).toBe("UNRECOVERABLE");
  });
});
