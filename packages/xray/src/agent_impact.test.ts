import { describe, it, expect } from "vitest";
import { buildAgentImpact, agentImpactGauntlet } from "./agent_impact.js";

const clean = { secrets: { totalFindings: 0 }, security: { destructive: [] }, busFactor: { singleOwnerFilePct: 0 }, coupling: { pairs: [] }, deps: { byBand: {} }, complexity: { hotspots: [] } };
const dirty = { secrets: { totalFindings: 20 }, security: { destructive: [{}, {}] }, busFactor: { singleOwnerFilePct: 80 }, coupling: { pairs: Array.from({ length: 12 }, () => ({ hidden: true })) }, deps: { byBand: { dead: 5 } }, complexity: { hotspots: Array.from({ length: 6 }, () => ({ bodyLines: 200 })) } };

describe("AGENT IMPACT — did the agent leave the codebase cleaner or dirtier (AQI delta)", () => {
  it("clean → dirty is 'degraded' + names the added pollutants", () => {
    const i = buildAgentImpact(clean, dirty);
    expect(i.verdict).toBe("degraded");
    expect(i.delta).toBeLessThan(0);
    expect(i.pollutantsAdded.length).toBeGreaterThan(0);
  });
  it("dirty → clean is 'improved'", () => {
    expect(buildAgentImpact(dirty, clean).verdict).toBe("improved");
  });
  it("no change is 'neutral' + symmetric delta", () => {
    expect(buildAgentImpact(clean, clean).verdict).toBe("neutral");
    expect(buildAgentImpact(clean, dirty).delta).toBe(-buildAgentImpact(dirty, clean).delta);
  });
  it("MEASURED: agentImpactGauntlet = 100", () => {
    const g = agentImpactGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass));
    expect(g.score).toBe(100);
  });
});
