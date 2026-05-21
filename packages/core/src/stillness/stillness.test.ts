import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getBudget, setBudget, consumeBudget,
  addRule, listRules, removeRule,
  recordCadence, inferCadenceState,
  listReceipts, verifyReceipt,
  gate,
  formatBudget, formatDecision, formatVerdict,
} from "./index.js";

describe("stillness protocol", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-still-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  // ─── BUDGET ──────────────────────────────────────────────────────────

  describe("budget", () => {
    it("creates default budget on first read", () => {
      const b = getBudget(repo);
      expect(b.maxUtterances).toBe(200);
      expect(b.refresh).toBe("day");
      expect(b.consumed).toBe(0);
    });

    it("setBudget updates max + reset clears the counter", () => {
      consumeBudget(repo, 5);
      const b = setBudget(repo, { maxUtterances: 50, reset: true });
      expect(b.maxUtterances).toBe(50);
      expect(b.consumed).toBe(0);
    });

    it("consumeBudget decrements + reports remaining", () => {
      setBudget(repo, { maxUtterances: 10, reset: true });
      const r1 = consumeBudget(repo, 3);
      expect(r1.ok).toBe(true);
      expect(r1.remaining).toBe(7);
      const r2 = consumeBudget(repo, 7);
      expect(r2.ok).toBe(true);
      expect(r2.remaining).toBe(0);
      const r3 = consumeBudget(repo, 1);
      expect(r3.ok).toBe(false);
    });

    it("refreshes at day boundary (simulate by setting windowStart to yesterday)", () => {
      setBudget(repo, { maxUtterances: 10, reset: true });
      consumeBudget(repo, 5);
      // Manually rewind window.
      const path = join(repo, ".mneme/stillness/budget.json");
      const state = JSON.parse(readFileSync(path, "utf8"));
      state.windowStart = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
      writeFileSync(path, JSON.stringify(state), "utf8");
      // Next read should auto-refresh.
      const b = getBudget(repo);
      expect(b.consumed).toBe(0);
    });

    it("supports hourly refresh", () => {
      const b = setBudget(repo, { maxUtterances: 5, refresh: "hour", reset: true });
      expect(b.refresh).toBe("hour");
    });
  });

  // ─── RULES ───────────────────────────────────────────────────────────

  describe("rules", () => {
    it("addRule + listRules round-trip", () => {
      addRule(repo, {
        rationale: "boundary: don't comment on my ex",
        match: { keywordsAny: ["ex-girlfriend", "ex-boyfriend"] },
        action: "silent",
      });
      const rules = listRules(repo);
      expect(rules.length).toBe(1);
      expect(rules[0]!.rationale).toContain("boundary");
    });

    it("removeRule removes by id", () => {
      const r = addRule(repo, { rationale: "x", match: { keywordsAny: ["foo"] }, action: "silent" });
      removeRule(repo, r.id);
      expect(listRules(repo).length).toBe(0);
    });

    it("keywordsAll requires ALL keywords; keywordsAny requires ANY", async () => {
      addRule(repo, {
        rationale: "every both must match",
        match: { keywordsAll: ["alpha", "beta"] },
        action: "silent",
      });
      // alpha alone → no match → speak
      const d1 = gate(repo, { prompt: "alpha test", skipBudget: true, skipCadence: true });
      expect(d1.decision).toBe("speak");
      // alpha + beta → match → silent
      const d2 = gate(repo, { prompt: "alpha and beta", skipBudget: true, skipCadence: true });
      expect(d2.decision).toBe("silent");
    });

    it("regex match (case-insensitive)", () => {
      addRule(repo, {
        rationale: "regex",
        match: { regex: "^should i quit" },
        action: "silent",
      });
      const d = gate(repo, { prompt: "Should I quit my job", skipBudget: true, skipCadence: true });
      expect(d.decision).toBe("silent");
    });

    it("delayHours action returns delay + reviewableAt", () => {
      addRule(repo, {
        rationale: "sleep on hard questions",
        match: { keywordsAny: ["should I quit"] },
        action: { delayHours: 24 },
      });
      const now = new Date("2026-05-20T10:00:00Z");
      const d = gate(repo, { prompt: "should I quit", skipBudget: true, skipCadence: true, now });
      expect(d.decision).toBe("delay");
      expect(d.reviewableAt).toBe(new Date(now.getTime() + 24 * 3600 * 1000).toISOString());
    });

    it("hoursWindow gates rule to specific UTC hours", () => {
      addRule(repo, {
        rationale: "no nag during sleep",
        match: { keywordsAny: ["nag"] },
        hoursWindow: "23:00-07:00",
        action: "silent",
      });
      // 03:00 UTC → in window → silent
      const inWindow = new Date(Date.UTC(2026, 4, 20, 3, 0, 0));
      const d1 = gate(repo, { prompt: "nag question", skipBudget: true, skipCadence: true, now: inWindow });
      expect(d1.decision).toBe("silent");
      // 14:00 UTC → outside window → speak
      const outsideWindow = new Date(Date.UTC(2026, 4, 20, 14, 0, 0));
      const d2 = gate(repo, { prompt: "nag question", skipBudget: true, skipCadence: true, now: outsideWindow });
      expect(d2.decision).toBe("speak");
    });

    it("vacuous rule (no matchers configured) never matches", () => {
      addRule(repo, { rationale: "empty", match: {}, action: "silent" });
      const d = gate(repo, { prompt: "anything", skipBudget: true, skipCadence: true });
      expect(d.decision).toBe("speak");
    });
  });

  // ─── CADENCE INFERENCE ────────────────────────────────────────────────

  describe("cadence state inference", () => {
    it("returns sparse when too few samples", () => {
      recordCadence(repo, [100, 110]);
      const v = inferCadenceState(repo);
      expect(v.state).toBe("sparse");
      expect(v.shouldSilence).toBe(false);
    });

    it("detects steady typing (CV in normal human range 0.2-0.6)", () => {
      // Real human typing has natural variation across word/pause/punctuation.
      // CV around 0.3-0.45.
      recordCadence(repo, [80, 150, 70, 200, 90, 130, 110, 180, 95, 120, 85, 160, 100, 140, 105, 175]);
      const v = inferCadenceState(repo);
      expect(v.state).toBe("steady");
      expect(v.shouldSilence).toBe(false);
    });

    it("detects robotic typing (CV < 0.15)", () => {
      // Extremely regular intervals — paste / bot.
      recordCadence(repo, Array.from({ length: 20 }, () => 50));
      const v = inferCadenceState(repo);
      expect(v.state).toBe("robotic");
      expect(v.shouldSilence).toBe(true);
    });

    it("detects agitated typing (CV > 0.8)", () => {
      // Wildly irregular intervals — drunk / agitated.
      recordCadence(repo, [50, 1500, 80, 2000, 30, 1800, 100, 2500, 60, 1700]);
      const v = inferCadenceState(repo);
      expect(v.state).toBe("agitated");
      expect(v.shouldSilence).toBe(true);
    });

    it("gate fires SILENT when cadence is agitated", () => {
      setBudget(repo, { maxUtterances: 100, reset: true });
      recordCadence(repo, [50, 1500, 80, 2000, 30, 1800, 100, 2500, 60, 1700]);
      const d = gate(repo, { prompt: "anything" });
      expect(d.decision).toBe("silent");
      expect(d.reason).toContain("cadence");
    });

    it("skipCadence bypasses the cadence gate", () => {
      setBudget(repo, { maxUtterances: 100, reset: true });
      recordCadence(repo, [50, 1500, 80, 2000, 30, 1800, 100, 2500, 60, 1700]);
      const d = gate(repo, { prompt: "anything", skipCadence: true });
      expect(d.decision).toBe("speak");
    });
  });

  // ─── RECEIPTS + HMAC ──────────────────────────────────────────────────

  describe("receipts + HMAC", () => {
    it("every decision writes a signed receipt", () => {
      setBudget(repo, { maxUtterances: 5, reset: true });
      const d = gate(repo, { prompt: "hello", skipCadence: true });
      expect(d.receipt.sig).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      const all = listReceipts(repo);
      expect(all.length).toBe(1);
      expect(all[0]!.sig).toBe(d.receipt.sig);
    });

    it("verifyReceipt confirms HMAC", () => {
      setBudget(repo, { maxUtterances: 5, reset: true });
      const d = gate(repo, { prompt: "hello", skipCadence: true });
      expect(verifyReceipt(repo, d.receipt)).toBe(true);
    });

    it("verifyReceipt rejects tampered receipt", () => {
      setBudget(repo, { maxUtterances: 5, reset: true });
      const d = gate(repo, { prompt: "hello", skipCadence: true });
      const tampered = { ...d.receipt, reason: "FAKE" };
      expect(verifyReceipt(repo, tampered)).toBe(false);
    });

    it("prompt is hashed (not stored) for privacy", () => {
      setBudget(repo, { maxUtterances: 5, reset: true });
      const d = gate(repo, { prompt: "very secret prompt content", skipCadence: true });
      expect(d.receipt.promptSha).not.toContain("secret");
      expect(d.receipt.promptSha).toMatch(/^[a-f0-9]{32}$/);
    });

    it("listReceipts since filter works", async () => {
      setBudget(repo, { maxUtterances: 10, reset: true });
      gate(repo, { prompt: "a", skipCadence: true });
      const mid = Date.now();
      await new Promise((r) => setTimeout(r, 5));
      gate(repo, { prompt: "b", skipCadence: true });
      const after = listReceipts(repo, mid);
      expect(after.length).toBe(1);
    });
  });

  // ─── END-TO-END GATE COMPOSITION ──────────────────────────────────────

  describe("gate composition (full primitives)", () => {
    it("budget exhaustion → silent + receipt + reason", () => {
      setBudget(repo, { maxUtterances: 1, reset: true });
      gate(repo, { prompt: "first", skipCadence: true });
      const d = gate(repo, { prompt: "second", skipCadence: true });
      expect(d.decision).toBe("silent");
      expect(d.reason).toContain("budget exhausted");
    });

    it("rule takes priority over budget (silent rule fires before counter)", () => {
      setBudget(repo, { maxUtterances: 10, reset: true });
      addRule(repo, { rationale: "boundary", match: { keywordsAny: ["ex"] }, action: "silent" });
      const d = gate(repo, { prompt: "my ex called", skipCadence: true });
      expect(d.decision).toBe("silent");
      // Budget should NOT have been consumed.
      const b = getBudget(repo);
      expect(b.consumed).toBe(0);
    });

    it("speak path returns remaining budget", () => {
      setBudget(repo, { maxUtterances: 5, reset: true });
      const d = gate(repo, { prompt: "hello", skipCadence: true });
      expect(d.decision).toBe("speak");
      expect(d.remainingBudget).toBe(4);
    });
  });

  // ─── FORMATTERS ───────────────────────────────────────────────────────

  describe("formatters", () => {
    it("formatBudget shows remaining + refresh window", () => {
      const b = setBudget(repo, { maxUtterances: 10, reset: true });
      const out = formatBudget(b);
      expect(out).toContain("STILLNESS BUDGET");
      expect(out).toContain("10");
    });

    it("formatDecision renders verdict badge", () => {
      setBudget(repo, { maxUtterances: 5, reset: true });
      const d = gate(repo, { prompt: "x", skipCadence: true });
      const out = formatDecision(d);
      expect(out).toContain("STILLNESS");
      expect(out).toContain("SPEAK");
    });

    it("formatVerdict renders cadence state", () => {
      recordCadence(repo, Array.from({ length: 20 }, () => 50));
      const v = inferCadenceState(repo);
      const out = formatVerdict(v);
      expect(out).toContain("robotic");
    });
  });
});
