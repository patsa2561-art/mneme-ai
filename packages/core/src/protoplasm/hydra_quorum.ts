/**
 * 🐉 PROTOPLASM — HYDRA QUORUM
 *
 * "Cut one head, two more grow."
 *
 * Multi-process co-hosting. N PIDs (typically 3) compete for PRIMARY
 * lock; non-primaries become SECONDARIES. Primary writes new findings;
 * secondaries replay + watch.
 *
 * Leader election: simple file-based lock with timeout.
 *   - .mneme/protoplasm/hydra.primary    (PID + timestamp of current primary)
 *   - lock acquired by atomic write-if-not-exists
 *   - primary refreshes timestamp every 5s
 *   - if primary stale (>15s) → any secondary can take over
 *
 * No Raft / Paxos — file-based is enough for liveness; HMAC chain on
 * findings remains the trust layer regardless of which head wrote what.
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync, unlinkSync, statSync } from "node:fs";
import { join, dirname } from "node:path";

export type HydraRole = "primary" | "secondary" | "uncontested";

export interface HydraStatus {
  role: HydraRole;
  primaryPid: number | null;
  primaryAge: number;          // ms since primary last refresh
  ownPid: number;
  acquiredAt?: string;
  lockPath: string;
}

const STALE_MS = 15_000;
const REFRESH_MS = 5_000;

function lockPath(ledgerDir: string): string {
  return join(ledgerDir, "hydra.primary");
}

function readLock(p: string): { pid: number; ts: number } | null {
  if (!existsSync(p)) return null;
  try {
    const j = JSON.parse(readFileSync(p, "utf8")) as { pid: number; ts: number };
    if (typeof j.pid === "number" && typeof j.ts === "number") return j;
  } catch { /* */ }
  return null;
}

function writeLock(p: string, pid: number): void {
  mkdirSync(dirname(p), { recursive: true });
  // Best-effort atomic-ish: write to tmp, rename
  const tmp = p + ".tmp." + pid;
  writeFileSync(tmp, JSON.stringify({ pid, ts: Date.now() }), "utf8");
  try { (require("node:fs") as typeof import("node:fs")).renameSync(tmp, p); } catch {
    try { writeFileSync(p, JSON.stringify({ pid, ts: Date.now() })); } catch { /* */ }
  }
}

function alivePid(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function statusHydra(ledgerDir: string, ownPid = process.pid): HydraStatus {
  const p = lockPath(ledgerDir);
  const lock = readLock(p);
  if (!lock) return { role: "uncontested", primaryPid: null, primaryAge: 0, ownPid, lockPath: p };
  const age = Date.now() - lock.ts;
  if (lock.pid === ownPid) return { role: "primary", primaryPid: ownPid, primaryAge: age, ownPid, lockPath: p };
  if (age > STALE_MS || !alivePid(lock.pid)) return { role: "uncontested", primaryPid: lock.pid, primaryAge: age, ownPid, lockPath: p };
  return { role: "secondary", primaryPid: lock.pid, primaryAge: age, ownPid, lockPath: p };
}

/** Attempt to become primary. Idempotent if already primary.
 *  Returns final role + reason. */
export function tryBecomePrimary(ledgerDir: string, ownPid = process.pid): HydraStatus {
  const p = lockPath(ledgerDir);
  const before = statusHydra(ledgerDir, ownPid);
  if (before.role === "primary") return before;
  if (before.role === "secondary") return before;     // someone else holds it freshly
  // uncontested — claim it
  writeLock(p, ownPid);
  return { role: "primary", primaryPid: ownPid, primaryAge: 0, ownPid, lockPath: p, acquiredAt: new Date().toISOString() };
}

/** Refresh primary timestamp (call every REFRESH_MS while primary).
 *  Returns true if still primary; false if got displaced. */
export function refreshPrimary(ledgerDir: string, ownPid = process.pid): boolean {
  const p = lockPath(ledgerDir);
  const lock = readLock(p);
  if (!lock || lock.pid !== ownPid) return false;
  writeLock(p, ownPid);
  return true;
}

/** Release primary (graceful step-down). */
export function releasePrimary(ledgerDir: string, ownPid = process.pid): boolean {
  const p = lockPath(ledgerDir);
  const lock = readLock(p);
  if (!lock || lock.pid !== ownPid) return false;
  try { unlinkSync(p); return true; } catch { return false; }
}

/** Wire as background refresher. Returns cancel fn. */
export function startHydraHeartbeat(ledgerDir: string, ownPid = process.pid): () => void {
  const interval = setInterval(() => {
    const ok = refreshPrimary(ledgerDir, ownPid);
    if (!ok) {
      // We were displaced. Try to reacquire next tick.
      tryBecomePrimary(ledgerDir, ownPid);
    }
  }, REFRESH_MS);
  if (typeof (interval as any).unref === "function") (interval as any).unref();
  return () => clearInterval(interval);
}

export const HYDRA_TUNING = { STALE_MS, REFRESH_MS };
