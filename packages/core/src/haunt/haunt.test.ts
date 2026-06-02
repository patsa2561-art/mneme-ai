import { describe, it, expect } from "vitest";
import { buildHauntReport, extractIntentSignals, safeguardFlags, hauntGauntlet, type HauntInput } from "./index.js";

const NOW = 1_700_000_000_000;
const touchedAt = Math.floor(NOW / 1000) - 90 * 86400;

describe("v2.141 · HAUNT — Code Haunting / Git Telepathy", () => {
  it("gauntlet is 100", () => {
    expect(hauntGauntlet().score).toBe(100);
  });

  it("extracts temporary-fix intent in EN and TH", () => {
    expect(extractIntentSignals("quick fix for flash sale, will revisit").some((s) => /temporary|deferred/.test(s.label))).toBe(true);
    expect(extractIntentSignals("แก้ขัดไปก่อน เดี๋ยวค่อยมาแก้").some((s) => /TH/.test(s.label))).toBe(true);
  });

  it("flags missing safeguards on a perf symptom", () => {
    const f = safeguardFlags("async function p(){ for (const o of orders){ await charge(o); } }", "slow under traffic peak");
    expect(f.some((x) => /await inside a loop|caching/.test(x))).toBe(true);
  });

  it("resolves last-touched + age and verdict HAUNTED on a temp-fix commit", () => {
    const r = buildHauntReport({
      file: "src/pay.ts", region: { start: 40, end: 92 }, nowMs: NOW, symptom: "slow",
      blame: [{ commitHash: "abc1234def", authorName: "Alice", authorTime: touchedAt, lineNumber: 41, content: "x" }],
      commits: [{ hash: "abc1234def567", authorName: "Alice", authorDate: "2023", subject: "quick fix for flash sale", body: "temporary, will revisit" }],
      codeSnippet: "for (const o of orders) await charge(o)",
    });
    expect(r.verdict).toBe("HAUNTED");
    expect(r.lastTouched?.author).toBe("Alice");
    expect(r.lastTouched?.commit).toBe("abc1234d");
    expect(r.ageDays).toBe(90);
    expect(r.intent.temporaryFix).toBe(true);
  });

  it("returns UNKNOWN with no fabricated author on empty history", () => {
    const r = buildHauntReport({ file: "x.ts", blame: [], commits: [], nowMs: NOW });
    expect(r.verdict).toBe("UNKNOWN");
    expect(r.lastTouched).toBeNull();
    expect(r.narrative).toMatch(/UNKNOWN/);
    expect(r.narrative).not.toMatch(/last changed/);
  });

  it("never over-claims causation", () => {
    const r = buildHauntReport({
      file: "src/pay.ts", nowMs: NOW, symptom: "slow",
      blame: [{ commitHash: "a1", authorName: "A", authorTime: touchedAt, lineNumber: 1, content: "x" }],
      commits: [{ hash: "a1", authorName: "A", authorDate: "2023", subject: "temp fix", body: "" }],
      codeSnippet: "for(x of y) await z(x)",
    });
    expect(r.narrative).toMatch(/candidate, not a proven cause/i);
    expect(r.narrative).not.toMatch(/this is the (bug|cause)/i);
  });

  it("is total on hostile input", () => {
    expect(() => buildHauntReport(null as never)).not.toThrow();
    expect(() => extractIntentSignals(undefined as never)).not.toThrow();
    expect(() => safeguardFlags(123 as never, null as never)).not.toThrow();
  });
});
