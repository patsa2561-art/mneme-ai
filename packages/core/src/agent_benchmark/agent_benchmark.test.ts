import { describe, it, expect } from "vitest";
import { rankAgents, wilsonLowerBound, benchmarkGauntlet } from "./index.js";
import type { AgentSurvival } from "../revert_radar/index.js";

describe("AGENT RELIABILITY BENCHMARK — cross-vendor, from real outcomes (Wilson-LB)", () => {
  it("Wilson lower bound is sound", () => {
    expect(wilsonLowerBound(0, 0)).toBe(0);
    expect(wilsonLowerBound(40, 40)).toBeGreaterThan(0.9);
    expect(wilsonLowerBound(40, 40)).toBeLessThan(1);
    expect(wilsonLowerBound(2, 2)).toBeLessThan(wilsonLowerBound(40, 40)); // small n → lower
  });
  it("a perfect tiny sample is 'unmeasured', never 'trusted' (un-gameable)", () => {
    const s: AgentSurvival[] = [{ agent: "newbie", commits: 2, regretted: 0, survivalRate: 1, explicit: 0, hotfix: 0 }];
    expect(rankAgents(s)[0].band).toBe("unmeasured");
  });
  it("ranks a big-n clean agent above a big-n shaky one", () => {
    const s: AgentSurvival[] = [
      { agent: "shaky", commits: 40, regretted: 16, survivalRate: 0.6, explicit: 8, hotfix: 8 },
      { agent: "clean", commits: 40, regretted: 1, survivalRate: 0.975, explicit: 1, hotfix: 0 },
    ];
    const r = rankAgents(s);
    expect(r[0].agent).toBe("clean");
    expect(r[0].band).toBe("trusted");
    expect(r[0].wilsonLB).toBeGreaterThan(r[1].wilsonLB);
  });
  it("MEASURED: benchmarkGauntlet = 100", () => {
    const g = benchmarkGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass));
    expect(g.score).toBe(100);
  });
});
