/**
 * v2.19.61 DLL EVICTION ORGAN — deep tests.
 *
 * Tests cover:
 *   - windowsTaskKill: returns structured result on both platforms (no crash)
 *   - killPidForce: refuses self-kill + handles dead PIDs gracefully
 *   - probeWritable: fast-path on missing file + retry semantics
 *   - evictByRenameSideways: rename works + returns target path
 *   - cleanLockedSideways: pattern-matches *.locked-<digits>-<digits>
 *   - cleanStaleStagingDirs: sweeps .mneme-ai-* dirs only
 *   - evictAndProbe: composed pipeline picks correct strategy
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  windowsTaskKill,
  killPidForce,
  probeWritable,
  evictByRenameSideways,
  cleanLockedSideways,
  cleanStaleStagingDirs,
  evictAndProbe,
  PROTOCOL_VERSION,
} from "./index.js";

let testDir: string;

beforeEach(() => {
  testDir = join(tmpdir(), `mneme-dll-eviction-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  mkdirSync(testDir, { recursive: true });
});

afterEach(() => {
  try { rmSync(testDir, { recursive: true, force: true }); } catch { /* */ }
});

describe("v2.19.61 DLL EVICTION ORGAN — taskkill primitives", () => {
  it("windowsTaskKill never throws + returns structured result on both platforms", () => {
    const r = windowsTaskKill("nonexistent-process-name-xyz", { timeoutMs: 3000 });
    expect(r.platform).toBe(process.platform);
    expect(typeof r.attempted).toBe("boolean");
    // taskkill/pkill on a nonexistent process exits non-zero — that's expected
  });

  it("killPidForce refuses self-kill (safety)", () => {
    const r = killPidForce(process.pid);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("skip-self-or-invalid");
  });

  it("killPidForce handles invalid PID (-1, 0)", () => {
    expect(killPidForce(0).ok).toBe(false);
    expect(killPidForce(-1).ok).toBe(false);
  });

  it("killPidForce on nonexistent PID returns ok=false gracefully (no throw)", () => {
    const r = killPidForce(999999, { timeoutMs: 1000 });
    expect(r.ok).toBe(false);
    expect(typeof r.reason).toBe("string");
  });
});

describe("v2.19.61 DLL EVICTION ORGAN — probeWritable", () => {
  it("returns writable=true immediately for missing file", () => {
    const r = probeWritable(join(testDir, "no-such-file.dll"));
    expect(r.writable).toBe(true);
    expect(r.attempts).toBe(0);
    expect(r.totalWaitMs).toBe(0);
  });

  it("returns writable=true for a regular file (fast-path)", () => {
    const p = join(testDir, "writable.txt");
    writeFileSync(p, "hello");
    const r = probeWritable(p, { maxAttempts: 1 });
    expect(r.writable).toBe(true);
    expect(r.attempts).toBe(1);
  });

  it("retry loop respects maxAttempts cap", () => {
    // Force a probe on a path we know is writable — but with maxAttempts=1
    const p = join(testDir, "single-attempt.txt");
    writeFileSync(p, "hello");
    const r = probeWritable(p, { maxAttempts: 1, intervalMs: 10 });
    expect(r.attempts).toBe(1);
    expect(r.totalWaitMs).toBe(0); // succeeded on first try, no wait
  });
});

describe("v2.19.61 DLL EVICTION ORGAN — evictByRenameSideways (WILD)", () => {
  it("evicts existing file by renaming to .locked-<ts>-<pid>", () => {
    const p = join(testDir, "to-evict.dll");
    writeFileSync(p, "fake dll content");
    const r = evictByRenameSideways(p);
    expect(r.evicted).toBe(true);
    expect(r.renamedTo).toBeDefined();
    expect(r.renamedTo).toMatch(/\.locked-\d+-\d+$/);
    expect(existsSync(p)).toBe(false); // original path now free
    expect(existsSync(r.renamedTo!)).toBe(true); // file lives at new path
  });

  it("returns evicted=true with file-not-present reason for missing file", () => {
    const r = evictByRenameSideways(join(testDir, "ghost.dll"));
    expect(r.evicted).toBe(true);
    expect(r.reason).toBe("file-not-present");
    expect(r.renamedTo).toBeUndefined();
  });

  it("eviction PRESERVES file content (inode intact)", () => {
    const p = join(testDir, "preserve.dll");
    writeFileSync(p, "critical-bytes");
    const r = evictByRenameSideways(p);
    expect(r.evicted).toBe(true);
    const fs = require("node:fs");
    expect(fs.readFileSync(r.renamedTo!, "utf8")).toBe("critical-bytes");
  });
});

