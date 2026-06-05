import { describe, it, expect } from "vitest";
import { rankAgents, wilsonLowerBound, benchmarkGauntlet, buildBenchmarkDigest, mergeBenchmarkDigests, digestLeaksRaw, federationGauntlet } from "./index.js";
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

  it("FEDERATION: a content-free digest shares counts only (no raw)", () => {
    const d = buildBenchmarkDigest([{ agent: "a", commits: 5, regretted: 1, survivalRate: 0.8, explicit: 1, hotfix: 0 }], "repoX");
    expect(d.agents[0]).toEqual({ agent: "a", commits: 5, survived: 4 });
    expect(digestLeaksRaw(d, ["src/x.ts", "deadbeef1234", "/home/u"]).valueOf()).toBe(false);
  });
  it("FEDERATION: merging repos compounds + is commutative/idempotent", () => {
    const one: AgentSurvival = { agent: "alice", commits: 4, regretted: 0, survivalRate: 1, explicit: 0, hotfix: 0 };
    const a = buildBenchmarkDigest([one], "A"), b = buildBenchmarkDigest([one], "B"), c = buildBenchmarkDigest([one], "C");
    expect(rankAgents([one])[0].band).toBe("unmeasured");
    const fed = mergeBenchmarkDigests([a, b, c])[0];
    expect(fed.commits).toBe(12);
    expect(fed.band).not.toBe("unmeasured");
    expect(JSON.stringify(mergeBenchmarkDigests([a, b]))).toBe(JSON.stringify(mergeBenchmarkDigests([b, a])));
    expect(JSON.stringify(mergeBenchmarkDigests([a, a, b]))).toBe(JSON.stringify(mergeBenchmarkDigests([a, b]))); // idempotent
  });
  it("MEASURED: federationGauntlet = 100", () => {
    const g = federationGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass));
    expect(g.score).toBe(100);
  });
});
