import { describe, expect, it } from "vitest";
import { whyNotQuantum, COMPLEXITY_TABLE, groverIterations, quantumSpeedupAt } from "./quantum.js";

describe("quantum easter egg", () => {
  it("whyNotQuantum returns honest explanation", () => {
    const text = whyNotQuantum();
    expect(text).toContain("ARCHITECTURE");
    expect(text).toContain("Mneme");
    expect(text.length).toBeGreaterThan(200);
  });

  it("COMPLEXITY_TABLE has at least 4 rows", () => {
    expect(COMPLEXITY_TABLE.length).toBeGreaterThanOrEqual(4);
    for (const row of COMPLEXITY_TABLE) {
      expect(row.classical.bigO).toMatch(/O\(/);
      expect(typeof row.applicableToMneme).toBe("boolean");
    }
  });

  it("AI-trigger row says NOT applicable to Mneme", () => {
    const row = COMPLEXITY_TABLE.find((r) => r.classical.name.includes("AI inference trigger"));
    expect(row).toBeDefined();
    expect(row!.applicableToMneme).toBe(false);
  });

  it("groverIterations(N=1024) ~= 25 (pi/4 * sqrt(1024) = ~25)", () => {
    const iters = groverIterations(1024);
    expect(iters).toBeGreaterThanOrEqual(20);
    expect(iters).toBeLessThanOrEqual(30);
  });

  it("groverIterations(0..1) returns 0", () => {
    expect(groverIterations(0)).toBe(0);
    expect(groverIterations(1)).toBe(0);
  });

  it("quantumSpeedupAt grows ~ sqrt(N) for large N", () => {
    const sp1k = quantumSpeedupAt(1_000);
    const sp1m = quantumSpeedupAt(1_000_000);
    // 1M / iterations(1M ~= 785) ~= 1273; 1k / iterations(1k ~= 25) ~= 40.
    // sqrt(1000x larger N) should give roughly sqrt(1000) ~= 31x larger speedup.
    expect(sp1m).toBeGreaterThan(sp1k * 10);
  });
});
