/**
 * v2.21.7 — UPGRADE VISIBILITY · MUTEX.
 *
 * File-lock-based mutex that prevents two Mneme operations from
 * running `npm install` concurrently. Closes the race condition
 * surfaced in the v2.21.6 AI-agent audit:
 *
 *   "auto-upgrade triggers in parallel with the user's npm install
 *    on session start; npm install fails because the daemon holds
 *    DLL handles."
 *
 *   - Lock file at `.mneme/upgrade/upgrade.lock` (per-repo).
 *   - Lock contains owner PID + ts + reason; stale-lock detection
 *     when owner PID is no longer alive (process check) OR lock is
 *     older than maxAgeMs (default 10 min — generous for slow CI).
 *   - acquire() returns ok/false; never blocks.
 */

import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const DIR = ".mneme/upgrade";
const LOCK = "upgrade.lock";
const DEFAULT_MAX_AGE_MS = 10 * 60 * 1000;

export interface LockState {
  pid: number;
  ts: string;
  reason: string;
  /** Optional: hostname for cross-machine awareness. */
  host?: string;
}

function dir(repoRoot: string): string {
  const d = join(repoRoot, DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function lockPath(repoRoot: string): string { return join(dir(repoRoot), LOCK); }

function pidAlive(pid: number): boolean {
  if (pid <= 0) return false;
  try {
    // signal 0 = liveness probe; throws on dead process.
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export interface AcquireResult {
  ok: boolean;
  /** When ok=false, the existing lock that blocks acquisition. */
  heldBy?: LockState;
  reason?: string;
}

export interface AcquireOptions {
  reason: string;
  /** Stale-lock threshold; default 10 minutes. */
  maxAgeMs?: number;
}

export function acquireLock(repoRoot: string, opts: AcquireOptions): AcquireResult {
  const p = lockPath(repoRoot);
  if (existsSync(p)) {
    let existing: LockState | null = null;
    try { existing = JSON.parse(readFileSync(p, "utf8")); } catch { /* corrupt */ }
    if (existing) {
      const alive = pidAlive(existing.pid);
      const age = Date.now() - Date.parse(existing.ts);
      const stale = !alive || age > (opts.maxAgeMs ?? DEFAULT_MAX_AGE_MS);
      if (!stale) {
        return { ok: false, heldBy: existing, reason: `lock held by pid=${existing.pid} since ${existing.ts}: ${existing.reason}` };
      }
      // stale → take it
    }
  }
  const state: LockState = {
    pid: process.pid,
    ts: new Date().toISOString(),
    reason: opts.reason,
    host: (() => { try { return require("node:os").hostname(); } catch { return undefined; } })(),
  };
  writeFileSync(p, JSON.stringify(state, null, 2), "utf8");
  return { ok: true };
}

export function releaseLock(repoRoot: string): { ok: boolean; reason?: string } {
  const p = lockPath(repoRoot);
  if (!existsSync(p)) return { ok: true };
  try {
    const cur: LockState = JSON.parse(readFileSync(p, "utf8"));
    if (cur.pid !== process.pid) {
      return { ok: false, reason: `cannot release lock held by another pid=${cur.pid}` };
    }
    unlinkSync(p);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: `failed to release: ${(e as Error).message}` };
  }
}

export function readLock(repoRoot: string): LockState | null {
  const p = lockPath(repoRoot);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; }
}

export function isLocked(repoRoot: string, maxAgeMs = DEFAULT_MAX_AGE_MS): boolean {
  const cur = readLock(repoRoot);
  if (!cur) return false;
  const alive = pidAlive(cur.pid);
  const age = Date.now() - Date.parse(cur.ts);
  return alive && age <= maxAgeMs;
}

export function formatLock(state: LockState | null): string {
  if (!state) return "✓ no upgrade in progress";
  return `🔒 upgrade in progress\n  pid:    ${state.pid}\n  host:   ${state.host ?? "(unknown)"}\n  since:  ${state.ts}\n  reason: ${state.reason}`;
}