describe("v2.19.61 DLL EVICTION ORGAN — cleanLockedSideways", () => {
  it("sweeps *.locked-<digits>-<digits> files", () => {
    writeFileSync(join(testDir, "libvips-42.dll.locked-1234567890-12345"), "stale");
    writeFileSync(join(testDir, "sharp-win32-x64.node.locked-9999999999-99999"), "stale2");
    writeFileSync(join(testDir, "regular-file.dll"), "keep");
    const r = cleanLockedSideways(testDir);
    expect(r.swept).toBe(2);
    expect(r.failed).toBe(0);
    expect(existsSync(join(testDir, "regular-file.dll"))).toBe(true);
  });

  it("returns {swept: 0, failed: 0} for nonexistent dir", () => {
    const r = cleanLockedSideways(join(testDir, "no-such-dir"));
    expect(r.swept).toBe(0);
    expect(r.failed).toBe(0);
  });

  it("does NOT match files that look similar but don't fit the pattern", () => {
    writeFileSync(join(testDir, "fake.dll.locked"), "no-ts");
    writeFileSync(join(testDir, "fake.dll.locked-abc"), "alpha-ts");
    writeFileSync(join(testDir, "fake.dll"), "ok");
    const r = cleanLockedSideways(testDir);
    expect(r.swept).toBe(0); // none match the strict pattern
  });
});

describe("v2.19.61 DLL EVICTION ORGAN — cleanStaleStagingDirs", () => {
  it("sweeps .mneme-ai-* directories", () => {
    mkdirSync(join(testDir, ".mneme-ai-AbCdEf"), { recursive: true });
    writeFileSync(join(testDir, ".mneme-ai-AbCdEf", "package.json"), "{}");
    mkdirSync(join(testDir, ".mneme-ai-XyZ123"), { recursive: true });
    mkdirSync(join(testDir, "regular-dir"), { recursive: true });
    const r = cleanStaleStagingDirs(testDir);
    expect(r.swept).toBeGreaterThanOrEqual(2);
    expect(existsSync(join(testDir, "regular-dir"))).toBe(true);
  });

  it("returns {swept: 0, failed: 0} for nonexistent parent", () => {
    const r = cleanStaleStagingDirs(join(testDir, "ghost"));
    expect(r.swept).toBe(0);
    expect(r.failed).toBe(0);
  });

  it("ignores .mneme-ai-* files that are NOT directories", () => {
    writeFileSync(join(testDir, ".mneme-ai-fakefile"), "not a dir");
    const r = cleanStaleStagingDirs(testDir);
    expect(r.swept).toBe(0); // file ignored
    expect(existsSync(join(testDir, ".mneme-ai-fakefile"))).toBe(true);
  });
});

describe("v2.19.61 DLL EVICTION ORGAN — evictAndProbe composed pipeline", () => {
  it("returns strategy=already-writable for missing file (fast-path)", () => {
    const r = evictAndProbe(join(testDir, "ghost.dll"));
    expect(r.v).toBe(PROTOCOL_VERSION);
    expect(r.ok).toBe(true);
    expect(r.strategy).toBe("already-writable");
    expect(r.totalMs).toBeGreaterThanOrEqual(0);
  });

  it("returns strategy=rename-sideways when eviction succeeds", () => {
    const p = join(testDir, "lockable.dll");
    writeFileSync(p, "content");
    const r = evictAndProbe(p);
    expect(r.ok).toBe(true);
    expect(r.strategy).toBe("rename-sideways");
    expect(r.evicted).toBe(true);
    expect(r.evictionResult.renamedTo).toMatch(/\.locked-\d+-\d+$/);
    // Original path now free for npm to write
    expect(existsSync(p)).toBe(false);
  });

  it("strategy succeeds end-to-end with all primitives composing", () => {
    // Set up: 3 lockable files + 2 staging dirs + 1 locked-sideways orphan
    writeFileSync(join(testDir, "a.dll"), "1");
    writeFileSync(join(testDir, "b.dll"), "2");
    writeFileSync(join(testDir, "stale.dll.locked-100-200"), "orphan");
    mkdirSync(join(testDir, ".mneme-ai-stale-1"), { recursive: true });

    // Step 1: evict
    const ev = evictAndProbe(join(testDir, "a.dll"));
    expect(ev.ok).toBe(true);

    // Step 2: sweep orphans
    const swept = cleanLockedSideways(testDir);
    expect(swept.swept).toBeGreaterThanOrEqual(1); // at least the .locked-100-200

    // Step 3: clean staging
    const staging = cleanStaleStagingDirs(testDir);
    expect(staging.swept).toBeGreaterThanOrEqual(1);
  });
});
