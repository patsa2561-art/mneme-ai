import { describe, it, expect } from "vitest";
import { habitableZone, zoneFromSamples, analyzeConfig, goldilocksGauntlet } from "./index.js";

describe("GOLDILOCKS — config fragility / habitable-zone analyzer", () => {
  it("gauntlet scores 100 (robust · tight · knife-edge · unstable · open · rank · samples · total)", () => {
    const g = goldilocksGauntlet();
    expect(g.score).toBe(100);
    expect(g.checks.every((c) => c.pass)).toBe(true);
  });

  it("finds the two-sided band [10,90] and a comfortable centered margin", () => {
    const z = habitableZone((v) => v >= 10 && v <= 90, { lo: 0, hi: 100, current: 50 });
    expect(z.passesNow).toBe(true);
    expect(z.lowEdge).toBeCloseTo(10, 1);
    expect(z.highEdge).toBeCloseTo(90, 1);
    expect(z.verdict).toBe("ROBUST");
  });

  it("flags KNIFE-EDGE when the current value sits on the boundary", () => {
    const z = habitableZone((v) => v >= 10 && v <= 90, { lo: 0, hi: 100, current: 10.0003 });
    expect(z.verdict).toBe("KNIFE-EDGE");
  });

  it("reports UNSTABLE (never guesses a zone) when the current value already fails", () => {
    const z = habitableZone((v) => v >= 10 && v <= 90, { lo: 0, hi: 100, current: 200 });
    expect(z.passesNow).toBe(false);
    expect(z.verdict).toBe("UNSTABLE");
  });

  it("ranks the most-fragile param first", () => {
    const band = (v: number) => v >= 10 && v <= 90;
    const a = analyzeConfig([
      { name: "ok", oracle: band, lo: 0, hi: 100, current: 50 },
      { name: "edge", oracle: band, lo: 0, hi: 100, current: 10.4 },
    ]);
    expect(a.mostFragile?.name).toBe("edge");
  });

  it("zoneFromSamples infers a band from discrete probes", () => {
    const z = zoneFromSamples([{ v: 0, pass: false }, { v: 30, pass: true }, { v: 60, pass: true }, { v: 100, pass: false }], 45);
    expect(z.passesNow).toBe(true);
    expect(z.lowEdge).toBeGreaterThan(0);
    expect(z.highEdge).toBeLessThan(100);
  });

  it("is total: a throwing oracle is treated as fail, never crashes", () => {
    expect(() => habitableZone(() => { throw new Error("boom"); }, { lo: 0, hi: 1, current: 0.5 })).not.toThrow();
  });
});
