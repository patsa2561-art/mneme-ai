/**
 * v2.19.57 SHEPHERD PROTOCOL — deep tests.
 *
 * Covers:
 *   - State ledger append + HMAC chain integrity
 *   - Tamper detection
 *   - Lock acquire / release / stale clearing / contention
 *   - Status reporting (running / lastVerdict / chainOk)
 *   - Script extraction idempotency
 *   - Parallel safety
 *   - Recovery from corrupt ledger
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { rmSync, existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  appendState,
  readState,
  verifyStateChain,
  acquireShepherdLock,
  releaseShepherdLock,
  readShepherdLock,
  shepherdStatus,
  installShepherdScript,
  ensureShepherdDir,
  shepherdDir,
  shepherdStatePath,
  shepherdLockPath,
  shepherdScriptPath,
  SHEPHERD_SCRIPT_SRC,
  PROTOCOL_VERSION,
} from "./index.js";

let savedHome: string | undefined;
let savedUserProfile: string | undefined;
let testHome: string;

beforeEach(() => {
  savedHome = process.env["HOME"];
  savedUserProfile = process.env["USERPROFILE"];
  testHome = join(tmpdir(), `mneme-shepherd-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(testHome, { recursive: true });
  process.env["HOME"] = testHome;
  process.env["USERPROFILE"] = testHome;
});

afterEach(() => {
  process.env["HOME"] = savedHome;
  process.env["USERPROFILE"] = savedUserProfile;
  try { rmSync(testHome, { recursive: true, force: true }); } catch { /* */ }
});

describe("v2.19.57 SHEPHERD — state ledger", () => {
  it("appendState writes valid HMAC-chained event", () => {
    const e = appendState({ step: "starting", shepherdPid: 12345, targetVersion: "2.19.57" });
    expect(e.v).toBe(PROTOCOL_VERSION);
    expect(e.step).toBe("starting");
    expect(e.shepherdPid).toBe(12345);
    expect(e.prevSig).toBe("0".repeat(64));
    expect(e.sig.length).toBe(64);
    expect(existsSync(shepherdStatePath())).toBe(true);
  });

  it("ledger chain links prevSig → sig correctly", () => {
    const a = appendState({ step: "starting", shepherdPid: 1, targetVersion: "v1" });
    const b = appendState({ step: "lock-acquired", shepherdPid: 1, targetVersion: "v1" });
    const c = appendState({ step: "complete", shepherdPid: 1, targetVersion: "v1" });
    expect(b.prevSig).toBe(a.sig);
    expect(c.prevSig).toBe(b.sig);
  });

  it("verifyStateChain returns ok=true for clean chain", () => {
    appendState({ step: "starting", shepherdPid: 1, targetVersion: "v1" });
    appendState({ step: "complete", shepherdPid: 1, targetVersion: "v1" });
    const r = verifyStateChain();
    expect(r.ok).toBe(true);
  });

  it("verifyStateChain detects tampering", () => {
    appendState({ step: "starting", shepherdPid: 1, targetVersion: "v1" });
    appendState({ step: "complete", shepherdPid: 1, targetVersion: "v1" });
    // Tamper the file
    const raw = readFileSync(shepherdStatePath(), "utf8");
    const tampered = raw.replace(/"sig":"[a-f0-9]+"/, '"sig":"deadbeef"');
    writeFileSync(shepherdStatePath(), tampered);
    const r = verifyStateChain();
    expect(r.ok).toBe(false);
  });

  it("readState returns recent events sorted ascending", () => {
    appendState({ step: "starting", shepherdPid: 1, targetVersion: "v1" });
    appendState({ step: "complete", shepherdPid: 1, targetVersion: "v1" });
    const events = readState(10);
    expect(events.length).toBe(2);
    expect(events[0]!.step).toBe("starting");
    expect(events[1]!.step).toBe("complete");
  });

  it("readState returns [] when file doesn't exist", () => {
    expect(readState(10)).toEqual([]);
  });
});

describe("v2.19.57 SHEPHERD — lock acquire/release", () => {
  it("acquireShepherdLock writes lock file + returns acquired=true", () => {
    const r = acquireShepherdLock("2.19.57", "starting");
    expect(r.acquired).toBe(true);
    expect(existsSync(shepherdLockPath())).toBe(true);
    const lock = readShepherdLock();
    expect(lock?.pid).toBe(process.pid);
    expect(lock?.targetVersion).toBe("2.19.57");
  });

  it("second acquire while first held returns reason=already-running", () => {
    const r1 = acquireShepherdLock("v1", "starting");
    expect(r1.acquired).toBe(true);
    const r2 = acquireShepherdLock("v2", "starting");
    expect(r2.acquired).toBe(false);
    if (!r2.acquired) {
      expect(r2.reason).toBe("already-running");
    }
  });

  it("releaseShepherdLock removes the lock file", () => {
    acquireShepherdLock("v1", "starting");
    expect(existsSync(shepherdLockPath())).toBe(true);
    expect(releaseShepherdLock()).toBe(true);
    expect(existsSync(shepherdLockPath())).toBe(false);
    // Idempotent — releasing twice doesn't throw
    expect(releaseShepherdLock()).toBe(false);
  });

  it("stale lock (PID dead) is auto-cleared on next acquire", () => {
    // Write a fake stale lock with a dead PID
    ensureShepherdDir();
    writeFileSync(shepherdLockPath(), JSON.stringify({
      v: 1, pid: 999999, startedAt: new Date().toISOString(),
      targetVersion: "v0", host: "test", step: "starting",
    }));
    const r = acquireShepherdLock("v1", "starting");
    expect(r.acquired).toBe(false);
    if (!r.acquired) {
      expect(r.reason).toBe("stale-lock-cleared");
    }
    // After clearing, file should be gone
    expect(existsSync(shepherdLockPath())).toBe(false);
    // Retry succeeds
    const r2 = acquireShepherdLock("v1", "starting");
    expect(r2.acquired).toBe(true);
  });

  it("stale lock (mtime > LOCK_STALENESS_MS) is auto-cleared", () => {
    ensureShepherdDir();
    writeFileSync(shepherdLockPath(), JSON.stringify({
      v: 1, pid: process.pid, startedAt: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      targetVersion: "v0", host: "test", step: "starting",
    }));
    // Manually set mtime to 10 minutes ago
    const oldTime = new Date(Date.now() - 10 * 60 * 1000);
    utimesSync(shepherdLockPath(), oldTime, oldTime);
    const r = acquireShepherdLock("v1", "starting");
    expect(r.acquired).toBe(false);
    if (!r.acquired) {
      expect(r.reason).toBe("stale-lock-cleared");
    }
  });
});

