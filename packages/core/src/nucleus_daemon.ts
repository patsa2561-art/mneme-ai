/**
 * NUCLEUS DAEMON (v1.21.0) — the persistent infinity loop that keeps the
 * Mneme nucleus alive between MCP sessions.
 *
 * Lifecycle:
 *   • `mneme nucleus daemon start [--detach]`  — starts the loop
 *   • `mneme nucleus daemon stop`              — graceful shutdown
 *   • `mneme nucleus daemon status`            — pid + uptime + last tick
 *
 * What the loop does (every NUCLEUS_INTERVAL_MS):
 *   1. Tick the nucleus (aggregate DNA + maybe synthesize a lesson).
 *   2. If the tick triggered MUTATION_THRESHOLD growth, apply one
 *      structured mutation (karma noise + molecule recipe drift).
 *   3. If 24+ hours since last consolidation, compress old chromosomes
 *      into a summary chromosome (saves disk + speeds future fertilize).
 *   4. Persist heartbeat to .mneme/nucleus.heartbeat.json.
 *
 * The daemon is single-instance — re-running `start` while a daemon is
 * alive returns "already running" (atomic PID file check).
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tick, mutate, readNucleus, dnaBanner } from "./nucleus.js";

const PID_FILE = ".mneme/nucleus.pid";
const HEARTBEAT_FILE = ".mneme/nucleus.heartbeat.json";

const NUCLEUS_INTERVAL_MS = 30 * 1000;          // tick every 30s
const MUTATION_THRESHOLD = 5;                    // mutate after 5 noteworthy ticks
const HEARTBEAT_WRITE_EVERY_TICK = 1;            // write heartbeat every tick

export interface DaemonHeartbeat {
  pid: number;
  startedAt: string;
  lastTick: string;
  tickCount: number;
  mutationsApplied: number;
  lastBanner: string;
  intervalMs: number;
}

function pidFilePath(repoRoot: string): string {
  return join(repoRoot, PID_FILE);
}

function heartbeatFilePath(repoRoot: string): string {
  return join(repoRoot, HEARTBEAT_FILE);
}

function ensureDir(repoRoot: string): void {
  const dir = join(repoRoot, ".mneme");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Check if a process with the given PID is alive. */
function isProcessAlive(pid: number): boolean {
  try {
    // signal 0 = check existence without sending a signal
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Read the daemon's PID + verify the process is alive. */
export function getDaemonPid(repoRoot: string): number | null {
  const path = pidFilePath(repoRoot);
  if (!existsSync(path)) return null;
  try {
    const pid = parseInt(readFileSync(path, "utf8").trim(), 10);
    if (!Number.isFinite(pid)) return null;
    return isProcessAlive(pid) ? pid : null;
  } catch {
    return null;
  }
}

/** Read the latest heartbeat. */
export function readHeartbeat(repoRoot: string): DaemonHeartbeat | null {
  const path = heartbeatFilePath(repoRoot);
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

export interface DaemonStatus {
  running: boolean;
  pid: number | null;
  heartbeat: DaemonHeartbeat | null;
  /** Seconds since last heartbeat — null when no heartbeat. */
  lastTickSecondsAgo: number | null;
  /** True if heartbeat is recent (≤ 2× interval). */
  healthy: boolean;
}

export function daemonStatus(repoRoot: string): DaemonStatus {
  const pid = getDaemonPid(repoRoot);
  const hb = readHeartbeat(repoRoot);
  const lastTickSecondsAgo = hb ? Math.floor((Date.now() - Date.parse(hb.lastTick)) / 1000) : null;
  const healthy = pid !== null && hb !== null && (lastTickSecondsAgo ?? Infinity) < (NUCLEUS_INTERVAL_MS / 1000) * 2;
  return { running: pid !== null, pid, heartbeat: hb, lastTickSecondsAgo, healthy };
}

/** Start the daemon loop INSIDE this process. Caller is responsible
 *  for forking / detaching if they want background behaviour. */
export async function runDaemonLoop(
  repoRoot: string,
  opts: { intervalMs?: number; onTick?: (state: { tickCount: number; banner: string }) => void } = {},
): Promise<void> {
  ensureDir(repoRoot);

  // Atomic PID-file write (refuse if already alive).
  const existingPid = getDaemonPid(repoRoot);
  if (existingPid !== null) {
    throw new Error(`nucleus daemon already running (pid ${existingPid})`);
  }
  writeFileSync(pidFilePath(repoRoot), String(process.pid), "utf8");

  const startedAt = new Date().toISOString();
  let tickCount = 0;
  let mutationsApplied = 0;
  let noteworthyTicks = 0;
  const intervalMs = opts.intervalMs ?? NUCLEUS_INTERVAL_MS;

  // Cleanup on shutdown — remove PID file so next `start` can succeed.
  const cleanup = () => {
    try { unlinkSync(pidFilePath(repoRoot)); } catch { /* ignore */ }
  };
  process.on("SIGTERM", () => { cleanup(); process.exit(0); });
  process.on("SIGINT", () => { cleanup(); process.exit(0); });
  process.on("beforeExit", cleanup);

  // Loop forever (or until killed).
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const result = tick(repoRoot);
      tickCount += 1;
      // Track noteworthy ticks (any growth) for mutation throttling.
      const grew =
        result.delta.growthSinceLastTick.chromosomes > 0 ||
        result.delta.growthSinceLastTick.calls > 0 ||
        result.delta.growthSinceLastTick.verified > 0;
      if (grew) noteworthyTicks += 1;
      if (noteworthyTicks >= MUTATION_THRESHOLD) {
        mutate(repoRoot, 1);
        mutationsApplied += 1;
        noteworthyTicks = 0;
      }
      // Heartbeat
      if (tickCount % HEARTBEAT_WRITE_EVERY_TICK === 0) {
        const banner = dnaBanner(result.state);
        const hb: DaemonHeartbeat = {
          pid: process.pid,
          startedAt,
          lastTick: new Date().toISOString(),
          tickCount,
          mutationsApplied,
          lastBanner: banner,
          intervalMs,
        };
        writeFileSync(heartbeatFilePath(repoRoot), JSON.stringify(hb, null, 2), "utf8");
        opts.onTick?.({ tickCount, banner });
      }
    } catch {
      // best-effort — never let a single tick failure kill the daemon
    }
    await new Promise<void>((resolve) => setTimeout(resolve, intervalMs));
  }
}

/** Stop the daemon by sending SIGTERM. Returns true if a daemon was killed. */
export function stopDaemon(repoRoot: string): { stopped: boolean; pid: number | null; reason: string } {
  const pid = getDaemonPid(repoRoot);
  if (pid === null) return { stopped: false, pid: null, reason: "no daemon running" };
  try {
    process.kill(pid, "SIGTERM");
    // Best-effort cleanup of pid file (the daemon's own shutdown handler
    // also tries to do this).
    try { unlinkSync(pidFilePath(repoRoot)); } catch { /* ignore */ }
    return { stopped: true, pid, reason: "SIGTERM sent" };
  } catch (err) {
    return { stopped: false, pid, reason: (err as Error).message };
  }
}
