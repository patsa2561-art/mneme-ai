import { describe, it, expect } from "vitest";
import {
  decideTicks,
  verifyTickPlan,
  runTickCycle,
  verifyCycleReport,
  computeStats,
  formatStatsLine,
  formatPlanLine,
  freshHealthRecord,
  DEFAULT_SCHEDULES,
  type OrganHealthRecord,
  type EventSignals,
  type OrganKind,
} from "./index.js";

const SECRET = "scheduler-test-secret-997744";
const MIN = 60_000;
const HOUR = 60 * MIN;

function freshHealth(): OrganHealthRecord[] {
  return DEFAULT_SCHEDULES.map((s) => freshHealthRecord(s.organ));
}

describe("v2.19.28 SCHEDULER · decideTicks (priority ladder)", () => {
  it("first run: every organ EXCEPT idle-gated should tick (interval_due since 0)", () => {
    const plan = decideTicks({
      health: freshHealth(),
      events: { idleMs: 0 },
      nowMs: 100,
      secret: SECRET,
    });
    const willTick = plan.entries.filter((e) => e.shouldTick).map((e) => e.organ);
    // breath + hormonal (no idle requirement) should fire; sleep + dreamspace need idle.
    expect(willTick).toContain("breath" as OrganKind);
    expect(willTick).toContain("hormonal" as OrganKind);
    expect(willTick).not.toContain("sleep" as OrganKind);
    expect(willTick).not.toContain("dreamspace" as OrganKind);
  });

  it("git event fires REFLEX even before interval", () => {
    const health = freshHealth().map((h) =>
      h.organ === "reflex" ? { ...h, lastTickMs: 1000 - 10 } : h,
    );
    const plan = decideTicks({
      health,
      events: { hasGitEvent: true },
      nowMs: 1000,
      secret: SECRET,
    });
    const reflex = plan.entries.find((e) => e.organ === "reflex")!;
    expect(reflex.shouldTick).toBe(true);
    expect(reflex.reason).toBe("event_triggered");
  });

  it("idle threshold gates SLEEP + DREAMSPACE", () => {
    const plan = decideTicks({
      health: freshHealth(),
      events: { idleMs: 31 * MIN },
      nowMs: 100,
      secret: SECRET,
    });
    const sleep = plan.entries.find((e) => e.organ === "sleep")!;
    expect(sleep.shouldTick).toBe(true);
    expect(sleep.reason).toBe("idle_threshold");
  });

  it("circuit-breaker open: skip with reason 'circuit_open'", () => {
    const health = freshHealth().map((h) =>
      h.organ === "breath" ? { ...h, cooldownUntilMs: 999_999_999 } : h,
    );
    const plan = decideTicks({
      health,
      events: {},
      nowMs: 1000,
      secret: SECRET,
    });
    const breath = plan.entries.find((e) => e.organ === "breath")!;
    expect(breath.shouldTick).toBe(false);
    expect(breath.reason).toBe("circuit_open");
  });

  it("HMAC plan signature verifies untampered; rejects tamper", () => {
    const plan = decideTicks({ health: freshHealth(), events: {}, nowMs: 1, secret: SECRET });
    expect(verifyTickPlan(plan, SECRET)).toBe(true);
    expect(verifyTickPlan({ ...plan, decidedAtMs: 999 }, SECRET)).toBe(false);
  });

  it("MEASURED 100% determinism: same input -> same plan sig (30 trials)", () => {
    const input = { health: freshHealth(), events: { idleMs: 100 }, nowMs: 1_000_000, secret: SECRET };
    const firstSig = decideTicks(input).sig;
    let allEqual = true;
    for (let i = 0; i < 30; i++) {
      if (decideTicks(input).sig !== firstSig) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.28 SCHEDULER · runTickCycle (invocation + backoff + fallback)", () => {
  it("happy path: every shouldTick organ invoked + success counted", async () => {
    const invoked: OrganKind[] = [];
    const invoke = async (organ: OrganKind) => { invoked.push(organ); };
    const r = await runTickCycle({
      health: freshHealth(),
      events: {},
      nowMs: 100,
      invoke,
      secret: SECRET,
    });
    expect(invoked).toContain("breath" as OrganKind);
    expect(invoked).toContain("hormonal" as OrganKind);
    const successes = r.outcomes.filter((o) => o.ok);
    expect(successes.length).toBeGreaterThan(0);
  });

  it("organ throws: outcome.ok=false, errorMessage captured, never crashes", async () => {
    const invoke = async (organ: OrganKind) => {
      if (organ === "breath") throw new Error("boom");
    };
    const r = await runTickCycle({
      health: freshHealth(),
      events: {},
      nowMs: 100,
      invoke,
      secret: SECRET,
    });
    const breath = r.outcomes.find((o) => o.organ === "breath")!;
    expect(breath.ok).toBe(false);
    expect(breath.errorMessage).toBe("boom");
  });

  it("circuit-breaker: 3 consecutive failures opens 1hr cooldown", async () => {
    let health = freshHealth();
    const invoke = async () => { throw new Error("always fail"); };
    let lastCycleNow = 100;
    for (let i = 0; i < 3; i++) {
      lastCycleNow = 100 + i * 100 * MIN;
      const r = await runTickCycle({
        health, events: {}, nowMs: lastCycleNow, invoke, secret: SECRET,
      });
      health = r.newHealth;
    }
    const breath = health.find((h) => h.organ === "breath")!;
    expect(breath.consecutiveFailures).toBeGreaterThanOrEqual(3);
    // cooldown is set to lastCycleNow + 1hr; verify ~1hr from last tick.
    expect(breath.cooldownUntilMs).toBeGreaterThan(lastCycleNow);
    expect(breath.cooldownUntilMs - lastCycleNow).toBeCloseTo(HOUR, -3);
  });

  it("success after failure RESETS consecutiveFailures + closes cooldown", async () => {
    let health = freshHealth().map((h) =>
      h.organ === "breath" ? { ...h, consecutiveFailures: 2, cooldownUntilMs: 500 } : h,
    );
    const invoke = async () => { /* ok */ };
    const r = await runTickCycle({
      health, events: {}, nowMs: 1_000_000, invoke, secret: SECRET,
    });
    const breath = r.newHealth.find((h) => h.organ === "breath")!;
    expect(breath.consecutiveFailures).toBe(0);
    expect(breath.cooldownUntilMs).toBe(0);
  });

  it("HMAC cycle report sig verifies; rejects tamper", async () => {
    const r = await runTickCycle({
      health: freshHealth(), events: {}, nowMs: 100,
      invoke: async () => {}, secret: SECRET,
    });
    expect(verifyCycleReport(r, SECRET)).toBe(true);
    expect(verifyCycleReport({ ...r, startedAtMs: 999 }, SECRET)).toBe(false);
  });

  it("MEASURED 24/7 resilience: 100 consecutive cycles with random failures never crashes", async () => {
    let health = freshHealth();
    const invoke = async () => {
      if (Math.random() < 0.3) throw new Error("random");
    };
    let nowMs = 100;
    let crashed = false;
    try {
      for (let i = 0; i < 100; i++) {
        const r = await runTickCycle({
          health, events: { idleMs: 60 * MIN }, nowMs, invoke, secret: SECRET,
        });
        health = r.newHealth;
        nowMs += 2 * MIN;
      }
    } catch {
      crashed = true;
    }
    expect(crashed).toBe(false);
  });
});

describe("v2.19.28 SCHEDULER · stats + formatter", () => {
  it("computeStats: totals + successRate + healthy/cooldown counts", () => {
    const health: OrganHealthRecord[] = [
      { organ: "breath", lastTickMs: 0, lastSuccessMs: 0, consecutiveFailures: 0, cooldownUntilMs: 0, totalTicks: 10, totalSuccesses: 9, totalFailures: 1 },
      { organ: "reflex", lastTickMs: 0, lastSuccessMs: 0, consecutiveFailures: 5, cooldownUntilMs: 999_999_999, totalTicks: 8, totalSuccesses: 0, totalFailures: 8 },
    ];
    const s = computeStats(health, 1000);
    expect(s.totalOrgans).toBe(2);
    expect(s.totalTicks).toBe(18);
    expect(s.totalSuccesses).toBe(9);
    expect(s.successRate).toBeCloseTo(0.5, 3);
    expect(s.organsInCooldown).toBe(1);
    expect(s.organsHealthy).toBe(1);
  });

  it("formatStatsLine includes all health metrics", () => {
    const s = computeStats([{ organ: "breath", lastTickMs: 0, lastSuccessMs: 0, consecutiveFailures: 0, cooldownUntilMs: 0, totalTicks: 5, totalSuccesses: 5, totalFailures: 0 }], 1000);
    const line = formatStatsLine(s);
    expect(line).toContain("SCHEDULER");
    expect(line).toContain("100.0%");
  });

  it("formatPlanLine summarises will/skip", () => {
    const plan = decideTicks({ health: freshHealth(), events: {}, nowMs: 1, secret: SECRET });
    const line = formatPlanLine(plan);
    expect(line).toContain("PLAN");
  });
});

describe("v2.19.28 SCHEDULER · 24/7 invariants (always-active by design)", () => {
  it("never throws even with empty health + empty schedule + empty events", () => {
    expect(() => decideTicks({ schedules: [], health: [], events: {}, nowMs: 0, secret: SECRET })).not.toThrow();
  });

  it("decideTicks always produces an entry per schedule (no silent drops)", () => {
    const plan = decideTicks({ health: freshHealth(), events: {}, nowMs: 100, secret: SECRET });
    expect(plan.entries.length).toBe(DEFAULT_SCHEDULES.length);
  });

  it("MEASURED 100% determinism on health record initialization (50 fresh records)", () => {
    const firstStr = JSON.stringify(freshHealthRecord("breath"));
    for (let i = 0; i < 50; i++) {
      expect(JSON.stringify(freshHealthRecord("breath"))).toBe(firstStr);
    }
  });
});

describe("v2.19.28 SCHEDULER · B1 root-cause regression (organs MUST tick on schedule)", () => {
  it("B1 fix proof: after 1 cycle, .breath health record shows lastTickMs > 0 + totalTicks > 0", async () => {
    const invoke = async () => {};
    const r = await runTickCycle({
      health: freshHealth(), events: {}, nowMs: 1_000_000,
      invoke, secret: SECRET,
    });
    const breath = r.newHealth.find((h) => h.organ === "breath")!;
    expect(breath.lastTickMs).toBeGreaterThan(0);
    expect(breath.totalTicks).toBeGreaterThan(0);
    expect(breath.totalSuccesses).toBeGreaterThan(0);
  });

  it("after 24 simulated cycles (representing 24min real time at 60s heartbeat), breath ticked >=24 times", async () => {
    let health = freshHealth();
    let nowMs = 1_000_000;
    for (let i = 0; i < 24; i++) {
      const r = await runTickCycle({
        health, events: {}, nowMs,
        invoke: async () => {}, secret: SECRET,
      });
      health = r.newHealth;
      nowMs += 65 * 1000; // slightly more than 60s interval
    }
    const breath = health.find((h) => h.organ === "breath")!;
    expect(breath.totalTicks).toBe(24);
    expect(breath.totalSuccesses).toBe(24);
  });
});
