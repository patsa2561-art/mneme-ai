import { describe, it, expect } from "vitest";
import { compareGauntlet, compareSecurity } from "./index.js";

describe("v3.148 · COMPARE — Mneme vs a typical baseline (measured, no competitor names)", () => {
  it("gauntlet is 100", () => expect(compareGauntlet().score).toBe(100));

  it("★ Mneme wins every measured axis with a real delta", () => {
    const r = compareSecurity();
    expect(r.mnemeWinsAll).toBe(true);
    expect(r.avgDelta).toBeGreaterThan(50);
    for (const row of r.rows) {
      expect(row.delta, row.axis).toBeGreaterThan(0);
      expect(row.mneme).toBeGreaterThanOrEqual(row.baseline);
    }
  });

  it("the obfuscated-defense edge is large (normalize-first beats a keyword filter)", () => {
    const row = compareSecurity().rows.find((r) => r.axis.startsWith("Obfuscated"))!;
    expect(row.mneme).toBeGreaterThanOrEqual(95);
    expect(row.baseline).toBeLessThan(50);
  });

  it("is deterministic", () => {
    expect(JSON.stringify(compareSecurity())).toBe(JSON.stringify(compareSecurity()));
  });
});
