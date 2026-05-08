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
  } catch {}
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

  appendLog(repoRoot, `daemon started, pid=${process.pid}`);

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
    if (pendingReindex) clearTimeout(pendingReindex);
    for (const w of watchers) {
      try {
        w.close();
      } catch {}
    }
    try {
      if (existsSync(p.pid)) unlinkSync(p.pid);
    } catch {}
    process.exit(0);
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

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
    } catch {}
  }

  if (opts.attached) {
    // We ARE the daemon — write PID file and run loop
    writeFileSync(p.pid, String(process.pid), "utf8");
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
  const pid = parseInt(readFileSync(p.pid, "utf8").trim(), 10);
  if (!isAlive(pid)) {
    try { unlinkSync(p.pid); } catch {}
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
    try { unlinkSync(p.pid); } catch {}
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
