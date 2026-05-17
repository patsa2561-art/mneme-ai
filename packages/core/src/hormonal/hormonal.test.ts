import { describe, it, expect } from "vitest";
import {
  neutralState,
  updateHormones,
  tuneFromHormones,
  emptyLedger,
  recordHormonal,
  verifyLedger,
  formatHormonalLine,
  type HormonalState,
  type HormonalLedger,
} from "./index.js";

const SECRET = "hormonal-test-secret-997744";

describe("v2.19.23 HORMONAL · neutralState + invariants", () => {
  it("neutralState: focus 0.5, fatigue 0.0, mood 0.5", () => {
    const s = neutralState(0);
    expect(s.focus).toBe(0.5);
    expect(s.fatigue).toBe(0.0);
    expect(s.mood).toBe(0.5);
  });
});

describe("v2.19.23 HORMONAL · updateHormones", () => {
  it("toolError raises fatigue", () => {
    const s = updateHormones({ state: neutralState(0), observation: { toolError: true, elapsedMs: 0 } });
    expect(s.fatigue).toBeGreaterThan(0);
  });

  it("cacheHit=true raises mood", () => {
    const s = updateHormones({ state: neutralState(0), observation: { cacheHit: true, elapsedMs: 0 } });
    expect(s.mood).toBeGreaterThan(0.5);
  });

  it("rapidAction raises focus", () => {
    const s = updateHormones({ state: neutralState(0), observation: { rapidAction: true, elapsedMs: 0 } });
    expect(s.focus).toBeGreaterThan(0.5);
  });

  it("successfulCommit raises mood", () => {
    const s = updateHormones({ state: neutralState(0), observation: { successfulCommit: true, elapsedMs: 0 } });
    expect(s.mood).toBeGreaterThan(0.5);
  });

  it("all signals clamped to [0,1]", () => {
    let s = neutralState(0);
    for (let i = 0; i < 1000; i++) {
      s = updateHormones({ state: s, observation: { toolError: true, cacheHit: true, rapidAction: true, elapsedMs: 0 } });
    }
    expect(s.focus).toBeLessThanOrEqual(1);
    expect(s.focus).toBeGreaterThanOrEqual(0);
    expect(s.fatigue).toBeLessThanOrEqual(1);
    expect(s.mood).toBeLessThanOrEqual(1);
  });

  it("natural decay toward baselines (fatigue -> 0, focus/mood -> 0.5)", () => {
    let s: HormonalState = { v: 1, focus: 0.9, fatigue: 0.9, mood: 0.9, ts: 0 };
    s = updateHormones({ state: s, observation: { elapsedMs: 60 * 60_000 } }); // 1 hour
    // After natural decay only (no observation deltas)
    expect(s.fatigue).toBeLessThan(0.9);
    expect(Math.abs(s.focus - 0.5)).toBeLessThan(Math.abs(0.9 - 0.5));
    expect(Math.abs(s.mood - 0.5)).toBeLessThan(Math.abs(0.9 - 0.5));
  });
});

describe("v2.19.23 HORMONAL · tuneFromHormones (cross-organ adjustment)", () => {
  it("neutral state -> midrange config", () => {
    const c = tuneFromHormones(neutralState(0));
    expect(c.breathHeartbeatMs).toBe(50);
    expect(c.reflexPrefetchBudgetMs).toBe(150);
    expect(c.dreamIdleThresholdMs).toBe(30 * 60_000 - 0.5 * 20 * 60_000); // 30 - 10 = 20min
    expect(c.negevTaxMultiplier).toBe(1.0);
  });

  it("high fatigue -> longer breath + stricter negev", () => {
    const c = tuneFromHormones({ v: 1, focus: 0.5, fatigue: 1.0, mood: 0.5, ts: 0 });
    expect(c.breathHeartbeatMs).toBe(200);
    expect(c.negevTaxMultiplier).toBe(1.5);
  });

  it("high focus -> shorter prefetch (don't interrupt deep work)", () => {
    const c = tuneFromHormones({ v: 1, focus: 1.0, fatigue: 0.0, mood: 0.5, ts: 0 });
    expect(c.reflexPrefetchBudgetMs).toBe(100);
  });

  it("high mood -> shorter dream threshold (work harder)", () => {
    const c = tuneFromHormones({ v: 1, focus: 0.5, fatigue: 0.0, mood: 1.0, ts: 0 });
    expect(c.dreamIdleThresholdMs).toBe(10 * 60_000);
  });

  it("MEASURED 100% determinism: same state -> same config (50 trials)", () => {
    const state: HormonalState = { v: 1, focus: 0.7, fatigue: 0.3, mood: 0.6, ts: 0 };
    const first = JSON.stringify(tuneFromHormones(state));
    let allEqual = true;
    for (let i = 0; i < 50; i++) {
      if (JSON.stringify(tuneFromHormones(state)) !== first) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.23 HORMONAL · ledger (HMAC chain)", () => {
  it("recordHormonal chains; verify passes untampered", () => {
    let L: HormonalLedger = emptyLedger();
    let s = neutralState(0);
    L = recordHormonal({ ledger: L, state: s, observation: { elapsedMs: 0, toolError: true }, secret: SECRET });
    s = updateHormones({ state: s, observation: { elapsedMs: 0, toolError: true } });
    L = recordHormonal({ ledger: L, state: s, observation: { elapsedMs: 0, cacheHit: true }, secret: SECRET });
    expect(L.records).toHaveLength(2);
    expect(L.records[1]!.prevSig).toBe(L.records[0]!.sig);
    expect(verifyLedger(L, SECRET).ok).toBe(true);
  });

  it("verifyLedger detects tamper at exact step", () => {
    let L: HormonalLedger = emptyLedger();
    let s = neutralState(0);
    for (let i = 0; i < 4; i++) {
      L = recordHormonal({ ledger: L, state: s, observation: { elapsedMs: 0 }, secret: SECRET });
    }
    const tampered: HormonalLedger = {
      ...L,
      records: L.records.map((r, i) => (i === 2 ? { ...r, state: { ...r.state, fatigue: 0.99 } } : r)),
    };
    const v = verifyLedger(tampered, SECRET);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(2);
  });
});

describe("v2.19.23 HORMONAL · formatter", () => {
  it("formatHormonalLine includes all 3 signals", () => {
    const line = formatHormonalLine(neutralState(0));
    expect(line).toContain("focus");
    expect(line).toContain("fatigue");
    expect(line).toContain("mood");
  });
});
