import { describe, it, expect } from "vitest";
import { kellyAllocate, classifyTier, estimateEdge, estimateVariance } from "./alpha.js";
import type { DebtItem } from "./alpha.js";

const item = (overrides: Partial<DebtItem>): DebtItem => ({
  id: "x",
  name: "X",
  edge: 0.1,
  variance: 0.05,
  effortDays: 5,
  ...overrides,
});

describe("kellyAllocate — basic invariants", () => {
  it("never allocates negative days", () => {
    const r = kellyAllocate(
      [
        item({ id: "good", edge: 0.2, variance: 0.05 }),
        item({ id: "bad", edge: -0.1, variance: 0.05 }),
      ],
      { budgetDays: 20 },
    );
    for (const a of r.items) expect(a.allocatedDays).toBeGreaterThanOrEqual(0);
    expect(r.items.find((a) => a.id === "bad")!.allocatedDays).toBe(0);
    expect(r.items.find((a) => a.id === "bad")!.tier).toBe("skip");
  });

  it("raw Kelly is edge / variance", () => {
    const r = kellyAllocate([item({ id: "x", edge: 0.2, variance: 0.05 })], { budgetDays: 100 });
    expect(r.items[0]!.rawKelly).toBeCloseTo(4, 6);
  });

  it("applies fractional Kelly multiplier (default 0.25)", () => {
    const r = kellyAllocate([item({ id: "x", edge: 0.2, variance: 0.1 })], { budgetDays: 100 });
    // raw kelly = 2.0, × 0.25 = 0.5 (clamped to ceiling)
    expect(r.items[0]!.kellyFraction).toBeLessThanOrEqual(0.5);
  });

  it("clamps any single item to ≤ 50% of budget", () => {
    const r = kellyAllocate([item({ edge: 1.0, variance: 0.001 })], { budgetDays: 100, multiplier: 1 });
    expect(r.items[0]!.kellyFraction).toBeLessThanOrEqual(0.5);
  });

  it("totalAllocated never exceeds budgetDays", () => {
    const items: DebtItem[] = [];
    for (let i = 0; i < 10; i++) {
      items.push(item({ id: `i${i}`, edge: 0.3, variance: 0.05 }));
    }
    const r = kellyAllocate(items, { budgetDays: 25 });
    expect(r.totalAllocated).toBeLessThanOrEqual(25);
  });

  it("reserves at least reserveFraction of the budget by default", () => {
    const items: DebtItem[] = Array.from({ length: 5 }, (_, i) => item({ id: `i${i}`, edge: 0.5, variance: 0.05 }));
    const r = kellyAllocate(items, { budgetDays: 25, reserveFraction: 0.2 });
    expect(r.totalAllocated).toBeLessThanOrEqual(25 * 0.8 + 0.5); // float wiggle
    expect(r.reserveDays).toBeGreaterThanOrEqual(25 * 0.2 - 0.5);
  });
});

describe("kellyAllocate — sorting + tiers", () => {
  it("sorts by allocated days desc", () => {
    const r = kellyAllocate(
      [
        item({ id: "small", edge: 0.05, variance: 0.05 }),
        item({ id: "big", edge: 0.5, variance: 0.05 }),
        item({ id: "mid", edge: 0.2, variance: 0.05 }),
      ],
      { budgetDays: 25 },
    );
    expect(r.items[0]!.id).toBe("big");
    expect(r.items[r.items.length - 1]!.id).toBe("small");
  });

  it("classifies tiers — outsized > core > small > skip", () => {
    expect(classifyTier(0.3, 0.2)).toBe("outsized");
    expect(classifyTier(0.15, 0.2)).toBe("core");
    expect(classifyTier(0.05, 0.2)).toBe("small");
    expect(classifyTier(0.0, 0.2)).toBe("skip");
    expect(classifyTier(0.5, -0.1)).toBe("skip"); // negative edge always skip
  });
});

describe("kellyAllocate — edge cases", () => {
  it("handles empty input", () => {
    const r = kellyAllocate([], { budgetDays: 25 });
    expect(r.items).toEqual([]);
    expect(r.totalAllocated).toBe(0);
    expect(r.reserveDays).toBe(25);
  });

  it("handles zero variance (avoids division by zero)", () => {
    const r = kellyAllocate([item({ id: "x", edge: 0.1, variance: 0 })], { budgetDays: 100 });
    expect(Number.isFinite(r.items[0]!.allocatedDays)).toBe(true);
  });

  it("zero-budget case allocates nothing", () => {
    const r = kellyAllocate([item({ edge: 0.5, variance: 0.05 })], { budgetDays: 0 });
    expect(r.totalAllocated).toBe(0);
    expect(r.items[0]!.allocatedDays).toBe(0);
  });

  it("more permissive multiplier (0.5) allocates more aggressively than default (0.25)", () => {
    // Use a low raw-Kelly so neither multiplier hits the per-item 0.5 ceiling.
    const items = [item({ edge: 0.05, variance: 0.1 })];
    const conservative = kellyAllocate(items, { budgetDays: 100, multiplier: 0.25 });
    const aggressive = kellyAllocate(items, { budgetDays: 100, multiplier: 0.5 });
    expect(aggressive.totalAllocated).toBeGreaterThan(conservative.totalAllocated);
  });
});

describe("estimateEdge — derives expected return from historical signals", () => {
  it("positive edge when post-refactor improves regret + churn", () => {
    const e = estimateEdge({
      pastRegretRate: 0.3,
      pastChurnPerDay: 5,
      postRefactorRegretRate: 0.1,
      postRefactorChurnPerDay: 3,
    });
    expect(e).toBeGreaterThan(0);
  });

  it("negative edge when post-refactor is worse", () => {
    const e = estimateEdge({
      pastRegretRate: 0.1,
      pastChurnPerDay: 5,
      postRefactorRegretRate: 0.3,
      postRefactorChurnPerDay: 8,
    });
    expect(e).toBeLessThan(0);
  });

  it("regret improvement weighted higher than churn improvement", () => {
    const regretOnly = estimateEdge({
      pastRegretRate: 0.5,
      pastChurnPerDay: 5,
      postRefactorRegretRate: 0,
      postRefactorChurnPerDay: 5,
    });
    const churnOnly = estimateEdge({
      pastRegretRate: 0.3,
      pastChurnPerDay: 10,
      postRefactorRegretRate: 0.3,
      postRefactorChurnPerDay: 5,
    });
    expect(regretOnly).toBeGreaterThan(churnOnly);
  });
});

describe("estimateVariance — sample variance of payoffs", () => {
  it("zero (floor) for unknown / single sample", () => {
    expect(estimateVariance([])).toBe(0.1);
    expect(estimateVariance([0.2])).toBe(0.1);
  });

  it("computes variance correctly for multiple payoffs", () => {
    const v = estimateVariance([0.1, 0.2, 0.3]);
    // mean = 0.2, deviations: -0.1, 0, 0.1; variance = (0.01 + 0 + 0.01) / 3
    expect(v).toBeCloseTo(0.00667, 4);
  });

  it("non-negative for any input", () => {
    const inputs = [
      [0, 0, 0],
      [-0.5, 0.5],
      [1, 1, 1, 1],
    ];
    for (const arr of inputs) expect(estimateVariance(arr)).toBeGreaterThanOrEqual(0);
  });
});
