import { describe, it, expect, beforeEach } from "vitest";
import {
  execute, listPhrases, registerPhrase, resetToBuiltin,
  verifyPlan, formatIntentLine,
} from "./index.js";

describe("v2.19.4 · INTENT ROUTER — short human phrase → multi-step plan", () => {
  beforeEach(() => resetToBuiltin());

  describe("English phrase matching", () => {
    it('"update mneme" → upgrade + drift + promote + restart + record + soul (6+ steps)', () => {
      const p = execute({ userPhrase: "update mneme" });
      expect(p.matchedPhrase).toBe("update mneme");
      expect(p.matchScore).toBeGreaterThan(0.5);
      expect(p.steps.length).toBeGreaterThanOrEqual(6);
      expect(p.steps.some((s) => s.tool === "mneme.system.upgrade")).toBe(true);
      expect(p.steps.some((s) => s.tool === "mneme.mcp_drift.check")).toBe(true);
      expect(p.steps.some((s) => s.kind === "restart_client")).toBe(true);
    });

    it('"ship it" → ritual + confessional + oracle + bug_prophet', () => {
      const p = execute({ userPhrase: "ship it" });
      expect(p.matchedPhrase).toBe("publish change");
      expect(p.steps.some((s) => s.tool === "mneme.confessional.audit")).toBe(true);
      expect(p.steps.some((s) => s.tool === "mneme.oracle.assess_risk")).toBe(true);
      expect(p.steps.some((s) => s.tool === "mneme.bug_prophet.prophesy")).toBe(true);
    });

    it('"how is mneme" → evolution.report + soul.journal', () => {
      const p = execute({ userPhrase: "how is mneme" });
      expect(p.matchedPhrase).toBe("how is mneme");
      expect(p.steps.some((s) => s.tool === "mneme.evolution.report")).toBe(true);
      expect(p.steps.some((s) => s.tool === "mneme.soul.journal")).toBe(true);
    });

    it('"audit this" → inverse.prompt + hint + inverse.audit', () => {
      const p = execute({ userPhrase: "audit this" });
      expect(p.matchedPhrase).toBe("audit this");
      expect(p.steps.some((s) => s.tool === "mneme.inverse.prompt")).toBe(true);
      expect(p.steps.some((s) => s.tool === "mneme.inverse.audit")).toBe(true);
    });

    it('"fix everything" → drift + system.health + aegis + embedder + soul', () => {
      const p = execute({ userPhrase: "fix everything" });
      expect(p.matchedPhrase).toBe("fix everything");
      expect(p.steps.some((s) => s.tool === "mneme.system.health")).toBe(true);
    });

    it('"what should I work on" → jackpot + evolution.report', () => {
      const p = execute({ userPhrase: "what should I work on today" });
      expect(p.matchedPhrase).toBe("what should I work on");
      expect(p.steps.some((s) => s.tool === "mneme.jackpot.draw")).toBe(true);
    });
  });

  describe("Thai phrase matching", () => {
    it('"อัพเดท" → upgrade plan', () => {
      const p = execute({ userPhrase: "อัพเดท" });
      expect(p.matchedPhrase).toBe("update mneme");
    });

    it('"ลูกเป็นไง" → how is mneme', () => {
      const p = execute({ userPhrase: "ลูกเป็นไง" });
      expect(p.matchedPhrase).toBe("how is mneme");
    });

    it('"ลูกป่วย" → fix everything', () => {
      const p = execute({ userPhrase: "ลูกป่วย" });
      expect(p.matchedPhrase).toBe("fix everything");
    });

    it('"ปล่อยของ" → publish change', () => {
      const p = execute({ userPhrase: "ปล่อยของ" });
      expect(p.matchedPhrase).toBe("publish change");
    });

    it('"เก็บใน dna" → engrave soul to dna', () => {
      const p = execute({ userPhrase: "เก็บใน dna" });
      expect(p.matchedPhrase).toBe("engrave soul to dna");
    });

    it('"วันนี้ทำอะไรดี" → jackpot/what next', () => {
      const p = execute({ userPhrase: "วันนี้ทำอะไรดี" });
      expect(p.matchedPhrase).toBe("what should I work on");
    });
  });

  describe("Unknown phrase fallback", () => {
    it("returns a help plan that lists known phrases", () => {
      const p = execute({ userPhrase: "spaceship orbital mechanics for kerbal" });
      expect(p.matchedPhrase).toBe("(none)");
      expect(p.steps.some((s) => s.tool === "mneme.intent.list_phrases")).toBe(true);
      expect(p.walkthrough).toContain("don't have a verified plan");
    });
  });

  describe("Plan signature + verification", () => {
    it("plans are HMAC-signed", () => {
      const p = execute({ userPhrase: "update mneme" });
      expect(p.sig).toMatch(/^[0-9a-f]{64}$/);
      expect(verifyPlan(p)).toBe(true);
    });

    it("verifyPlan detects tampering", () => {
      const p = execute({ userPhrase: "update mneme" });
      const tampered = { ...p, steps: [{ kind: "tool" as const, tool: "mneme.evil.tool", note: "evil" }] };
      expect(verifyPlan(tampered)).toBe(false);
    });
  });

  describe("Registry extensibility", () => {
    it("listPhrases returns all built-in phrases", () => {
      const list = listPhrases();
      expect(list.length).toBeGreaterThanOrEqual(7);
      expect(list.map((p) => p.canonical)).toContain("update mneme");
      expect(list.map((p) => p.canonical)).toContain("how is mneme");
    });

    it("registerPhrase adds a new phrase that subsequent execute() can match", () => {
      registerPhrase({
        canonical: "do the dance",
        aliases: ["dance", "เต้น"],
        intent: "User wants Mneme to perform a celebratory dance ritual.",
        plan: [{ kind: "hint", note: "Mneme bows." }],
      });
      const p = execute({ userPhrase: "do the dance" });
      expect(p.matchedPhrase).toBe("do the dance");
    });

    it("registerPhrase rejects malformed phrase", () => {
      expect(() => registerPhrase({ canonical: "", aliases: [], intent: "x", plan: [] }))
        .toThrow(/canonical \+ non-empty plan/);
    });

    it("resetToBuiltin restores the original catalogue", () => {
      const baseline = listPhrases().length;
      registerPhrase({ canonical: "x-extra", aliases: [], intent: "y", plan: [{ kind: "hint", note: "z" }] });
      expect(listPhrases().length).toBeGreaterThan(baseline);
      resetToBuiltin();
      expect(listPhrases().length).toBe(baseline);
    });
  });

  describe("walkthrough is human-readable", () => {
    it("walkthrough mentions confidence + plan + step list", () => {
      const p = execute({ userPhrase: "update mneme" });
      expect(p.walkthrough).toContain("matched");
      expect(p.walkthrough).toContain("confidence");
      expect(p.walkthrough).toContain("Steps:");
      // Each plan step should appear in walkthrough as numbered list item
      for (const s of p.steps) {
        if (s.kind === "tool") expect(p.walkthrough).toContain(s.tool!);
      }
    });
  });

  describe("formatIntentLine", () => {
    it("formats matched + unmatched cases differently", () => {
      const matched = execute({ userPhrase: "update mneme" });
      expect(formatIntentLine(matched)).toContain("update mneme");
      const unmatched = execute({ userPhrase: "spaceship orbital mechanics" });
      expect(formatIntentLine(unmatched)).toContain("no match");
    });
  });
});
