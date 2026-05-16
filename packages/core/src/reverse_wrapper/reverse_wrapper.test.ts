import { describe, it, expect, beforeEach } from "vitest";
import {
  ReverseWrapperSession, verifySuggestion, formatSuggestionLine,
  BUILTIN_RULES, type SuggestionRule,
} from "./index.js";

describe("v2.19.10 · REVERSE-WRAPPER", () => {
  let s: ReverseWrapperSession;
  beforeEach(() => { s = new ReverseWrapperSession({ sessionId: "test-session", loopWindow: 4 }); });

  // ── suggestNext ─────────────────────────────────────────────────
  describe("suggestNext", () => {
    it("emits a signed SuggestedNext when a rule fires", () => {
      const rules: SuggestionRule[] = [
        { forTool: "X", suggestTool: "Y", why: "always after X", confidence: 0.8 },
      ];
      const sn = s.suggestNext({ currentTool: "X", output: {}, rules });
      expect(sn).not.toBeNull();
      expect(sn!.tool).toBe("Y");
      expect(sn!.confidence).toBe(0.8);
      expect(sn!.sig).toMatch(/^[0-9a-f]{64}$/);
      expect(verifySuggestion(sn!)).toBe(true);
    });

    it("returns null when no rule matches", () => {
      expect(s.suggestNext({ currentTool: "X", output: {}, rules: [] })).toBeNull();
    });

    it("respects predicate (rule doesn't fire if predicate false)", () => {
      const rules: SuggestionRule[] = [
        { forTool: "X", suggestTool: "Y", why: "x", confidence: 0.9, predicate: (o) => (o as { trigger?: boolean }).trigger === true },
      ];
      const noFire = s.suggestNext({ currentTool: "X", output: { trigger: false }, rules });
      const fire = s.suggestNext({ currentTool: "X", output: { trigger: true }, rules });
      expect(noFire).toBeNull();
      expect(fire).not.toBeNull();
    });

    it("buildArgs populates suggestedArgs", () => {
      const rules: SuggestionRule[] = [
        { forTool: "X", suggestTool: "Y", why: "", confidence: 0.5, buildArgs: (o) => ({ from: (o as { v: number }).v }) },
      ];
      const sn = s.suggestNext({ currentTool: "X", output: { v: 42 }, rules });
      expect(sn!.suggestedArgs).toEqual({ from: 42 });
    });
  });

  // ── loop detection ──────────────────────────────────────────────
  describe("loop detection", () => {
    it("suppresses suggestion when target tool was called within loopWindow", () => {
      const rules: SuggestionRule[] = [
        { forTool: "X", suggestTool: "Y", why: "x", confidence: 0.9 },
      ];
      // Pretend Y was called recently
      s.recordCall("Y");
      const sn = s.suggestNext({ currentTool: "X", output: {}, rules });
      expect(sn).not.toBeNull();
      expect(sn!.suppressedReason).toContain("loop guard");
    });

    it("doesn't suppress when target tool is OUTSIDE loopWindow", () => {
      const s2 = new ReverseWrapperSession({ sessionId: "x", loopWindow: 2 });
      const rules: SuggestionRule[] = [
        { forTool: "X", suggestTool: "Y", why: "x", confidence: 0.9 },
      ];
      // Y called 3 ago; window=2 → outside
      s2.recordCall("Y");
      s2.recordCall("A");
      s2.recordCall("B");
      const sn = s2.suggestNext({ currentTool: "X", output: {}, rules });
      expect(sn!.suppressedReason).toBeUndefined();
    });
  });

  // ── attachSuggestion ────────────────────────────────────────────
  describe("attachSuggestion", () => {
    it("wraps output with __suggested_next when a rule fires", () => {
      const rules: SuggestionRule[] = [{ forTool: "X", suggestTool: "Y", why: "x", confidence: 0.7 }];
      const wrapped = s.attachSuggestion({ output: { real: "data" }, currentTool: "X", rules });
      expect(wrapped.data).toEqual({ real: "data" });
      expect(wrapped.__suggested_next?.tool).toBe("Y");
    });
    it("returns output un-wrapped when no rule fires", () => {
      const wrapped = s.attachSuggestion({ output: { real: "data" }, currentTool: "ZZZ", rules: [] });
      expect(wrapped.data).toEqual({ real: "data" });
      expect(wrapped.__suggested_next).toBeUndefined();
    });
  });

  // ── follow-through telemetry ────────────────────────────────────
  describe("follow-through telemetry", () => {
    it("counts a suggestion as 'followed' when next call matches", () => {
      const rules: SuggestionRule[] = [{ forTool: "X", suggestTool: "Y", why: "", confidence: 0.9 }];
      s.recordCall("X");
      s.suggestNext({ currentTool: "X", output: {}, rules });
      s.recordCall("Y"); // followed
      const stats = s.followThroughStats();
      expect(stats.followed).toBe(1);
      expect(stats.expired).toBe(0);
      expect(stats.followRate).toBe(1);
    });

    it("counts a suggestion as 'expired' when window passes without match", () => {
      const s3 = new ReverseWrapperSession({ sessionId: "x", loopWindow: 2 });
      const rules: SuggestionRule[] = [{ forTool: "X", suggestTool: "Y", why: "", confidence: 0.9 }];
      s3.recordCall("X");
      s3.suggestNext({ currentTool: "X", output: {}, rules });
      // 3 calls without Y → suggestion expires
      s3.recordCall("A");
      s3.recordCall("B");
      s3.recordCall("C");
      const stats = s3.followThroughStats();
      expect(stats.expired).toBeGreaterThanOrEqual(1);
      expect(stats.followRate).toBe(0);
    });

    it("perToolBreakdown aggregates across many suggestions (when not loop-suppressed)", () => {
      // Use a small loopWindow so we can deliberately space the suggestions out.
      const s2 = new ReverseWrapperSession({ sessionId: "agg-test", loopWindow: 2 });
      const rules: SuggestionRule[] = [
        { forTool: "X", suggestTool: "Y", why: "", confidence: 0.9 },
      ];
      // Suggestion #1
      s2.recordCall("X");
      s2.suggestNext({ currentTool: "X", output: {}, rules });
      s2.recordCall("Y");                      // followed → tracked
      // Push Y out of the loop window before suggesting again
      s2.recordCall("A");
      s2.recordCall("B");
      // Suggestion #2
      s2.recordCall("X");
      s2.suggestNext({ currentTool: "X", output: {}, rules });
      // Expire #2 by calling many non-Y tools
      s2.recordCall("P"); s2.recordCall("Q"); s2.recordCall("R");
      const stats = s2.followThroughStats();
      const yRow = stats.perToolBreakdown.find((r) => r.tool === "Y");
      expect(yRow!.suggested).toBe(2);
      expect(yRow!.followed).toBe(1);
    });
  });

  // ── BUILTIN_RULES ───────────────────────────────────────────────
  describe("BUILTIN_RULES", () => {
    it("ships >= 5 default rules", () => {
      expect(BUILTIN_RULES.length).toBeGreaterThanOrEqual(5);
    });
    it("inverse.audit rejected → chronostasis.tick suggestion", () => {
      const sn = s.suggestNext({
        currentTool: "mneme.inverse.audit",
        output: { data: { verdict: "rejected" } },
        rules: BUILTIN_RULES,
      });
      expect(sn).not.toBeNull();
      expect(sn!.tool).toBe("mneme.chronostasis.tick");
    });
    it("inverse.audit trusted → NO suggestion (predicate filters)", () => {
      const sn = s.suggestNext({
        currentTool: "mneme.inverse.audit",
        output: { data: { verdict: "trusted" } },
        rules: BUILTIN_RULES,
      });
      expect(sn).toBeNull();
    });
    it("agreement.compile → suggests pre_commit_hook (no predicate)", () => {
      const sn = s.suggestNext({
        currentTool: "mneme.agreement.compile",
        output: {},
        rules: BUILTIN_RULES,
      });
      expect(sn!.tool).toBe("mneme.agreement.pre_commit_hook");
    });
    it("dream.run with candidates → suggests dream.review", () => {
      const sn = s.suggestNext({
        currentTool: "mneme.dream.run",
        output: { data: { candidatesEmitted: 3 } },
        rules: BUILTIN_RULES,
      });
      expect(sn!.tool).toBe("mneme.dream.review");
    });
    it("dream.run with NO candidates → no suggestion", () => {
      const sn = s.suggestNext({
        currentTool: "mneme.dream.run",
        output: { data: { candidatesEmitted: 0 } },
        rules: BUILTIN_RULES,
      });
      expect(sn).toBeNull();
    });
  });

  // ── HMAC tamper ─────────────────────────────────────────────────
  describe("HMAC + tamper detection", () => {
    it("verifySuggestion detects tampered confidence", () => {
      const rules: SuggestionRule[] = [{ forTool: "X", suggestTool: "Y", why: "", confidence: 0.5 }];
      const sn = s.suggestNext({ currentTool: "X", output: {}, rules })!;
      const tampered = { ...sn, confidence: 0.99 };
      expect(verifySuggestion(tampered)).toBe(false);
    });
  });

  // ── formatter ───────────────────────────────────────────────────
  describe("formatter", () => {
    it("formatSuggestionLine emits short summary with right icon", () => {
      const rules: SuggestionRule[] = [{ forTool: "X", suggestTool: "Y", why: "", confidence: 0.5 }];
      const sn = s.suggestNext({ currentTool: "X", output: {}, rules })!;
      expect(formatSuggestionLine(sn)).toContain("SUGGEST");
      expect(formatSuggestionLine(sn)).toContain("🪂");
      // Triggered suppression
      s.recordCall("Y");
      const sn2 = s.suggestNext({ currentTool: "X", output: {}, rules })!;
      expect(formatSuggestionLine(sn2)).toContain("🔁");
    });
  });
});
