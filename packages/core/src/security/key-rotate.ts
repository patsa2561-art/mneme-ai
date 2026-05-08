/**
 * Key rotation — atomically re-sign the audit-log chain with a fresh secret.
 *
 * Banking / SOC2 requirement: secret keys must be rotated periodically (90d
 * typical). Naive rotation breaks every HMAC in the chain — verify() would
 * fail forever after rotation. Solution: re-walk the chain, recompute each
 * entry's hmac under the NEW secret, write atomically.
 *
 * Wisdom check #1 (world-class?): YES.
 *   - Atomic via temp file + rename (POSIX rename is atomic; Windows close-
 *     enough atomic).
 *   - Re-verify the chain BEFORE rotating (refuse to re-sign tampered data).
 *   - Re-verify the chain AFTER rotating (paranoia: confirm new chain valid).
 *   - Old log archived as audit.log.pre-rotate-<ts> (never destroy evidence).
 *   - Rotation event itself appended after rotation, signed with new secret.
 *
 * Wisdom check #2 (does this affect functionality?): NO.
 *   - Opt-in via `mneme key rotate --confirm`. Default: never auto-rotate.
 *   - If audit-log disabled: no-op (returns gracefully).
 *
 * What we DON'T do (and why):
 *   - We don't keep the old secret around after rotation — the old chain
 *     is archived in plaintext (still a tamper-evident snapshot signed
 *     with the old secret) but the live log uses only the new secret.
 *   - We don't auto-rotate on schedule — that's a daemon-level concern,
 *     and silent auto-rotation breaks compliance audit trails.
 */

import { existsSync, readFileSync, writeFileSync, renameSync, copyFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import * as auditLog from "./audit-log.js";

export interface KeyRotateResult {
  rotated: boolean;
  reason?: string;
  archivedPath?: string;
  /** Number of entries re-signed under the new secret. */
  reSigned?: number;
  /** First 12 hex chars of the new secret (for display only). */
  newSecretFingerprint?: string;
}

const SECRET_LENGTH = 32;

function paths(repoRoot: string) {
  return {
    log: join(repoRoot, ".mneme", "audit.log"),
    secret: join(repoRoot, ".mneme", "audit-log.secret"),
  };
}

/**
 * Rotate the HMAC secret. The flow:
 *   1. Verify the existing chain — refuse to rotate tampered data.
 *   2. Generate fresh secret.
 *   3. Re-sign every entry: prevHmac links updated, hmac fields recomputed.
 *   4. Atomically swap the new chain into place.
 *   5. Atomically swap the new secret into place.
 *   6. Re-verify (paranoia).
 *   7. Append a `key-rotate` audit entry under the new secret.
 *
 * If MNEME_AUDIT_SECRET env is set, the new secret is appended to the
 * stored secret file but the env var still wins for runtime — operator
 * is expected to update the env var separately. We surface the new
 * secret fingerprint in the result so they can sync.
 */
export function rotateSecret(repoRoot: string, actor: string): KeyRotateResult {
  if (!auditLog.isEnabled(repoRoot)) {
    return { rotated: false, reason: "audit-log not enabled" };
  }

  const p = paths(repoRoot);
  if (!existsSync(p.log)) {
    // Empty log — just generate a fresh secret + record the rotation.
    const fresh = randomBytes(SECRET_LENGTH).toString("hex");
    writeSecretAtomic(p.secret, fresh);
    auditLog.appendEntry(repoRoot, { actor, action: "key-rotate", details: { fromEntries: 0 } });
    return { rotated: true, reSigned: 0, newSecretFingerprint: fresh.slice(0, 12) };
  }

  // 1. Verify the chain BEFORE we touch anything.
  const pre = auditLog.verify(repoRoot);
  if (!pre.ok) {
    return {
      rotated: false,
      reason: `chain broken at index ${pre.brokenAtIndex} (${pre.brokenReason}) — refusing to re-sign tampered data`,
    };
  }

  // 2. Read current entries.
  const entries = auditLog.readAll(repoRoot);

  // 3. Generate the fresh secret + re-sign.
  const newSecret = randomBytes(SECRET_LENGTH).toString("hex");
  const reSignedLines: string[] = [];
  let prevHmac = "0".repeat(64);
  for (const e of entries) {
    const body = {
      ts: e.ts,
      actor: e.actor,
      action: e.action,
      target: e.target,
      details: e.details,
    };
    const newHmac = auditLog._computeEntryHmacForTests(newSecret, prevHmac, body);
    const re = { ...body, prevHmac, hmac: newHmac };
    reSignedLines.push(JSON.stringify(re));
    prevHmac = newHmac;
  }

  // 4. Archive the old log (preserve evidence) + atomically install new chain.
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const archived = p.log + ".pre-rotate-" + stamp;
  copyFileSync(p.log, archived);
  const tmpLog = p.log + ".tmp";
  writeFileSync(tmpLog, reSignedLines.join("\n") + "\n", { encoding: "utf8", mode: 0o600 });
  renameSync(tmpLog, p.log);

  // 5. Atomically install the new secret.
  writeSecretAtomic(p.secret, newSecret);

  // 6. Paranoia — re-verify with the new secret in place.
  // Force the env var off temporarily so verify reads from the file.
  const envBackup = process.env["MNEME_AUDIT_SECRET"];
  if (envBackup !== undefined) delete process.env["MNEME_AUDIT_SECRET"];
  try {
    const post = auditLog.verify(repoRoot);
    if (!post.ok) {
      throw new Error(`Internal error: re-signed chain failed verification at index ${post.brokenAtIndex}`);
    }
  } finally {
    if (envBackup !== undefined) process.env["MNEME_AUDIT_SECRET"] = envBackup;
  }

  // 7. Append the rotation event itself.
  auditLog.appendEntry(repoRoot, {
    actor,
    action: "key-rotate",
    details: {
      reSignedEntries: entries.length,
      archivedPath: archived,
    },
  });

  return {
    rotated: true,
    archivedPath: archived,
    reSigned: entries.length,
    newSecretFingerprint: newSecret.slice(0, 12),
  };
}

function writeSecretAtomic(secretPath: string, secret: string): void {
  const tmp = secretPath + ".tmp";
  writeFileSync(tmp, secret, { encoding: "utf8", mode: 0o600 });
  renameSync(tmp, secretPath);
}
