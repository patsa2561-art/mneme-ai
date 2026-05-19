/**
 * v2.19.63 PHOENIX HARDENING — DOCTOR organ deep tests.
 *
 * Tests cover: prefix discovery, dual-install detection, version
 * conflict identification, PATH-active resolution, recommendation
 * string content, never-mutates invariant.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir, platform } from "node:os";
import { join } from "node:path";
import {
  runDoctorCycle,
  discoverNpmPrefixes,
  findActiveOnPath,
  PROTOCOL_VERSION,
} from "./index.js";

describe("v2.19.63 doctor PROTOCOL_VERSION", () => {
  it("is 1", () => {
    expect(PROTOCOL_VERSION).toBe(1);
  });
});

describe("v2.19.63 doctor discoverNpmPrefixes", () => {
  it("returns at least one prefix on a typical dev machine", () => {
    const p = discoverNpmPrefixes();
    expect(Array.isArray(p)).toBe(true);
    // Should at least find dirname(process.execPath) which always exists
    expect(p.length).toBeGreaterThan(0);
  });

  it("only returns paths that exist on disk", () => {
    const p = discoverNpmPrefixes();
    for (const prefix of p) {
      expect(existsSync(prefix)).toBe(true);
    }
  });

  it("returns absolute paths", () => {
    const p = discoverNpmPrefixes();
    for (const prefix of p) {
      // Windows uses C:\... or //server\share; POSIX uses /
      if (platform() === "win32") {
        expect(prefix).toMatch(/^[A-Z]:[\\/]|^\\\\/i);
      } else {
        expect(prefix.startsWith("/")).toBe(true);
      }
    }
  });
});

describe("v2.19.63 doctor findActiveOnPath", () => {
  it("returns null OR a valid bin path", () => {
    const r = findActiveOnPath();
    if (r !== null) {
      expect(existsSync(r.binPath)).toBe(true);
      expect(typeof r.pathEntry).toBe("string");
    }
  });
});

describe("v2.19.63 doctor runDoctorCycle shape", () => {
  it("returns structured DoctorReport", () => {
    const r = runDoctorCycle();
    expect(r.v).toBe(1);
    expect(r.organ).toBe("doctor");
    expect(typeof r.ts).toBe("string");
    expect(Array.isArray(r.installs)).toBe(true);
    expect(typeof r.hasConflict).toBe("boolean");
    expect(Array.isArray(r.versionsFound)).toBe(true);
    expect(Array.isArray(r.prefixesScanned)).toBe(true);
    expect(Array.isArray(r.recommendations)).toBe(true);
    expect(r.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("never throws even when env is unusual", () => {
    const savedPath = process.env["PATH"];
    process.env["PATH"] = "";
    try {
      expect(() => runDoctorCycle()).not.toThrow();
    } finally {
      process.env["PATH"] = savedPath;
    }
  });

  it("hasConflict=false when 0 or 1 install present", () => {
    const r = runDoctorCycle();
    // We can't control the actual state of the machine, but we can assert
    // the invariant: hasConflict iff installs.length > 1
    expect(r.hasConflict).toBe(r.installs.length > 1);
  });

  it("recommendations always non-empty", () => {
    const r = runDoctorCycle();
    expect(r.recommendations.length).toBeGreaterThan(0);
  });
});

describe("v2.19.63 doctor synthetic dual-install detection", () => {
  let sandbox1: string;
  let savedPrefix: string | undefined;

  beforeEach(() => {
    sandbox1 = mkdtempSync(join(tmpdir(), "doctor-prefix-a-"));
    // Plant a fake mneme-ai install in the sandbox prefix
    const pkgDir = join(sandbox1, "node_modules", "mneme-ai");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "mneme-ai", version: "2.19.61-doctor-test" }), "utf8");
    savedPrefix = process.env["NPM_CONFIG_PREFIX"];
    process.env["NPM_CONFIG_PREFIX"] = sandbox1;
  });

  afterEach(() => {
    try { rmSync(sandbox1, { recursive: true, force: true }); } catch { /* */ }
    if (savedPrefix !== undefined) {
      process.env["NPM_CONFIG_PREFIX"] = savedPrefix;
    } else {
      delete process.env["NPM_CONFIG_PREFIX"];
    }
  });

  it("detects the synthetic install via env-injected prefix", () => {
    const r = runDoctorCycle();
    const sandboxInstall = r.installs.find((i) => i.packagePath.includes("doctor-prefix-a-"));
    expect(sandboxInstall).toBeDefined();
    expect(sandboxInstall!.version).toBe("2.19.61-doctor-test");
  });

  it("reports hasConflict=true when 2+ installs", () => {
    const r = runDoctorCycle();
    if (r.installs.length >= 2) {
      expect(r.hasConflict).toBe(true);
    }
  });

  it("recommendations include CONFLICT phrase when 2+ installs", () => {
    const r = runDoctorCycle();
    if (r.installs.length >= 2) {
      expect(r.recommendations.some((s) => s.includes("CONFLICT"))).toBe(true);
    }
  });

  it("recommendations include exact rm command per stale install", () => {
    const r = runDoctorCycle();
    if (r.installs.length >= 2) {
      // At least one rm/Remove-Item suggestion should be present
      const cmdRe = platform() === "win32" ? /Remove-Item/ : /rm -rf/;
      expect(r.recommendations.some((s) => cmdRe.test(s))).toBe(true);
    }
  });

  it("versionsFound is sorted + unique (Set semantics)", () => {
    const r = runDoctorCycle();
    const dedup = Array.from(new Set(r.versionsFound)).sort();
    expect(r.versionsFound).toEqual(dedup);
  });
});

describe("v2.19.63 doctor never mutates filesystem", () => {
  let sandbox: string;

  beforeEach(() => {
    sandbox = mkdtempSync(join(tmpdir(), "doctor-mutation-test-"));
    const pkgDir = join(sandbox, "node_modules", "mneme-ai");
    mkdirSync(pkgDir, { recursive: true });
    writeFileSync(join(pkgDir, "package.json"), JSON.stringify({ name: "mneme-ai", version: "9.9.9" }), "utf8");
    writeFileSync(join(pkgDir, "canary.txt"), "do-not-touch", "utf8");
    process.env["NPM_CONFIG_PREFIX"] = sandbox;
  });

  afterEach(() => {
    delete process.env["NPM_CONFIG_PREFIX"];
    try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* */ }
  });

  it("after doctor run, canary file unchanged", () => {
    runDoctorCycle();
    const canaryPath = join(sandbox, "node_modules", "mneme-ai", "canary.txt");
    expect(existsSync(canaryPath)).toBe(true);
    const { readFileSync } = require("node:fs") as typeof import("node:fs");
    expect(readFileSync(canaryPath, "utf8")).toBe("do-not-touch");
  });
});
