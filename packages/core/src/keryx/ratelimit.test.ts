import { describe, it, expect } from "vitest";
import { rateGauntlet, checkRate } from "./ratelimit.js";
describe("KERYX RATE LIMIT", () => {
  it("MEASURED: rateGauntlet = 100", () => { const g = rateGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
  it("a flood from one key is throttled while others pass", () => {
    const st = {}; let blocked = 0;
    for (let i = 0; i < 50; i++) if (!checkRate(st, "flooder", 0, { burst: 10, refillPerSec: 1 }).allowed) blocked++;
    expect(blocked).toBeGreaterThan(30);
    expect(checkRate(st, "innocent", 0, { burst: 10, refillPerSec: 1 }).allowed).toBe(true);
  });
});
