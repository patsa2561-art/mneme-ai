/**
 * v2.19.51 P3 — DREAMSPACE context-shift trigger regression test.
 *
 * User reported (v2.19.49): `.mneme/organ_ticks/` shows breath ✓, hormonal ✓,
 * reflex ✓, sleep ✓ but DREAMSPACE ✗ (last touch > 60min ago).
 *
 * Root cause: daemon (packages/cli/src/commands/daemon.ts) only set
 * `hasGitEvent` + `idleMs` in EventSignals. It did NOT set
 * `hasCommitCycle` / `msSinceLastCommit` / `hasBranchSwitch`. The scheduler
 * checks these for DREAMSPACE + SLEEP context-shift triggers, so dreamspace
 * was permanently dormant for active devs (waiting for 6h dead-man).
 *
 * Fix: daemon now records lastCommitDetectedAtMs + lastBranchSwitchAtMs in
 * triggerReindex() + supplies them to scheduler events on every tick cycle.
 *
 * This file pins the SCHEDULER side: given the now-populated events,
 * dreamspace fires on commit cycle or no-commit gap.
 */

import { describe, it, expect } from "vitest";
import { decideTicks, freshHealthRecord, DEFAULT_SCHEDULES_ACTIVE_DEV } from "./index.js";

const baseHealth = () => [
  freshHealthRecord("breath"),
  freshHealthRecord("reflex"),
  freshHealthRecord("sleep"),
  freshHealthRecord("dreamspace"),
  freshHealthRecord("hormonal"),
];

describe("v2.19.51 P3 — DREAMSPACE context-shift trigger", () => {
  it("DREAMSPACE fires when hasCommitCycle=true (event_triggered)", () => {
    // Health: dreamspace just ticked, sleep just ticked (no interval-due).
    const health = baseHealth().map((h) =>
      h.organ === "dreamspace" || h.organ === "sleep"
        ? { ...h, lastTickMs: Date.now() - 1000 }
        : h,
    );
    const plan = decideTicks({
      health,
      events: { hasCommitCycle: true },
      nowMs: Date.now(),
    });
    const dream = plan.entries.find((e) => e.organ === "dreamspace");
    expect(dream).toBeDefined();
    expect(dream!.shouldTick).toBe(true);
    expect(dream!.reason).toBe("event_triggered");
    expect(dream!.details).toContain("commit cycle");
  });

  it("SLEEP fires when hasBranchSwitch=true (event_triggered)", () => {
    const health = baseHealth().map((h) =>
      h.organ === "dreamspace" || h.organ === "sleep"
        ? { ...h, lastTickMs: Date.now() - 1000 }
        : h,
    );
    const plan = decideTicks({
      health,
      events: { hasBranchSwitch: true },
      nowMs: Date.now(),
    });
    const sleep = plan.entries.find((e) => e.organ === "sleep");
    expect(sleep).toBeDefined();
    expect(sleep!.shouldTick).toBe(true);
    expect(sleep!.reason).toBe("event_triggered");
    expect(sleep!.details).toContain("branch switch");
  });

  it("DREAMSPACE fires after 60min no-commit gap (regardless of wall idle)", () => {
    const now = Date.now();
    const health = baseHealth().map((h) =>
      h.organ === "dreamspace"
        ? { ...h, lastTickMs: now - 65 * 60_000 } // last tick 65min ago — interval ok
        : h,
    );
    const plan = decideTicks({
      health,
      events: { msSinceLastCommit: 61 * 60_000 },
      nowMs: now,
    });
    const dream = plan.entries.find((e) => e.organ === "dreamspace");
    expect(dream).toBeDefined();
    expect(dream!.shouldTick).toBe(true);
    expect(dream!.reason).toBe("event_triggered");
    expect(dream!.details).toContain("no-commit");
  });

  it("DREAMSPACE does NOT fire when hasCommitCycle=undefined + no other signal (regression guard for the bug)", () => {
    const now = Date.now();
    const health = baseHealth().map((h) =>
      h.organ === "dreamspace"
        ? { ...h, lastTickMs: now - 30 * 60_000 } // 30min ago — interval NOT due (interval=60min)
        : h,
    );
    const plan = decideTicks({
      health,
      // The OLD daemon supplied ONLY these — the bug.
      events: { hasGitEvent: false, idleMs: 1000 },
      nowMs: now,
    });
    const dream = plan.entries.find((e) => e.organ === "dreamspace");
    expect(dream).toBeDefined();
    expect(dream!.shouldTick).toBe(false);
  });

  it("DEAD-MAN'S SWITCH still fires for dreamspace at 6h even without context-shift events", () => {
    const now = Date.now();
    const health = baseHealth().map((h) =>
      h.organ === "dreamspace"
        ? { ...h, lastTickMs: now - 7 * 60 * 60 * 1000 } // 7h ago — past dead-man
        : h,
    );
    const plan = decideTicks({
      health,
      events: {}, // empty — pure dead-man path
      nowMs: now,
    });
    const dream = plan.entries.find((e) => e.organ === "dreamspace");
    expect(dream).toBeDefined();
    expect(dream!.shouldTick).toBe(true);
    expect(dream!.reason).toBe("idle_threshold");
    expect(dream!.details).toContain("dead-man");
  });

  it("scheduler config invariants — dreamspace has fireOnContextShift + dead-man", () => {
    const ds = DEFAULT_SCHEDULES_ACTIVE_DEV.find((s) => s.organ === "dreamspace")!;
    expect(ds.fireOnContextShift).toBe(true);
    expect(ds.deadManMs).toBeGreaterThan(0);
  });
});
