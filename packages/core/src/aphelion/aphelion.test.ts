import { describe, it, expect } from "vitest";
import { aphelionGauntlet, openSession, recordAction, sealCapsule, verifyCapsule, mergeCapsules } from "./index.js";
describe("APHELION — the brain beyond the cloud", () => {
  it("MEASURED: aphelionGauntlet = 100", () => { const g = aphelionGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
  it("a disconnected window with a violation verifies offline + can't hide it", () => {
    let s = openSession({ sessionId: "x", node: "rover", charter: { mission: "m", scope: ["ok/*"], forbidden: ["boom"], maxRisk: 0.7 }, nowMs: 1 });
    s = recordAction(s, { action: "read", risk: 0.1, path: "ok/a" }, 2);
    s = recordAction(s, { action: "boom", risk: 0.9, path: "core" }, 3);
    const cap = sealCapsule(s); const v = verifyCapsule(cap);
    expect(v.valid).toBe(true); expect(v.compliant).toBe(false); expect(cap.compliance.violations).toBe(1);
    const fleet = mergeCapsules([cap, cap]); // idempotent
    expect(fleet.totalActions).toBe(2); expect(fleet.totalViolations).toBe(1);
  });
});
