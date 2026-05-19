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
  // v2.19.53/56/58 — RESPAWN THROTTLE (cheap-probe variant) + INSTALL SHIELD.
  //
  // The 6-recurring-rounds EBUSY bug class root cause: when `npm install -g
  // mneme-ai@latest` runs with a daemon alive, the preinstall stops the
  // daemon. But mid-install ANY other CLI invocation (Cursor MCP server,
  // VS Code extension, parallel terminal) respawns the daemon → daemon
  // loads sharp/libvips DLL → next npm file-copy of sharp-win32-x64.node
  // hits EBUSY → user-visible install failure.
  //
  // v2.19.58 fix: install-incoming.flag throttle window (5 minutes by
  // default — npm install can take that long). When the preinstall (or
  // mneme upgrade --execute, or any MCP install.announce) writes the flag,
  // ALL autonomic_breath_hook respawns are vetoed for the next 5 minutes.
  // Bug class extinct: daemon stays dead through the entire install window.
  //
  // Belt-and-suspenders: also keep the 2s heartbeat-mtime throttle for
  // the OTHER race (50 parallel CLI starts during normal operation).
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const core = require("@mneme-ai/core") as typeof import("@mneme-ai/core");

    // SHIELD 1 — install-incoming.flag (v2.19.58, 5-minute window).
    const INSTALL_FLAG_TTL_MS = 5 * 60 * 1000;
    try {
      const flag = core.installOrgan.readInstallIncoming();
      if (flag && typeof flag.announcedAt === "string") {
        const ageMs = Date.now() - new Date(flag.announcedAt).getTime();
        if (Number.isFinite(ageMs) && ageMs >= 0 && ageMs < INSTALL_FLAG_TTL_MS) {
          return { action: "throttled", ms: Date.now() - t0 };
        }
      }
    } catch { /* readInstallIncoming may not exist on older core — fall through */ }

    // SHIELD 2 — heartbeat-mtime (v2.19.56, 2-second window).
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
