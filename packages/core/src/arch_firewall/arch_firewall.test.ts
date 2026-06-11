import { describe, it, expect } from "vitest";
import { firewall, parsePolicy, severityFromAge, firewallReport, archFirewallGauntlet } from "./index.js";
import type { SourceFile } from "../cross_layer_graph/index.js";

const baseline: SourceFile[] = [
  { path: "schema.prisma", content: "model Wallet { id Int @id }\nmodel Note { id Int @id }" },
  { path: "a.ts", content: "export function charge(){ return prisma.wallet.create({data:{}}); }\nexport function readNote(){ return prisma.note.findMany(); }" },
];
const broke: SourceFile[] = [...baseline, { path: "refund.ts", content: "export function refundHandler(){ return prisma.wallet.update({where:{}}); }" }];

describe("arch_firewall", () => {
  it("gauntlet is 100", () => expect(archFirewallGauntlet().score).toBe(100));

  it("BLOCKS a broken old contract, names the offending writer + history", () => {
    const v = firewall(baseline, broke, { ageResolver: () => ({ ageDays: 426, establishedAt: "a1b2c3", heldThroughCommits: 312 }) });
    expect(v.verdict).toBe("BLOCK");
    expect(v.critical).toBe(1);
    expect(v.violations[0].counterexample).toMatch(/refundHandler/);
    expect(v.violations[0].heldThroughCommits).toBe(312);
    expect(firewallReport(v)).toMatch(/BLOCKED/);
  });

  it("treats a broken YOUNG contract as evolution (info, not blocked)", () => {
    const v = firewall(baseline, broke, { ageResolver: () => ({ ageDays: 3 }) });
    expect(v.verdict).not.toBe("BLOCK");
    expect(v.violations[0].severity).toBe("info");
  });

  it("a declared-critical policy overrides age and forces BLOCK", () => {
    const v = firewall(baseline, broke, { policies: parsePolicy("critical table wallet single-writer"), ageResolver: () => ({ ageDays: 3 }) });
    expect(v.verdict).toBe("BLOCK");
    expect(v.violations[0].severity).toBe("critical");
  });

  it("PASSES when nothing regressed", () => {
    const v = firewall(baseline, baseline, { ageResolver: () => ({ ageDays: 999 }) });
    expect(v.verdict).toBe("PASS");
    expect(v.violations.length).toBe(0);
  });

  it("parsePolicy: severity prefix + default warn + comments", () => {
    const p = parsePolicy("# header\ncritical table wallet single-writer\nwarn endpoint POST /x exists\ntable note private\n   \n");
    expect(p.length).toBe(3);
    expect(p[0].severity).toBe("critical");
    expect(p[1].severity).toBe("warn");
    expect(p[2].severity).toBe("warn");   // default
    expect(p[2].rule).toBe("table note private");
  });

  it("severityFromAge thresholds", () => {
    expect(severityFromAge(400)).toBe("critical");
    expect(severityFromAge(120)).toBe("warn");
    expect(severityFromAge(5)).toBe("info");
    expect(severityFromAge(null)).toBe("warn");
    expect(severityFromAge(undefined)).toBe("warn");
  });

  it("verdict is the worst severity present (critical > warn > info)", () => {
    // declare wallet warn (so the regression is warn, not age-critical) → WARN verdict
    const v = firewall(baseline, broke, { policies: parsePolicy("warn table wallet single-writer"), ageResolver: () => ({ ageDays: 999 }) });
    expect(v.verdict).toBe("WARN");
  });

  it("never throws on garbage", () => {
    expect(() => firewall(null as never, null as never)).not.toThrow();
    expect(firewall(null as never, null as never).verdict).toBe("PASS");
    expect(() => parsePolicy(null as never)).not.toThrow();
  });
});
