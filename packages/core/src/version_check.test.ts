import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs"; // readFileSync used in v1.23.1 memo test
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkVersion, readCachedVersionCheck, semverGt } from "./version_check.js";

describe("semverGt", () => {
  it("major beats minor", () => {
    expect(semverGt("2.0.0", "1.99.99")).toBe(true);
    expect(semverGt("1.0.0", "2.0.0")).toBe(false);
  });
  it("minor beats patch", () => {
    expect(semverGt("1.2.0", "1.1.99")).toBe(true);
  });
  it("patch ordering", () => {
    expect(semverGt("1.19.2", "1.19.1")).toBe(true);
    expect(semverGt("1.19.0", "1.19.0")).toBe(false);
  });
  it("pre-release is LOWER than release of same core", () => {
    expect(semverGt("1.0.0", "1.0.0-rc1")).toBe(true);
    expect(semverGt("1.0.0-rc1", "1.0.0")).toBe(false);
  });
  it("v-prefix is tolerated", () => {
    expect(semverGt("v2.0.0", "v1.0.0")).toBe(true);
  });
  it("garbage input does not throw", () => {
    expect(() => semverGt("garbage", "1.0.0")).not.toThrow();
  });
});

describe("checkVersion + cache", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-vercheck-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("hits the network on first call (best-effort) and writes cache", async () => {
    const r = await checkVersion(repo, "1.19.0");
    expect(r.current).toBe("1.19.0");
    // Result.latest may be null if offline / registry down — but cache must exist.
    expect(existsSync(join(repo, ".mneme/version-check.json"))).toBe(true);
  });

  it("subsequent call within 24h returns cached result without re-fetching", async () => {
    // Pre-seed the cache.
    mkdirSync(join(repo, ".mneme"), { recursive: true });
    writeFileSync(join(repo, ".mneme/version-check.json"), JSON.stringify({
      current: "1.19.0",
      latest: "1.20.0",
      lastChecked: new Date().toISOString(),
    }));
    const r = await checkVersion(repo, "1.19.0");
    expect(r.fromCache).toBe(true);
    expect(r.latest).toBe("1.20.0");
    expect(r.updateAvailable).toBe(true);
  });

  it("readCachedVersionCheck returns null when no cache exists", () => {
    expect(readCachedVersionCheck(repo, "1.19.0")).toBeNull();
  });

  it("readCachedVersionCheck recomputes updateAvailable from cache + current", () => {
    mkdirSync(join(repo, ".mneme"), { recursive: true });
    writeFileSync(join(repo, ".mneme/version-check.json"), JSON.stringify({
      current: "1.19.0",
      latest: "1.19.0",
      lastChecked: new Date().toISOString(),
    }));
    // Cache says latest=1.19.0; ask with current=1.18.0 → updateAvailable=true.
    const r = readCachedVersionCheck(repo, "1.18.0");
    expect(r?.updateAvailable).toBe(true);
  });

  it("expired cache (>1h) triggers a re-check on the next call", async () => {
    mkdirSync(join(repo, ".mneme"), { recursive: true });
    writeFileSync(join(repo, ".mneme/version-check.json"), JSON.stringify({
      current: "1.19.0",
      latest: "0.0.1",
      lastChecked: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), // 2h old
    }));
    const r = await checkVersion(repo, "1.19.0");
    // Either fresh from network (fromCache=false) or cache was bumped.
    expect(r.fromCache).toBe(false);
  });

  it("v1.23.1 — also writes .mneme/CURRENT_VERSION.md memo for AI agents", async () => {
    await checkVersion(repo, "1.19.0");
    const memoPath = join(repo, ".mneme/CURRENT_VERSION.md");
    expect(existsSync(memoPath)).toBe(true);
    const memo = readFileSync(memoPath, "utf8");
    expect(memo).toContain("Mneme — current version status");
    expect(memo).toContain("mneme-ai@1.19.0");
    expect(memo).toContain("For AI agents reading this file");
  });
});
