import { describe, it, expect } from "vitest";
import { proofLoopGauntlet, recordAssist, scorecard } from "./index.js";
describe("LIVE PROOF LOOP", () => {
  it("MEASURED: proofLoopGauntlet = 100", () => { const g = proofLoopGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
  it("counts harms-prevented + tokens per agent, honestly", () => {
    let L = recordAssist([], { agent: "a", kind: "hallucination_caught", at: 1 });
    L = recordAssist(L, { agent: "a", kind: "token_saved", count: 1000, at: 2 });
    L = recordAssist(L, { agent: "b", kind: "unknown_flagged", at: 3 });
    const sc = scorecard(L, { now: 9 });
    expect(sc.harmsPrevented).toBe(1); expect(sc.tokensSaved).toBe(1000); expect(sc.topAgent).toBe("a");
  });
});
