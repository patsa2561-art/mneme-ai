import { describe, it, expect } from "vitest";
import { agentLiabilityGauntlet } from "./index.js";
describe("AGENT-RUN LIABILITY", () => {
  it("MEASURED: agentLiabilityGauntlet = 100", () => { const g = agentLiabilityGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
});
