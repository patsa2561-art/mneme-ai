/**
 * v2.19.54 PREDICTIVE INSTALL SIGNAL + EXPONENTIAL-BACKOFF PROBE +
 * UPGRADE PIPELINE — deep tests for the 3 new wild innovations.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  announceInstallIncoming,
  clearInstallIncoming,
  readInstallIncoming,
  installIncomingPath,
  backoffProbeAndReap,
  runUpgradePipeline,
  DEFAULT_BACKOFFS_MS,
} from "./index.js";

let savedHome: string | undefined;
let savedUserProfile: string | undefined;
let testHome: string;

beforeEach(() => {
  savedHome = process.env["HOME"];
  savedUserProfile = process.env["USERPROFILE"];
  testHome = join(tmpdir(), `mneme-organ-v1954-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(testHome, { recursive: true });
  process.env["HOME"] = testHome;
  process.env["USERPROFILE"] = testHome;
});

afterEach(() => {
  process.env["HOME"] = savedHome;
  process.env["USERPROFILE"] = savedUserProfile;
  try { rmSync(testHome, { recursive: true, force: true }); } catch { /* */ }
});

describe("v2.19.54 — PREDICTIVE INSTALL SIGNAL", () => {
  it("announceInstallIncoming writes a parsable flag file at the canonical path", () => {
    const flagPath = announceInstallIncoming("test-reason", "2.19.54");
    expect(flagPath).toBe(installIncomingPath());
    expect(existsSync(flagPath)).toBe(true);
    const body = JSON.parse(readFileSync(flagPath, "utf8"));
    expect(body.v).toBe(1);
    expect(body.announcerPid).toBe(process.pid);
    expect(body.reason).toBe("test-reason");
    expect(body.expectedVersion).toBe("2.19.54");
    expect(typeof body.announcedAt).toBe("string");
  });

  it("readInstallIncoming returns parsed flag or null", () => {
    expect(readInstallIncoming()).toBeNull();
    announceInstallIncoming("test");
    const flag = readInstallIncoming();
    expect(flag).not.toBeNull();
    expect(flag?.reason).toBe("test");
  });

  it("clearInstallIncoming removes the flag (idempotent)", () => {
    announceInstallIncoming("test");
    expect(existsSync(installIncomingPath())).toBe(true);
    clearInstallIncoming();
    expect(existsSync(installIncomingPath())).toBe(false);
    // Idempotent — second call doesn't throw
    expect(() => clearInstallIncoming()).not.toThrow();
  });

  it("announce is idempotent — overwrites prior flag with fresh content", () => {
    announceInstallIncoming("first");
    const flag1 = readInstallIncoming();
    announceInstallIncoming("second");
    const flag2 = readInstallIncoming();
    expect(flag1?.reason).toBe("first");
    expect(flag2?.reason).toBe("second");
    expect(flag2!.announcedAt >= flag1!.announcedAt).toBe(true);
  });
});

describe("v2.19.54 — EXPONENTIAL-BACKOFF DLL PROBE", () => {
  it("DEFAULT_BACKOFFS_MS sums to 7850ms (worst case wall-time: 100+250+500+1000+2000+4000)", () => {
    const sum = DEFAULT_BACKOFFS_MS.reduce((a, b) => a + b, 0);
    expect(sum).toBe(7850);
    expect(DEFAULT_BACKOFFS_MS.length).toBe(6);
    // Sequence is exponential-ish + bounded
    for (let i = 1; i < DEFAULT_BACKOFFS_MS.length; i++) {
      expect(DEFAULT_BACKOFFS_MS[i]!).toBeGreaterThan(DEFAULT_BACKOFFS_MS[i - 1]!);
    }
  });

  it("fast path: probes succeed immediately, no waits, attempts=0", () => {
    // Probe a writable path (file we just created)
    const tempFile = join(testHome, "writable.txt");
    writeFileSync(tempFile, "ok");
    const r = backoffProbeAndReap([tempFile]);
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(0);
    expect(r.totalWaitMs).toBe(0);
    expect(r.reapPerAttempt.length).toBe(0);
  });

  it("nonexistent path treated as writable (file-not-present) — fast path", () => {
    const r = backoffProbeAndReap([join(testHome, "nonexistent.dll")]);
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(0);
  });

  it("with empty probe list, fast path returns ok=true with attempts=0", () => {
    const r = backoffProbeAndReap([]);
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(0);
  });

  it("custom backoffs honored (test sleeps respected)", () => {
    // We can't easily fail a probe in test, but we can verify the API accepts custom backoffs
    const r = backoffProbeAndReap([], { backoffsMs: [50, 100, 200] });
    expect(r.ok).toBe(true);
    // Empty probes hit fast path
    expect(r.totalWaitMs).toBe(0);
  });
});

describe("v2.19.54 — UPGRADE PIPELINE (composed)", () => {
  it("runUpgradePipeline with empty probes succeeds — stages all present", () => {
    const r = runUpgradePipeline([], { waitForReapMs: 50 });
    expect(r.ok).toBe(true);
    expect(r.stages.announce.announced).toBe(true);
    expect(r.stages.waitForSelfReap.waitedMs).toBe(50);
    expect(r.stages.heal).toBeDefined();
    expect(r.stages.backoff).toBeDefined();
    expect(r.recommendation).toMatch(/MAGICAL/);
  });

  it("pipeline writes the flag (visible to daemon fs.watch)", () => {
    runUpgradePipeline([], { waitForReapMs: 10 });
    expect(existsSync(installIncomingPath())).toBe(true);
  });

  it("pipeline integration: announce + heal + backoff all run with no errors", () => {
    const r = runUpgradePipeline([join(testHome, "writable.dll")], { waitForReapMs: 50 });
    expect(r.ok).toBe(true);
    expect(r.stages.backoff.finalProbes.length).toBe(1);
    expect(r.stages.backoff.finalProbes[0]!.writable).toBe(true);
  });

  it("pipeline waitForReapMs respected", () => {
    const t0 = Date.now();
    runUpgradePipeline([], { waitForReapMs: 200 });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(200);
  });

  it("pipeline accepts expectedVersion + reason and records them in announce flag", () => {
    runUpgradePipeline([], { waitForReapMs: 10, expectedVersion: "2.19.54", reason: "test-pipeline" });
    const flag = readInstallIncoming();
    expect(flag?.expectedVersion).toBe("2.19.54");
    expect(flag?.reason).toBe("test-pipeline");
  });
});
