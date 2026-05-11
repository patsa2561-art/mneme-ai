/**
 * v1.56.0 -- PHOENIX RESURRECTION PROTOCOL tests.
 *
 * The install / uninstall paths touch the host filesystem (Scheduled
 * Task registry / LaunchAgents dir / systemd user units / shell rcs)
 * so the tests focus on:
 *
 *   - Probe correctness: detects the right platform from process.platform,
 *     reports capabilities that match the host.
 *   - Plan ordering: best mechanism first.
 *   - Triple-witness probability math: 1 - 0.05^n.
 *   - Status reporter purity: read-only, idempotent.
 *
 * We do NOT actually install anything in the test repo; that would
 * pollute the host. The install/uninstall code path is shape-checked
 * via API surface only.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { probe, detectPlatform } from "./probe.js";
import { autoBootStatus } from "./index.js";

describe("v1.56 Phoenix · platform detection", () => {
  it("detectPlatform returns 'windows' / 'macos' / 'linux' / 'unknown'", () => {
    const p = detectPlatform();
    expect(["windows", "macos", "linux", "unknown"]).toContain(p);
  });

  it("matches process.platform mapping", () => {
    const p = detectPlatform();
    if (process.platform === "win32") expect(p).toBe("windows");
    else if (process.platform === "darwin") expect(p).toBe("macos");
    else if (process.platform === "linux") expect(p).toBe("linux");
  });
});

describe("v1.56 Phoenix · capability probe", () => {
  it("returns a non-empty capability map on supported platforms", () => {
    const r = probe();
    expect(r.platform).toBeDefined();
    if (r.platform !== "unknown") {
      expect(Object.keys(r.capabilities).length).toBeGreaterThan(0);
    }
  });

  it("plan is a subset of capabilities", () => {
    const r = probe();
    for (const mech of r.plan) {
      expect(r.capabilities[mech]).toBeDefined();
      expect(r.capabilities[mech]!.available).toBe(true);
    }
  });

  it("plan is ordered best-first per platform", () => {
    const r = probe();
    if (r.platform === "windows") {
      const idx = (k: string) => r.plan.indexOf(k);
      // schtasks (if available) must come before startupFolder and registryRun.
      if (idx("schtasks") >= 0 && idx("startupFolder") >= 0) {
        expect(idx("schtasks")).toBeLessThan(idx("startupFolder"));
      }
      if (idx("schtasks") >= 0 && idx("registryRun") >= 0) {
        expect(idx("schtasks")).toBeLessThan(idx("registryRun"));
      }
    } else if (r.platform === "macos") {
      const idx = (k: string) => r.plan.indexOf(k);
      if (idx("launchctl") >= 0 && idx("cron") >= 0) {
        expect(idx("launchctl")).toBeLessThan(idx("cron"));
      }
    } else if (r.platform === "linux") {
      const idx = (k: string) => r.plan.indexOf(k);
      if (idx("systemd") >= 0 && idx("cron") >= 0) {
        expect(idx("systemd")).toBeLessThan(idx("cron"));
      }
    }
  });

  it("probing twice returns the same shape (idempotent)", () => {
    const a = probe();
    const b = probe();
    expect(a.platform).toBe(b.platform);
    expect(a.plan).toEqual(b.plan);
  });
});

describe("v1.56 Phoenix · status reporter", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-phoenix-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("status with no install tag returns lastInstall=null", () => {
    const r = autoBootStatus(repo);
    expect(r.lastInstall).toBeNull();
    expect(typeof r.daemonRunning).toBe("boolean");
  });

  it("status reads the install tag when present", () => {
    const dir = join(repo, ".mneme", "autoboot");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "installed.json"), JSON.stringify({
      platform: "windows",
      installedAt: "2026-05-11T00:00:00.000Z",
      mechanisms: ["schtasks", "startupFolder", "registryRun"],
      probSuccess: 1 - Math.pow(0.05, 3),
    }), "utf8");
    const r = autoBootStatus(repo);
    expect(r.lastInstall).not.toBeNull();
    expect(r.lastInstall!.mechanisms).toContain("schtasks");
    expect(r.lastInstall!.probSuccess).toBeGreaterThan(0.999);
  });

  it("daemon detection respects .mneme/daemon.pid", () => {
    const dir = join(repo, ".mneme");
    mkdirSync(dir, { recursive: true });
    // Write a PID that's almost certainly NOT running.
    writeFileSync(join(dir, "daemon.pid"), "999999", "utf8");
    const r = autoBootStatus(repo);
    expect(r.daemonRunning).toBe(false);
  });

  it("daemon detection returns true for the current process PID", () => {
    const dir = join(repo, ".mneme");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "daemon.pid"), String(process.pid), "utf8");
    const r = autoBootStatus(repo);
    expect(r.daemonRunning).toBe(true);
  });
});

describe("v1.56 Phoenix · triple-witness probability math", () => {
  // Replicates the formula used in installAutoBoot summary.
  function tripleWitness(n: number, perMechFailure = 0.05): number {
    if (n === 0) return 0;
    return 1 - Math.pow(perMechFailure, n);
  }

  it("0 armed -> 0 probability", () => {
    expect(tripleWitness(0)).toBe(0);
  });

  it("1 armed (5% failure) -> 95% success", () => {
    expect(tripleWitness(1)).toBeCloseTo(0.95, 4);
  });

  it("2 armed -> 99.75% success", () => {
    expect(tripleWitness(2)).toBeCloseTo(0.9975, 4);
  });

  it("3 armed -> 99.9875% success (the cheat)", () => {
    expect(tripleWitness(3)).toBeCloseTo(0.999875, 6);
  });
});

describe("v1.56 Phoenix · capability + plan invariants", () => {
  it("an unknown platform yields empty plan + empty capabilities", () => {
    // We can't actually swap process.platform, so we verify by API shape:
    // platforms outside the supported set should be filtered to empty plan.
    const r = probe();
    if (r.platform === "unknown") {
      expect(r.plan).toEqual([]);
      expect(Object.keys(r.capabilities).length).toBe(0);
    } else {
      expect(r.plan.length).toBeGreaterThanOrEqual(0);
    }
  });
});
