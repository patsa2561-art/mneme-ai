/**
 * v2.19.97 — SUPERLOCK + DEV-SOURCE GUARD.
 *
 * Solves the race condition class user reported in the post-mortem of
 * their broken install:
 *
 *   1. Pulse banner advertises [AUTO-ACTION] mneme.system.upgrade
 *   2. Daemon (or shepherd) starts auto-upgrade in background
 *      → deletes bot/platforms/index.js to rewrite
 *   3. User simultaneously runs `npm install -g mneme-ai` from terminal
 *   4. EBUSY on libvips DLL because daemon is mid-write
 *   5. Half-finished install: missing files; every `mneme` command
 *      throws ERR_MODULE_NOT_FOUND
 *
 * Plus the user discovered a SECOND install source: when Mneme is
 * checked out as a dev repo (D:\lib_ai_git\packages\cli\bin\mneme.js),
 * THAT daemon ALSO honours pulse auto-upgrade mandates — and tries to
 * upgrade the *global npm install*, racing with whatever the user is
 * doing.  Two install roots → two daemons → two upgrade triggers →
 * guaranteed race.
 *
 * Two-layer fix:
 *
 *   DEV-SOURCE GUARD
 *     Detect when the running mneme binary is from a source checkout
 *     (path contains `packages/cli/bin/`) rather than a published
 *     `node_modules/mneme-ai/` tree.  When detected, refuse ALL
 *     auto-upgrade attempts + drop the upgrade [AUTO-ACTION] from
 *     pulse output entirely.  Dev source manages its own upgrades
 *     via git pull.
 *
 *   SUPERLOCK
 *     Single global file mutex at `~/.mneme-global/superlock.flag`
 *     that EVERY install/upgrade path must grab before mutating the
 *     on-disk install.  Lock content is JSON with { pid, startedAt,
 *     intent, role } so observers can see who's holding it + why.
 *     Stale locks (>10 min) are auto-broken.  Lock acquisition is
 *     atomic-rename (POSIX + Windows safe).
 *
 * Composes with v2.19.58 install-incoming.flag (5-min flag window),
 * v2.19.57 shepherd, v2.19.62 phoenix DLL extraction, but is the
 * single source of truth that serialises EVERYTHING.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync, renameSync, statSync } from "node:fs";
import { join, normalize } from "node:path";
import { homedir } from "node:os";
import { randomBytes } from "node:crypto";

const GLOBAL_DIR = ".mneme-global";
const LOCK = "superlock.flag";
const STALE_MS = 10 * 60 * 1000; // 10 min — anything older is presumed dead

export type LockRole = "user-npm" | "daemon-autoupgrade" | "shepherd" | "phoenix" | "cli-upgrade" | "test";

export interface LockState {
  pid: number;
  startedAt: string;
  intent: string;
  role: LockRole;
  /** Absolute path of the binary that holds the lock — used for
   *  dev-source attribution. */
  holderPath: string;
}

function lockDir(): string {
  const d = join(homedir(), GLOBAL_DIR);
  if (!existsSync(d)) { try { mkdirSync(d, { recursive: true }); } catch { /* */ } }
  return d;
}

function lockPath(): string { return join(lockDir(), LOCK); }

/** Read current lock state if any. Returns null if no lock or unreadable. */
export function readLock(): LockState | null {
  const p = lockPath();
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as LockState; }
  catch { return null; }
}

/** True iff a lock exists AND is fresh enough to honour. Stale locks
 *  (older than STALE_MS) are ignored because the holder probably died. */
export function isLockHeld(): boolean {
  const s = readLock();
  if (!s) return false;
  try {
    const age = Date.now() - new Date(s.startedAt).getTime();
    return age < STALE_MS;
  } catch { return false; }
}

/** Atomic acquire. Returns true if we now hold the lock; false if
 *  somebody else holds a fresh one. Uses tmpfile + rename for atomicity
 *  on both POSIX and Windows. */
export function acquireLock(state: Omit<LockState, "startedAt">): boolean {
  // Check existing lock.
  const existing = readLock();
  if (existing) {
    const age = Date.now() - new Date(existing.startedAt).getTime();
    if (age < STALE_MS && existing.pid !== state.pid) return false;
    // Stale — break it.
    try { unlinkSync(lockPath()); } catch { /* */ }
  }
  // Atomic: write to tmp then rename. Two concurrent acquirers race on
  // rename; one wins, the other's rename overwrites — both think they
  // won. Belt-and-suspenders: re-read after writing and check pid.
  const tmp = join(lockDir(), `superlock.${process.pid}.${randomBytes(4).toString("hex")}.tmp`);
  const full: LockState = { ...state, startedAt: new Date().toISOString() };
  try {
    writeFileSync(tmp, JSON.stringify(full, null, 2), "utf8");
    renameSync(tmp, lockPath());
  } catch {
    try { unlinkSync(tmp); } catch { /* */ }
    return false;
  }
  // Verify we're the winner.
  const s = readLock();
  return !!s && s.pid === state.pid;
}

