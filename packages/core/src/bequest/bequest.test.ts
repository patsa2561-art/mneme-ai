import { describe, it, expect } from "vitest";
import { survival, inheritanceReport, mintCapsule, verifyInheritance, minHeirCover, bequestGauntlet, type KnowledgeUnit, type HeirCandidate } from "./index.js";

describe("v2.122 BEQUEST — knowledge survival (reliability redundancy)", () => {
  it("0 holders ⇒ survival 0 (orphaned)", () => {
    expect(survival({ holders: [] })).toBe(0);
  });
  it("one fully-fluent holder ⇒ survival 1", () => {
    expect(survival({ holders: [{ id: "a", fluency: 1 }] })).toBe(1);
  });
  it("two half-fluent holders ⇒ 0.75 (redundancy raises survival)", () => {
    expect(survival({ holders: [{ id: "a", fluency: 0.5 }, { id: "b", fluency: 0.5 }] })).toBeCloseTo(0.75, 6);
  });
  it("clamps out-of-range fluency", () => {
    expect(survival({ holders: [{ id: "a", fluency: 5 }] })).toBe(1);
    expect(survival({ holders: [{ id: "a", fluency: -3 }] })).toBe(0);
  });
});

describe("v2.122 BEQUEST — inheritance completeness / orphaned mass", () => {
  const units: KnowledgeUnit[] = [
    { id: "pay.ts", mass: 100, holders: [{ id: "alice", fluency: 0.9 }] },
    { id: "auth.ts", mass: 50, holders: [{ id: "bob", fluency: 0.2 }] },
    { id: "legacy.ts", mass: 30, holders: [] },
  ];
  it("orphaned = total − surviving (exact)", () => {
    const r = inheritanceReport(units);
    expect(r.orphanedMass).toBeCloseTo(r.totalMass - r.survivingMass, 3);
  });
  it("completeness = survivingMass / totalMass", () => {
    const r = inheritanceReport(units);
    expect(r.completeness).toBeCloseTo(r.survivingMass / r.totalMass, 3);
  });
  it("a unit with no holders is reported as orphaned", () => {
    const r = inheritanceReport(units, { orphanThreshold: 0.5 });
    expect(r.orphans.map((o) => o.id)).toContain("legacy.ts");
  });
  it("empty input ⇒ all zeros, never NaN", () => {
    const r = inheritanceReport([]);
    expect(r.completeness).toBe(0);
    expect(r.orphanedMass).toBe(0);
  });
});

describe("v2.122 BEQUEST — succession capsule + transfer-integrity proof", () => {
  const units: KnowledgeUnit[] = [
    { id: "pay.ts", mass: 100, holders: [{ id: "alice", fluency: 0.9 }], content: "the payment retry path uses idempotency keys" },
    { id: "auth.ts", mass: 50, holders: [{ id: "alice", fluency: 0.8 }], content: "tokens rotate every 24h" },
  ];
  it("capsule is deterministic + tamper-evident", () => {
    const a = mintCapsule({ holderId: "alice", units, reasoning: "owns payment+auth" });
    const b = mintCapsule({ holderId: "alice", units, reasoning: "owns payment+auth" });
    expect(a.bodyHash).toHaveLength(64);
    expect(a.bodyHash).toBe(b.bodyHash);
    expect(mintCapsule({ holderId: "alice", units, reasoning: "DIFFERENT" }).bodyHash).not.toBe(a.bodyHash);
  });
  it("a correct heir claim verifies (full mass coverage)", () => {
    const cap = mintCapsule({ holderId: "alice", units });
    const provided: Record<string, string> = {}; for (const u of cap.units) provided[u.id] = u.contentHash;
    const v = verifyInheritance(cap, "carol", provided);
    expect(v.ok).toBe(true);
    expect(v.coverageByMass).toBeCloseTo(1, 6);
    expect(v.missing).toEqual([]);
  });
  it("a wrong/missing hash is rejected and reported", () => {
    const cap = mintCapsule({ holderId: "alice", units });
    const provided: Record<string, string> = {}; for (const u of cap.units) provided[u.id] = u.contentHash;
    provided["pay.ts"] = "deadbeef";
    const v = verifyInheritance(cap, "carol", provided);
    expect(v.ok).toBe(false);
    expect(v.missing).toContain("pay.ts");
    expect(v.coverageByMass).toBeLessThan(1);
  });
  it("the note honestly disclaims deep comprehension", () => {
    const cap = mintCapsule({ holderId: "alice", units });
    const v = verifyInheritance(cap, "carol", {});
    expect(v.note).toMatch(/NOT a proof of deep comprehension/i);
  });
});

describe("v2.122 BEQUEST — minimum-heir set cover", () => {
  const atRisk = [{ id: "u1", mass: 10 }, { id: "u2", mass: 8 }, { id: "u3", mass: 6 }, { id: "u4", mass: 4 }];
  const cands: HeirCandidate[] = [
    { id: "c1", canCover: ["u1", "u2"] },
    { id: "c2", canCover: ["u1", "u3"] },
    { id: "c3", canCover: ["u3", "u4"] },
    { id: "c4", canCover: ["u2", "u4"] },
  ];
  it("respects the budget and never exceeds it", () => {
    expect(minHeirCover(atRisk, cands, 2).chosen.length).toBeLessThanOrEqual(2);
  });
  it("greedy ≥ (1−1/e)·OPT (beats the approximation bound)", () => {
    const g = minHeirCover(atRisk, cands, 2);
    const massOf = new Map(atRisk.map((u) => [u.id, u.mass]));
    let opt = 0;
    for (let i = 0; i < cands.length; i++) for (let j = i + 1; j < cands.length; j++) {
      const s = new Set([...cands[i]!.canCover, ...cands[j]!.canCover]);
      let m = 0; for (const id of s) m += massOf.get(id) ?? 0;
      opt = Math.max(opt, m);
    }
    expect(g.coveredMass).toBeGreaterThanOrEqual((1 - 1 / Math.E) * opt - 1e-9);
  });
  it("more budget never reduces coverage (monotone)", () => {
    const c1 = minHeirCover(atRisk, cands, 1).coveredMass;
    const c2 = minHeirCover(atRisk, cands, 2).coveredMass;
    const c3 = minHeirCover(atRisk, cands, 4).coveredMass;
    expect(c2).toBeGreaterThanOrEqual(c1);
    expect(c3).toBeGreaterThanOrEqual(c2);
  });
});

describe("v2.122 BEQUEST — total + gauntlet", () => {
  it("never throws on garbage (108-error rule)", () => {
    expect(() => survival(null as never)).not.toThrow();
    expect(() => inheritanceReport(null as never)).not.toThrow();
    expect(() => mintCapsule(null as never)).not.toThrow();
    expect(() => verifyInheritance(null as never, null as never, null as never)).not.toThrow();
    expect(() => minHeirCover(null as never, null as never, NaN as never)).not.toThrow();
  });
  it("bequestGauntlet() = 100", () => {
    const g = bequestGauntlet();
    expect(g.score).toBe(100);
    expect(g.survivalIdentity).toBe(true);
    expect(g.survivalMonotone).toBe(true);
    expect(g.completenessIdentity).toBe(true);
    expect(g.capsuleTamperEvident).toBe(true);
    expect(g.inheritanceVerifies).toBe(true);
    expect(g.setCoverBeatsBound).toBe(true);
    expect(g.deterministic).toBe(true);
    expect(g.stable).toBe(true);
    expect(g.cases).toBe(4000);
  });
});
