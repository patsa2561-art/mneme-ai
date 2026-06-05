import { describe, it, expect } from "vitest";
import { gateCall, appendAuditFrame, verifyAuditChain, mcpGateGauntlet } from "./index.js";

describe("MCP GATEWAY", () => {
  it("a bash call with rm -rf / → block", () => { expect(gateCall({ tool: "bash", args: { command: "rm -rf /" } }).decision).toBe("block"); });
  it("a sensitive tool not allowlisted → needs-approval", () => { expect(gateCall({ tool: "http_request", args: { url: "https://x" } }).decision).toBe("needs-approval"); });
  it("an allowlisted read-only tool → allow", () => { expect(gateCall({ tool: "get_weather", args: { city: "x" } }, { allow: ["get_*"] }).decision).toBe("allow"); });
  it("args are hashed, never raw", () => { const v = gateCall({ tool: "bash", args: { command: "rm -rf /etc" } }); expect(JSON.stringify(v)).not.toContain("/etc"); expect(v.argsHash).toMatch(/^[0-9a-f]{64}$/); });
  it("audit chain verifies + is tamper-evident", () => {
    const f0 = appendAuditFrame(null, { tool: "a", args: {} }, gateCall({ tool: "a" }), 1);
    const f1 = appendAuditFrame(f0, { tool: "b", args: {} }, gateCall({ tool: "b" }), 2);
    expect(verifyAuditChain([f0, f1]).ok).toBe(true);
    expect(verifyAuditChain([f0, { ...f1, risk: 0 }]).brokenAt).toBe(1);
  });
  it("MEASURED: mcpGateGauntlet = 100", () => { const g = mcpGateGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
});
