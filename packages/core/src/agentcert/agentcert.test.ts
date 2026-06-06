import { describe, it, expect } from "vitest";
import { agentCertGauntlet } from "./index.js";
describe("AGENT RUN CERTIFICATE", () => {
  it("MEASURED: agentCertGauntlet = 100", () => { const g = agentCertGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
});
