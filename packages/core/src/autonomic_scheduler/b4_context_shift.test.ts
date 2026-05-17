/**
 * v2.19.33 B4 REGRESSION — SLEEP + DREAMSPACE must tick for active devs.
 *
 * Pre-v2.19.33: required wall-clock idle 30/60min. Active dev = NEVER tick.
 * Post-v2.19.33: fires on branch switch / commit cycle / 30+min no-commit gap.
 *
 * A/B comparison: same simulated 8-hour active-dev workday, two schedules.
 *   LEGACY (pre-fix):     sleep ticks 0, dreamspace ticks 0
 *   ACTIVE_DEV (post-fix): sleep ticks ≥3, dreamspace ticks ≥3
 */

import { describe, it, expect } from "vitest";
import {
  decideTicks,
  freshHealthRecord,
  DEFAULT_SCHEDULES,
  DEFAULT_SCHEDULES_LEGACY,
  DEFAULT_SCHEDULES_ACTIVE_DEV,
  type OrganHealthRecord,
  type EventSignals,
} from "./index.js";

const SECRET = "b4-test-secret";

describe("v2.19.33 B4 REGRESSION — SLEEP + DREAMSPACE tick on context shifts", () => {
  it("SLEEP fires on branch switch (no wall-clock idle needed)", () => {
    const health: OrganHealthRecord[] = [{ ...freshHealthRecord("sleep"), lastTickMs: 100 }];
    const plan = decideTicks({
      health,
      events: { hasBranchSwitch: true, idleMs: 0 } as EventSignals,
      nowMs: 100 + 1000,
      secret: SECRET,
    });
    const sleep = plan.entries.find((e) => e.organ === "sleep");
    expect(sleep?.shouldTick).toBe(true);
    expect(sleep?.details).toContain("branch switch");
  });

  it("DREAMSPACE fires on commit cycle (no wall-clock idle needed)", () => {
    const health: OrganHealthRecord[] = [{ ...freshHealthRecord("dreamspace"), lastTickMs: 100 }];
    const plan = decideTicks({
      health,
      events: { hasCommitCycle: true, idleMs: 0 } as EventSignals,
      nowMs: 100 + 1000,
      secret: SECRET,
    });
    const ds = plan.entries.find((e) => e.organ === "dreamspace");
    expect(ds?.shouldTick).toBe(true);
    expect(ds?.details).toContain("commit cycle");
  });

  it("SLEEP fires on 30+min no-commit gap (active-dev fallback)", () => {
    const health: OrganHealthRecord[] = [{ ...freshHealthRecord("sleep"), lastTickMs: 0 }];
    const plan = decideTicks({
      health,
      events: { msSinceLastCommit: 31 * 60_000, idleMs: 0 } as EventSignals,
      nowMs: 100_000,
      secret: SECRET,
    });
    const sleep = plan.entries.find((e) => e.organ === "sleep");
    expect(sleep?.shouldTick).toBe(true);
    expect(sleep?.details).toContain("no-commit");
  });

  it("DREAMSPACE fires on 60+min no-commit gap", () => {
    const health: OrganHealthRecord[] = [{ ...freshHealthRecord("dreamspace"), lastTickMs: 0 }];
    const plan = decideTicks({
      health,
      events: { msSinceLastCommit: 61 * 60_000, idleMs: 0 } as EventSignals,
      nowMs: 100_000,
      secret: SECRET,
    });
    const ds = plan.entries.find((e) => e.organ === "dreamspace");
    expect(ds?.shouldTick).toBe(true);
    expect(ds?.details).toContain("no-commit");
  });

  it("DREAMSPACE does NOT fire on 10min no-commit (below threshold)", () => {
    const health: OrganHealthRecord[] = [{ ...freshHealthRecord("dreamspace"), lastTickMs: 100 }];
    const plan = decideTicks({
      health,
      events: { msSinceLastCommit: 10 * 60_000, idleMs: 0 } as EventSignals,
      nowMs: 100 + 5 * 60_000,
      secret: SECRET,
    });
    const ds = plan.entries.find((e) => e.organ === "dreamspace");
    expect(ds?.shouldTick).toBe(false);
  });
});

describe("v2.19.33 B4 — manual force (mneme sleep --force)", () => {
  it("forceOrgans: ['sleep'] fires sleep regardless of interval/idle", () => {
    const health: OrganHealthRecord[] = [{ ...freshHealthRecord("sleep"), lastTickMs: Date.now() }];
    const plan = decideTicks({
      health,
      events: { forceOrgans: ["sleep"], idleMs: 0 } as EventSignals,
      nowMs: Date.now() + 1000,
      secret: SECRET,
    });
    const sleep = plan.entries.find((e) => e.organ === "sleep");
    expect(sleep?.shouldTick).toBe(true);
    expect(sleep?.reason).toBe("manual");
  });

  it("force does NOT bypass circuit-breaker cooldown", () => {
    const now = Date.now();
    const health: OrganHealthRecord[] = [{
      ...freshHealthRecord("sleep"),
      lastTickMs: now,
      cooldownUntilMs: now + 60 * 60_000,
    }];
    const plan = decideTicks({
      health,
      events: { forceOrgans: ["sleep"] } as EventSignals,
      nowMs: now + 1000,
      secret: SECRET,
    });
    const sleep = plan.entries.find((e) => e.organ === "sleep");
    expect(sleep?.shouldTick).toBe(false);
    expect(sleep?.reason).toBe("circuit_open");
  });

  it("forceOrgans: ['dreamspace'] only fires dreamspace, not sleep", () => {
    const health: OrganHealthRecord[] = [
      { ...freshHealthRecord("sleep"), lastTickMs: 100 },
      { ...freshHealthRecord("dreamspace"), lastTickMs: 100 },
    ];
    const plan = decideTicks({
      health,
      events: { forceOrgans: ["dreamspace"], idleMs: 0 } as EventSignals,
      nowMs: 100 + 1000,
      secret: SECRET,
    });
    const sleep = plan.entries.find((e) => e.organ === "sleep");
    const ds = plan.entries.find((e) => e.organ === "dreamspace");
    expect(ds?.shouldTick).toBe(true);
    expect(sleep?.shouldTick).toBe(false);
  });
});

