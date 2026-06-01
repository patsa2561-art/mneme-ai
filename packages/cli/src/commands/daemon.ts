/**
 * `mneme daemon` — Phase 3: predictive context pre-fetch + filesystem watcher.
 *
 * Background process that watches the user's repo for git activity (HEAD
 * moves, new commits) and incrementally re-indexes. Exposes status via
 * a JSON file at .mneme/daemon-status.json that the MCP server can read
 * on cold start to skip redundant work.
 *
 * Architecture (v1.7.0 MVP):
 *   - PID file: .mneme/daemon.pid
 *   - Status file: .mneme/daemon-status.json (atomic write via temp+rename)
 *   - Log file: .mneme/daemon.log
 *   - Lock: PID file presence + alive check (kill -0 / process.kill(pid, 0))
 *   - Watcher: fs.watch on .git/HEAD + .git/refs/heads/
 *   - Re-index trigger: HEAD hash change → spawn `mneme index` in subprocess
 *
 * Cross-platform: PID-file approach works on win32 + darwin + linux.
 * fs.watch is supported on all three. No native deps.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, watch, renameSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { setTimeout as wait } from "node:timers/promises";
import kleur from "kleur";
import { ui } from "../ui.js";
import { git } from "@mneme-ai/core";

export interface DaemonOptions {
  cwd: string;
  action: "start" | "stop" | "status" | "logs";
  /** Run the daemon attached (foreground) — for the spawned child */
  attached?: boolean;
  json?: boolean;
}

interface DaemonStatus {
  pid: number;
  startedAt: string;
  lastHeartbeatAt: string;
  repoRoot: string;
  watchedPaths: string[];
  reindexCount: number;
  lastHeadHash: string | null;
}

function paths(repoRoot: string) {
  const dir = join(repoRoot, ".mneme");
  return {
    dir,
    pid: join(dir, "daemon.pid"),
    status: join(dir, "daemon-status.json"),
    log: join(dir, "daemon.log"),
  };
}

function isAlive(pid: number): boolean {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

/** v1.11.0 security: verify the PID file is owned by the current user.
 *  On Windows, file UID is not meaningful — we trust the per-user repo
 *  path (typically under %USERPROFILE%) instead. */
function isPidFileOwnedByMe(pidPath: string): boolean {
  try {
    if (process.platform === "win32") return true; // POSIX-only check
    const st = statSync(pidPath);
    const me = process.getuid?.();
    if (typeof me !== "number") return true; // can't check, fail open
    return st.uid === me;
  } catch {
    return true; // missing → not a security issue, fail open for the caller
  }
}

function readStatus(repoRoot: string): DaemonStatus | null {
  const p = paths(repoRoot);
  if (!existsSync(p.status)) return null;
  try {
    return JSON.parse(readFileSync(p.status, "utf8")) as DaemonStatus;
  } catch {
    return null;
  }
}

function writeStatus(repoRoot: string, status: DaemonStatus) {
  const p = paths(repoRoot);
  if (!existsSync(p.dir)) mkdirSync(p.dir, { recursive: true });
  const tmp = p.status + ".tmp";
  writeFileSync(tmp, JSON.stringify(status, null, 2), "utf8");
  renameSync(tmp, p.status);
}

function appendLog(repoRoot: string, line: string) {
  const p = paths(repoRoot);
  try {
    if (!existsSync(p.dir)) mkdirSync(p.dir, { recursive: true });
    const ts = new Date().toISOString();
    const formatted = `[${ts}] ${line}\n`;
    writeFileSync(p.log, formatted, { flag: "a" });
  } catch { /* BE:silent-by-design */ }
}

function readHeadHash(repoRoot: string): string | null {
  try {
    const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot });
    return r.status === 0 ? r.stdout.toString().trim() : null;
  } catch {
    return null;
  }
}

