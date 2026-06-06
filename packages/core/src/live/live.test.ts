import { describe, it, expect } from "vitest";
import { liveGauntlet, evaluateLiveness, approvalCanary, providerReady } from "./index.js";
describe("MNEME LIVE — self-verifying liveness", () => {
  it("MEASURED: liveGauntlet = 100", () => { const g = liveGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
  it("the approval pipeline canary passes end-to-end", () => { const c = approvalCanary(); expect(c.ok).toBe(true); expect(c.steps).toHaveLength(6); });
  it("send/clear readiness can never drift (the LINE-guard-bug class)", () => {
    const r = providerReady("line", { channelId: "c", channelSecret: "s" });
    expect(r.sendReady).toBe(r.clearReady); expect(r.sendReady).toBe(true);
  });
  it("a provider with a half-ready config is reported DOWN (loud, not silent)", () => {
    const rep = evaluateLiveness({ daemonHeartbeatAgeMs: 1000, hookWired: true, providers: [{ name: "whatsapp", cfg: { token: "t" } }] });
    expect(rep.verdict).toBe("down");
  });
});