/** Release the lock if we still hold it. Caller MUST always call this
 *  in a `finally` block to avoid leaks. */
export function releaseLock(pid: number = process.pid): boolean {
  const s = readLock();
  if (!s) return true;
  if (s.pid !== pid) return false; // somebody else owns it now
  try { unlinkSync(lockPath()); return true; }
  catch { return false; }
}

/** Wrap any async install/upgrade action with the superlock. Throws
 *  with a descriptive error if the lock is held by another fresh
 *  process. */
export async function withSuperlock<T>(
  state: Omit<LockState, "startedAt" | "pid">,
  fn: () => Promise<T>,
): Promise<T> {
  const acquired = acquireLock({ ...state, pid: process.pid });
  if (!acquired) {
    const held = readLock();
    throw new Error(
      `SUPERLOCK: another mneme install/upgrade is in progress` +
      (held ? ` (pid=${held.pid}, role=${held.role}, intent=${held.intent}, since ${held.startedAt})` : "") +
      `. Wait for it to finish, or run \`mneme superlock --break\` if you believe it is stuck.`
    );
  }
  try { return await fn(); }
  finally { releaseLock(); }
}

// ─── DEV-SOURCE GUARD ──────────────────────────────────────────────────

/** True iff the currently-running mneme binary lives in a source
 *  checkout (path contains `/packages/cli/` or `\packages\cli\`) rather
 *  than a node_modules install. Dev-source must NEVER auto-upgrade
 *  itself — git pull is the right tool for that. */
export function isDevSource(scriptPath?: string): boolean {
  // Distinguish "caller passed nothing" (use argv default) from "caller
  // explicitly passed empty" (refuse to guess) — the latter should
  // return false so callers can opt out of process-state inspection.
  const raw = scriptPath === undefined ? (process.argv[1] ?? "") : scriptPath;
  if (!raw) return false;
  const path = normalize(raw);
  // Patterns that indicate dev checkout:
  //   .../packages/cli/bin/mneme.js
  //   .../packages/cli/dist/index.js
  //   .../packages/cli/src/index.ts
  const devPatterns = [
    /[\\/]packages[\\/]cli[\\/]/,
    /[\\/]lib_ai_git[\\/]/,
    /[\\/]mneme-ai[\\/]packages[\\/]/,
  ];
  // Conversely, definitely-not-dev-source patterns (real install):
  const installPatterns = [
    /[\\/]node_modules[\\/]mneme-ai[\\/]/,
    /[\\/]\.npm-global[\\/]/,
    /[\\/]npm[\\/]node_modules[\\/]mneme-ai[\\/]/,
  ];
  for (const p of installPatterns) if (p.test(path)) return false;
  for (const p of devPatterns) if (p.test(path)) return true;
  return false;
}

/** Human-readable explanation surfaced when dev-source guard fires. */
export function devSourceMessage(scriptPath?: string): string {
  const path = scriptPath ?? process.argv[1] ?? "(unknown)";
  return [
    `Mneme is running from a dev source checkout, not a published npm install.`,
    `  binary path:  ${path}`,
    `  auto-upgrade: REFUSED (dev source manages itself via git pull)`,
    `To pull latest dev changes:  cd <repo> && git pull && pnpm install`,
    `To use the published version: install via npm install -g mneme-ai in a separate shell.`,
  ].join("\n");
}

/** The decision the pulse renderer + auto-upgrade hooks call before
 *  emitting `[AUTO-ACTION] mneme.system.upgrade`.  Returns true when
 *  the auto-action is safe to advertise + execute. */
export function autoUpgradeAllowed(scriptPath?: string): { allowed: boolean; reason: string } {
  if (isDevSource(scriptPath)) {
    return { allowed: false, reason: "dev-source-detected" };
  }
  if (isLockHeld()) {
    const s = readLock();
    return { allowed: false, reason: `superlock-held-by-${s?.role ?? "unknown"}` };
  }
  return { allowed: true, reason: "ok" };
}
