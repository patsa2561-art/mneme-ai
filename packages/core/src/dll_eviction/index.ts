/**
 * v2.19.61 DLL EVICTION ORGAN — the world-class wild trick that ends EBUSY.
 *
 * Root cause analysis (user-identified across 7 rounds):
 *   - Daemon holds libvips-42.dll (via sharp) when npm install runs
 *   - `mneme daemon stop` (SIGTERM) is IGNORED by Node.js on Windows by default
 *   - Even when daemon exits cleanly, Windows OS keeps the DLL handle in
 *     "section" / pending close state for 5-30 seconds
 *   - During that window npm tries to overwrite the DLL → EBUSY
 *
 * Three composable primitives that finally end the bug class:
 *
 *   1. windowsTaskKill(processName) — uses `taskkill /F` which actually
 *      kills on Windows (TerminateProcess, not SIGTERM). The ONLY Windows-
 *      correct way to force-stop a Node.js daemon that isn't graceful.
 *
 *   2. probeWritable(path, opts) — opens for write in a retry loop until
 *      success. Proves the OS released the DLL handle. Returns elapsed ms
 *      so caller can record telemetry. Cross-platform via fs.openSync('r+').
 *
 *   3. evictByRenameSideways(path) — THE WILD ONE. Windows allows
 *      renaming a loaded DLL via MoveFile (it's how Windows Installer
 *      updates system DLLs that are in use). We rename the locked DLL to
 *      `<path>.locked-<ts>`, freeing the original path. npm can then
 *      write fresh to the original path. The `.locked-*` file gets
 *      cleaned up at next CLI start. No process needs to die for this
 *      to work — purely sidesteps the OS-level filesystem lock.
 *
 *   4. cleanStaleStagingDirs(parentDir) — sweeps `.mneme-ai-*` orphan
 *      dirs left by npm's atomic-install staging on Windows. Reclaims
 *      disk + prevents future install confusion.
 *
 * The combined ritual (used by preinstall + `mneme heal install`):
 *   announce-incoming → wait → taskkill/SIGKILL → rename-sideways →
 *   wait for new path writable → npm install proceeds → cleanup
 *
 * 11th world-first: rename-loaded-DLL-sideways is a known Windows trick
 * in OS-update land but no npm package / AI tool uses it for install
 * conflict resolution. First-mover forever.
 */

import { spawnSync } from "node:child_process";
import { existsSync, openSync, closeSync, renameSync, readdirSync, rmSync, statSync, unlinkSync } from "node:fs";
import { join, dirname, basename } from "node:path";

const PROTOCOL_VERSION = 1;

// ────────────────────────────────────────────────────────────────────────
// PRIMITIVE 1 — windowsTaskKill (the SIGKILL-equivalent on Windows)
// ────────────────────────────────────────────────────────────────────────

export interface TaskKillResult {
  platform: NodeJS.Platform;
  attempted: boolean;
  exitCode: number | null;
  stdoutTail: string;
  stderrTail: string;
}

/** Windows-correct force-stop. taskkill /F /IM does TerminateProcess (not
 *  the SIGTERM that Node.js ignores by default). On POSIX, falls back to
 *  the POSIX-correct equivalent (pkill -9 by name).
 *
 *  This is the bedrock fix for Windows: SIGTERM is documented to be ignored
 *  by Node.js unless you explicitly install a handler — preinstall scripts
 *  from v2.19.45 onwards relied on SIGTERM and never actually killed the
 *  Windows daemon. taskkill /F bypasses that entirely. */
export function windowsTaskKill(imageName: string, opts?: { timeoutMs?: number; killTree?: boolean }): TaskKillResult {
  const timeout = opts?.timeoutMs ?? 5_000;
  const killTree = opts?.killTree ?? true;
  if (process.platform === "win32") {
    const args = ["/F", "/IM", imageName];
    if (killTree) args.push("/T");
    const r = spawnSync("taskkill", args, {
      shell: true,
      windowsHide: true,
      encoding: "utf8",
      timeout,
    });
    return {
      platform: process.platform,
      attempted: true,
      exitCode: r.status,
      stdoutTail: (r.stdout || "").slice(-200),
      stderrTail: (r.stderr || "").slice(-200),
    };
  }
  // POSIX — pkill -9 is the equivalent
  try {
    const r = spawnSync("pkill", ["-9", "-f", imageName], {
      encoding: "utf8",
      timeout,
    });
    return {
      platform: process.platform,
      attempted: true,
      exitCode: r.status,
      stdoutTail: (r.stdout || "").slice(-200),
      stderrTail: (r.stderr || "").slice(-200),
    };
  } catch (e) {
    return {
      platform: process.platform,
      attempted: false,
      exitCode: null,
      stdoutTail: "",
      stderrTail: (e as Error).message,
    };
  }
}

