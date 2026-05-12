/**
 * v1.65.1 -- Windowed compliance stats tests.
 */

import { describe, it, expect } from "vitest";

import { computeComplianceStats, computeWindowedComplianceStats, type ComplianceEntry } from "./ai_compliance.js";

function entry(tsDaysAgo: number, outcome: ComplianceEntry["outcome"], mandate = "mneme.system.upgrade"): ComplianceEntry {
  return {
    ts: new Date(Date.now() - tsDaysAgo * 86400 * 1000).toISOString(),
    mandate,
    args: {},
    executor: "pulse-pre-executor",
    outcome,
  };
}

describe("v1.65.1 WindowedComplianceStats", () => {
  it("30-day window excludes legacy failures from rate", () => {
    const entries: ComplianceEntry[] = [
      // 5 failures 60 days ago (the legacy Windows-lock incident)
      entry(60, "failed"), entry(60, "failed"), entry(60, "failed"), entry(60, "failed"), entry(60, "failed"),
      // 5 successes in the last 7 days
      entry(7, "executed"), entry(6, "executed"), entry(5, "executed"), entry(4, "executed"), entry(3, "executed"),
    ];
    const lifetime = computeComplianceStats(entries);
    const windowed = computeWindowedComplianceStats(entries, 30);
    expect(lifetime.inlineComplianceRate).toBeCloseTo(5 / 10, 2);
    expect(windowed.inlineComplianceRate).toBeCloseTo(1.0, 2);
    expect(windowed.excludedOlderCount).toBe(5);
    expect(windowed.windowDays).toBe(30);
  });

  it("includes ts boundary entries (>=)", () => {
    // Make sure an entry exactly at the boundary survives the cutoff.
    const exactly30 = entry(30, "executed");
    const stats = computeWindowedComplianceStats([exactly30], 30);
    expect(stats.total).toBe(1);
    expect(stats.excludedOlderCount).toBe(0);
  });

  it("empty input gives 100% rate and zero entries", () => {
    const s = computeWindowedComplianceStats([], 30);
    expect(s.total).toBe(0);
    expect(s.inlineComplianceRate).toBe(1);
    expect(s.excludedOlderCount).toBe(0);
  });

  it("invalid ts entries are excluded", () => {
    const bad: ComplianceEntry = { ts: "not-a-date", mandate: "x", args: {}, executor: "pulse-pre-executor", outcome: "failed" };
    const s = computeWindowedComplianceStats([bad, entry(1, "executed")], 30);
    expect(s.total).toBe(1);
    expect(s.excludedOlderCount).toBe(1);
  });

  it("windowDays parameter is honored", () => {
    const entries: ComplianceEntry[] = [
      entry(45, "failed"),  // outside 30-day, inside 60-day
      entry(15, "executed"),
    ];
    const w30 = computeWindowedComplianceStats(entries, 30);
    const w60 = computeWindowedComplianceStats(entries, 60);
    expect(w30.total).toBe(1);
    expect(w60.total).toBe(2);
  });

  it("preserves byMandate breakdown inside window", () => {
    const entries: ComplianceEntry[] = [
      entry(60, "failed", "old-mandate"),
      entry(10, "executed", "new-mandate"),
      entry(5, "executed", "new-mandate"),
    ];
    const s = computeWindowedComplianceStats(entries, 30);
    expect(s.byMandate["new-mandate"]?.executed).toBe(2);
    expect(s.byMandate["old-mandate"]).toBeUndefined();
  });
});
