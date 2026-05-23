/**
 * v2.38.0 — BRIDGE PHOENIX (self-restart watchdog).
 *
 * Closes audit-card bug: "Bridge ไม่ phoenix-restart — daemon ตายไป 3 รอบ
 * session นี้ bridge ก็ตายตาม → ผู้ใช้ต้อง mneme bridge --detach เอง".
 *
 * The daemon supervisor probes the bridge port (17741 default) every
 * `intervalMs` (default 30s). If the probe fails N consecutive times
 * (default 2), spawn `mneme bridge --detach` to respawn.
 *
 * Pure module — caller (nucleus_daemon) integrates the probe + respawn
 * loop. Every probe is best-effort + never throws. Spawn failures are
 * recorded but don't crash the daemon.
 */

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { request } from "node:http";

export interface BridgeProbeResult {
  ok: boolean;
  port: number;
  dtMs: number;
  reason?: string;
}

export interface RespawnAttempt {
  at: string;
  ok: boolean;
  reason?: string;
  pid?: number;
}

/**
 * Probe /v1/ping on the bridge port. Returns { ok: true } on HTTP 200,
 * { ok: false, reason } on any failure. Never throws.
 */
export function probeBridge(port = 17741, timeoutMs = 1500): Promise<BridgeProbeResult> {
  const t0 = Date.now();
  return new Promise<BridgeProbeResult>((resolve) => {
    let done = false;
    const finish = (ok: boolean, reason?: string) => {
      if (done) return;
      done = true;
      resolve({ ok, port, dtMs: Date.now() - t0, ...(reason ? { reason } : {}) });
    };
    try {
      const req = request({
        host: "127.0.0.1", port, path: "/v1/ping", method: "GET", timeout: timeoutMs,
      }, (res) => {
        // Drain response so the socket releases.
        res.on("data", () => { /* drain */ });
        res.on("end", () => finish(res.statusCode === 200, res.statusCode === 200 ? undefined : `http ${res.statusCode}`));
      });
      req.on("error", (e) => finish(false, `req error: ${e.message}`));
      req.on("timeout", () => { try { req.destroy(); } catch { /* */ } finish(false, "timeout"); });
      req.end();
    } catch (e) {
      finish(false, `probe threw: ${(e as Error).message}`);
    }
  });
}

/**
 * Detach-spawn `mneme bridge --detach`. Resolves to RespawnAttempt
 * indicating whether the child was started + PID. Best-effort: if
 * the CLI bin isn't on PATH we record the reason + move on.
 */
export function respawnBridge(repoRoot: string, cliBinHint?: string): RespawnAttempt {
  const at = new Date().toISOString();
  try {
    const cmd = cliBinHint ?? "mneme";
    const args = ["bridge", "--detach"];
    const child = spawn(cmd, args, {
      cwd: repoRoot,
      detached: true,
      stdio: "ignore",
      shell: process.platform === "win32", // .cmd shim on Windows
    });
    child.unref();
    return { at, ok: true, pid: child.pid };
  } catch (e) {
    return { at, ok: false, reason: `spawn failed: ${(e as Error).message}` };
  }
}

/**
 * State for the watchdog — caller (daemon) keeps an instance + calls
 * `tick()` periodically. After `failuresBeforeRespawn` consecutive
 * failed probes, respawnBridge fires (rate-limited by `cooldownMs`).
 */
export interface WatchdogState {
  port: number;
  failuresBeforeRespawn: number;
  cooldownMs: number;
  consecutiveFailures: number;
  lastRespawnAt: number; // epoch ms; 0 = never
  attempts: RespawnAttempt[];
}

export function newWatchdogState(opts: { port?: number; failuresBeforeRespawn?: number; cooldownMs?: number } = {}): WatchdogState {
  return {
    port: opts.port ?? 17741,
    failuresBeforeRespawn: opts.failuresBeforeRespawn ?? 2,
    cooldownMs: opts.cooldownMs ?? 30_000,
    consecutiveFailures: 0,
    lastRespawnAt: 0,
    attempts: [],
  };
}

export async function tickWatchdog(repoRoot: string, state: WatchdogState, cliBinHint?: string): Promise<{ probe: BridgeProbeResult; respawned: RespawnAttempt | null }> {
  const probe = await probeBridge(state.port);
  if (probe.ok) {
    state.consecutiveFailures = 0;
    return { probe, respawned: null };
  }
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures < state.failuresBeforeRespawn) {
    return { probe, respawned: null };
  }
  const now = Date.now();
  if (now - state.lastRespawnAt < state.cooldownMs) {
    return { probe, respawned: null }; // cooling down
  }
  const respawn = respawnBridge(repoRoot, cliBinHint);
  state.lastRespawnAt = now;
  state.attempts.push(respawn);
  if (state.attempts.length > 50) state.attempts.shift();
  // Persist attempt to a ledger so the user can see history.
  try {
    const dir = join(repoRoot, ".mneme", "bridge_phoenix");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "respawns.jsonl"), JSON.stringify(respawn) + "\n");
  } catch { /* best-effort */ }
  // Reset counter after attempting respawn (so we don't fire every tick).
  state.consecutiveFailures = 0;
  return { probe, respawned: respawn };
}

// v2.42.0 — CROSS-PROCESS WATCHDOG (closes R8). The in-band watchdog
// above can't help when the daemon ITSELF dies. The cross-process
// version registers an OS-level scheduled task that probes + respawns
// independently of the Mneme daemon process.
export {
  installCrossProcessWatchdog,
  uninstallCrossProcessWatchdog,
  detectMechanism,
  type WatchdogMechanism,
  type InstallOptions as CrossProcessInstallOptions,
  type InstallResult as CrossProcessInstallResult,
} from "./cross_process.js";
