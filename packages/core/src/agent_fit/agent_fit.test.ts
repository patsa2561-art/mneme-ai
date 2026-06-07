import { describe, it, expect } from "vitest";
import { agentFitGauntlet, detectActiveAgent, fitFor, listFits } from "./index.js";
describe("AGENT-FIT — native integration map", () => {
  it("MEASURED: agentFitGauntlet = 100", () => { const g = agentFitGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
  it("detects the active agent from env; unknown → null", () => {
    expect(detectActiveAgent({ CLAUDECODE: "1" })?.id).toBe("claude-code");
    expect(detectActiveAgent({ CLINE: "1" })?.id).toBe("cline");
    expect(detectActiveAgent({})).toBeNull();
  });
  it("Claude Code is FULL; a browser chat is honestly LIMITED", () => {
    expect(fitFor("claude-code")?.tier).toBe("FULL");
    expect(fitFor("web-chat")?.tier).toBe("LIMITED");
  });
  it("every profile carries wiring + a live mechanism", () => {
    for (const p of listFits()) { expect(p.wiring.length).toBeGreaterThan(0); expect(p.liveMechanism.length).toBeGreaterThan(0); }
  });
});
