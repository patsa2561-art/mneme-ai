import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { ship, listManifests } from "./shipper.js";

function setupRepo(repo: string, version = "1.0.0"): void {
  writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "t", version }, null, 2));
  spawnSync("git", ["init", "--quiet"], { cwd: repo });
  spawnSync("git", ["config", "user.email", "t@t"], { cwd: repo });
  spawnSync("git", ["config", "user.name", "t"], { cwd: repo });
  spawnSync("git", ["add", "."], { cwd: repo });
  spawnSync("git", ["commit", "-m", "init", "--quiet"], { cwd: repo });
}

const isWindows = process.platform === "win32";
const okGate = isWindows
  ? { name: "echo-ok", command: "cmd", args: ["/c", "exit 0"] }
  : { name: "echo-ok", command: "true", args: [] };
const failGate = isWindows
  ? { name: "echo-fail", command: "cmd", args: ["/c", "exit 1"] }
  : { name: "echo-fail", command: "false", args: [] };

describe("wings/shipper · core flow", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-shipper-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("ships when all gates pass on a clean tree", () => {
    setupRepo(repo);
    const m = ship(repo, { bump: "patch", gates: [okGate] });
    expect(m.shipped).toBe(true);
    expect(m.versionBefore).toBe("1.0.0");
    expect(m.versionAfter).toBe("1.0.1");
    expect(m.refusedReason).toBeNull();
    expect(m.readinessScore).toBe(100);
  });

  it("refuses with 'gate-failed' when any gate fails", () => {
    setupRepo(repo);
    const m = ship(repo, { bump: "patch", gates: [okGate, failGate] });
    expect(m.shipped).toBe(false);
    expect(m.refusedReason).toBe("gate-failed");
    expect(m.versionAfter).toBe("1.0.0"); // unchanged
    expect(m.readinessScore).toBe(50);
  });

  it("refuses with 'dirty-tree' when working tree dirty", () => {
    setupRepo(repo);
    writeFileSync(join(repo, "untracked.txt"), "x");
    const m = ship(repo, { bump: "patch", gates: [okGate] });
    expect(m.shipped).toBe(false);
    expect(m.refusedReason).toBe("dirty-tree");
  });

  it("allowDirty=true ships even with untracked files", () => {
    setupRepo(repo);
    writeFileSync(join(repo, "untracked.txt"), "x");
    const m = ship(repo, { bump: "patch", gates: [okGate], allowDirty: true });
    expect(m.shipped).toBe(true);
  });

  it("dryRun never bumps version on disk", () => {
    setupRepo(repo);
    const m = ship(repo, { bump: "minor", gates: [okGate], dryRun: true });
    expect(m.shipped).toBe(false);
    expect(m.versionAfter).toBe("1.1.0"); // computed but not written
    const onDisk = JSON.parse(readFileSync(join(repo, "package.json"), "utf8"));
    expect(onDisk.version).toBe("1.0.0");
  });

  it("writes audit manifest on every run, even refused", () => {
    setupRepo(repo);
    const m = ship(repo, { bump: "patch", gates: [failGate] });
    expect(m.shipped).toBe(false);
    expect(listManifests(repo)).toHaveLength(1);
  });

  it("multiple runs accumulate in ledger", () => {
    setupRepo(repo);
    ship(repo, { bump: "patch", gates: [okGate] });
    ship(repo, { bump: "patch", gates: [okGate] });
    expect(listManifests(repo)).toHaveLength(2);
  });
});

describe("wings/shipper · semver bumping", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-shipper-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("patch bump 1.2.3 → 1.2.4", () => {
    setupRepo(repo, "1.2.3");
    const m = ship(repo, { bump: "patch", gates: [okGate] });
    expect(m.versionAfter).toBe("1.2.4");
  });

  it("minor bump 1.2.3 → 1.3.0", () => {
    setupRepo(repo, "1.2.3");
    const m = ship(repo, { bump: "minor", gates: [okGate] });
    expect(m.versionAfter).toBe("1.3.0");
  });

  it("major bump 1.2.3 → 2.0.0", () => {
    setupRepo(repo, "1.2.3");
    const m = ship(repo, { bump: "major", gates: [okGate] });
    expect(m.versionAfter).toBe("2.0.0");
  });

  it("preserves package.json formatting via surgical edit", () => {
    mkdirSync(repo, { recursive: true });
    writeFileSync(join(repo, "package.json"), '{\n  "name": "t",\n  "version": "1.0.0",\n  "scripts": {\n    "test": "vitest"\n  }\n}\n');
    spawnSync("git", ["init", "--quiet"], { cwd: repo });
    spawnSync("git", ["config", "user.email", "t@t"], { cwd: repo });
    spawnSync("git", ["config", "user.name", "t"], { cwd: repo });
    spawnSync("git", ["add", "."], { cwd: repo });
    spawnSync("git", ["commit", "-m", "init", "--quiet"], { cwd: repo });
    ship(repo, { bump: "patch", gates: [okGate] });
    const after = readFileSync(join(repo, "package.json"), "utf8");
    expect(after).toContain('"scripts"');
    expect(after).toContain('"version": "1.0.1"');
    expect(after).toContain("vitest");
  });
});

describe("wings/shipper · weighting", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-shipper-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("higher-weighted failed gate drops score more", () => {
    setupRepo(repo);
    const m = ship(repo, {
      bump: "patch",
      gates: [
        { ...okGate, weight: 1 },
        { ...failGate, weight: 9 },
      ],
    });
    expect(m.readinessScore).toBe(10); // 1 / (1+9) = 0.1
  });
});

describe("wings/shipper · fingerprint determinism", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-shipper-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("two runs with same inputs produce same fingerprint (mod version)", () => {
    setupRepo(repo);
    const m1 = ship(repo, { bump: "patch", gates: [failGate] });
    const m2 = ship(repo, { bump: "patch", gates: [failGate] });
    // Both refused (gate-failed) so version unchanged for both → identical fingerprint
    expect(m1.fingerprint).toBe(m2.fingerprint);
  });
});
