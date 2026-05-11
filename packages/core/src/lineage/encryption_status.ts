/**
 * MNEME LINEAGE ENCRYPTION STATUS (v1.42.5 — #8 fix).
 *
 * v1.42.2 (#9 fix) updated the inline COMMENT on `encryptionEnabled` to
 * say "the at_rest_crypto module shipped v1.35 but is NOT yet wired into
 * the chromosome read/write path." That made the COMMENT honest. The
 * FLAG itself is still decorative.
 *
 * v1.42.5 (#8 fix) ships an explicit STATUS function that returns the
 * real picture. Callers should use this instead of reading the boolean
 * flag directly. The flag stays for backward compat (and for the
 * agent-facing `welcome` payload) but new code reads here.
 *
 * The contract:
 *   - moduleAvailable: true when at_rest_crypto.ts is present + a salt
 *     file exists at .mneme/lineage/identity (i.e. the key derivation
 *     could succeed if invoked).
 *   - autoWired: true when chromosome read/write actually call
 *     encryptChromosome / decryptChromosome. Currently ALWAYS false.
 *     Flips to true when v1.43.x lands the wiring.
 *   - userVisibleEnabled: what the welcome payload should report —
 *     `moduleAvailable && autoWired`.
 */

import { existsSync } from "node:fs";
import { join } from "node:path";

const SALT_FILE = ".mneme/lineage/identity/salt.bin";

export interface EncryptionStatus {
  /** at_rest_crypto module exists in the build + key material is on disk. */
  moduleAvailable: boolean;
  /** Chromosome read/write actually calls encrypt/decrypt. Currently false. */
  autoWired: boolean;
  /** Single boolean for callers that just want one yes/no. */
  userVisibleEnabled: boolean;
  /** Free-text reason — surfaced in `mneme lineage encryption status`. */
  reason: string;
}

export function getEncryptionStatus(repoRoot: string): EncryptionStatus {
  const saltExists = existsSync(join(repoRoot, SALT_FILE));
  // Until v1.43.x wires it, autoWired is hard-coded false. When the
  // wiring lands, replace this with a runtime probe (e.g., read one
  // chromosome + check magic bytes "MNEMECv1").
  const autoWired = false;
  const moduleAvailable = saltExists;
  const userVisibleEnabled = moduleAvailable && autoWired;
  let reason: string;
  if (userVisibleEnabled) {
    reason = "AES-256-GCM at rest, Argon2id key derivation, salt persistent across reinstalls";
  } else if (moduleAvailable) {
    reason = "at_rest_crypto module + salt material ready, but chromosome read/write does NOT call encrypt yet (v1.43.x will wire)";
  } else {
    reason = "at_rest_crypto module shipped v1.35.0 but salt material missing — encryption neither possible nor enforced";
  }
  return { moduleAvailable, autoWired, userVisibleEnabled, reason };
}

/** Render a one-line summary for `mneme lineage encryption status`. */
export function renderEncryptionStatus(repoRoot: string): string {
  const s = getEncryptionStatus(repoRoot);
  const verdict = s.userVisibleEnabled ? "✓ ENABLED" : s.moduleAvailable ? "○ READY (wiring pending v1.43.x)" : "✗ DISABLED";
  return `Encryption at rest: ${verdict}\n  ${s.reason}`;
}
