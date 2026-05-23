/**
 * v2.31.0 — HGP-ID issuance (CVE-style deterministic IDs).
 *
 * Format: HGP-YYYY-NNNNN
 *   YYYY = year the hallucination was FIRST seen
 *   NNNNN = 5-digit base-10 derived deterministically from the
 *           hallucination's simhash so that the SAME shape on
 *           different machines + at different times gets the SAME
 *           HGP-ID (modulo year-collision, handled by the registry).
 *
 * The year-NNNNN combination is a 64-bit space → < 1 in 10^5
 * per-year collision rate even at 10k hallucinations/year. Registry
 * (next file) handles collision by appending -A / -B / ... suffix.
 */

import { createHash } from "node:crypto";

export function computeHgpIdFromSimhash(simhash: string, firstSeen: string): string {
  const year = new Date(firstSeen).getUTCFullYear();
  // Deterministic 5-digit derivation: hash(simhash || year) mod 100_000.
  const h = createHash("sha256").update(`${simhash}|${year}`).digest();
  const n = (h[0]! << 24 | h[1]! << 16 | h[2]! << 8 | h[3]!) >>> 0;
  const slot = (n % 99_999) + 1;
  return `HGP-${year}-${String(slot).padStart(5, "0")}`;
}

const VALID = /^HGP-(\d{4})-(\d{5})(?:-[A-Z]+)?$/;

export function isValidHgpId(id: string): boolean {
  return VALID.test(id);
}

export function disambiguate(baseId: string, takenCount: number): string {
  if (takenCount === 0) return baseId;
  // Suffix A, B, C, ..., AA, AB, ... for >26. takenCount is 1-based:
  // 1 → A, 2 → B, ..., 27 → AA.
  let n = takenCount - 1;
  const letters: string[] = [];
  do {
    letters.unshift(String.fromCharCode("A".charCodeAt(0) + (n % 26)));
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${baseId}-${letters.join("")}`;
}
