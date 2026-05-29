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

  it("v2.78.0 DE-WORM: update-available surfaces an INFO notice, NOT an [AUTO-ACTION]", async () => {
    // Was "surfaces an [AUTO-ACTION]". v2.78.0 makes version availability
    // purely informational — no level:"action", no autoAction, no EXECUTE NOW.
    // Upgrades are fully manual: the user is told a new version exists and how
    // to install it themselves.
    const { readLiveMnemeVersion } = await import("./version_check.js");
    const live = readLiveMnemeVersion();
    if (live === "unknown") return; // can't run this assertion without a live version
    writeFileSync(
      join(repo, ".mneme/version-check.json"),
      JSON.stringify({ current: live, latest: "9999.0.0" }),
      "utf8",
    );
    const s = collectPulseStatus(repo);
    expect(s.version.updateAvailable).toBe(true);
    // The version-available notice is INFO and carries NO autoAction.
    const upgradeNotice = s.notable.find((n) => n.text.includes("9999.0.0"));
    expect(upgradeNotice).toBeDefined();
    expect(upgradeNotice!.level).toBe("info");
    expect(upgradeNotice!.autoAction).toBeUndefined();
    expect(s.notable.some((n) => n.level === "action" && n.text.includes("is available"))).toBe(false);
    const out = renderPulse(s);
    expect(out).not.toContain("[AUTO-ACTION]");
    expect(out).toContain("mneme upgrade");
  });

  // v2.19.72 N5-DEEP regression — the self-heal half of the contract.
  // After an `npm install -g mneme-ai@<new>` finishes, the running
  // process resolves a NEW package.json (live current = <new>) but
  // .mneme/version-check.json still records `current = <old>` because
  // the cache TTL is 1h and nothing invalidates it on install.
  // Pre-fix: pulse would read `latest` from a cache whose `current`
  // field is meaningless, potentially showing
  // "v<new> (latest: v<new>)" or false update-available banners,
  // AND leaving a stale CURRENT_VERSION.md for AI agents to read.
  // Post-fix: the stale cache + memo are deleted; pulse treats it
  // as no-cache; next checkVersion() refetches + repopulates.
  it("v2.19.72 N5-deep: stale cache (current != live) is self-healed (cache + memo deleted)", async () => {
    const { readLiveMnemeVersion } = await import("./version_check.js");
    const live = readLiveMnemeVersion();
    if (live === "unknown") return;
    // SIMULATE: cache was written when v<old> was installed.  User has
    // since upgraded to live, but cache file + memo are stale.
    const cachePath = join(repo, ".mneme/version-check.json");
    const memoPath = join(repo, ".mneme/CURRENT_VERSION.md");
    writeFileSync(cachePath, JSON.stringify({ current: "0.0.1-old", latest: "9999.0.0" }), "utf8");
    writeFileSync(memoPath, "# stale memo — Installed: v0.0.1-old\n", "utf8");
    // Sanity check the setup landed.
    expect(existsSync(cachePath)).toBe(true);
    expect(existsSync(memoPath)).toBe(true);
    // Run pulse — triggers the self-heal.
    const s = collectPulseStatus(repo);
    // The stale cache + memo MUST be gone.
    expect(existsSync(cachePath), "stale version-check.json must be deleted on cache.current mismatch").toBe(false);
    expect(existsSync(memoPath), "stale CURRENT_VERSION.md must be deleted alongside the cache").toBe(false);
    // No false update-available signal — we have no valid cache.
    expect(s.version.updateAvailable).toBe(false);
    expect(s.version.latest, "latest must be null when cache was invalidated").toBeNull();
    // Live current is still reported correctly (read from package.json,
    // independent of the cache).
    expect(s.version.current).toBe(live);
  });

  // v1.27.3 (HOTFIX): regression tests for the AUTO-ACTION self-loop
  // bug. If `latest <= live current`, the pulse must NOT emit an
  // AUTO-ACTION upgrade notice -- otherwise an AI honoring the
  // EXECUTE NOW contract will call mneme.system.upgrade in a loop.
  it("v1.27.3 + v2.19.72 regression: stale cache (current != live) emits NO AUTO-ACTION (now via self-heal)", async () => {
    const { readLiveMnemeVersion } = await import("./version_check.js");
    const live = readLiveMnemeVersion();
    if (live === "unknown") return; // skip if we can't determine live version
    // SIMULATE: cache says "current=0.0.1-old, latest=<live>" — but
    // live IS <live>.  The upgrade was completed; the cache wasn't
    // refreshed.  Without the v1.27.3 fix, this would emit an
    // "upgrade to <live> (you're on <live>)" self-loop notice.
    //
    // v2.19.72 N5-deep: the cache is now ALSO self-healed (deleted)
    // when current != live, so we additionally assert latest === null
    // after the call.  The "no AUTO-ACTION" invariant is preserved
    // via a stronger guarantee — there's no cache at all to misread.
    writeFileSync(
      join(repo, ".mneme/version-check.json"),
      JSON.stringify({ current: "0.0.1-old", latest: live }),
      "utf8",
    );
    const s = collectPulseStatus(repo);
    expect(s.version.current).toBe(live);
    // Pre-v2.19.72 this was `live` because pulse trusted the cache's
    // latest field regardless of cache.current vintage.  Post-fix the
    // cache is deleted because cache.current !== live, so latest is null.
    expect(s.version.latest).toBeNull();
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
    // v2.78.0 DE-WORM — was "action"; version availability is now INFO-only.
    expect(upgradeNotice!.level).toBe("info");
  });

  it("v2.93.0 WHISPER: the upgrade notice surfaces ONCE then stays quiet (no per-turn nag)", async () => {
    const { readLiveMnemeVersion } = await import("./version_check.js");
    const live = readLiveMnemeVersion();
    if (live === "unknown") return;
    writeFileSync(join(repo, ".mneme/version-check.json"), JSON.stringify({ current: live, latest: "9999.0.0" }), "utf8");
    // first turn → whispers once
    const first = collectPulseStatus(repo);
    expect(first.notable.some((n) => n.text.includes("9999.0.0"))).toBe(true);
    // subsequent turns within the cooldown → SILENT (the un-luxurious nag is gone)
    expect(collectPulseStatus(repo).notable.some((n) => n.text.includes("9999.0.0"))).toBe(false);
    expect(collectPulseStatus(repo).notable.some((n) => n.text.includes("9999.0.0"))).toBe(false);
    // but the version state itself is still tracked (the signal isn't lost, just quiet)
    expect(collectPulseStatus(repo).version.updateAvailable).toBe(true);
    // a genuinely NEW version re-whispers exactly once
    writeFileSync(join(repo, ".mneme/version-check.json"), JSON.stringify({ current: live, latest: "9999.0.1" }), "utf8");
    expect(collectPulseStatus(repo).notable.some((n) => n.text.includes("9999.0.1"))).toBe(true);
    expect(collectPulseStatus(repo).notable.some((n) => n.text.includes("9999.0.1"))).toBe(false);
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

  it("renders all expected counters in quiet mode when notable", async () => {
    // v2.19.72 N5-deep: cache.current MUST match live for pulse to
    // trust it.  Use the live version so the self-heal doesn't fire +
    // updateAvailable signal lands in the rendered output.
    const { readLiveMnemeVersion } = await import("./version_check.js");
    const live = readLiveMnemeVersion();
    if (live === "unknown") return;
    writeFileSync(join(repo, ".mneme/version-check.json"), JSON.stringify({ current: live, latest: "9999.0.0" }), "utf8");
    const s = collectPulseStatus(repo);
    const out = renderPulse(s);
    expect(out).toMatch(/mneme v[\w.]+/);
    expect(out).toMatch(/daemon=/);
    expect(out).toMatch(/inbox-unsent=/); // v1.46.0 (#9 fix) — was inbox=N (ambiguous), now inbox-unsent=N matches list output
    expect(out).toMatch(/vaccines=/);
    expect(out).toMatch(/retrieval-trials=/);
  });
});
