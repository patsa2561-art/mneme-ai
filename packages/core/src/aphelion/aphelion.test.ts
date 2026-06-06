import { describe, it, expect } from "vitest";
import { aphelionGauntlet, openSession, recordAction, amendCharter, activeCharterOf, sealCapsule, verifyCapsule, mergeCapsules, createBundle, forwardBundle, verifyBundle } from "./index.js";
describe("APHELION — the brain beyond the cloud", () => {
  it("MEASURED: aphelionGauntlet = 100", () => { const g = aphelionGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });

  it("a disconnected window with a violation verifies offline + can't hide it", () => {
    let s = openSession({ sessionId: "x", node: "rover", charter: { mission: "m", scope: ["ok/*"], forbidden: ["boom"], maxRisk: 0.7 }, nowMs: 1 });
    s = recordAction(s, { action: "read", risk: 0.1, path: "ok/a" }, 2);
    s = recordAction(s, { action: "boom", risk: 0.9, path: "core" }, 3);
    const cap = sealCapsule(s); const v = verifyCapsule(cap);
    expect(v.valid).toBe(true); expect(v.compliant).toBe(false); expect(cap.compliance.violations).toBe(1);
    expect(mergeCapsules([cap, cap]).totalViolations).toBe(1); // idempotent
  });

  it("a signed mid-flight amendment governs future actions but cannot cover a past violation", () => {
    let s = openSession({ sessionId: "a", node: "lander", charter: { mission: "m", scope: ["*"], forbidden: [], maxRisk: 0.5 }, nowMs: 1 });
    s = recordAction(s, { action: "burn", risk: 0.8 }, 2);                        // violation @ maxRisk 0.5
    s = amendCharter(s, { charter: { mission: "m", scope: ["*"], forbidden: [], maxRisk: 0.9 }, reason: "descent" }, 3);
    s = recordAction(s, { action: "burn2", risk: 0.8 }, 4);                       // ok @ maxRisk 0.9
    const cap = sealCapsule(s);
    expect(activeCharterOf(s).maxRisk).toBe(0.9);
    expect(cap.compliance.total).toBe(2); expect(cap.compliance.violations).toBe(1);
    expect(verifyCapsule(cap).valid).toBe(true);
  });

  it("DTN store-and-forward: the custody path + payload both verify; tampering either is caught", () => {
    let s = openSession({ sessionId: "d", node: "rover", charter: { mission: "m", scope: ["*"], forbidden: [], maxRisk: 0.7 }, nowMs: 1 });
    s = recordAction(s, { action: "read", risk: 0.2 }, 2);
    const cap = sealCapsule(s);
    let b = createBundle(cap, "rover", 10);
    b = forwardBundle(b, "orbiter", 20);
    b = forwardBundle(b, "dsn", 30);
    const v = verifyBundle(b);
    expect(v.valid).toBe(true); expect(v.path).toEqual(["rover", "orbiter", "dsn"]);
    const tampered = { ...b, custody: b.custody.map((h, i) => i === 1 ? { ...h, node: "evil" } : h) };
    expect(verifyBundle(tampered).valid).toBe(false);
  });
});
