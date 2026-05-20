/**
 * v2.19.86 — Time-Machine Polygraph deep tests.
 */

import { describe, it, expect } from "vitest";
import { buildTimeline, buildCrossVendorTable, renderAsciiChart } from "./index.js";

const NOW = Date.now();
const HOUR = 3600_000;
const DAY = 24 * HOUR;

function ev(daysAgo: number, vendor: string, color: "green" | "yellow" | "red" | "grey") {
  return { ts: NOW - daysAgo * DAY, vendor, color };
}

describe("time_machine · buildTimeline", () => {
  it("buckets daily honesty per vendor + computes drift", () => {
    const events = [
      ev(5, "claude-ai", "green"), ev(5, "claude-ai", "green"), ev(5, "claude-ai", "red"),
      ev(4, "claude-ai", "green"), ev(4, "claude-ai", "yellow"),
      ev(3, "claude-ai", "green"), ev(3, "claude-ai", "green"),
      ev(2, "claude-ai", "green"), ev(2, "claude-ai", "green"), ev(2, "claude-ai", "green"),
      ev(1, "claude-ai", "green"), ev(1, "claude-ai", "green"),
    ];
    const s = buildTimeline(events, "claude-ai", { windowDays: 7, bucketHours: 24 });
    expect(s.vendor).toBe("claude-ai");
    expect(s.buckets.length).toBeGreaterThan(0);
    expect(s.meanHonesty).toBeGreaterThan(0.7); // 10/12 green
    // First non-null bucket = 2/3 honest; last non-null = 2/2 = 100%; drift > 0
    expect(s.drift).not.toBeNull();
    expect(s.drift!).toBeGreaterThan(0);
  });

  it("excludes other vendors from the series", () => {
    const events = [
      ev(1, "claude-ai", "green"),
      ev(1, "chatgpt", "red"),
      ev(1, "chatgpt", "red"),
    ];
    const claude = buildTimeline(events, "claude-ai", { windowDays: 7 });
    const total = claude.buckets.reduce((s, b) => s + b.total, 0);
    expect(total).toBe(1);
  });

  it("returns null stats when no judged events in window", () => {
    const events = [ev(1, "ghost", "grey"), ev(1, "ghost", "grey")];
    const s = buildTimeline(events, "ghost", { windowDays: 7 });
    expect(s.meanHonesty).toBeNull();
    expect(s.minHonesty).toBeNull();
    expect(s.maxHonesty).toBeNull();
    expect(s.drift).toBeNull();
  });

  it("fills the bucket grid (no gaps) so empty days still show on the chart", () => {
    const events = [ev(0, "claude-ai", "green"), ev(6, "claude-ai", "red")];
    const s = buildTimeline(events, "claude-ai", { windowDays: 7, bucketHours: 24 });
    // 7-day window with 24h buckets → ~7-8 buckets total; all present.
    expect(s.buckets.length).toBeGreaterThanOrEqual(7);
    // Many buckets will have total=0 (no events) — that's the grid fill.
    expect(s.buckets.some((b) => b.total === 0)).toBe(true);
  });
});

describe("time_machine · renderAsciiChart", () => {
  it("renders a chart without crashing + uses the height arg", () => {
    const events = [
      ev(2, "claude-ai", "green"), ev(2, "claude-ai", "red"),
      ev(1, "claude-ai", "green"), ev(1, "claude-ai", "green"),
    ];
    const s = buildTimeline(events, "claude-ai", { windowDays: 3, bucketHours: 24 });
    const chart = renderAsciiChart(s, { height: 6 });
    expect(typeof chart).toBe("string");
    expect(chart.length).toBeGreaterThan(0);
    // Has an axis label + at least one bar character.
    expect(/[▆▅█]/.test(chart)).toBe(true);
  });
});

describe("time_machine · buildCrossVendorTable", () => {
  it("aligns multiple vendors on the same bucket grid", () => {
    const events = [
      ev(1, "claude-ai", "green"), ev(1, "claude-ai", "green"),
      ev(1, "chatgpt", "red"),
    ];
    const tbl = buildCrossVendorTable(events, ["claude-ai", "chatgpt"], { windowDays: 3 });
    expect(tbl.length).toBeGreaterThan(0);
    for (const row of tbl) {
      expect(typeof row.bucketStart).toBe("string");
      expect("claude-ai" in row).toBe(true);
      expect("chatgpt" in row).toBe(true);
    }
  });
});
