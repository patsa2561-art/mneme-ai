import { describe, it, expect } from "vitest";
import { approvalMatrixGauntlet, approvalStressGauntlet, processTap, openTicket } from "./approval_matrix.js";
describe("APPROVAL MATRIX — authoritative first-wins ticket", () => {
  it("MEASURED: approvalMatrixGauntlet = 100", () => { const g = approvalMatrixGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
  it("STRESS: 100,000 chaotic cross-provider tap streams hold every invariant (incl. correct answering-provider name)", () => {
    const s = approvalStressGauntlet(100000); if (s.score !== 100) console.error(s.failures); expect(s.score).toBe(100); expect(s.rounds).toBe(100000);
  });
  it("the TAP SINK: first wins, others cleared once, a late tap is calmed not silent", () => {
    let t = openTicket({ id: "x", command: "c", agent: "Grok", createdAt: 0, surfaces: ["telegram", "line", "whatsapp", "computer"] });
    const a = processTap(t, { surface: "telegram", decision: "allow", at: 1 }); t = a.ticket;
    expect(a.outcome).toBe("accepted");
    expect(a.actions.filter((x) => x.type === "clear").map((x) => x.surface).sort()).toEqual(["computer", "line", "whatsapp"]);
    const late = processTap(t, { surface: "line", decision: "deny", at: 2 });
    expect(late.outcome).toBe("already-decided");
    expect(late.actions).toHaveLength(1); expect(late.actions[0].type).toBe("reply"); expect(late.actions[0].surface).toBe("line");
    expect(late.ticket.decision).toBe("allow"); // unchanged
  });
});
