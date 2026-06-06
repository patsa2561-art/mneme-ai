import { describe, it, expect } from "vitest";
import { approvalMatrixGauntlet, openTicket, applyDecision, reconcilePlan } from "./approval_matrix.js";
describe("APPROVAL MATRIX — authoritative first-wins ticket", () => {
  it("MEASURED: approvalMatrixGauntlet = 100", () => { const g = approvalMatrixGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
  it("a second tap on any surface never double-acts", () => {
    const t = openTicket({ id: "x", command: "c", agent: "a", createdAt: 1, surfaces: ["telegram", "line", "computer"] });
    const a = applyDecision(t, { decision: "allow", on: "telegram", at: 2 });
    const b = applyDecision(a.ticket, { decision: "deny", on: "line", at: 3 });
    expect(a.outcome).toBe("accepted"); expect(b.outcome).toBe("already-decided"); expect(b.ticket.decision).toBe("allow");
    expect(reconcilePlan(a.ticket).clears.map((c) => c.provider).sort()).toEqual(["computer", "line"]);
  });
});
