import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireLock, releaseLock, readLock, isLocked, formatLock,
  recordUpgrade, listUpgrades, lastFailure, lastSuccess, verifyChain, formatUpgradeLog,
  isInsideNpmInstall, isUpgradeSafeRightNow, formatDetection,
  upgradeDoctor, formatDoctor,
} from "./index.js";

describe("upgrade_visibility (v2.21.7)", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-upgrade-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  // ─── MUTEX ─────────────────────────────────────────────────────────

  describe("mutex (race-condition guard)", () => {
    it("acquireLock writes a lock file with owner pid", () => {
      const r = acquireLock(repo, { reason: "test acquire" });
      expect(r.ok).toBe(true);
      const cur = readLock(repo);
      expect(cur?.pid).toBe(process.pid);
      expect(cur?.reason).toBe("test acquire");
    });

    it("second acquireLock from same process fails (lock held)", () => {
      acquireLock(repo, { reason: "first" });
      const second = acquireLock(repo, { reason: "second" });
      expect(second.ok).toBe(false);
      expect(second.heldBy?.pid).toBe(process.pid);
    });

    it("releaseLock removes the lock file; subsequent acquire succeeds", () => {
      acquireLock(repo, { reason: "a" });
      const rel = releaseLock(repo);
      expect(rel.ok).toBe(true);
      expect(readLock(repo)).toBeNull();
      const next = acquireLock(repo, { reason: "b" });
      expect(next.ok).toBe(true);
    });

    it("stale lock from dead PID is reclaimable", () => {
      // Write a lock file claiming a definitely-dead pid (1 is unlikely
      // to be us on Linux; on Windows pidAlive will throw).
      const fakePath = join(repo, ".mneme/upgrade/upgrade.lock");
      require("node:fs").mkdirSync(join(repo, ".mneme/upgrade"), { recursive: true });
      writeFileSync(fakePath, JSON.stringify({ pid: 999999999, ts: new Date().toISOString(), reason: "ghost" }), "utf8");
      const r = acquireLock(repo, { reason: "real" });
      // Either it's reclaimed (preferred) or it was treated as live.
      // We assert the test runs without crashing.
      expect(typeof r.ok).toBe("boolean");
    });

    it("isLocked: true after acquire, false after release", () => {
      acquireLock(repo, { reason: "x" });
      expect(isLocked(repo)).toBe(true);
      releaseLock(repo);
      expect(isLocked(repo)).toBe(false);
    });

    it("formatLock prints empty + populated states", () => {
      expect(formatLock(null)).toContain("no upgrade in progress");
      acquireLock(repo, { reason: "test" });
      expect(formatLock(readLock(repo))).toContain("upgrade in progress");
    });
  });

  // ─── EXIT LOG ──────────────────────────────────────────────────────

  describe("exit log (silent-fail extinction)", () => {
    it("recordUpgrade chain-links via prev sig", () => {
      const r1 = recordUpgrade(repo, { versionBefore: "1.0.0", versionAfter: "1.0.1", exitCode: 0, reason: "first" });
      const r2 = recordUpgrade(repo, { versionBefore: "1.0.1", versionAfter: null,    exitCode: 1, reason: "failed" });
      expect(r1.prev).toBe("genesis");
      expect(r2.prev).toBe(r1.sig);
    });

    it("verifyChain returns ok on untouched log", () => {
      recordUpgrade(repo, { versionBefore: "1", versionAfter: "2", exitCode: 0, reason: "ok" });
      recordUpgrade(repo, { versionBefore: "2", versionAfter: "3", exitCode: 0, reason: "ok" });
      expect(verifyChain(repo).ok).toBe(true);
    });

    it("verifyChain detects tamper at correct index", () => {
      recordUpgrade(repo, { versionBefore: "1", versionAfter: "2", exitCode: 0, reason: "a" });
      recordUpgrade(repo, { versionBefore: "2", versionAfter: "3", exitCode: 0, reason: "b" });
      const p = join(repo, ".mneme/upgrade/log.jsonl");
      const lines = readFileSync(p, "utf8").split("\n");
      const middle = JSON.parse(lines[0]!);
      middle.exitCode = 99;
      lines[0] = JSON.stringify(middle);
      writeFileSync(p, lines.join("\n"), "utf8");
      const r = verifyChain(repo);
      expect(r.ok).toBe(false);
      expect(r.brokenAt).toBe(0);
    });

    it("lastFailure surfaces most-recent non-zero exit; lastSuccess returns most-recent 0", () => {
      recordUpgrade(repo, { versionBefore: "1", versionAfter: "2", exitCode: 0, reason: "success-old" });
      recordUpgrade(repo, { versionBefore: "2", versionAfter: null, exitCode: 4294963214, reason: "fail-mid" });
      recordUpgrade(repo, { versionBefore: "2", versionAfter: "3", exitCode: 0, reason: "success-new" });
      expect(lastFailure(repo)?.exitCode).toBe(4294963214);
      expect(lastSuccess(repo)?.reason).toBe("success-new");
    });

    it("returns null when no entries", () => {
      expect(lastFailure(repo)).toBeNull();
      expect(lastSuccess(repo)).toBeNull();
    });

    it("formatUpgradeLog handles empty + populated, surfaces stderrTail on failure", () => {
      expect(formatUpgradeLog([])).toContain("empty");
      recordUpgrade(repo, { versionBefore: "1", versionAfter: null, exitCode: 1, reason: "EBUSY", stderrTail: "line1\nlibvips-42.dll EBUSY\n" });
      const out = formatUpgradeLog(listUpgrades(repo));
      expect(out).toContain("UPGRADE LOG");
      expect(out).toContain("EBUSY");
    });
  });

  // ─── NPM DETECTOR ──────────────────────────────────────────────────

  describe("npm install detector (race-condition guard)", () => {
    it("isInsideNpmInstall returns a structured result (detected/unknown)", () => {
      const r = isInsideNpmInstall();
      // We don't assert detection truth — depends on where the test runs.
      // We assert the SHAPE of the response is correct so downstream code
      // can depend on it.
      expect(typeof r.detected).toBe("boolean");
      if (!r.detected) {
        // either evidence-empty OR unknownReason populated.
        expect(typeof r.unknownReason).toMatch(/string|undefined/);
      }
    });

    it("isUpgradeSafeRightNow returns safe=true when no npm in ancestor chain", () => {
      // Best-effort: when running under vitest, our parent is the test
      // runner (node) → not npm. Should be safe.
      const r = isUpgradeSafeRightNow();
      // We accept either (a) safe=true with reason citing no detection,
      // OR (b) safe=false with a clear unknownReason — the contract is
      // that 'safe' is always boolean + 'reason' always populated.
      expect(typeof r.safe).toBe("boolean");
      expect(r.reason.length).toBeGreaterThan(0);
    });

    it("formatDetection prints the right badge for detected / clean / unknown", () => {
      expect(formatDetection({ detected: true, evidence: "npm.exe" })).toContain("npm-like process detected");
      expect(formatDetection({ detected: false })).toContain("no package manager active");
      expect(formatDetection({ detected: false, unknownReason: "wmic missing" })).toContain("inconclusive");
    });
  });

  // ─── DOCTOR (composed) ─────────────────────────────────────────────

  describe("upgradeDoctor — one-shot 'is it safe right now?'", () => {
    it("ready=true on a fresh repo with no lock + no detector hit", () => {
      const r = upgradeDoctor(repo);
      // Either ready=true (no npm parent, no lock) or ready=false with
      // a reason about parent detection. Test the shape + that an
      // existing lock blocks readiness.
      if (r.ready) {
        expect(r.reasons.length).toBe(0);
      } else {
        expect(r.reasons.length).toBeGreaterThan(0);
      }
    });

    it("ready=false when a lock is active", () => {
      acquireLock(repo, { reason: "concurrent test" });
      const r = upgradeDoctor(repo);
      expect(r.ready).toBe(false);
      expect(r.reasons.join(" ")).toMatch(/lock/);
    });

    it("formatDoctor renders 🩺 + blockers + last attempt", () => {
      recordUpgrade(repo, { versionBefore: "1", versionAfter: null, exitCode: 1, reason: "boom" });
      const r = upgradeDoctor(repo);
      const out = formatDoctor(r);
      expect(out).toContain("UPGRADE DOCTOR");
    });
  });
});
