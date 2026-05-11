import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordPulseSnapshot, readPulseTrace, computePulseDelta, renderPulseDeltaLine,
  type PulseSnapshot,
} from "./pulse_continuity.js";

function snap(ts: string, overrides: Partial<PulseSnapshot> = {}): PulseSnapshot {
  return {
    ts, version: "1.30.0",
    daemonRunning: true, daemonTickCount: 100,
    inboxUnsent: 0, vaccines: 8, uncertifiedVaccines: 0,
    retrievalTrials: 29, hci: 88, memoryTier: "bundled",
    ...overrides,
  };
}

describe("pulse continuity (super sonic)", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-cont-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("recordPulseSnapshot + readPulseTrace", () => {
    it("appends snapshots to .mneme/pulse-trace.jsonl", () => {
      recordPulseSnapshot(repo, snap("2026-05-11T08:00:00Z"));
      recordPulseSnapshot(repo, snap("2026-05-11T08:00:30Z"));
      expect(existsSync(join(repo, ".mneme/pulse-trace.jsonl"))).toBe(true);
      const trace = readPulseTrace(repo, 10);
      expect(trace.length).toBe(2);
    });
    it("returns [] when trace file is missing", () => {
      expect(readPulseTrace(repo, 5)).toEqual([]);
    });
    it("survives malformed lines", () => {
      recordPulseSnapshot(repo, snap("2026-05-11T08:00:00Z"));
      // Corrupt by appending a malformed line.
      const path = join(repo, ".mneme/pulse-trace.jsonl");
      const fs = require("fs");
      fs.appendFileSync(path, "not valid json\n", "utf8");
      const trace = readPulseTrace(repo, 10);
      expect(trace.length).toBe(1);          // bad line skipped
    });
  });

  describe("computePulseDelta", () => {
    it("hasChanges=false when no prior snapshot", () => {
      const d = computePulseDelta(repo, snap("2026-05-11T08:00:00Z"));
      expect(d.hasChanges).toBe(false);
      expect(d.changes).toEqual([]);
      expect(d.secondsSinceLast).toBeNull();
    });

    it("detects vaccine count change", () => {
      recordPulseSnapshot(repo, snap("2026-05-11T08:00:00Z", { vaccines: 8 }));
      const d = computePulseDelta(repo, snap("2026-05-11T08:00:30Z", { vaccines: 9 }));
      expect(d.hasChanges).toBe(true);
      expect(d.changes.some((c) => c.includes("vaccines 8") && c.includes("9"))).toBe(true);
      expect(d.secondsSinceLast).toBe(30);
    });

    it("detects daemon stop->start", () => {
      recordPulseSnapshot(repo, snap("2026-05-11T08:00:00Z", { daemonRunning: false }));
      const d = computePulseDelta(repo, snap("2026-05-11T08:00:30Z", { daemonRunning: true }));
      expect(d.changes.some((c) => c.includes("daemon STARTED"))).toBe(true);
    });

    it("detects daemon RESTART (tick count reset)", () => {
      recordPulseSnapshot(repo, snap("2026-05-11T08:00:00Z", { daemonTickCount: 500 }));
      const d = computePulseDelta(repo, snap("2026-05-11T08:00:30Z", { daemonTickCount: 5 }));
      expect(d.changes.some((c) => c.includes("RESTARTED"))).toBe(true);
    });

    it("detects HCI change >= 5pt", () => {
      recordPulseSnapshot(repo, snap("2026-05-11T08:00:00Z", { hci: 88 }));
      const d = computePulseDelta(repo, snap("2026-05-11T08:00:30Z", { hci: 75 }));
      expect(d.changes.some((c) => c.includes("HCI 88") && c.includes("75"))).toBe(true);
    });

    it("ignores HCI noise < 5pt", () => {
      recordPulseSnapshot(repo, snap("2026-05-11T08:00:00Z", { hci: 88 }));
      const d = computePulseDelta(repo, snap("2026-05-11T08:00:30Z", { hci: 86 }));
      expect(d.changes.find((c) => c.includes("HCI"))).toBeUndefined();
    });

    it("detects memory tier upgrade hash -> bundled", () => {
      recordPulseSnapshot(repo, snap("2026-05-11T08:00:00Z", { memoryTier: "hash" }));
      const d = computePulseDelta(repo, snap("2026-05-11T08:00:30Z", { memoryTier: "bundled" }));
      expect(d.changes.some((c) => c.includes("memory tier hash") && c.includes("bundled"))).toBe(true);
    });

    it("detects mneme version upgrade", () => {
      recordPulseSnapshot(repo, snap("2026-05-11T08:00:00Z", { version: "1.29.0" }));
      const d = computePulseDelta(repo, snap("2026-05-11T08:00:30Z", { version: "1.30.0" }));
      expect(d.changes.some((c) => c.includes("upgraded 1.29.0") && c.includes("1.30.0"))).toBe(true);
    });
  });

  describe("renderPulseDeltaLine", () => {
    it("returns null when no changes", () => {
      const line = renderPulseDeltaLine({ hasChanges: false, secondsSinceLast: null, changes: [] });
      expect(line).toBeNull();
    });
    it("formats < 60s as 'Xs ago'", () => {
      const line = renderPulseDeltaLine({ hasChanges: true, secondsSinceLast: 45, changes: ["x"] });
      expect(line).toContain("(45s ago)");
    });
    it("formats < 3600s as 'Xmin ago'", () => {
      const line = renderPulseDeltaLine({ hasChanges: true, secondsSinceLast: 600, changes: ["x"] });
      expect(line).toContain("(10min ago)");
    });
    it("formats >= 3600s as 'Xh ago'", () => {
      const line = renderPulseDeltaLine({ hasChanges: true, secondsSinceLast: 7200, changes: ["x"] });
      expect(line).toContain("(2h ago)");
    });
    it("joins multiple changes with ' · '", () => {
      const line = renderPulseDeltaLine({ hasChanges: true, secondsSinceLast: 30, changes: ["a", "b", "c"] });
      expect(line).toContain("a · b · c");
    });
  });
});
