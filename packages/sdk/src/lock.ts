/**
 * @mneme-ai/sdk file-lock adapter.
 *
 * Fixes the race condition the user identified:
 *   "CLI mneme verify ... + Cursor SDK writing HMAC chain simultaneously
 *    → race in writing .mneme/cli-activity.jsonl"
 *
 * Strategy: simple advisory lock via `.lock` sentinel file with PID +
 * stale-detection. No external dependency (no proper-lockfile import) —
 * stays compatible with bundler tree-shake + works in container/serverless.
 *
 * Pure deterministic + defensive; never throws.
 */

import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, openSync, closeSync, constants as fsConstants } from "node:fs";
import { dirname, join } from "node:path";

const STALE_MS = 5_000; // a lock older than this is considered stale

export interface LockResult {
  acquired: boolean;
  /** The lock file path (for telemetry / debug). */
  lockPath: string;
  /** When the lock was acquired (or last detected to be held). */
  at: number;
  /** PID holding the lock (or null on acquire failure). */
  holderPid?: number;
  reason?: string;
}

function lockPathFor(target: string): string {
  return target + ".lock";
}

/**
 * Try to acquire an advisory lock on a target file. Non-blocking: returns
 * { acquired: false } immediately on failure.
 *
 * Caller MUST call releaseLock when done.
 */
export function acquireLock(targetPath: string): LockResult {
  const lockPath = lockPathFor(targetPath);
  const now = Date.now();
  try {
    // Ensure parent dir exists
    const parent = dirname(targetPath);
    if (parent && !existsSync(parent)) {
      try { mkdirSync(parent, { recursive: true }); } catch { /* */ }
    }
    // Stale check: if lock file exists + old enough → remove
    if (existsSync(lockPath)) {
      try {
        const body = JSON.parse(readFileSync(lockPath, "utf8")) as { pid: number; at: number };
        if (now - body.at > STALE_MS) {
          try { unlinkSync(lockPath); } catch { /* */ }
        } else {
          return { acquired: false, lockPath, at: body.at, holderPid: body.pid, reason: "held by another process" };
        }
      } catch {
        // Corrupted lock file → safe to remove
        try { unlinkSync(lockPath); } catch { /* */ }
      }
    }
    // Try exclusive create — fails if another process raced us
    let fd: number;
    try {
      fd = openSync(lockPath, fsConstants.O_CREAT | fsConstants.O_EXCL | fsConstants.O_WRONLY);
    } catch {
      return { acquired: false, lockPath, at: now, reason: "exclusive create failed (race)" };
    }
    writeFileSync(fd, JSON.stringify({ pid: process.pid, at: now }));
    closeSync(fd);
    return { acquired: true, lockPath, at: now, holderPid: process.pid };
  } catch (e) {
    return { acquired: false, lockPath, at: now, reason: `lock attempt failed: ${(e as Error).message}` };
  }
}

export function releaseLock(lockResult: Pick<LockResult, "lockPath" | "acquired">): void {
  if (!lockResult.acquired) return;
  try { if (existsSync(lockResult.lockPath)) unlinkSync(lockResult.lockPath); } catch { /* */ }
}

/**
 * Run a critical section under the lock. Releases the lock even when fn
 * throws. Returns { acquired: false } envelope when the lock could not
 * be acquired (caller decides whether to retry).
 */
export async function withLock<T>(
  targetPath: string,
  fn: () => T | Promise<T>,
  opts: { retries?: number; retryDelayMs?: number } = {},
): Promise<{ ok: boolean; data?: T; reason?: string }> {
  const retries = Math.max(0, opts.retries ?? 5);
  const delayMs = Math.max(1, opts.retryDelayMs ?? 50);
  for (let i = 0; i <= retries; i++) {
    const r = acquireLock(targetPath);
    if (r.acquired) {
      try {
        const data = await Promise.resolve(fn());
        return { ok: true, data };
      } catch (e) {
        return { ok: false, reason: `critical-section threw: ${(e as Error).message}` };
      } finally {
        releaseLock(r);
      }
    }
    if (i < retries) await new Promise((res) => setTimeout(res, delayMs));
  }
  return { ok: false, reason: `lock acquisition failed after ${retries + 1} attempts` };
}

/** Diagnostic: check if a lock currently exists + is fresh. */
export function isLocked(targetPath: string): { locked: boolean; holderPid?: number; ageMs?: number } {
  const p = lockPathFor(targetPath);
  if (!existsSync(p)) return { locked: false };
  try {
    const body = JSON.parse(readFileSync(p, "utf8")) as { pid: number; at: number };
    const age = Date.now() - body.at;
    if (age > STALE_MS) return { locked: false, ageMs: age };
    return { locked: true, holderPid: body.pid, ageMs: age };
  } catch {
    return { locked: false };
  }
}

/** Test-only: lockPath getter. */
export function __lockPathForTest(targetPath: string): string {
  return lockPathFor(targetPath);
}

/**
 * Wrap a function so that every call serialises through the lock for
 * a given path. Useful for wrapping ledger writers transparently.
 */
export function serializeOnLock<Args extends unknown[], R>(
  lockTarget: string,
  fn: (...a: Args) => R | Promise<R>,
): (...a: Args) => Promise<{ ok: boolean; data?: R; reason?: string }> {
  return async (...a: Args) => withLock(lockTarget, () => fn(...a));
}

export const STALE_LOCK_MS = STALE_MS;
