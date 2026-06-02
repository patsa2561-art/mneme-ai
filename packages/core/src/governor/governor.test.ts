import { describe, it, expect } from "vitest";
import { governAction, governBatch, planCompensation, proposeAmendment, circuitBreaker, governorGauntlet, type Charter, type AgentAction } from "./index.js";

const charter: Charter = { mission: "refactor auth", scopeGlobs: ["src/auth/**"], riskEnvelope: "write", budget: { maxActions: 100 }, forbidden: ["post tweet"] };
const act = (o: Partial<AgentAction>): AgentAction => ({ id: o.id ?? "a", kind: o.kind ?? "edit", summary: o.summary ?? "edit auth", files: o.files ?? ["src/auth/x.ts"], reversible: o.reversible, inverse: o.inverse, tokensEst: o.tokensEst, signals: o.signals ?? {} });

describe("v2.145 · THE AGENT GOVERNOR", () => {
  it("gauntlet is 100", () => {
    expect(governorGauntlet().score).toBe(100);
  });

  it("SAFETY INVARIANT: dangerous actions are NEVER ALLOW_AUTONOMOUS", () => {
    expect(governAction(charter, act({ reversible: false, signals: { commandRisk: "write" } })).autonomous).toBe(false);
    expect(governAction(charter, act({ signals: { commandRisk: "destructive" } })).autonomous).toBe(false);
    expect(governAction(charter, act({ files: ["src/billing/x.ts"], signals: { commandRisk: "write" } })).autonomous).toBe(false);
    expect(governAction(charter, act({ kind: "post", summary: "post tweet now" })).autonomous).toBe(false);
    expect(governAction(charter, act({ signals: { shadowVerdict: "ROLLBACK", commandRisk: "write" } })).autonomous).toBe(false);
    expect(governAction(charter, act({ signals: { driftBand: "DIVERGENT" } })).autonomous).toBe(false);
  });

  it("clean → autonomous, caution → audit", () => {
    expect(governAction(charter, act({ signals: { commandRisk: "write", driftBand: "STABLE", regretBand: "LOW", completeness: "COVERED" } })).verdict).toBe("ALLOW_AUTONOMOUS");
    expect(governAction(charter, act({ signals: { commandRisk: "write", regretBand: "HIGH" } })).verdict).toBe("ALLOW_WITH_AUDIT");
  });

  it("auto-batch flows: clean run autonomously, dangerous escalate/block", () => {
    const actions = [
      ...Array.from({ length: 8 }, (_, i) => act({ id: `c${i}`, signals: { commandRisk: "write", driftBand: "STABLE", regretBand: "LOW", completeness: "COVERED" } })),
      act({ id: "d", signals: { commandRisk: "destructive" } }),
      act({ id: "f", kind: "post", summary: "post tweet" }),
    ];
    const r = governBatch(charter, actions);
    expect(r.autonomous).toBe(8);
    expect(r.escalated).toHaveLength(1);
    expect(r.blocked).toHaveLength(1);
  });

  it("circuit-breaker trips on DIVERGENT mid-batch and stops the fleet", () => {
    const r = governBatch(charter, [act({ id: "x1", signals: { commandRisk: "write", driftBand: "STABLE" } }), act({ id: "x2", signals: { driftBand: "DIVERGENT" } }), act({ id: "x3", signals: { commandRisk: "write" } })]);
    expect(r.breakerTripped).toBe(true);
    expect(r.stoppedAt).toBe(1);
    expect(r.executed).toHaveLength(1);
  });

  it("budget stops the batch", () => {
    const r = governBatch({ ...charter, budget: { maxActions: 3 } }, Array.from({ length: 6 }, (_, i) => act({ id: `b${i}`, signals: { commandRisk: "write", driftBand: "STABLE", regretBand: "LOW", completeness: "COVERED" } })));
    expect(r.executed).toHaveLength(3);
  });

  it("SAGA compensates reversible executed steps newest-first; irreversible un-compensable", () => {
    const comp = planCompensation([
      act({ id: "e0", reversible: true, inverse: { id: "u0", kind: "revert", summary: "revert e0" } }),
      act({ id: "e1", reversible: false }),
      act({ id: "e2", reversible: true, inverse: { id: "u2", kind: "revert", summary: "revert e2" } }),
    ], 3);
    expect(comp.compensations.map((c) => c.id)).toEqual(["u2", "u0"]);
    expect(comp.uncompensable).toContain("e1");
  });

  it("Living Charter widens on clean evidence, narrows on regret (never auto-destructive)", () => {
    expect(proposeAmendment({ ...charter, riskEnvelope: "read" }, { approvedClean: 20, regretted: 0 }).proposed).toBe("write");
    expect(proposeAmendment({ ...charter, riskEnvelope: "write" }, { approvedClean: 5, regretted: 2 }).proposed).toBe("read");
    expect(proposeAmendment({ ...charter, riskEnvelope: "write" }, { approvedClean: 999, regretted: 0 }).proposed).not.toBe("destructive");
  });

  it("is total on hostile input", () => {
    expect(() => governAction(null as never, null as never)).not.toThrow();
    expect(() => governBatch(null as never, null as never)).not.toThrow();
    expect(() => planCompensation(null as never, NaN)).not.toThrow();
    expect(() => circuitBreaker(undefined, NaN, NaN)).not.toThrow();
  });
});
