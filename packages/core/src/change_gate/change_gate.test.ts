import { describe, it, expect } from "vitest";
import { composeGate, gateReport, changeGateGauntlet } from "./index.js";
import type { FirewallVerdict } from "../arch_firewall/index.js";
import type { ScarVerdict } from "../scar_vaccine/index.js";

const fwBlock = { verdict: "BLOCK", blockedBy: [{ rule: "table wallet single-writer", finalSeverity: "critical", counterexample: "2 writers: a, b" }], findings: [{ rule: "table wallet single-writer", finalSeverity: "critical", waived: false }] } as unknown as FirewallVerdict;
const fwWarn = { verdict: "WARN", blockedBy: [], findings: [{ rule: "table x single-writer", finalSeverity: "high", waived: false }] } as unknown as FirewallVerdict;
const fwPass = { verdict: "PASS", blockedBy: [], findings: [] } as unknown as FirewallVerdict;
const scarFire = { fires: true, firing: [{ scar: { id: "SCAR-double-charge", severity: "critical", lesson: "use idempotency key" } }], immune: [], report: "" } as unknown as ScarVerdict;
const scarQuiet = { fires: false, firing: [], immune: [], report: "" } as unknown as ScarVerdict;

describe("change_gate", () => {
  it("gauntlet is 100", () => expect(changeGateGauntlet().score).toBe(100));
  it("firewall BLOCK ⇒ BLOCK", () => expect(composeGate(fwBlock, scarQuiet).verdict).toBe("BLOCK"));
  it("firewall WARN ⇒ WARN", () => expect(composeGate(fwWarn, scarQuiet).verdict).toBe("WARN"));
  it("scar fire ⇒ WARN with the lesson", () => {
    const g = composeGate(fwPass, scarFire);
    expect(g.verdict).toBe("WARN");
    expect(g.reasons.some((r) => /SCAR-double-charge/.test(r))).toBe(true);
  });
  it("clean ⇒ PASS", () => expect(composeGate(fwPass, scarQuiet).verdict).toBe("PASS"));
  it("BLOCK dominates a co-occurring scar", () => expect(composeGate(fwBlock, scarFire).verdict).toBe("BLOCK"));
  it("gateReport renders the verdict", () => expect(gateReport(composeGate(fwBlock, scarQuiet))).toMatch(/BLOCK/));
  it("null inputs never throw", () => { expect(() => composeGate(null, null)).not.toThrow(); expect(composeGate(null, null).verdict).toBe("PASS"); });
});
