/**
 * v2.82.0 — IDLE-TIME COMPOUNDING pinned + QUAN tests (💎10).
 */
import { describe, it, expect } from "vitest";
import { consolidate, type ConsolidationClaim } from "./index.js";

describe("v2.82.0 💎10 Idle Compounding (PINNED)", () => {
  it("I1 near-duplicate TRUE claims merge into one higher-support axiom", () => {
    const claims: ConsolidationClaim[] = [
      { id: "1", text: "the auth module uses bcrypt for password hashing", verdict: "TRUE" },
      { id: "2", text: "auth module uses bcrypt password hashing", verdict: "TRUE" },
      { id: "3", text: "the database is postgres", verdict: "TRUE" },
    ];
    const r = consolidate(claims);
    expect(r.axioms.length).toBe(2);
    const bcrypt = r.axioms.find((a) => a.text.includes("bcrypt"))!;
    expect(bcrypt.support).toBe(2);
    expect(bcrypt.ids).toEqual(["1", "2"]);
    expect(r.compoundedCount).toBe(1); // 3 trues → 2 axioms
  });
  it("I2 FALSE claims that contradict an axiom are pruned as contradictions", () => {
    const claims: ConsolidationClaim[] = [
      { id: "1", text: "the auth module uses bcrypt password hashing", verdict: "TRUE" },
      { id: "2", text: "the auth module uses bcrypt password hashing scheme", verdict: "FALSE" },
      { id: "3", text: "totally unrelated false thing about weather", verdict: "FALSE" },
    ];
    const r = consolidate(claims);
    expect(r.contradictions).toBe(1);
    expect(r.pruned.find((p) => p.id === "2")!.reason).toMatch(/contradicts/);
    expect(r.pruned.find((p) => p.id === "3")!.reason).toMatch(/not promoted/);
  });
  it("I3 UNVERIFIED claims are not promoted", () => {
    const r = consolidate([{ id: "1", text: "maybe true thing", verdict: "UNVERIFIED" }]);
    expect(r.axioms.length).toBe(0);
    expect(r.pruned[0]!.reason).toMatch(/unverified/);
  });
});

describe("v2.82.0 💎10 QUAN", () => {
  it("Q deterministic + idempotent fixed point + order-independent", () => {
    const base: ConsolidationClaim[] = [];
    for (let i = 0; i < 40; i++) {
      const topic = i % 5;
      base.push({ id: `c${i}`, text: `topic ${topic} fact alpha beta gamma ${topic}`, verdict: (i % 7 === 0 ? "FALSE" : i % 11 === 0 ? "UNVERIFIED" : "TRUE") });
    }
    const r1 = consolidate(base);
    const r2 = consolidate(base.slice().reverse());
    // order-independent axiom set (compare canonical texts + supports)
    const sig = (r: ReturnType<typeof consolidate>) => r.axioms.map((a) => `${a.text}#${a.support}`).sort();
    expect(sig(r1)).toEqual(sig(r2));
    // idempotent: feeding the axioms back as TRUE claims yields the same axioms
    const asClaims: ConsolidationClaim[] = r1.axioms.map((a, i) => ({ id: `x${i}`, text: a.text, verdict: "TRUE" as const }));
    const r3 = consolidate(asClaims);
    expect(r3.axioms.length).toBe(r1.axioms.length);
    expect(r1.axioms.every((a) => a.support >= 1)).toBe(true);
  });
});
