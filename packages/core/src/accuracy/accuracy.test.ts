import { describe, it, expect } from "vitest";
import { benchmark, accuracyGauntlet } from "./index.js";

describe("accuracy", () => {
  it("gauntlet is 100 (harness calibrated + suite clears the floor)", () => expect(accuracyGauntlet().score).toBe(100));

  it("the suite's MEASURED macro-F1 and micro-precision clear the committed floor", () => {
    const r = benchmark();
    expect(r.macroF1).toBeGreaterThanOrEqual(r.floor);
    expect(r.microPrecision).toBeGreaterThanOrEqual(r.floor);
    expect(r.meetsFloor).toBe(true);
  });

  it("reports every foundational dimension", () => {
    const dims = benchmark().dimensions.map((d) => d.dimension);
    for (const d of ["tables", "endpoints", "functions", "data-edges", "calls", "consumers", "authz-gaps", "keystones"]) expect(dims).toContain(d);
  });

  it("each dimension's precision/recall are real numbers in [0,1]", () => {
    for (const d of benchmark().dimensions) {
      expect(d.precision).toBeGreaterThanOrEqual(0); expect(d.precision).toBeLessThanOrEqual(1);
      expect(d.recall).toBeGreaterThanOrEqual(0); expect(d.recall).toBeLessThanOrEqual(1);
    }
  });

  it("a tighter floor than measured is honestly reported as not-met", () => {
    expect(benchmark({ floor: 1.0001 }).meetsFloor).toBe(false);   // can't cheat the floor
  });
});
