import { describe, it, expect } from "vitest";
import { firewall, parsePolicy, loadPolicy, scoreSeverity, firewallReport, archFirewallGauntlet, DEFAULT_POLICY } from "./index.js";
import type { AgeInfo } from "./index.js";
import type { SourceFile } from "../cross_layer_graph/index.js";

const baseline: SourceFile[] = [
  { path: "schema.prisma", content: "model Wallet { id Int @id }\nmodel Note { id Int @id }" },
  { path: "a.ts", content: "export function charge(){ return prisma.wallet.create({data:{}}); }\nexport function readNote(){ return prisma.note.findMany(); }" },
];
const broke: SourceFile[] = [...baseline, { path: "refund.ts", content: "export function refundHandler(){ return prisma.wallet.update({where:{}}); }" }];
const oldAge = (): AgeInfo => ({ ageDays: 875, establishedAt: "a1b2c3", heldThroughCommits: 312 });
const youngAge = (): AgeInfo => ({ ageDays: 3 });

describe("arch_firewall", () => {
  it("gauntlet is 100", () => expect(archFirewallGauntlet().score).toBe(100));

  it("BLOCKS an old contract (base high +2 ⇒ critical), names the writer + history", () => {
    const v = firewall(baseline, broke, DEFAULT_POLICY, { ageResolver: oldAge });
    expect(v.verdict).toBe("BLOCK");
    expect(v.findings[0].finalSeverity).toBe("critical");
    expect(v.findings[0].counterexample).toMatch(/refundHandler/);
    expect(v.findings[0].heldThroughCommits).toBe(312);
    expect(firewallReport(v)).toMatch(/BLOCKED/);
  });

  it("WARNs (not BLOCK) for a young contract (base high +0 ⇒ high)", () => {
    const v = firewall(baseline, broke, DEFAULT_POLICY, { ageResolver: youngAge });
    expect(v.verdict).toBe("WARN");
    expect(v.findings[0].finalSeverity).toBe("high");
  });

  it("a waiver suppresses the block", () => {
    const pol = parsePolicy("waive table wallet single-writer :: dual-writer approved in RFC-42");
    const v = firewall(baseline, broke, pol, { ageResolver: oldAge, today: "2026-06-11" });
    expect(v.verdict).not.toBe("BLOCK");
    expect(v.findings[0].waived).toBe(true);
    expect(v.findings[0].waiverReason).toMatch(/RFC-42/);
  });

  it("an EXPIRED waiver is NOT honoured — block stands + surfaced", () => {
    const pol = parsePolicy("waive until=2025-01-01 table wallet single-writer :: temporary");
    const v = firewall(baseline, broke, pol, { ageResolver: oldAge, today: "2026-06-11" });
    expect(v.verdict).toBe("BLOCK");
    expect(v.findings[0].waiverExpired).toBe(true);
    expect(v.expiredWaivers.length).toBe(1);
  });

  it("PASSES when nothing regressed", () => {
    const v = firewall(baseline, baseline, DEFAULT_POLICY, { ageResolver: oldAge });
    expect(v.verdict).toBe("PASS");
    expect(v.clean).toBe(true);
  });

  it("scoreSeverity: age bump, flicker cap, UNKNOWN penalty", () => {
    expect(scoreSeverity({ base: "high", status: "VIOLATED", ageDays: 800, flickered: false, ageWeight: true, ageTiers: DEFAULT_POLICY.ageTiers }).final).toBe("critical"); // +2
    expect(scoreSeverity({ base: "medium", status: "VIOLATED", ageDays: 800, flickered: false, ageWeight: true, ageTiers: DEFAULT_POLICY.ageTiers }).final).toBe("critical"); // medium +2
    expect(scoreSeverity({ base: "medium", status: "VIOLATED", ageDays: 800, flickered: true, ageWeight: true, ageTiers: DEFAULT_POLICY.ageTiers }).final).toBe("high"); // flicker caps +2→+1
    expect(scoreSeverity({ base: "high", status: "UNKNOWN", ageDays: 3, flickered: false, ageWeight: true, ageTiers: DEFAULT_POLICY.ageTiers }).final).toBe("medium"); // +0 −1
    expect(scoreSeverity({ base: "medium", status: "VIOLATED", ageDays: 200, flickered: false, ageWeight: true, ageTiers: DEFAULT_POLICY.ageTiers }).final).toBe("high"); // +1
  });

  it("parsePolicy: directives + enforce + waiver(+until)", () => {
    const p = parsePolicy("# header\nname payments\nblockon high\ndefault single-writer critical\nagetier 30 1\ncritical table x single-writer\nwaive until=2030-01-01 table y private :: ok");
    expect(p.name).toBe("payments");
    expect(p.blockOn).toBe("high");
    expect(p.defaults["single-writer"]).toBe("critical");
    expect(p.enforce.length).toBe(1);
    expect(p.enforce[0].severity).toBe("critical");
    expect(p.waivers[0].until).toBe("2030-01-01");
    expect(p.ageTiers.some((t) => t.minDays === 30 && t.bump === 1)).toBe(true);
  });

  it("an enforce override changes the base severity", () => {
    // pin wallet single-writer to 'critical' base → even at 3 days it blocks (critical ≥ blockOn critical)
    const pol = parsePolicy("critical table wallet single-writer");
    const v = firewall(baseline, broke, pol, { ageResolver: youngAge });
    expect(v.verdict).toBe("BLOCK");
  });

  it("loadPolicy parses JSON and falls back to DSL", () => {
    const j = loadPolicy(JSON.stringify({ name: "j", blockOn: "high", waivers: [{ rule: "table wallet single-writer", reason: "x" }] }));
    expect(j.name).toBe("j");
    expect(j.blockOn).toBe("high");
    expect(j.waivers.length).toBe(1);
    expect(loadPolicy("critical table z private").enforce.length).toBe(1);
  });

  it("never throws on garbage", () => {
    expect(() => firewall(null as never, null as never)).not.toThrow();
    expect(firewall(null as never, null as never).verdict).toBe("PASS");
    expect(() => parsePolicy(null as never)).not.toThrow();
    expect(() => loadPolicy("{bad json")).not.toThrow();
  });
});
