import { describe, it, expect } from "vitest";
import { turnSignalGauntlet, bestMove, turnNudge, detectTurnSignals } from "./index.js";
describe("TURN-SIGNAL — per-turn best Mneme move", () => {
  it("MEASURED: turnSignalGauntlet = 100", () => { const g = turnSignalGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
  it("fires the right move + abstains on neutral prose", () => {
    expect(bestMove("run rm -rf /tmp/x")?.move).toBe("gate");
    expect(bestMove("upgrade to React version 19.0.0")?.move).toBe("verify");
    expect(bestMove("please tidy the imports")).toBeNull();
  });
  it("turnNudge is empty when nothing is warranted", () => {
    expect(turnNudge("looks good, continue")).toBe("");
    expect(turnNudge("delete the prod db with drop table users")).toContain("gate");
  });
  it("priority: prevent-harm wins when several fire", () => {
    const sigs = detectTurnSignals("rm -rf /data and also check React 19.0.0 api signature");
    expect(sigs[0].move).toBe("gate");
  });
});