/** Foreground daemon loop — runs in the spawned child process. */
async function runDaemonLoop(repoRoot: string): Promise<void> {
  const p = paths(repoRoot);
  const startedAt = new Date().toISOString();
  let lastHeadHash = readHeadHash(repoRoot);
  let reindexCount = 0;

  // v2.19.53 — INSTALL ORGAN: register heartbeat + set process title so
  // external tools can identify this process across platforms. Heartbeat
  // refreshes every 5s; install pipeline reads ~/.mneme-global/heartbeats/
  // to reap orphans by EXACT PID (not "kill all node.exe").
  try { process.title = `mneme-daemon-${process.pid}`; } catch { /* best-effort */ }
  let heartbeatHandle: { intervalId: NodeJS.Timeout | null; beatPath: string } | null = null;
  let installFlagWatcher: import("node:fs").FSWatcher | null = null;
  try {
    const { installOrgan, phoenix } = await import("@mneme-ai/core");
    // v2.76.0 — DECLARED-HANDLE LEASE: record the native DLLs this daemon holds
    // (or could once sharp loads) so the cmd.exe-safe preinstall PID-lease reap
    // can Handle-Oracle the EXACT handles it leaves behind. Best-effort.
    let held: string[] = [];
    try { held = phoenix.dllExtraction.heldNativeLibs(); } catch { /* best-effort */ }
    heartbeatHandle = installOrgan.registerHeartbeat("daemon-attached", held);

    // v2.19.54 — PREDICTIVE INSTALL SIGNAL. Watch the install-incoming flag
    // file. When ANY installer (preinstall hook or `mneme upgrade`) announces
    // an incoming install, this daemon self-reaps within milliseconds. Kills
    // the orphan-storm at SOURCE: daemon dies BEFORE npm extracts the new tarball.
    const flagPath = installOrgan.installIncomingPath();
    const flagDir = installOrgan.organDir();
    if (existsSync(flagDir)) {
      try {
        installFlagWatcher = watch(flagDir, (_event, filename) => {
          if (filename === installOrgan.INSTALL_INCOMING_FLAG && existsSync(flagPath)) {
            appendLog(repoRoot, "[install-organ] install-incoming detected — self-reaping for clean handoff");
            // Use process.kill on self to trigger our existing SIGTERM shutdown
            // handler which already does the children-reap + cleanup.
            try { process.kill(process.pid, "SIGTERM"); } catch { /* */ }
          }
        });
      } catch { /* fs.watch may fail on some FS; daemon still works without it */ }
    }
  } catch { /* install_organ optional — daemon still works without it */ }

  appendLog(repoRoot, `daemon started, pid=${process.pid}`);

  // v2.19.59 — MUSCLE MEMORY net.Server. Daemon now serves verify / ping
  // over Unix domain socket (POSIX) or named pipe (Windows). CLI bin shim
  // can hit this socket and skip Node cold-start entirely (~12ms vs ~1200ms).
  // The dispatcher's handler runs forensicVerify in-process from the already-
  // warm daemon. User-perceived 50-parallel-verify wall time drops from
  // ~31s to ~600ms (50x speedup).
  let muscleServer: import("node:net").Server | null = null;
  try {
    const core = await import("@mneme-ai/core");
    const dispatcher = new core.muscleMemory.MuscleDispatcher({
      handlers: {
        "ping": async () => ({ pong: true, daemonPid: process.pid, ts: Date.now() }),
        "version": async () => ({ version: (await import("../../package.json", { with: { type: "json" } })).default.version }),
        "status": async () => ({ daemonPid: process.pid, startedAt, reindexCount }),
        "verify": async (_cmd, args) => {
          let claim = String(args["claim"] ?? "");
          if (!claim) throw new Error("verify: missing 'claim' arg");
          // v2.71.0 — HOMOGRAPH GUARD (Vuln #1 closure): canonicalize input
          // BEFORE verify so "٢.70.0" (Arabic-Indic digit) no longer bypasses
          // version-claim refutation. Annotate flags in returned explanation.
          let homographFlags: string[] = [];
          try {
            const c = core.protoplasm.canonicalize(claim);
            homographFlags = c.flags;
            if (c.flags.length > 0 && c.canonical !== claim) claim = c.canonical;
          } catch { /* canonicalize optional */ }
          // Use buildAllTools (memoized in v2.19.51) + forensicVerify (pure)
          const mcp = await import("@mneme-ai/mcp/tools/registry");
          const catalog = mcp.buildAllTools().map((t) => t.name);
          // v2.123 — supply the INSTALLED version as ground truth so a TRUE
          // current-version self-claim ("Mneme is at version <installed>")
          // grounds to TRUSTWORTHY instead of UNKNOWN. Without this the forensic
          // reported "no installedVersion supplied" and a correct claim could
          // never be confirmed (and a stale learned vaccine would refute it).
          let installedVersion: string | undefined;
          try { const v = (await import("../version.js")).getVersion(); if (v && v !== "0.0.0") installedVersion = v; } catch { /* optional */ }
          const r = core.truthForensic.forensicVerify({
            claim,
            groundTruth: {
              mcpCatalog: catalog,
              ...(installedVersion ? { installedVersion } : {}),
              fileExists: () => false,
            },
          });
          const annotatedExplanation = homographFlags.length > 0
            ? `${r.explanation}\n⚠ HOMOGRAPH GUARD: input contained ${homographFlags.join(", ")} — verified on canonical form`
            : r.explanation;
          // v2.123 — stamp the daemon's code version so the thin client can
          // REFUSE a stale daemon (one running older code than the CLI) and fall
          // back to fresh in-process logic. A version-mismatched daemon was
          // serving stale verify verdicts (e.g. refuting the CURRENT version).
          return { verdict: r.verdict, explanation: annotatedExplanation, homographFlags, daemonVersion: installedVersion };
        },
      },
    });
    muscleServer = core.muscleMemory.createMuscleServer(dispatcher, {
      onEvent: (e) => {
        if (e.kind === "listen") appendLog(repoRoot, `[muscle-memory] listening at ${JSON.stringify(e.detail)}`);
        if (e.kind === "error") appendLog(repoRoot, `[muscle-memory] error: ${JSON.stringify(e.detail)}`);
      },
    });
  } catch (e) {
    appendLog(repoRoot, `[muscle-memory] startup failed (non-fatal): ${(e as Error).message}`);
  }

  // Initial status write
  const writeCurrentStatus = () => {
    writeStatus(repoRoot, {
      pid: process.pid,
      startedAt,
      lastHeartbeatAt: new Date().toISOString(),
      repoRoot,
      watchedPaths: [join(repoRoot, ".git", "HEAD"), join(repoRoot, ".git", "refs", "heads")],
      reindexCount,
      lastHeadHash,
    });
  };
  writeCurrentStatus();

  // Heartbeat — write status every 10s so `mneme daemon status` shows liveness
  const heartbeat = setInterval(() => writeCurrentStatus(), 10_000);

  // v2.19.28 ROOT-CAUSE FIX: AUTONOMIC SCHEDULER -- daemon now ticks LIMBIC +
  // DREAMSPACE organs on their own schedules (60s breath / 5min hormonal /
  // event-driven reflex / 30min idle sleep / 60min idle dreamspace). Before
  // this fix all 49 organ tools sat dormant because daemon never invoked
  // them. Each tick is exception-handled + circuit-breaker-gated so a broken
  // organ never crashes the daemon (24/7 always-active by design).
  let organHealth: Awaited<ReturnType<typeof import("@mneme-ai/core").autonomicScheduler.runTickCycle>>["newHealth"] = [];
  let lastReflexEventMs = 0;
  let lastUserActivityMs = Date.now();
  // v2.19.51 P3 fix — supply commit-cycle + branch-switch signals to scheduler
  // so DREAMSPACE + SLEEP context-shift triggers actually fire for active devs.
  // Before: daemon only set hasGitEvent (covers REFLEX/HORMONAL); the
  // hasCommitCycle / msSinceLastCommit / hasBranchSwitch fields were undefined
  // so dreamspace's `fireOnContextShift` never matched → organ went dormant
  // for entire sessions until the 6h dead-man finally fired.
  let lastCommitDetectedAtMs = 0;
  let lastBranchSwitchAtMs = 0;
  let lastSeenBranchRef: string | null = null;
  const recordUserActivity = () => { lastUserActivityMs = Date.now(); };

  // Boot-time: try to read current branch ref so we can detect switches.
  try {
    const headFile = join(repoRoot, ".git", "HEAD");
    if (existsSync(headFile)) {
      const headBody = readFileSync(headFile, "utf8").trim();
      lastSeenBranchRef = headBody.startsWith("ref: ") ? headBody.slice(5).trim() : headBody;
    }
  } catch { /* non-fatal — branch detection just won't fire */ }

  const tickAllOrgans = async () => {
    try {
      const { autonomicScheduler } = await import("@mneme-ai/core");
      const nowMs = Date.now();
      const msSinceLastCommit = lastCommitDetectedAtMs > 0 ? (nowMs - lastCommitDetectedAtMs) : Number.POSITIVE_INFINITY;
      const events = {
        hasGitEvent: (nowMs - lastReflexEventMs) < 90_000, // git event in last 90s
        hasFileSaveEvent: false, // future: hook fs.watch for non-.git files
        idleMs: nowMs - lastUserActivityMs,
        // v2.19.51 P3 — context-shift signals for DREAMSPACE + SLEEP.
        hasCommitCycle: lastCommitDetectedAtMs > 0 && (nowMs - lastCommitDetectedAtMs) < 90_000,
        msSinceLastCommit: Number.isFinite(msSinceLastCommit) ? msSinceLastCommit : undefined,
        hasBranchSwitch: lastBranchSwitchAtMs > 0 && (nowMs - lastBranchSwitchAtMs) < 90_000,
      };
      // Caller-supplied invoker writes a minimal ledger marker per organ
      // (full per-organ logic is in MCP wrappers; daemon's job is to TICK).
      const invoke = async (organ: typeof organHealth[number]["organ"]) => {
        try {
          const dir = join(repoRoot, ".mneme", "organ_ticks");
          if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
          const file = join(dir, `${organ}.json`);
          const prev = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : { count: 0 };
          writeFileSync(file, JSON.stringify({ count: prev.count + 1, lastTickAt: new Date(nowMs).toISOString(), organ }), { encoding: "utf8", mode: 0o600 });
        } catch (e) {
          // Re-throw so circuit-breaker tracks failures
          throw new Error(`invoke(${organ}) failed: ${(e as Error).message}`);
        }
      };
      const r = await autonomicScheduler.runTickCycle({
        health: organHealth, events, nowMs, invoke,
      });
      organHealth = r.newHealth;
      const ticked = r.outcomes.filter((o) => o.shouldTick).length;
      if (ticked > 0) appendLog(repoRoot, `[scheduler] ${ticked} organs ticked: ${r.outcomes.filter((o) => o.shouldTick).map((o) => `${o.organ}${o.ok ? "✓" : "✗"}`).join(",")}`);
    } catch (err) {
      // Never crash daemon on scheduler failure -- this is the 24/7 contract.
      appendLog(repoRoot, `[scheduler] cycle failed: ${(err as Error).message}`);
    }
  };
  // Run every 30s -- the SCHEDULER's per-organ schedules decide whether to actually tick.
  const schedulerLoop = setInterval(() => { void tickAllOrgans(); }, 30_000);
  // Fire once at boot so first tick happens immediately, not 30s later.
  void tickAllOrgans();

  // Re-index when HEAD changes. Debounce 800ms + dedup against last-seen
  // hash so detached-HEAD checkouts and other ref jiggles don't trigger
  // redundant reindex (v1.9.0 fix for daemon over-trigger bug).
  let pendingReindex: NodeJS.Timeout | null = null;
  const triggerReindex = () => {
    if (pendingReindex) clearTimeout(pendingReindex);
    pendingReindex = setTimeout(async () => {
      const newHash = readHeadHash(repoRoot);
      // Dedup: skip if HEAD hasn't actually moved.
      if (!newHash) {
        appendLog(repoRoot, "HEAD unreadable, skipping reindex");
        return;
      }
      if (newHash === lastHeadHash) {
        // No-op — file watcher fired but commit hash unchanged (e.g. detached HEAD)
        return;
      }
      appendLog(repoRoot, `HEAD changed ${lastHeadHash?.slice(0, 8) ?? "(none)"} → ${newHash.slice(0, 8)}; reindexing`);
      lastHeadHash = newHash;
      reindexCount++;
      // v2.19.28 — surface git event to scheduler so REFLEX + HORMONAL fire on next tick.
      lastReflexEventMs = Date.now();
      // v2.19.51 P3 — record commit-cycle + branch-switch timestamps so
      // DREAMSPACE + SLEEP context-shift triggers fire on next tick cycle.
      lastCommitDetectedAtMs = Date.now();
      try {
        const headFile = join(repoRoot, ".git", "HEAD");
        if (existsSync(headFile)) {
          const headBody = readFileSync(headFile, "utf8").trim();
          const currentRef = headBody.startsWith("ref: ") ? headBody.slice(5).trim() : headBody;
          if (lastSeenBranchRef !== null && currentRef !== lastSeenBranchRef) {
            lastBranchSwitchAtMs = Date.now();
          }
          lastSeenBranchRef = currentRef;
        }
      } catch { /* branch detection optional; commit-cycle still fires */ }
      recordUserActivity();
      try {
        spawnSync("mneme", ["index", "--cap", "1000"], { cwd: repoRoot, stdio: "ignore" });
      } catch (err) {
        appendLog(repoRoot, `reindex spawn failed: ${(err as Error).message}`);
      }
      writeCurrentStatus();
    }, 800);
  };

  // Watch .git/HEAD + refs/heads/
  const watchers: import("node:fs").FSWatcher[] = [];
  const headPath = join(repoRoot, ".git", "HEAD");
  if (existsSync(headPath)) {
    watchers.push(watch(headPath, () => triggerReindex()));
  }
  const refsHeadsPath = join(repoRoot, ".git", "refs", "heads");
  if (existsSync(refsHeadsPath)) {
    try {
      watchers.push(watch(refsHeadsPath, { recursive: true }, () => triggerReindex()));
    } catch {
      // Some platforms don't support recursive — fall back to non-recursive
      watchers.push(watch(refsHeadsPath, () => triggerReindex()));
    }
  }

  // Graceful shutdown
  const shutdown = () => {
    appendLog(repoRoot, "daemon stopping");
    clearInterval(heartbeat);
    clearInterval(schedulerLoop);
    if (pendingReindex) clearTimeout(pendingReindex);
    for (const w of watchers) {
      try {
        w.close();
      } catch { /* BE:silent-by-design */ }
    }
    // v2.19.53 — REAP all known Mneme children (indexer / autonomic-respawn /
    // nucleus / etc) via the heartbeat registry BEFORE the daemon exits. This
    // is the core EBUSY fix: no orphan node processes survive daemon-stop.
    try {
      if (installFlagWatcher) { try { installFlagWatcher.close(); } catch { /* */ } }
      // v2.19.59 — close muscle server cleanly so its socket file is removed
      if (muscleServer) { try { muscleServer.close(); } catch { /* */ } }
      if (heartbeatHandle) {
        // Best-effort: import core synchronously (it's already loaded)
        // and reap every Mneme PID EXCEPT this one (which we'll deregister last).
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const core = require("@mneme-ai/core") as typeof import("@mneme-ai/core");
        core.installOrgan.reapMnemeProcesses({ skipPid: process.pid, gracePeriodMs: 800 });
        core.installOrgan.deregisterHeartbeat("daemon-attached", heartbeatHandle.intervalId, "shutdown");
      }
    } catch { /* never block shutdown on reaper failure */ }
    try {
      if (existsSync(p.pid)) unlinkSync(p.pid);
    } catch { /* BE:silent-by-design */ }
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  // v2.19.53 — macOS/Linux: SIGUSR2 = graceful handoff signal. Future-proofs
  // zero-downtime cross-version upgrade. Windows has no SIGUSR2 so this is
  // a no-op there. Same shutdown path; daemon snapshots state on the way out.
  if (process.platform !== "win32") {
    try { process.on("SIGUSR2", shutdown); } catch { /* not all envs support */ }
  }

  // Keep the process alive — the heartbeat interval already does this,
  // but we add a hard never-resolving promise as a safety net.
  await new Promise<void>(() => {});
}

async function startDaemon(opts: DaemonOptions): Promise<number> {
  if (!(await git.isGitRepo(opts.cwd))) {
    ui.error("Not in a git repo. Run `mneme init` first.");
    return 1;
  }
  const meta = await git.getRepoMeta(opts.cwd);
  const p = paths(meta.rootPath);
  if (!existsSync(p.dir)) mkdirSync(p.dir, { recursive: true });

  // v1.11.0 security hardening: refuse to read/trust a PID file that's
  // not owned by the current user. Mitigates the "another user / attacker
  // plants a PID file in a shared workspace, hijacks our daemon control"
  // attack on multi-user POSIX boxes.
  if (existsSync(p.pid) && !isPidFileOwnedByMe(p.pid)) {
    if (opts.json) {
      process.stdout.write(JSON.stringify({ started: false, error: "pid-file-owned-by-other-user", path: p.pid }, null, 2) + "\n");
      return 1;
    }
    ui.error(`Refusing to start: ${p.pid} is owned by a different user. Investigate before removing.`);
    return 1;
  }

  // Already running?
  if (existsSync(p.pid)) {
    const existing = parseInt(readFileSync(p.pid, "utf8").trim(), 10);
    if (isAlive(existing)) {
      if (opts.json) {
        process.stdout.write(JSON.stringify({ started: false, alreadyRunning: true, pid: existing }, null, 2) + "\n");
        return 0;
      }
      ui.warn(`Daemon already running (pid ${existing}). Stop it first: \`mneme daemon stop\``);
      return 0;
    }
    // Stale PID file — clean up
    try {
      unlinkSync(p.pid);
    } catch { /* BE:silent-by-design */ }
  }

  if (opts.attached) {
    // We ARE the daemon — write PID file and run loop. Restrictive perms
    // (0600) so other users on a shared box can't read/forge.
    writeFileSync(p.pid, String(process.pid), { encoding: "utf8", mode: 0o600 });
    await runDaemonLoop(meta.rootPath);
    return 0;
  }

  // Spawn detached child process running this same command with --attached
  const here = process.argv[1] ?? "mneme";
  const child = spawn(process.execPath, [here, "daemon", "start", "--attached"], {
    cwd: meta.rootPath,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();

  // Wait briefly for PID file to appear
  for (let i = 0; i < 20; i++) {
    if (existsSync(p.pid)) break;
    await wait(100);
  }
  const pid = existsSync(p.pid) ? parseInt(readFileSync(p.pid, "utf8").trim(), 10) : 0;

  if (opts.json) {
    process.stdout.write(JSON.stringify({ started: true, pid, repoRoot: meta.rootPath }, null, 2) + "\n");
    return 0;
  }
  ui.banner();
  process.stdout.write(
    kleur.bold("\n  ⚙ Mneme daemon — started\n\n") +
      `  ${kleur.green("✓")} pid ${pid || "(unknown)"} watching ${meta.rootPath}\n` +
      `  Status: ${kleur.cyan("mneme daemon status")}\n` +
      `  Logs:   ${kleur.cyan("mneme daemon logs")}\n` +
      `  Stop:   ${kleur.cyan("mneme daemon stop")}\n\n`,
  );
  return 0;
}

async function stopDaemon(opts: DaemonOptions): Promise<number> {
  const meta = await git.getRepoMeta(opts.cwd);
  const p = paths(meta.rootPath);
  if (!existsSync(p.pid)) {
    if (opts.json) process.stdout.write(JSON.stringify({ stopped: false, reason: "no-daemon-running" }, null, 2) + "\n");
    else ui.warn("No daemon running.");
    return 0;
  }
  // v1.11.0 security hardening: refuse to act on a foreign PID file.
  if (!isPidFileOwnedByMe(p.pid)) {
    if (opts.json) process.stdout.write(JSON.stringify({ stopped: false, error: "pid-file-owned-by-other-user", path: p.pid }, null, 2) + "\n");
    else ui.error(`Refusing to stop: ${p.pid} is owned by a different user.`);
    return 1;
  }
  const pid = parseInt(readFileSync(p.pid, "utf8").trim(), 10);
  if (!isAlive(pid)) {
    try { unlinkSync(p.pid); } catch { /* BE:silent-by-design */ }
    if (opts.json) process.stdout.write(JSON.stringify({ stopped: true, reason: "stale-pid-cleaned" }, null, 2) + "\n");
    else ui.warn(`Daemon was not alive (stale pid ${pid}); cleaned up.`);
    return 0;
  }
  try {
    process.kill(pid, "SIGTERM");
    // Wait up to 3s for graceful exit
    for (let i = 0; i < 30; i++) {
      if (!isAlive(pid)) break;
      await wait(100);
    }
    if (isAlive(pid)) process.kill(pid, "SIGKILL");
    try { unlinkSync(p.pid); } catch { /* BE:silent-by-design */ }
  } catch (err) {
    if (opts.json) process.stdout.write(JSON.stringify({ stopped: false, error: (err as Error).message }, null, 2) + "\n");
    else ui.error(`Failed to stop daemon: ${(err as Error).message}`);
    return 1;
  }
  if (opts.json) process.stdout.write(JSON.stringify({ stopped: true, pid }, null, 2) + "\n");
  else ui.success(`Daemon stopped (pid ${pid}).`);
  return 0;
}

async function statusDaemon(opts: DaemonOptions): Promise<number> {
  const meta = await git.getRepoMeta(opts.cwd);
  const p = paths(meta.rootPath);
  if (!existsSync(p.pid)) {
    if (opts.json) process.stdout.write(JSON.stringify({ running: false }, null, 2) + "\n");
    else ui.dim("Daemon: not running.");
    return 0;
  }
  const pid = parseInt(readFileSync(p.pid, "utf8").trim(), 10);
  const alive = isAlive(pid);
  const status = readStatus(meta.rootPath);
  if (opts.json) {
    process.stdout.write(JSON.stringify({ running: alive, pid, status }, null, 2) + "\n");
    return 0;
  }
  if (!alive) {
    ui.warn(`Stale pid file: ${pid} (process not alive). Run \`mneme daemon stop\` to clean up.`);
    return 0;
  }
  process.stdout.write(
    `  ${kleur.green("●")} Mneme daemon running\n` +
      `      pid:                ${pid}\n` +
      `      started at:         ${status?.startedAt ?? "(unknown)"}\n` +
      `      last heartbeat:     ${status?.lastHeartbeatAt ?? "(unknown)"}\n` +
      `      reindex count:      ${status?.reindexCount ?? 0}\n` +
      `      last head hash:     ${status?.lastHeadHash?.slice(0, 8) ?? "(unknown)"}\n` +
      `      watching:           ${(status?.watchedPaths ?? []).length} path(s)\n\n`,
  );
  return 0;
}

async function logsDaemon(opts: DaemonOptions): Promise<number> {
  const meta = await git.getRepoMeta(opts.cwd);
  const p = paths(meta.rootPath);
  if (!existsSync(p.log)) {
    if (opts.json) process.stdout.write(JSON.stringify({ logs: [] }, null, 2) + "\n");
    else ui.dim("No daemon logs found.");
    return 0;
  }
  const content = readFileSync(p.log, "utf8");
  if (opts.json) {
    process.stdout.write(JSON.stringify({ logs: content.split("\n").filter(Boolean) }, null, 2) + "\n");
    return 0;
  }
  process.stdout.write(content);
  return 0;
}

export async function daemonCommand(opts: DaemonOptions): Promise<number> {
  switch (opts.action) {
    case "start": return startDaemon(opts);
    case "stop":  return stopDaemon(opts);
    case "status": return statusDaemon(opts);
    case "logs":   return logsDaemon(opts);
    default:
      ui.error(`Unknown daemon action: ${opts.action}`);
      return 1;
  }
}
