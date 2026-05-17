/**
 * v2.19.35 R3 REGRESSION — DEAD-MAN'S SWITCH
 *
 * Guarantees "perfect schedule that never fires" cannot happen.
 * If an organ hasn't ticked in deadManMs (default 6h for sleep/dreamspace),
 * the NEXT decideTicks fires it regardless of interval/idle/event gates.
 */
import { describe, it, expect } from "vitest";
import {
  decideTicks, freshHealthRecord, DEFAULT_SCHEDULES_ACTIVE_DEV,
  type OrganHealthRecord, type EventSignals,
} from "./index.js";

const SECRET = "r3-dead-man-test";

describe("v2.19.35 R3 — DEAD-MAN'S SWITCH for SLEEP + DREAMSPACE", () => {
  it("SLEEP fires after 6+ hours with NO context shift + NO idle", () => {
    const now = 1_700_000_000_000;
    const h: OrganHealthRecord[] = [{ ...freshHealthRecord("sleep"), lastTickMs: now - 7 * 60 * 60_000 }];
    const plan = decideTicks({
      schedules: DEFAULT_SCHEDULES_ACTIVE_DEV,
      health: h,
      events: { idleMs: 0 } as EventSignals,
      nowMs: now,
      secret: SECRET,
    });
    const sleep = plan.entries.find((e) => e.organ === "sleep");
    expect(sleep?.shouldTick).toBe(true);
    expect(sleep?.details).toContain("dead-man");
  });

  it("DREAMSPACE fires after 6+ hours with NO context shift + NO idle", () => {
    const now = 1_700_000_000_000;
    const h: OrganHealthRecord[] = [{ ...freshHealthRecord("dreamspace"), lastTickMs: now - 7 * 60 * 60_000 }];
    const plan = decideTicks({
      schedules: DEFAULT_SCHEDULES_ACTIVE_DEV,
      health: h,
      events: { idleMs: 0 } as EventSignals,
      nowMs: now,
      secret: SECRET,
    });
    const ds = plan.entries.find((e) => e.organ === "dreamspace");
    expect(ds?.shouldTick).toBe(true);
    expect(ds?.details).toContain("dead-man");
  });

  it("DEAD-MAN does NOT fire if last tick was < 6h ago", () => {
    const now = 1_700_000_000_000;
    const h: OrganHealthRecord[] = [{ ...freshHealthRecord("sleep"), lastTickMs: now - 60 * 60_000 }]; // 1h ago
    const plan = decideTicks({
      schedules: DEFAULT_SCHEDULES_ACTIVE_DEV,
      health: h,
      events: { idleMs: 0 } as EventSignals,
      nowMs: now,
      secret: SECRET,
    });
    const sleep = plan.entries.find((e) => e.organ === "sleep");
    // Should fall through to interval check; with no idle + no context shift = no tick
    expect(sleep?.shouldTick).toBe(false);
    expect(sleep?.details).not.toContain("dead-man");
  });

  it("DEAD-MAN does NOT fire for organs with deadManMs=0 (BREATH/REFLEX/HORMONAL)", () => {
    const now = 1_700_000_000_000;
    const h: OrganHealthRecord[] = [
      { ...freshHealthRecord("breath"), lastTickMs: now - 24 * 60 * 60_000 }, // 24h ago
    ];
    const plan = decideTicks({
      schedules: DEFAULT_SCHEDULES_ACTIVE_DEV,
      health: h,
      events: { idleMs: 0 } as EventSignals,
      nowMs: now,
      secret: SECRET,
    });
    const breath = plan.entries.find((e) => e.organ === "breath");
    expect(breath?.details).not.toContain("dead-man");
    // breath ticks every 60s so will fire via interval; we only assert dead-man wasn't the reason
  });

  it("DEAD-MAN does NOT bypass cooldown circuit-breaker", () => {
    const now = 1_700_000_000_000;
    const h: OrganHealthRecord[] = [{
      ...freshHealthRecord("sleep"),
      lastTickMs: now - 7 * 60 * 60_000, // 7h ago (deadman would fire)
      cooldownUntilMs: now + 60 * 60_000, // but in cooldown
    }];
    const plan = decideTicks({
      schedules: DEFAULT_SCHEDULES_ACTIVE_DEV,
      health: h,
      events: {} as EventSignals,
      nowMs: now,
      secret: SECRET,
    });
    const sleep = plan.entries.find((e) => e.organ === "sleep");
    expect(sleep?.shouldTick).toBe(false);
    expect(sleep?.reason).toBe("circuit_open");
  });

  it("DEAD-MAN does NOT fire on lastTickMs===0 (first-tick semantics handle that)", () => {
    const now = 1_700_000_000_000;
    const h: OrganHealthRecord[] = [{ ...freshHealthRecord("sleep"), lastTickMs: 0 }];
    const plan = decideTicks({
      schedules: DEFAULT_SCHEDULES_ACTIVE_DEV,
      health: h,
      events: { idleMs: 0 } as EventSignals,
      nowMs: now,
      secret: SECRET,
    });
    const sleep = plan.entries.find((e) => e.organ === "sleep");
    // Dead-man SKIPS when lastTickMs===0 (first-tick path owns that case).
    // For sleep with requireIdleMs=30min and idleMs=0, first-tick won't fire either,
    // BUT we only assert the dead-man branch wasn't taken (the invariant we care about).
    expect(sleep?.details).not.toContain("dead-man");
  });

  it("DEAD-MAN scenario: 24hr daemon-alive with NO activity → both sleep + dreamspace fire", () => {
    const now = 1_700_000_000_000;
    const h: OrganHealthRecord[] = [
      { ...freshHealthRecord("sleep"), lastTickMs: now - 24 * 60 * 60_000 },
      { ...freshHealthRecord("dreamspace"), lastTickMs: now - 24 * 60 * 60_000 },
    ];
    const plan = decideTicks({
      schedules: DEFAULT_SCHEDULES_ACTIVE_DEV,
      health: h,
      events: { idleMs: 0 } as EventSignals,
      nowMs: now,
      secret: SECRET,
    });
    const sleep = plan.entries.find((e) => e.organ === "sleep");
    const ds = plan.entries.find((e) => e.organ === "dreamspace");
    expect(sleep?.shouldTick).toBe(true);
    expect(ds?.shouldTick).toBe(true);
    expect(sleep?.details).toContain("dead-man");
    expect(ds?.details).toContain("dead-man");
  });
});