describe("v2.19.33 B4 A/B — 8-hour active dev workday simulation", () => {
  // Simulate an 8hr active-dev session: 16 commits over 8 hours, 3 branch
  // switches, NEVER 30min idle. Count ticks under LEGACY vs ACTIVE_DEV.
  function simulateWorkday(schedules: typeof DEFAULT_SCHEDULES_LEGACY): { sleep: number; dreamspace: number } {
    let health: OrganHealthRecord[] = [
      freshHealthRecord("breath"),
      freshHealthRecord("reflex"),
      freshHealthRecord("sleep"),
      freshHealthRecord("dreamspace"),
      freshHealthRecord("hormonal"),
    ];
    let sleepTicks = 0, dreamTicks = 0;
    const startMs = 1_700_000_000_000;
    // Tick every 30s (daemon cadence)
    const tickEveryMs = 30_000;
    const totalMs = 8 * 60 * 60_000; // 8 hours
    let lastCommitMs = startMs;
    let lastBranchSwitchMs = startMs;
    const branchSwitchTimes = [startMs + 2 * 60 * 60_000, startMs + 4 * 60 * 60_000, startMs + 6 * 60 * 60_000];
    // 16 commits spread evenly
    const commitTimes = Array.from({ length: 16 }, (_, i) => startMs + (i + 1) * (totalMs / 17));

    for (let t = startMs; t < startMs + totalMs; t += tickEveryMs) {
      // Determine signals for this tick window
      const recentCommit = commitTimes.some((ct) => ct > t - tickEveryMs && ct <= t);
      if (recentCommit) lastCommitMs = t;
      const recentBranchSwitch = branchSwitchTimes.some((bt) => bt > t - tickEveryMs && bt <= t);
      if (recentBranchSwitch) lastBranchSwitchMs = t;
      const events: EventSignals = {
        hasGitEvent: recentCommit,
        hasCommitCycle: recentCommit,
        hasBranchSwitch: recentBranchSwitch,
        msSinceLastCommit: t - lastCommitMs,
        idleMs: 0, // active dev — NEVER idle
      };
      const plan = decideTicks({ schedules, health, events, nowMs: t, secret: SECRET });
      for (const entry of plan.entries) {
        if (!entry.shouldTick) continue;
        const h = health.find((x) => x.organ === entry.organ);
        if (!h) continue;
        h.lastTickMs = t;
        h.totalTicks++;
        if (entry.organ === "sleep") sleepTicks++;
        if (entry.organ === "dreamspace") dreamTicks++;
      }
    }
    return { sleep: sleepTicks, dreamspace: dreamTicks };
  }

  it("A: LEGACY schedules (pre-v2.19.33) — SLEEP + DREAMSPACE tick 0 in 8hr workday", () => {
    const r = simulateWorkday(DEFAULT_SCHEDULES_LEGACY);
    expect(r.sleep).toBe(0);
    expect(r.dreamspace).toBe(0);
  });

  it("B: ACTIVE_DEV schedules (post-v2.19.33) — SLEEP ticks ≥3, DREAMSPACE ticks ≥3", () => {
    const r = simulateWorkday(DEFAULT_SCHEDULES_ACTIVE_DEV);
    expect(r.sleep).toBeGreaterThanOrEqual(3);
    expect(r.dreamspace).toBeGreaterThanOrEqual(3);
  });

  it("A/B DELTA: post-fix produces measurably more ticks (≥6 total vs 0)", () => {
    const a = simulateWorkday(DEFAULT_SCHEDULES_LEGACY);
    const b = simulateWorkday(DEFAULT_SCHEDULES_ACTIVE_DEV);
    const aTotal = a.sleep + a.dreamspace;
    const bTotal = b.sleep + b.dreamspace;
    expect(bTotal - aTotal).toBeGreaterThanOrEqual(6);
  });
});

describe("v2.19.33 B4 — DEFAULT_SCHEDULES is now ACTIVE_DEV variant", () => {
  it("DEFAULT_SCHEDULES === DEFAULT_SCHEDULES_ACTIVE_DEV (v2.19.33 default)", () => {
    expect(DEFAULT_SCHEDULES).toBe(DEFAULT_SCHEDULES_ACTIVE_DEV);
  });

  it("legacy schedules still exported for backward compat", () => {
    expect(DEFAULT_SCHEDULES_LEGACY.length).toBe(DEFAULT_SCHEDULES_ACTIVE_DEV.length);
  });

  it("sleep + dreamspace in ACTIVE_DEV have fireOnContextShift=true", () => {
    const sleep = DEFAULT_SCHEDULES_ACTIVE_DEV.find((s) => s.organ === "sleep");
    const ds = DEFAULT_SCHEDULES_ACTIVE_DEV.find((s) => s.organ === "dreamspace");
    expect(sleep?.fireOnContextShift).toBe(true);
    expect(ds?.fireOnContextShift).toBe(true);
  });

  it("breath + reflex + hormonal in ACTIVE_DEV have fireOnContextShift=false", () => {
    for (const organ of ["breath", "reflex", "hormonal"] as const) {
      const s = DEFAULT_SCHEDULES_ACTIVE_DEV.find((x) => x.organ === organ);
      expect(s?.fireOnContextShift).toBe(false);
    }
  });
});
