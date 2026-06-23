import { describe, it, expect } from "vitest";
import { compress, inflate, entangle, gravity, bruteforce, cosmosBench, cosmosGauntlet, type Lesson, type Memory } from "./index.js";

describe("v3.138 · COSMOS — singularity codec + entangled-gravity (classically real)", () => {
  it("gauntlet is 100", () => expect(cosmosGauntlet().score).toBe(100));

  it("★ inflate-precision 1.0, accuracy ≥98.5%; gravity matches a full scan ≥98.5% at sub-scan", () => {
    const b = cosmosBench();
    expect(b.qsi.precision).toBe(1);
    expect(b.qsi.leaks).toEqual([]);
    expect(b.qsi.accuracy).toBeGreaterThanOrEqual(0.985);
    expect(b.qsi.avgTouchedRatio).toBeLessThan(1);            // sub-scan
    expect(b.mes.topkAgreement).toBeGreaterThanOrEqual(0.985);
    expect(b.mes.avgTouchedRatio).toBeLessThan(1);            // sub-scan
  });

  it("SINGULARITY: compresses dups + inflates only the problem-shaped pocket", () => {
    const lessons: Lesson[] = [
      { text: "auth tokens expire in 15 minutes" }, { text: "auth tokens expire in 15 minutes" },  // dup
      { text: "payments table is append-only" }, { text: "cache is redis with lru" },
    ];
    const seed = compress(lessons);
    expect(seed.n).toBeLessThan(lessons.length);              // deduped
    const inf = inflate(seed, "the auth token expiry");
    expect(inf.working.some((f) => /auth tokens expire/i.test(f.text))).toBe(true);
    expect(inf.working.some((f) => /payments/i.test(f.text))).toBe(false);  // irrelevant excluded
    expect(inf.touched).toBeLessThanOrEqual(seed.n);
  });

  it("GRAVITY: matches the brute-force top-k while touching fewer nodes", () => {
    const mems: Memory[] = [
      { id: "a", text: "auth middleware", entities: ["auth", "middleware"] },
      { id: "b", text: "auth token", entities: ["auth", "token"] },
      { id: "c", text: "payments ledger", entities: ["payments", "ledger"] },
      { id: "d", text: "redis cache", entities: ["cache", "redis"] },
    ];
    const g = entangle(mems);
    const r = gravity(g, "auth", { top: 3 });
    const bf = new Set(bruteforce(g, "auth", 3));
    expect(r.ranked.every((x) => bf.has(x.id))).toBe(true);
    expect(r.touched).toBeLessThan(g.total);
  });

  it("is total on hostile input", () => {
    expect(() => compress(null as never)).not.toThrow();
    expect(() => gravity(entangle([]), "")).not.toThrow();
    expect(inflate(compress([]), "x").working).toEqual([]);
  });
});