describe("v2.19.57 SHEPHERD — status reporting", () => {
  it("shepherdStatus reports running=false when no lock", () => {
    const s = shepherdStatus();
    expect(s.running).toBe(false);
    expect(s.currentLock).toBeNull();
    expect(s.lastVerdict).toBe("none");
  });

  it("shepherdStatus reports running=true when lock held by alive PID", () => {
    acquireShepherdLock("v1", "starting");
    const s = shepherdStatus();
    expect(s.running).toBe(true);
    expect(s.currentLock).not.toBeNull();
    expect(s.currentLock?.pid).toBe(process.pid);
  });

  it("shepherdStatus reports lastVerdict=complete after complete event", () => {
    appendState({ step: "starting", shepherdPid: 1, targetVersion: "v1" });
    appendState({ step: "complete", shepherdPid: 1, targetVersion: "v1" });
    const s = shepherdStatus();
    expect(s.lastVerdict).toBe("complete");
    expect(s.lastTargetVersion).toBe("v1");
  });

  it("shepherdStatus reports lastVerdict=failed after failed event", () => {
    appendState({ step: "starting", shepherdPid: 1, targetVersion: "v1" });
    appendState({ step: "failed", shepherdPid: 1, targetVersion: "v1" });
    const s = shepherdStatus();
    expect(s.lastVerdict).toBe("failed");
  });

  it("shepherdStatus reports chainOk=true for clean ledger", () => {
    appendState({ step: "starting", shepherdPid: 1, targetVersion: "v1" });
    appendState({ step: "complete", shepherdPid: 1, targetVersion: "v1" });
    const s = shepherdStatus();
    expect(s.chainOk).toBe(true);
  });

  it("shepherdStatus reports chainOk=false after tamper", () => {
    appendState({ step: "starting", shepherdPid: 1, targetVersion: "v1" });
    appendState({ step: "complete", shepherdPid: 1, targetVersion: "v1" });
    const raw = readFileSync(shepherdStatePath(), "utf8");
    writeFileSync(shepherdStatePath(), raw.replace(/"sig":"[a-f0-9]+"/, '"sig":"bad"'));
    const s = shepherdStatus();
    expect(s.chainOk).toBe(false);
  });
});

describe("v2.19.57 SHEPHERD — script extraction", () => {
  it("installShepherdScript writes valid CJS to ~/.mneme-global/shepherd/shepherd.cjs", () => {
    const path = installShepherdScript();
    expect(path).toBe(shepherdScriptPath());
    expect(existsSync(path)).toBe(true);
    const body = readFileSync(path, "utf8");
    expect(body).toBe(SHEPHERD_SCRIPT_SRC);
    expect(body.startsWith("#!/usr/bin/env node")).toBe(true);
    expect(body).toContain("npm-install-start");
    expect(body).toContain("clear-incoming-flag");
  });

  it("installShepherdScript is idempotent (overwrites)", () => {
    const path = installShepherdScript();
    const first = readFileSync(path, "utf8");
    installShepherdScript();
    const second = readFileSync(path, "utf8");
    expect(second).toBe(first);
  });

  it("SHEPHERD_SCRIPT_SRC has no external deps (only node built-ins)", () => {
    // Ensure no require("@mneme-ai/...") or require("npm-package") in the script
    expect(SHEPHERD_SCRIPT_SRC).not.toMatch(/require\("@/);
    // Sanity: built-ins are used
    expect(SHEPHERD_SCRIPT_SRC).toContain('require("node:fs")');
    expect(SHEPHERD_SCRIPT_SRC).toContain('require("node:child_process")');
  });
});

describe("v2.19.57 SHEPHERD — parallel safety + recovery", () => {
  it("appendState chain restarts cleanly if ledger corrupted", () => {
    appendState({ step: "starting", shepherdPid: 1, targetVersion: "v1" });
    // Corrupt the ledger
    writeFileSync(shepherdStatePath(), "not valid json\n");
    // Next append should not throw + should write a NEW chain
    const r = appendState({ step: "complete", shepherdPid: 1, targetVersion: "v1" });
    expect(r.sig.length).toBe(64);
  });

  it("shepherdStatus handles missing dir gracefully (no throw)", () => {
    // Don't ensureShepherdDir
    try { rmSync(shepherdDir(), { recursive: true, force: true }); } catch { /* */ }
    expect(() => shepherdStatus()).not.toThrow();
    const s = shepherdStatus();
    expect(s.running).toBe(false);
    expect(s.lastVerdict).toBe("none");
  });
});
