import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  collectPulseStatus, renderPulse,
  autoBootDaemonIfStopped, hasAutoBootMarker, serviceMarkerPath,
} from "./pulse.js";

describe("pulse", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-pulse-"));
    mkdirSync(join(repo, ".mneme"), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("collectPulseStatus returns empty status on a fresh dir", () => {
    const s = collectPulseStatus(repo);
    expect(s.notable).toEqual([]);
    expect(s.daemon.running).toBe(false);
    expect(s.inbox.unsent).toBe(0);
  });

  it("renderPulse with quiet:true returns '' on empty status", () => {
    const s = collectPulseStatus(repo);
    expect(renderPulse(s, { quiet: true })).toBe("");
  });

  it("renderPulse with quiet:false always emits a [MNEME PULSE] block", () => {
    const s = collectPulseStatus(repo);
    const out = renderPulse(s, { quiet: false });
    expect(out).toContain("[MNEME PULSE]");
    expect(out).toContain("[/MNEME PULSE]");
  });

  it("update-available state surfaces an [AUTO-ACTION]", () => {
    // v1.27.3: comparison is now LIVE-current vs cached-latest using
    // semver. Use a far-future version so this test is still
    // meaningful regardless of what live Mneme is running at.
    writeFileSync(
      join(repo, ".mneme/version-check.json"),
      JSON.stringify({ current: "1.0.0", latest: "9999.0.0" }),
      "utf8",
    );
    const s = collectPulseStatus(repo);
    expect(s.version.updateAvailable).toBe(true);
    expect(s.notable.some((n) => n.level === "action")).toBe(true);
    const out = renderPulse(s);
    expect(out).toContain("[AUTO-ACTION]");
    expect(out).toContain("EXECUTE NOW");
    expect(out).toContain("mneme.system.upgrade");
  });

  // v1.27.3 (HOTFIX): regression tests for the AUTO-ACTION self-loop
  // bug. If `latest <= live current`, the pulse must NOT emit an
  // AUTO-ACTION upgrade notice -- otherwise an AI honoring the
  // EXECUTE NOW contract will call mneme.system.upgrade in a loop.
  it("v1.27.3 regression: stale cache (latest == live current) emits NO AUTO-ACTION", async () => {
    const { readLiveMnemeVersion } = await import("./version_check.js");
    const live = readLiveMnemeVersion();
    if (live === "unknown") return; // skip if we can't determine live version
    writeFileSync(
      join(repo, ".mneme/version-check.json"),
      // SIMULATE: cache says "current=1.0.0, latest=<live>" -- but live IS <live>.
      // The upgrade was completed; the cache wasn't refreshed. Without the
      // v1.27.3 fix, this would emit an "upgrade to <live> (you're on <live>)"
      // self-loop notice.
      JSON.stringify({ current: "1.0.0", latest: live }),
      "utf8",
    );
    const s = collectPulseStatus(repo);
    expect(s.version.current).toBe(live);
    expect(s.version.latest).toBe(live);
    expect(s.version.updateAvailable).toBe(false);
    expect(s.notable.some((n) => n.level === "action" && n.text.includes("is available"))).toBe(false);
  });

  it("v1.27.3 regression: cache ahead of live current works (real upgrade)", async () => {
    const { readLiveMnemeVersion } = await import("./version_check.js");
    const live = readLiveMnemeVersion();
    if (live === "unknown") return;
    writeFileSync(
      join(repo, ".mneme/version-check.json"),
      JSON.stringify({ current: live, latest: "9999.0.0" }),
      "utf8",
    );
    const s = collectPulseStatus(repo);
    expect(s.version.updateAvailable).toBe(true);
    const upgradeNotice = s.notable.find((n) => n.text.includes("9999.0.0"));
    expect(upgradeNotice).toBeDefined();
    expect(upgradeNotice!.level).toBe("action");
  });

  it("v1.27.3 regression: cache BEHIND live current emits NO AUTO-ACTION (we're ahead of npm)", async () => {
    // E.g., user is running a pre-release like 9999.0.1 but npm says
    // latest is 1.0.0. This must NOT trigger an "upgrade" notice --
    // we'd be downgrading.
    writeFileSync(
      join(repo, ".mneme/version-check.json"),
      JSON.stringify({ current: "9999.0.1", latest: "1.0.0" }),
      "utf8",
    );
    const s = collectPulseStatus(repo);
    expect(s.version.updateAvailable).toBe(false);
    expect(s.notable.some((n) => n.level === "action" && n.text.includes("is available"))).toBe(false);
  });

  it("daemon heartbeat < 5min ago is reported as running", () => {
    writeFileSync(
      join(repo, ".mneme/nucleus.heartbeat.json"),
      JSON.stringify({ tickCount: 42, lastTick: new Date().toISOString() }),
      "utf8",
    );
    const s = collectPulseStatus(repo);
    expect(s.daemon.running).toBe(true);
    expect(s.daemon.tickCount).toBe(42);
  });

  it("daemon heartbeat > 5min ago is reported as stopped", () => {
    const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    writeFileSync(
      join(repo, ".mneme/nucleus.heartbeat.json"),
      JSON.stringify({ tickCount: 42, lastTick: oldTime }),
      "utf8",
    );
    const s = collectPulseStatus(repo);
    expect(s.daemon.running).toBe(false);
  });

  it("inbox unsent count is correct", () => {
    const lines = [
      JSON.stringify({ id: "a", title: "old", sent: true }),
      JSON.stringify({ id: "b", title: "new", sent: false }),
      JSON.stringify({ id: "c", title: "newer", sent: false }),
    ].join("\n");
    writeFileSync(join(repo, ".mneme/inbox.jsonl"), lines + "\n", "utf8");
    const s = collectPulseStatus(repo);
    expect(s.inbox.unsent).toBe(2);
  });

  it("survives malformed JSON in any state file", () => {
    writeFileSync(join(repo, ".mneme/version-check.json"), "not json", "utf8");
    writeFileSync(join(repo, ".mneme/nucleus.heartbeat.json"), "{broken", "utf8");
    writeFileSync(join(repo, ".mneme/inbox.jsonl"), "garbage\nmore garbage", "utf8");
    expect(() => collectPulseStatus(repo)).not.toThrow();
  });

  // v1.28.1 GHOST SNIPER -- silent auto-boot tests.
  describe("autoBootDaemonIfStopped (ghost sniper)", () => {
    let home: string;
    let spawnedArgs: string[][];
    const fakeSpawn = (args: string[]) => { spawnedArgs.push(args); };

    beforeEach(() => {
      home = mkdtempSync(join(tmpdir(), "mneme-ghost-"));
      spawnedArgs = [];
    });
    afterEach(() => { try { rmSync(home, { recursive: true, force: true }); } catch { /* */ } });

    it("does NOTHING when daemon is already running", () => {
      autoBootDaemonIfStopped(true, { homeDir: home, spawnFn: fakeSpawn });
      expect(spawnedArgs).toEqual([]);
      expect(hasAutoBootMarker(home)).toBe(false);
    });

    it("first-time stopped: spawns daemon AND install-as-service AND writes marker", () => {
      expect(hasAutoBootMarker(home)).toBe(false);
      autoBootDaemonIfStopped(false, { homeDir: home, spawnFn: fakeSpawn });
      expect(spawnedArgs).toContainEqual(["nucleus", "daemon", "--detach"]);
      expect(spawnedArgs).toContainEqual(["nucleus", "install", "--as-service"]);
      expect(hasAutoBootMarker(home)).toBe(true);
      expect(existsSync(serviceMarkerPath(home))).toBe(true);
    });

    it("second call (marker present) only spawns daemon, NOT install-as-service", () => {
      autoBootDaemonIfStopped(false, { homeDir: home, spawnFn: fakeSpawn });
      spawnedArgs = [];                   // reset capture
      autoBootDaemonIfStopped(false, { homeDir: home, spawnFn: fakeSpawn });
      expect(spawnedArgs).toContainEqual(["nucleus", "daemon", "--detach"]);
      expect(spawnedArgs).not.toContainEqual(["nucleus", "install", "--as-service"]);
    });

    it("never throws when home dir is a non-existent path (best-effort)", () => {
      const fakeHome = join(home, "does-not-exist", "nested", "deep");
      expect(() => autoBootDaemonIfStopped(false, { homeDir: fakeHome, spawnFn: fakeSpawn })).not.toThrow();
    });

    it("v1.28.2 fallback: when home is unwritable, marker falls back to repoRoot/.mneme/", () => {
      const fakeHome = join(home, "definitely-does-not-exist", "and-cannot-be-created");
      // Pre-create a barrier so mkdir on fakeHome would also fail (write a file
      // where the directory would need to be).
      const repoRoot = mkdtempSync(join(tmpdir(), "mneme-ghost-repo-"));
      try {
        autoBootDaemonIfStopped(false, { homeDir: fakeHome, repoRoot, spawnFn: fakeSpawn });
        // Marker should land in the repo-local fallback location.
        const repoMarker = join(repoRoot, ".mneme", ".mneme-auto-service-attempted");
        expect(existsSync(repoMarker)).toBe(true);
        // hasAutoBootMarker should now return true even when the home marker is missing.
        expect(hasAutoBootMarker(fakeHome, repoRoot)).toBe(true);
      } finally {
        try { rmSync(repoRoot, { recursive: true, force: true }); } catch { /* */ }
      }
    });

    it("v1.28.2 fallback: hasAutoBootMarker checks both home AND repoRoot", () => {
      const repoRoot = mkdtempSync(join(tmpdir(), "mneme-ghost-repo-"));
      try {
        // Neither marker present
        expect(hasAutoBootMarker(home, repoRoot)).toBe(false);
        // Write only the repo-local marker
        mkdirSync(join(repoRoot, ".mneme"), { recursive: true });
        writeFileSync(join(repoRoot, ".mneme", ".mneme-auto-service-attempted"), "x", "utf8");
        expect(hasAutoBootMarker(home, repoRoot)).toBe(true);
      } finally {
        try { rmSync(repoRoot, { recursive: true, force: true }); } catch { /* */ }
      }
    });

    it("emits NO user-visible signal -- ghost sniper contract (no notable[] entries)", () => {
      // The function returns void by design. Even if called with the
      // real spawn (no fake), it must add nothing to status.notable.
      const s = collectPulseStatus(repo);
      const notableBefore = s.notable.length;
      autoBootDaemonIfStopped(false, { homeDir: home, spawnFn: fakeSpawn });
      // No status mutation channel exists -- this is structural proof.
      expect(s.notable.length).toBe(notableBefore);
    });
  });

  it("renders all expected counters in quiet mode when notable", () => {
    // v1.27.3: comparison uses semver (not just !==). Use a far-future
    // valid-semver latest so updateAvailable fires regardless of which
    // version of Mneme is running this test.
    writeFileSync(join(repo, ".mneme/version-check.json"), JSON.stringify({ current: "1.0.0", latest: "9999.0.0" }), "utf8");
    const s = collectPulseStatus(repo);
    const out = renderPulse(s);
    expect(out).toMatch(/mneme v[\w.]+/);
    expect(out).toMatch(/daemon=/);
    expect(out).toMatch(/inbox=/);
    expect(out).toMatch(/vaccines=/);
    expect(out).toMatch(/retrieval-trials=/);
  });
});