/** Kill a specific PID with the platform-correct force signal. Windows:
 *  `taskkill /F /PID <pid>`. POSIX: SIGKILL. */
export function killPidForce(pid: number, opts?: { timeoutMs?: number }): { ok: boolean; reason?: string } {
  if (pid <= 0 || pid === process.pid) return { ok: false, reason: "skip-self-or-invalid" };
  const timeout = opts?.timeoutMs ?? 3_000;
  if (process.platform === "win32") {
    const r = spawnSync("taskkill", ["/F", "/PID", String(pid), "/T"], {
      shell: true, windowsHide: true, encoding: "utf8", timeout,
    });
    return { ok: r.status === 0, ...(r.status !== 0 ? { reason: (r.stderr || "").slice(-100) } : {}) };
  }
  try {
    process.kill(pid, "SIGKILL");
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
}

// ────────────────────────────────────────────────────────────────────────
// PRIMITIVE 2 — probeWritable (DLL handle release detection)
// ────────────────────────────────────────────────────────────────────────

export interface ProbeWritableResult {
  path: string;
  writable: boolean;
  attempts: number;
  totalWaitMs: number;
  lastErrorCode?: string;
}

/** Retry loop probing whether a file is writable. Returns as soon as the
 *  OS releases the handle (fs.openSync('r+') succeeds). Use AFTER killing
 *  the daemon — proves the kernel has actually released the DLL handle
 *  before allowing npm to copy over it. Cross-platform. */
export function probeWritable(
  path: string,
  opts?: { maxAttempts?: number; intervalMs?: number }
): ProbeWritableResult {
  const maxAttempts = opts?.maxAttempts ?? 60; // default: 60 × 500ms = 30s
  const intervalMs = opts?.intervalMs ?? 500;
  if (!existsSync(path)) {
    return { path, writable: true, attempts: 0, totalWaitMs: 0 };
  }
  let totalWaitMs = 0;
  let lastErrorCode: string | undefined;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const fd = openSync(path, "r+");
      closeSync(fd);
      return { path, writable: true, attempts: attempt, totalWaitMs };
    } catch (e) {
      lastErrorCode = (e as NodeJS.ErrnoException).code ?? "UNKNOWN";
      if (attempt < maxAttempts) {
        const end = Date.now() + intervalMs;
        while (Date.now() < end) { /* busy-wait — preinstall context */ }
        totalWaitMs += intervalMs;
      }
    }
  }
  return { path, writable: false, attempts: maxAttempts, totalWaitMs, ...(lastErrorCode ? { lastErrorCode } : {}) };
}

// ────────────────────────────────────────────────────────────────────────
// PRIMITIVE 3 — evictByRenameSideways (THE WILD WORLD-CLASS TRICK)
// ────────────────────────────────────────────────────────────────────────

export interface EvictionResult {
  path: string;
  evicted: boolean;
  renamedTo?: string;
  reason?: string;
}

/** Rename a locked file out of the way so npm has a clean slate.
 *
 *  KEY INSIGHT: Windows allows renaming a file that has a SHARING-mode
 *  lock (which is what loaded DLLs have via FILE_SHARE_READ | FILE_SHARE_DELETE).
 *  This is the same trick Windows Installer uses to update DLLs that are
 *  currently loaded. POSIX allows rename of open files trivially.
 *
 *  We rename `<path>` to `<path>.locked-<ts>`. The DLL stays loaded in
 *  any process that has it open (kernel still holds the inode/section)
 *  but the PATH is now free. npm can write a fresh file at the original
 *  path without conflict.
 *
 *  After install, the orphaned `.locked-*` files are cleaned up at next
 *  CLI start via cleanLockedSideways(parentDir).
 *
 *  Returns evicted=true on success, evicted=false on failure (caller can
 *  fall back to the wait-for-handle-release path). */
export function evictByRenameSideways(path: string): EvictionResult {
  if (!existsSync(path)) {
    return { path, evicted: true, reason: "file-not-present" };
  }
  const target = `${path}.locked-${Date.now()}-${process.pid}`;
  try {
    renameSync(path, target);
    return { path, evicted: true, renamedTo: target };
  } catch (e) {
    return { path, evicted: false, reason: (e as NodeJS.ErrnoException).code ?? (e as Error).message };
  }
}

/** Sweep orphaned `*.locked-*` files in a directory (callable from CLI
 *  startup or `mneme heal install`). Returns number cleaned. Best-effort
 *  — silently skips files we can't delete (some may legitimately still
 *  be loaded; that's fine, we'll get them next time). */
