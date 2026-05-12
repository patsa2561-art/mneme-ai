import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { generateHeartbeat, renderHeartbeatMarkdown, parseHeartbeat } from "./heartbeat.js";

function tmpCacheDir(): string {
  const d = mkdtempSync(join(tmpdir(), "mneme-telepathy-"));
  return join(d, "telepathy");
}

describe("VERSION TELEPATHY heartbeat", () => {
  it("offline mode returns unknown sync status", async () => {
    const h = await generateHeartbeat({
      localVersion: "1.75.0",
      repoFingerprint: "abc123",
      offline: true,
      cacheDir: tmpCacheDir(),
    });
    expect(h.syncStatus).toBe("unknown");
    expect(h.npmLatest).toBeNull();
    expect(h.localVersion).toBe("1.75.0");
  });

  it("in-sync when local == npm latest (from cache)", async () => {
    const dir = tmpCacheDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "npm-cache.json"), JSON.stringify({ version: "1.75.0", savedAt: Date.now() }));
    const h = await generateHeartbeat({ localVersion: "1.75.0", repoFingerprint: "abc", cacheDir: dir, offline: true });
    expect(h.syncStatus).toBe("in-sync");
    expect(h.npmLatest).toBe("1.75.0");
  });

  it("behind when local < npm latest", async () => {
    const dir = tmpCacheDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "npm-cache.json"), JSON.stringify({ version: "2.0.0", savedAt: Date.now() }));
    const h = await generateHeartbeat({ localVersion: "1.75.0", repoFingerprint: "abc", cacheDir: dir, offline: true });
    expect(h.syncStatus).toBe("behind");
  });

  it("ahead when local > npm latest (dev build)", async () => {
    const dir = tmpCacheDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "npm-cache.json"), JSON.stringify({ version: "1.74.0", savedAt: Date.now() }));
    const h = await generateHeartbeat({ localVersion: "1.75.0", repoFingerprint: "abc", cacheDir: dir, offline: true });
    expect(h.syncStatus).toBe("ahead");
  });

  it("expired cache + offline = unknown (cache TTL respected)", async () => {
    const dir = tmpCacheDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "npm-cache.json"),
      JSON.stringify({ version: "1.75.0", savedAt: Date.now() - 60 * 60 * 1000 * 2 }),
    );
    const h = await generateHeartbeat({
      localVersion: "1.75.0",
      repoFingerprint: "abc",
      cacheDir: dir,
      offline: true,
      cacheTtlMs: 60 * 60 * 1000,
    });
    expect(h.npmLatest).toBeNull();
    expect(h.syncStatus).toBe("unknown");
  });

  it("corrupt cache falls back gracefully (no throw)", async () => {
    const dir = tmpCacheDir();
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "npm-cache.json"), "{not valid json");
    const h = await generateHeartbeat({ localVersion: "1.75.0", repoFingerprint: "abc", cacheDir: dir, offline: true });
    expect(h.syncStatus).toBe("unknown");
  });

  it("fetchOverride is called and cache is populated", async () => {
    const dir = tmpCacheDir();
    let calls = 0;
    const h = await generateHeartbeat({
      localVersion: "1.75.0",
      repoFingerprint: "abc",
      cacheDir: dir,
      fetchOverride: async () => {
        calls++;
        return "1.99.0";
      },
    });
    expect(calls).toBe(1);
    expect(h.npmLatest).toBe("1.99.0");
    expect(h.syncStatus).toBe("behind");
    expect(existsSync(join(dir, "npm-cache.json"))).toBe(true);
    const cached = JSON.parse(readFileSync(join(dir, "npm-cache.json"), "utf8"));
    expect(cached.version).toBe("1.99.0");
  });

  it("fetchOverride returning null still produces a heartbeat", async () => {
    const dir = tmpCacheDir();
    const h = await generateHeartbeat({
      localVersion: "1.75.0",
      repoFingerprint: "abc",
      cacheDir: dir,
      fetchOverride: async () => null,
    });
    expect(h.npmLatest).toBeNull();
    expect(h.syncStatus).toBe("unknown");
  });

  it("renderHeartbeatMarkdown includes all key fields", () => {
    const md = renderHeartbeatMarkdown({
      localVersion: "1.75.0",
      npmLatest: "1.75.0",
      syncStatus: "in-sync",
      daemonRunning: true,
      vaccineCount: 8,
      inboxUnsent: 2,
      repoFingerprint: "abc123",
      checkedAt: "2026-05-12T15:00:00.000Z",
    });
    expect(md).toContain("local_version: 1.75.0");
    expect(md).toContain("npm_latest: 1.75.0");
    expect(md).toContain("in-sync");
    expect(md).toContain("repo_fingerprint: abc123");
    expect(md).toContain("vaccines: 8");
  });

  it("renderHeartbeatMarkdown behind status surfaces upgrade instruction", () => {
    const md = renderHeartbeatMarkdown({
      localVersion: "1.50.0",
      npmLatest: "1.75.0",
      syncStatus: "behind",
      daemonRunning: false,
      vaccineCount: 0,
      inboxUnsent: 0,
      repoFingerprint: "x",
      checkedAt: "2026-05-12T15:00:00.000Z",
    });
    expect(md).toContain("BEHIND");
    expect(md).toMatch(/mneme\.system\.upgrade/i);
  });

  it("parseHeartbeat round-trips a rendered heartbeat", () => {
    const h = {
      localVersion: "1.75.0",
      npmLatest: "1.75.0",
      syncStatus: "in-sync" as const,
      daemonRunning: true,
      vaccineCount: 8,
      inboxUnsent: 2,
      repoFingerprint: "abc123",
      checkedAt: "2026-05-12T15:00:00.000Z",
    };
    const md = renderHeartbeatMarkdown(h);
    const parsed = parseHeartbeat(md);
    expect(parsed).not.toBeNull();
    expect(parsed!.localVersion).toBe("1.75.0");
    expect(parsed!.npmLatest).toBe("1.75.0");
    expect(parsed!.syncStatus).toBe("in-sync");
    expect(parsed!.daemonRunning).toBe(true);
    expect(parsed!.vaccineCount).toBe(8);
    expect(parsed!.repoFingerprint).toBe("abc123");
  });

  it("parseHeartbeat returns null when section is missing", () => {
    expect(parseHeartbeat("no heartbeat here")).toBeNull();
  });

  it("parseHeartbeat handles npm_latest=(unknown)", () => {
    const md = renderHeartbeatMarkdown({
      localVersion: "1.75.0",
      npmLatest: null,
      syncStatus: "unknown",
      daemonRunning: false,
      vaccineCount: 0,
      inboxUnsent: 0,
      repoFingerprint: "x",
      checkedAt: "2026-05-12T15:00:00.000Z",
    });
    const parsed = parseHeartbeat(md);
    expect(parsed).not.toBeNull();
    expect(parsed!.npmLatest).toBeNull();
    expect(parsed!.syncStatus).toBe("unknown");
  });

  it("parseHeartbeat extracts from a longer text with surrounding sections", () => {
    const text = [
      "# 🧬 MNEME SOUL PROMPT",
      "",
      "## Context",
      "blah blah",
      "",
      "## Mneme Heartbeat (version telepathy)",
      "local_version: 1.75.0",
      "npm_latest: 1.75.0",
      "sync_status: in-sync ✓",
      "daemon: running",
      "vaccines: 8",
      "inbox_unsent: 2",
      "repo_fingerprint: zz9plural",
      "checked_at: 2026-05-12T15:00:00.000Z",
      "",
      "### What this means…",
      "irrelevant",
      "",
      "---",
      "ID: deadbeef",
    ].join("\n");
    const p = parseHeartbeat(text);
    expect(p).not.toBeNull();
    expect(p!.localVersion).toBe("1.75.0");
    expect(p!.repoFingerprint).toBe("zz9plural");
  });
});
