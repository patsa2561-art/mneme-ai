import { describe, it, expect } from "vitest";
import { projectRoi, execGauntlet, type RoiInput } from "./index.js";

const BASE: RoiInput = { measuredTokensSaved: 50_000, measuredReductions: 100, teamSize: 10, reductionsPerDevPerMonth: 40, pricePer1kUSD: 0.003, months: 12 };

describe("v2.120 EXEC — ROI projection (skeleton)", () => {
  it("computes the measured per-reduction rate", () => {
    expect(projectRoi(BASE).avgTokensPerReduction).toBe(500); // 50000 / 100
  });
  it("projects reductions = team × per-dev × months", () => {
    expect(projectRoi(BASE).projectedReductions).toBe(10 * 40 * 12);
  });
  it("projects tokens = projected reductions × measured rate", () => {
    const r = projectRoi(BASE);
    expect(r.projectedTokensSaved).toBe(r.projectedReductions * r.avgTokensPerReduction);
  });
  it("USD = tokens/1000 × price (the dollar identity)", () => {
    const r = projectRoi(BASE);
    expect(r.projectedUsdSaved).toBeCloseTo((r.projectedTokensSaved / 1000) * BASE.pricePer1kUSD, 2);
  });
  it("realized USD reflects the measured saving", () => {
    expect(projectRoi(BASE).realizedUsdSaved).toBeCloseTo((50_000 / 1000) * 0.003, 2);
  });
  it("labels the basis honestly (no forecast claim)", () => {
    expect(projectRoi(BASE).basis).toMatch(/measured|your/i);
    expect(projectRoi(BASE).basis).not.toMatch(/guarantee|forecast of the business/i);
  });
});

describe("v2.120 EXEC — discrete-math properties", () => {
  it("zero team ⇒ zero projection", () => {
    expect(projectRoi({ ...BASE, teamSize: 0 }).projectedUsdSaved).toBe(0);
  });
  it("zero measured rate ⇒ zero projection (no realized reductions yet)", () => {
    const r = projectRoi({ ...BASE, measuredTokensSaved: 0, measuredReductions: 0 });
    expect(r.avgTokensPerReduction).toBe(0);
    expect(r.projectedTokensSaved).toBe(0);
  });
  it("monotonic in team size and price (5000-case sweep) via execGauntlet", () => {
    const g = execGauntlet();
    expect(g.monotonicInTeam).toBe(true);
    expect(g.monotonicInPrice).toBe(true);
    expect(g.cases).toBe(5000);
  });
  it("never negative; clamps negative/NaN inputs to 0", () => {
    const r = projectRoi({ measuredTokensSaved: -100, measuredReductions: NaN, teamSize: -5, reductionsPerDevPerMonth: -1, pricePer1kUSD: -0.01, months: -3 } as never);
    expect(r.projectedUsdSaved).toBe(0);
    expect(r.projectedTokensSaved).toBe(0);
    expect(r.avgTokensPerReduction).toBe(0);
  });
  it("is TOTAL — never throws on garbage", () => {
    expect(() => projectRoi(null as never)).not.toThrow();
    expect(() => projectRoi({} as never)).not.toThrow();
    expect(projectRoi(null as never).projectedUsdSaved).toBe(0);
  });
});

describe("v2.120 EXEC — execGauntlet() = 100", () => {
  it("all proofs hold", () => {
    const g = execGauntlet();
    expect(g.score).toBe(100);
    expect(g.zeroTeamZero).toBe(true);
    expect(g.zeroRateZero).toBe(true);
    expect(g.usdIdentityHolds).toBe(true);
    expect(g.realizedExact).toBe(true);
    expect(g.deterministic).toBe(true);
    expect(g.stable).toBe(true);
  });
});