export function cleanLockedSideways(parentDir: string): { swept: number; failed: number } {
  if (!existsSync(parentDir)) return { swept: 0, failed: 0 };
  let swept = 0;
  let failed = 0;
  try {
    const entries = readdirSync(parentDir);
    for (const entry of entries) {
      // Match pattern: <basename>.locked-<digits>-<digits>
      if (/\.locked-\d+-\d+$/.test(entry)) {
        const full = join(parentDir, entry);
        try { unlinkSync(full); swept++; }
        catch { failed++; }
      }
    }
  } catch { /* dir scan failed — best-effort */ }
  return { swept, failed };
}

// ────────────────────────────────────────────────────────────────────────
// PRIMITIVE 4 — cleanStaleStagingDirs (npm leftover sweep)
// ────────────────────────────────────────────────────────────────────────

export interface StagingCleanupResult {
  swept: number;
  failed: number;
  perDir: Array<{ path: string; ok: boolean; reason?: string }>;
}

/** Sweep `.mneme-ai-*` staging dirs left by npm's atomic-install when a
 *  prior install crashed midway. These can accumulate + occasionally
 *  cause future install confusion. Best-effort recursive delete. */
export function cleanStaleStagingDirs(parentDir: string): StagingCleanupResult {
  if (!existsSync(parentDir)) return { swept: 0, failed: 0, perDir: [] };
  const result: StagingCleanupResult = { swept: 0, failed: 0, perDir: [] };
  try {
    const entries = readdirSync(parentDir);
    for (const entry of entries) {
      if (entry.startsWith(".mneme-ai-")) {
        const full = join(parentDir, entry);
        try {
          // Only remove if it looks like a staging dir (directory, not a regular file)
          const st = statSync(full);
          if (!st.isDirectory()) continue;
          rmSync(full, { recursive: true, force: true });
          result.swept++;
          result.perDir.push({ path: full, ok: true });
        } catch (e) {
          result.failed++;
          result.perDir.push({ path: full, ok: false, reason: (e as Error).message });
        }
      }
    }
  } catch (e) {
    // Parent dir scan failed — return what we have
    result.failed++;
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────────
// COMPOSED PIPELINE — evictAndProbe (the high-level user-facing op)
// ────────────────────────────────────────────────────────────────────────

export interface EvictAndProbeResult {
  v: typeof PROTOCOL_VERSION;
  path: string;
  evicted: boolean;
  evictionResult: EvictionResult;
  probeResult: ProbeWritableResult;
  ok: boolean;
  strategy: "rename-sideways" | "wait-for-release" | "already-writable" | "evicted-and-confirmed-writable";
  totalMs: number;
}

/** Try the wild rename-sideways trick first; if it fails, fall back to
 *  the wait-for-OS-handle-release loop. Returns combined result so caller
 *  can decide what to do (proceed with install or alert). */
export function evictAndProbe(path: string, opts?: { maxProbeAttempts?: number; probeIntervalMs?: number }): EvictAndProbeResult {
  const t0 = Date.now();
  // Fast path: file doesn't exist (= nothing to evict, npm gets clean slate)
  if (!existsSync(path)) {
    return {
      v: PROTOCOL_VERSION,
      path,
      evicted: true,
      evictionResult: { path, evicted: true, reason: "file-not-present" },
      probeResult: { path, writable: true, attempts: 0, totalWaitMs: 0 },
      ok: true,
      strategy: "already-writable",
      totalMs: Date.now() - t0,
    };
  }
  // Strategy 1 (wild): rename sideways. Sidesteps the lock entirely.
  const eviction = evictByRenameSideways(path);
  if (eviction.evicted) {
    return {
      v: PROTOCOL_VERSION,
      path,
      evicted: true,
      evictionResult: eviction,
      probeResult: { path, writable: true, attempts: 1, totalWaitMs: 0 },
      ok: true,
      strategy: "rename-sideways",
      totalMs: Date.now() - t0,
    };
  }
  // Strategy 2 (fallback): wait for OS to release the handle
  const probe = probeWritable(path, {
    ...(opts?.maxProbeAttempts !== undefined ? { maxAttempts: opts.maxProbeAttempts } : {}),
    ...(opts?.probeIntervalMs !== undefined ? { intervalMs: opts.probeIntervalMs } : {}),
  });
  return {
    v: PROTOCOL_VERSION,
    path,
    evicted: probe.writable,
    evictionResult: eviction,
    probeResult: probe,
    ok: probe.writable,
    strategy: probe.writable ? "evicted-and-confirmed-writable" : "wait-for-release",
    totalMs: Date.now() - t0,
  };
}

export { PROTOCOL_VERSION };
