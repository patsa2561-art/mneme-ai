/**
 * v1.11.1 — "Security on by default" auto-bootstrap.
 *
 * Single entry point that every mutating Mneme operation calls before
 * doing its work. Idempotent. Cost ~1ms on warm path (one stat call).
 *
 *   1. Auto-enable HMAC-chained audit log on first touch.
 *   2. Auto-detect FIPS-validated OpenSSL → set compliance posture.
 *   3. Auto-pin bundled-model checksums on first download (handled in
 *      embeddings package; this module just exposes the helper).
 *
 * Wisdom check: is auto-on the right default?
 *   - Audit log: YES — passive, near-zero cost, privacy-preserving.
 *   - FIPS detection: YES — informational only; no enforcement unless
 *     user passes --compliance fips140.
 *   - Subprocess hardening: ALWAYS on (no toggle, no opt-out).
 *
 * `mneme security off` is the documented escape hatch; we never silently
 * re-enable for users who explicitly disabled.
 */

import { ensureAutoEnabled, isEnabled } from "./audit-log.js";
import { isFipsActive } from "./compliance.js";

export interface AutoBootstrapResult {
  /** True if audit log was just auto-enabled this call (vs already on). */
  auditLogAutoEnabled: boolean;
  /** Current state of audit log after bootstrap. */
  auditLogEnabled: boolean;
  /** Detected FIPS posture (informational; not enforced unless --compliance fips140). */
  fipsActive: boolean;
}

/**
 * Bootstrap security defaults for a repo root. Idempotent.
 * Safe to call on every command entry — costs ~1ms warm.
 *
 * Caller can inspect the return value to surface a one-time "auto-enabled"
 * notice on first install (e.g. printed by `mneme init` or `mneme index`).
 */
export function autoBootstrap(repoRoot: string): AutoBootstrapResult {
  const auditLogAutoEnabled = ensureAutoEnabled(repoRoot);
  const auditLogEnabled = isEnabled(repoRoot);
  const fipsActive = isFipsActive();
  return { auditLogAutoEnabled, auditLogEnabled, fipsActive };
}
