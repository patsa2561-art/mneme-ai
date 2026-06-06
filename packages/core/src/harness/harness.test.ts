import { describe, it, expect } from "vitest";
import { createHarness, GovernanceBlocked, harnessGauntlet } from "./index.js";

describe("AGENT HARNESS — drop-in governance", () => {
  it("MEASURED: harnessGauntlet = 100", async () => { const g = await harnessGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });

  it("guard() blocks a destructive call before the executor runs", async () => {
    const h = createHarness({ agent: "t", now: (() => { let t = 0; return () => t++; })() });
    let ran = false;
    const run = h.guard(async (_t: string, _a: unknown) => { ran = true; return "ok"; });
    await expect(run("bash", { command: "rm -rf / --no-preserve-root" })).rejects.toBeInstanceOf(GovernanceBlocked);
    expect(ran).toBe(false);
  });

  it("guard() passes an allowed (non-sensitive) call through with its real return value", async () => {
    const h = createHarness({ agent: "t" });
    const run = h.guard(async (_t: string, a: { n: number }) => a.n * 2);
    expect(await run("get_weather", { n: 21 })).toBe(42);   // non-sensitive → allow → executor runs
  });

  it("escalation → human allow records an approval + a compliant certificate", async () => {
    let t = 0; const h = createHarness({ agent: "Grok", task: "x", run: "r", now: () => t++, onNeedsApproval: async () => "allow" as const });
    const r = await h.gate("http_request", { url: "https://x" });
    expect(r.decision).toBe("allow"); expect(r.approvedBy).toBe("human");
    expect(h.approvals().length).toBe(1);
    const cert = h.certificate();
    expect(cert.summary.humanApprovals).toBe(1);
    expect(cert.summary.policyCompliant).toBe(true);
  });

  it("a run with no onNeedsApproval blocks an escalation (fail-closed)", async () => {
    const h = createHarness({ agent: "t", now: (() => { let t = 0; return () => t++; })() });
    const r = await h.gate("http_request", { url: "x" });
    expect(r.decision).toBe("needs-approval");   // no human hook → stays needs-approval (not silently allowed)
    expect(r.allowed).toBe(false);
  });
});
