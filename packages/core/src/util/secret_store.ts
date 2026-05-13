/**
 * v2.4.0 -- SECRET STORE. Root-cause fix for the plaintext-HMAC-secret
 * class. Every long-lived secret Mneme writes to disk MUST go through
 * this helper so it lands as 0600 (owner-read-only) on Unix and with
 * restricted ACL on Windows.
 *
 * Why this exists:
 *   - An external audit found that pole-secret.json (used to sign rope
 *     tokens), and similar HMAC-secret files, were being written with
 *     the Node fs default mode — 0644 on Unix. Any unprivileged user
 *     on the same machine could read them, forge tokens, and bypass
 *     covenant / killswitch / passport / soul-prompt verification.
 *   - The fix is structural: replace every direct `writeFileSync(secret)`
 *     call with `writeSecretFile(...)`. Future leaks become impossible.
 *
 * Contract:
 *   - File written with mode 0600 on POSIX. icacls invoked on Windows
 *     to remove inherited permissions and grant access only to the
 *     current user. If the icacls call fails (e.g., FAT32 volume), the
 *     helper logs a warning to stderr and continues, since the file is
 *     still less-readable than the previous default.
 *   - Parent directory is created if missing (also chmod 0700 on POSIX).
 *   - Atomicity: write-then-rename via a sibling temp file so a partial
 *     write never leaves a half-written secret on disk.
 */

import { existsSync, mkdirSync, writeFileSync, renameSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { platform } from "node:os";
import { safeExecTry } from "./safe_exec.js";

const IS_WINDOWS = platform() === "win32";

export interface SecretWriteOptions {
  /** Optional override of the file mode (POSIX). Default 0600. */
  modePosix?: number;
  /** Optional override of the directory mode (POSIX). Default 0700. */
  dirModePosix?: number;
  /** When true, skips the Windows ACL step (used by tests). */
  skipWindowsAcl?: boolean;
}

/** Lock a Windows file's ACL down to the current user.
 *  Best-effort: a failure here doesn't abort the write.
 *  Implementation: `icacls path /inheritance:r /grant:r %USERNAME%:F`. */
function lockdownWindowsAcl(path: string): { ok: boolean; reason?: string } {
  const user = process.env["USERNAME"];
  if (!user) return { ok: false, reason: "no USERNAME env" };
  // Strip inherited ACEs first.
  const strip = safeExecTry("icacls", [path, "/inheritance:r"], { timeoutMs: 5000 });
  if (!strip || strip.status !== 0) return { ok: false, reason: "icacls /inheritance:r failed" };
  // Grant the current user full access — and nobody else.
  const grant = safeExecTry("icacls", [path, "/grant:r", `${user}:F`], { timeoutMs: 5000 });
  if (!grant || grant.status !== 0) return { ok: false, reason: "icacls /grant failed" };
  return { ok: true };
}

/** Write a secret file securely. Returns the absolute path written. */
export function writeSecretFile(path: string, content: string | Buffer, opts: SecretWriteOptions = {}): string {
  const dir = dirname(path);
  const fileMode = opts.modePosix ?? 0o600;
  const dirMode = opts.dirModePosix ?? 0o700;

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    if (!IS_WINDOWS) {
      try { chmodSync(dir, dirMode); } catch { /* best-effort */ }
    }
  }

  // Write to a temp sibling first, then atomically rename. Ensures we
  // never leave a partial-content secret on disk if the process dies
  // mid-write.
  const tmpPath = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(tmpPath, content, { mode: fileMode });
  try {
    renameSync(tmpPath, path);
  } catch (e) {
    try { writeFileSync(path, content, { mode: fileMode }); } catch { /* */ }
    throw e;
  }

  // Re-assert the mode after rename — some filesystems mask the create
  // mode through umask, so an explicit chmod is the only guarantee on POSIX.
  if (!IS_WINDOWS) {
    try { chmodSync(path, fileMode); } catch { /* best-effort */ }
  } else if (!opts.skipWindowsAcl) {
    const r = lockdownWindowsAcl(path);
    if (!r.ok) {
      // Don't crash; surface a warning. Users on FAT32 / network shares
      // may legitimately not have ACL support.
      // eslint-disable-next-line no-console
      console.warn(`[mneme:secret_store] Windows ACL lockdown skipped for ${path}: ${r.reason}`);
    }
  }
  return path;
}

/** Convenience: write JSON.stringify(obj) as a secret. */
export function writeSecretJson(path: string, obj: unknown, opts: SecretWriteOptions = {}): string {
  return writeSecretFile(path, JSON.stringify(obj, null, 2), opts);
}
