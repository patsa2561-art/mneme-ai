/**
 * v2.19.23 — CLI-side BREATH hook (G1 killer integration)
 *
 *   The pure-function decision logic lives in @mneme-ai/core
 *   `autonomicBreath`. THIS file does the actual filesystem reads +
 *   detached spawn (the side-effects Node can't do in a pure module).
 *
 *   Called once at CLI preAction. Silent on success. Never blocks
 *   the user-visible command for more than ~50ms in the alive path.
 *
 * Skipped for: `daemon` command itself (avoid recursive respawn);
 * `--version`, `--help`, `-V`, `-h`; the `init` command on a fresh
 * repo (which may not have .mneme dir yet).
 */

import { existsSync, readFileSync, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { join } from "node:path";
import { autonomicBreath, git } from "@mneme-ai/core";

const HEARTBEAT_BUDGET_MS = 50;

function pidIsAlive(pid: number): boolean {
  if (!pid || pid <= 0 || Number.isNaN(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

function probePidFile(repoRoot: string): { pid: number; alive: boolean; exists: boolean; mtimeMs: number } {
  const p = join(repoRoot, ".mneme", "daemon.pid");
  if (!existsSync(p)) return { pid: NaN, alive: false, exists: false, mtimeMs: 0 };
  let pid = NaN;
  let mtimeMs = 0;
  try {
    pid = parseInt(readFileSync(p, "utf8").trim(), 10);
    mtimeMs = statSync(p).mtimeMs;
  } catch {
    return { pid: NaN, alive: false, exists: false, mtimeMs: 0 };
  }
  return { pid, alive: pidIsAlive(pid), exists: true, mtimeMs };
}

/**
 * Decide + respawn (silent). Returns the outcome action so callers can
 * record telemetry. Never throws. Never prints to stdout/stderr on the
 * success paths (already_alive, respawned silently). Only logs to
 * .mneme/breath.log on failure.
 */
export async function ensureAutonomicBreath(opts: { cwd: string; commandName: string }): Promise<{
  action: "skipped" | "already_alive" | "respawned" | "no_pid_file" | "failed" | "throttled";
  ms: number;
}> {
  const t0 = Date.now();
  // Skip self-recursion: daemon command manages its own lifecycle.
  if (opts.commandName === "daemon" || opts.commandName === "init") {
    return { action: "skipped", ms: Date.now() - t0 };
  }
  // Skip when not in a git repo (init hasn't run yet; respawn would be pointless).
  try {
    if (!(await git.isGitRepo(opts.cwd))) return { action: "skipped", ms: Date.now() - t0 };
  } catch {
    return { action: "skipped", ms: Date.now() - t0 };
  }
  let repoRoot: string;
  try {
    const meta = await git.getRepoMeta(opts.cwd);
    repoRoot = meta.rootPath;
  } catch {
    return { action: "skipped", ms: Date.now() - t0 };
  }
  const probeResult = probePidFile(repoRoot);
  const probe = {
    pidIsAlive: probeResult.alive,
    pidFileExists: probeResult.exists,
    pid: probeResult.pid,
    pidFileMtimeMs: probeResult.mtimeMs,
    nowMs: Date.now(),
  };
  const decision = autonomicBreath.decideBreath({ probe });
  if (!decision.shouldRespawn) {
    return { action: "already_alive", ms: Date.now() - t0 };
  }
  // v2.19.53/56 — RESPAWN THROTTLE (cheap-probe variant).
  //
  // v2.19.53 read every heartbeat file + did process.kill probes — that
  // turned out to be the source of v2.19.54's 18x P1 latency regression
  // (50 parallel CLIs each doing readdirSync + readFileSync × N + kill probe).
  //
  // v2.19.56 replaces it with a single statSync on the heartbeat dir mtime.
  // If ANY heartbeat was written in the last RESPAWN_THROTTLE_MS, throttle.
  // ~1ms per call vs ~360ms before. Fallback: if the cheap probe throws or
  // install_organ isn't available, fall through to detached respawn (the
  // OLD behaviour) so we never DEADLOCK a fresh install.
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require("@mneme-ai/core") as typeof import("@mneme-ai/core");
    const RESPAWN_THROTTLE_MS = 2_000;
    if (typeof core.installOrgan.recentHeartbeatActivity === "function"
        && core.installOrgan.recentHeartbeatActivity(RESPAWN_THROTTLE_MS)) {
      return { action: "throttled", ms: Date.now() - t0 };
    }
  } catch { /* install_organ optional — fall through to legacy respawn */ }
  // SILENT detached respawn — we are not allowed to print anything
  // during a normal command invocation. The daemon binary is `mneme
  // daemon start`. Spawn detached so it survives our parent process.
  try {
    const here = process.argv[1] ?? "mneme";
    const child = spawn(process.execPath, [here, "daemon", "start"], {
      cwd: repoRoot,
      detached: decision.detached,
      stdio: decision.silentStdio ? "ignore" : "inherit",
      env: process.env,
      windowsHide: decision.windowsHide,
    });
    child.unref();
    const action = probe.pidFileExists ? "respawned" : "no_pid_file";
    return { action, ms: Date.now() - t0 };
  } catch {
    return { action: "failed", ms: Date.now() - t0 };
  }
}

export const _BUDGET = HEARTBEAT_BUDGET_MS;
