/**
 * v2.4.0 -- HMAC CONSTANT-TIME COMPARE. Root-cause fix for the
 * timing-attack class. The audit found ~25 sites where Mneme compared
 * an expected HMAC against a candidate using JavaScript's `===` operator.
 * `===` on strings short-circuits at the first differing byte, leaking
 * a timing side-channel that an attacker can use to recover an HMAC
 * byte-by-byte.
 *
 * `timingSafeEqual` from node:crypto always compares the full buffer
 * length, so the comparison takes the same wall-clock time regardless
 * of where the strings differ.
 *
 * Contract:
 *   - Both inputs must be strings (hex, base64, base64url — encoding
 *     doesn't matter as long as both use the same one).
 *   - DIFFERENT-LENGTH strings short-circuit to `false`. This is the
 *     ONLY non-constant-time path, and it's safe: an attacker who can
 *     measure the length distinguishes nothing they don't already know
 *     (HMAC output length is fixed per algorithm and public).
 *   - Empty strings compare equal to other empty strings.
 *   - NEVER throws — returns `false` on weird inputs.
 */

import { timingSafeEqual } from "node:crypto";

export function safeHmacEqual(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string") return false;
  if (a.length !== b.length) return false;
  if (a.length === 0) return true;
  try {
    return timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
}

/** Convenience inverse — useful when callers want the "different" path
 *  to read naturally: `if (safeHmacNotEqual(expected, sig)) return "TAMPERED";`. */
export function safeHmacNotEqual(a: unknown, b: unknown): boolean {
  return !safeHmacEqual(a, b);
}
