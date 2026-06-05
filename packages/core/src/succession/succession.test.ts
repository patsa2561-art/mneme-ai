import { describe, it, expect } from "vitest";
import { buildSuccessionCapsule, capsuleLeaksRaw, inherit, successionGauntlet, type SuccessionInput } from "./index.js";

const input: SuccessionInput = {
  agent: "claude-code", reason: "loop thrash", trigger: "loopguard",
  axioms: ["deploy needs cosign", "auth.ts single-owner", "deploy needs cosign"],
  reliability: { survivalPct: 82, band: "solid" },
  purgeProofRefs: ["geo-purge:abc"], ts: 1_700_000_000_000,
};

describe("SUCCESSION CAPSULE — no brain-drain on halt (Mneme decides, host enforces)", () => {
  it("verdict is HALT_RECOMMENDED, enforced by the host (Mneme never kills)", () => {
    const c = buildSuccessionCapsule(input);
    expect(c.haltVerdict).toBe("HALT_RECOMMENDED");
    expect(c.enforcedBy).toBe("host-orchestrator");
  });
  it("carries deduped wisdom + NO raw", () => {
    const c = buildSuccessionCapsule(input);
    expect(c.wisdom.length).toBe(2);
    expect(capsuleLeaksRaw(c, ["AKIA_X", "raw blob"])).toBe(false);
  });
  it("a successor inherits wisdom + reliability + knows raw was purged", () => {
    const inh = inherit(buildSuccessionCapsule(input));
    expect(inh.wisdom.length).toBe(2);
    expect(inh.predecessorReliability?.survivalPct).toBe(82);
    expect(inh.rawWasPurged).toBe(true);
  });
  it("total on garbage", () => {
    expect(() => buildSuccessionCapsule(null as never)).not.toThrow();
    expect(() => inherit(null as never)).not.toThrow();
  });
  it("MEASURED: successionGauntlet = 100", () => {
    const g = successionGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass));
    expect(g.score).toBe(100);
  });
});
