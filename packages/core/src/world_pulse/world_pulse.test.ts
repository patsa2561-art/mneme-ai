/**
 * v2.19.84 — World AI Pulse deep tests.
 *
 * Pins the load-bearing invariants:
 *   - record/read round-trip
 *   - HMAC chain holds across N events; detects tampering
 *   - aggregate window slicing + per-vendor + per-region buckets
 *   - synthetic stream is realistic-shaped + seedable / deterministic
 *   - private fields stay private (NEVER stores sentence text)
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  recordPulseEvent, readPulseEvents, aggregatePulse,
  verifyPulseChain, synthesizePulseEvents,
} from "./index.js";

function makeRepo(): string {
  return mkdtempSync(join(tmpdir(), "mneme-pulse-"));
}

describe("world_pulse · record + read", () => {
  it("round-trips an event with HMAC chain hash", () => {
    const r = makeRepo();
    try {
      const e = recordPulseEvent(r, { vendor: "claude-ai", color: "green", regionTimezone: "Asia/Bangkok" });
      expect(e.chainHash).toMatch(/^[A-Za-z0-9_-]{22}$/);
      const back = readPulseEvents(r);
      expect(back.length).toBe(1);
      expect(back[0]!.vendor).toBe("claude-ai");
      expect(back[0]!.color).toBe("green");
      expect(back[0]!.regionTimezone).toBe("Asia/Bangkok");
    } finally { rmSync(r, { recursive: true, force: true }); }
  });

  it("normalises bad input WITHOUT throwing (fire-and-forget contract)", () => {
    const r = makeRepo();
    try {
      // Vendor not a string → "unknown". Color invalid → grey. Confidence > 1 → clamped.
      const e = recordPulseEvent(r, { vendor: 12345 as unknown as string, color: "purple" as unknown as "green", confidence: 9.9 });
      expect(e.vendor).toBe("unknown");
      expect(e.color).toBe("grey");
      expect(e.confidence).toBe(1);
    } finally { rmSync(r, { recursive: true, force: true }); }
  });

  it("limit + sinceTs filters work", () => {
    const r = makeRepo();
    try {
      const t0 = Date.now() - 10_000;
      recordPulseEvent(r, { vendor: "a", color: "green", ts: t0 });
      recordPulseEvent(r, { vendor: "b", color: "red",   ts: t0 + 2000 });
      recordPulseEvent(r, { vendor: "c", color: "yellow",ts: t0 + 4000 });
      const recent = readPulseEvents(r, { sinceTs: t0 + 3000 });
      expect(recent.length).toBe(1);
      expect(recent[0]!.vendor).toBe("c");
      const lim = readPulseEvents(r, { limit: 2 });
      expect(lim.length).toBe(2); // newest first → c then b
      expect(lim[0]!.vendor).toBe("c");
    } finally { rmSync(r, { recursive: true, force: true }); }
  });
});

describe("world_pulse · HMAC chain integrity", () => {
  it("verifyPulseChain reports intact on a clean chain", () => {
    const r = makeRepo();
    try {
      for (let i = 0; i < 5; i++) recordPulseEvent(r, { vendor: `v${i}`, color: "green" });
      const v = verifyPulseChain(r);
      expect(v.intact).toBe(true);
      expect(v.firstBrokenIndex).toBe(-1);
      expect(v.checked).toBe(5);
    } finally { rmSync(r, { recursive: true, force: true }); }
  });

  it("verifyPulseChain detects tampering (mutated chainHash)", () => {
    const r = makeRepo();
    try {
      recordPulseEvent(r, { vendor: "a", color: "green" });
      recordPulseEvent(r, { vendor: "b", color: "red" });
      recordPulseEvent(r, { vendor: "c", color: "yellow" });
      // Tamper: rewrite line 2's chainHash to something fake.
      const path = join(r, ".mneme", "pulse.jsonl");
      const lines = readFileSync(path, "utf8").trim().split("\n");
      const evil = { ...JSON.parse(lines[1]!), chainHash: "XXXXXXXXXXXXXXXXXXXXXX" };
      lines[1] = JSON.stringify(evil);
      writeFileSync(path, lines.join("\n") + "\n", "utf8");
      const v = verifyPulseChain(r);
      expect(v.intact).toBe(false);
      expect(v.firstBrokenIndex).toBeGreaterThanOrEqual(0);
    } finally { rmSync(r, { recursive: true, force: true }); }
  });
});

describe("world_pulse · aggregate", () => {
  it("windows correctly + bucketises by color / vendor / region", () => {
    const r = makeRepo();
    try {
      const now = Date.now();
      recordPulseEvent(r, { vendor: "claude-ai", color: "green",  ts: now - 10_000, regionTimezone: "Asia/Bangkok" });
      recordPulseEvent(r, { vendor: "claude-ai", color: "red",    ts: now - 5_000,  regionTimezone: "Asia/Bangkok" });
      recordPulseEvent(r, { vendor: "chatgpt",   color: "yellow", ts: now - 1_000,  regionTimezone: "Europe/London" });
      // Outside the 1-hour window
      recordPulseEvent(r, { vendor: "gemini", color: "green", ts: now - 4 * 3600_000, regionTimezone: "Asia/Tokyo" });
      const events = readPulseEvents(r);
      const agg = aggregatePulse(events, { windowHours: 1 });
      expect(agg.total).toBe(3);
      expect(agg.byColor.green).toBe(1);
      expect(agg.byColor.red).toBe(1);
      expect(agg.byColor.yellow).toBe(1);
      expect(agg.byVendor["claude-ai"]!.total).toBe(2);
      expect(agg.byVendor["chatgpt"]!.total).toBe(1);
      expect(agg.byVendor["gemini"]).toBeUndefined();
      expect(agg.byRegion["Asia/Bangkok"]).toBe(2);
      expect(agg.byRegion["Europe/London"]).toBe(1);
    } finally { rmSync(r, { recursive: true, force: true }); }
  });
});

describe("world_pulse · synthesizePulseEvents", () => {
  it("emits the requested count + realistic shape", () => {
    const stream = synthesizePulseEvents({ count: 100, spanMinutes: 60, seed: 1 });
    expect(stream.length).toBe(100);
    const colors = new Set(stream.map((e) => e.color));
    expect(colors.has("green")).toBe(true);
    // With 100 events + realistic weights we should see at least one red.
    expect(stream.some((e) => e.color === "red")).toBe(true);
    // All events fall inside the requested span (or close to "now").
    const now = Date.now();
    for (const e of stream) {
      expect(now - e.ts).toBeGreaterThanOrEqual(0);
      expect(now - e.ts).toBeLessThan(70 * 60_000);
    }
    // All vendors are the known 6.
    const allowedVendors = new Set(["claude-ai", "chatgpt", "gemini", "copilot", "deepseek", "qwen"]);
    for (const e of stream) expect(allowedVendors.has(e.vendor)).toBe(true);
  });

  it("deterministic when seed is fixed", () => {
    const a = synthesizePulseEvents({ count: 30, seed: 7 });
    const b = synthesizePulseEvents({ count: 30, seed: 7 });
    expect(a.map((e) => `${e.ts}|${e.vendor}|${e.color}`).join(","))
      .toBe(b.map((e) => `${e.ts}|${e.vendor}|${e.color}`).join(","));
  });
});

describe("world_pulse · privacy invariant", () => {
  it("the PulseEvent shape has NO sentence-text field — privacy by design", () => {
    const r = makeRepo();
    try {
      // Defensive: even if a caller tries to smuggle a `sentence` field
      // through Partial<PulseEvent>, the recorder strips it.
      const evil = { vendor: "x", color: "green" as const, regionTimezone: "Asia/Bangkok", sentence: "secret claim text" } as unknown as Record<string, unknown>;
      const e = recordPulseEvent(r, evil as never);
      const raw = readFileSync(join(r, ".mneme", "pulse.jsonl"), "utf8");
      expect(raw).not.toContain("secret claim text");
      expect(raw).not.toContain("sentence");
      // Verify the recorded object only contains the documented fields.
      const allowed = new Set(["ts", "vendor", "color", "regionTimezone", "topicHash", "chainHash", "confidence"]);
      for (const key of Object.keys(e)) expect(allowed.has(key)).toBe(true);
    } finally { rmSync(r, { recursive: true, force: true }); }
  });
});
