import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SupernovaSupervisor, factorialBackoffSeconds, readSupernovaLog } from "./supervisor.js";

describe("supernova supervisor", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-super-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("factorialBackoffSeconds", () => {
    it("returns 1!, 2!, 3!, 4!, 5! for attempts 1..5", () => {
      expect(factorialBackoffSeconds(1)).toBe(1);
      expect(factorialBackoffSeconds(2)).toBe(2);
      expect(factorialBackoffSeconds(3)).toBe(6);
      expect(factorialBackoffSeconds(4)).toBe(24);
      expect(factorialBackoffSeconds(5)).toBe(120);
    });
    it("caps at 5! for attempts above 5", () => {
      expect(factorialBackoffSeconds(6)).toBe(120);
      expect(factorialBackoffSeconds(100)).toBe(120);
    });
    it("returns 0 for attempt 0 or negative", () => {
      expect(factorialBackoffSeconds(0)).toBe(0);
      expect(factorialBackoffSeconds(-1)).toBe(0);
    });
  });

  describe("runCycle", () => {
    it("logs an 'ok' entry on successful cycle", async () => {
      const sup = new SupernovaSupervisor(repo);
      const result = await sup.runCycle("test-cycle", () => { /* succeed */ });
      expect(result).toBe("ok");
      const log = readSupernovaLog(repo);
      expect(log.length).toBe(1);
      expect(log[0]!.outcome).toBe("ok");
      expect(log[0]!.cycle).toBe("test-cycle");
    });

    it("logs a 'failed' entry on throw + sets cooldown", async () => {
      const sup = new SupernovaSupervisor(repo);
      const result = await sup.runCycle("flaky", () => { throw new Error("boom"); });
      expect(result).toBe("failed");
      const log = readSupernovaLog(repo);
      expect(log[0]!.outcome).toBe("failed");
      expect(log[0]!.attempt).toBe(1);
      expect(log[0]!.error).toContain("boom");
      expect(log[0]!.retryAt).toBeTruthy();
    });

    it("resets attempt counter on success after failure", async () => {
      const sup = new SupernovaSupervisor(repo);
      await sup.runCycle("recovers", () => { throw new Error("once"); });
      expect(sup.state.attempts["recovers"]).toBe(1);
      // Manually clear cooldown so the second call doesn't skip.
      sup.state.cooldownUntil["recovers"] = 0;
      await sup.runCycle("recovers", () => { /* succeed */ });
      expect(sup.state.attempts["recovers"]).toBe(0);
    });

    it("skips silently when cooldown is active", async () => {
      const sup = new SupernovaSupervisor(repo);
      await sup.runCycle("cooled-down", () => { throw new Error("e"); });
      // Immediately try again -- should skip.
      const r = await sup.runCycle("cooled-down", () => { throw new Error("should not run"); });
      expect(r).toBe("skipped");
    });

    it("escalates after 5 consecutive failures + invokes onEscalate callback", async () => {
      let escalatedWith: { cycle: string; error: string } | null = null;
      const sup = new SupernovaSupervisor(repo, async (cycle, error) => {
        escalatedWith = { cycle, error };
      });
      for (let i = 0; i < 5; i++) {
        sup.state.cooldownUntil["bad-cycle"] = 0;        // skip cooldown for the test
        await sup.runCycle("bad-cycle", () => { throw new Error(`fail-${i}`); });
      }
      expect(sup.state.escalated["bad-cycle"]).toBe(true);
      expect(escalatedWith).toBeTruthy();
      expect(escalatedWith!.cycle).toBe("bad-cycle");
      // After escalation, runCycle returns "escalated-quiet" without invoking fn.
      let invoked = false;
      const r = await sup.runCycle("bad-cycle", () => { invoked = true; });
      expect(r).toBe("escalated-quiet");
      expect(invoked).toBe(false);
      // Log contains the escalation entry.
      const log = readSupernovaLog(repo);
      expect(log.some((e) => e.outcome === "escalated" && e.cycle === "bad-cycle")).toBe(true);
    });

    it("clearEscalation resumes auto-retry", async () => {
      const sup = new SupernovaSupervisor(repo);
      sup.state.escalated["x"] = true;
      sup.state.attempts["x"] = 5;
      sup.clearEscalation("x");
      expect(sup.state.escalated["x"]).toBe(false);
      expect(sup.state.attempts["x"]).toBe(0);
      // Should now run again.
      const r = await sup.runCycle("x", () => { /* succeed */ });
      expect(r).toBe("ok");
    });

    it("snapshot returns per-cycle state for status displays", async () => {
      const sup = new SupernovaSupervisor(repo);
      await sup.runCycle("a", () => { /* succeed */ });
      await sup.runCycle("b", () => { throw new Error("e"); });
      const snap = sup.snapshot();
      const a = snap.cycles.find((c) => c.cycle === "a");
      const b = snap.cycles.find((c) => c.cycle === "b");
      expect(a!.attempts).toBe(0);
      expect(b!.attempts).toBe(1);
      expect(b!.escalated).toBe(false);
      expect(b!.cooldownRemainingSec).toBeGreaterThan(0);
    });
  });

  describe("supernova log persistence", () => {
    it("writes to .mneme/supernova.jsonl", async () => {
      const sup = new SupernovaSupervisor(repo);
      await sup.runCycle("persist", () => { /* */ });
      expect(existsSync(join(repo, ".mneme/supernova.jsonl"))).toBe(true);
    });
  });
});
