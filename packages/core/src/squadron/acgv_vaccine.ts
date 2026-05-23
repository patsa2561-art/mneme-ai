/**
 * v1.51.0 — ACGV LAYER 5: STIGMERGY VACCINE FROM LIES.
 *
 * Every claim that earns IMPOSSIBLE_REFUTE (Chandrasekhar BLACK_HOLE +
 * Godel UNSAT) is hashed and stored as a vaccine. Future claims with
 * similar simhash signatures are auto-refuted in microseconds without
 * re-running the full pipeline.
 *
 * Simhash is a content fingerprint that yields 0 Hamming distance for
 * identical strings, small distance for near-duplicates, large distance
 * for unrelated. We use a 64-bit simhash over tokenized claim text.
 *
 * Storage: .mneme/squadron/lie-vaccines.jsonl  (JSONL, append-only)
 *
 * Match rule: a new claim matches a vaccine when their simhash Hamming
 * distance is <= MATCH_RADIUS (default 8 bits out of 64). That's strict
 * enough to avoid false positives but loose enough to catch paraphrased
 * versions of the same lie.
 *
 * This is the "lies become immunity" mechanic. Mneme remembers every
 * debunked claim shape forever. The repo's antibody pool grows over time.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";

export interface LieVaccine {
  id: string;
  /** 64-bit simhash, hex-encoded (16 chars). */
  simhash: string;
  /** First time we saw this lie shape. */
  firstSeen: string;
  /** Most recent time. */
  lastSeen: string;
  /** How many times this shape has been refuted. */
  refuteCount: number;
  /** Why this pattern was deemed a lie (proof summary). */
  signature: string;
  /** Sample claim text -- truncated to 200 chars. */
  sample: string;
}

export interface VaccineMatch {
  vaccine: LieVaccine;
  distance: number;
  /** When true, the orchestrator should refuse the new claim immediately. */
  matched: boolean;
}

/** Tokenize for simhash: lowercase, alphanumeric tokens length >= 3. */
function tokenize(text: string): string[] {
  return text.toLowerCase().split(/[^a-z0-9]+/g).filter((t) => t.length >= 3);
}

/** Compute a 64-bit simhash over the token stream. We hash each token
 *  with sha1, take the first 64 bits, then bit-vote across all tokens.
 *  Positive votes become 1, non-positive become 0. */
export function simhash64(text: string): string {
  const tokens = tokenize(text);
  if (tokens.length === 0) return "0".repeat(16);
  const votes = new Array<number>(64).fill(0);
  for (const t of tokens) {
    const h = createHash("sha1").update(t).digest();
    for (let i = 0; i < 64; i++) {
      const byte = h[Math.floor(i / 8)]!;
      const bit = (byte >> (7 - (i % 8))) & 1;
      votes[i]! += bit === 1 ? 1 : -1;
    }
  }
  let hex = "";
  for (let nibble = 0; nibble < 16; nibble++) {
    let v = 0;
    for (let b = 0; b < 4; b++) {
      const bitIdx = nibble * 4 + b;
      v = (v << 1) | (votes[bitIdx]! > 0 ? 1 : 0);
    }
    hex += v.toString(16);
  }
  return hex;
}

/** Hamming distance between two equal-length hex strings (64-bit simhash).
 *  Returns -1 if lengths don't match. */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) return -1;
  let dist = 0;
  for (let i = 0; i < a.length; i++) {
    const xa = parseInt(a[i]!, 16);
    const xb = parseInt(b[i]!, 16);
    let x = xa ^ xb;
    while (x) { dist += x & 1; x >>>= 1; }
  }
  return dist;
}

const MATCH_RADIUS = 8;
const VACCINE_FILE = join(".mneme", "squadron", "lie-vaccines.jsonl");

function vaccinePath(repoRoot: string): string {
  return join(repoRoot, VACCINE_FILE);
}

/** Load every vaccine. Best-effort. Cap at last 1000 to keep memory bounded. */
export function loadVaccines(repoRoot: string): LieVaccine[] {
  const path = vaccinePath(repoRoot);
  if (!existsSync(path)) return [];
  try {
    const body = readFileSync(path, "utf8");
    const lines = body.split("\n").filter(Boolean);
    const recent = lines.slice(-1000);
    const out: LieVaccine[] = [];
    for (const line of recent) {
      try { out.push(JSON.parse(line) as LieVaccine); } catch { /* skip bad row */ }
    }
    return out;
  } catch {
    return [];
  }
}

/** Check whether a claim matches any existing vaccine. Returns the FIRST
 *  match within MATCH_RADIUS (sorted by Hamming distance). */
export function checkAgainstVaccines(repoRoot: string, claim: string): VaccineMatch | null {
  const vaccines = loadVaccines(repoRoot);
  if (vaccines.length === 0) return null;
  const h = simhash64(claim);
  let best: VaccineMatch | null = null;
  for (const v of vaccines) {
    const d = hammingDistance(h, v.simhash);
    if (d < 0) continue;
    if (d <= MATCH_RADIUS && (best === null || d < best.distance)) {
      best = { vaccine: v, distance: d, matched: true };
    }
  }
  return best;
}

/** Store a new vaccine. Idempotent on exact-match simhash; updates count
 *  + lastSeen if we've already got this lie shape. */
export function emitVaccine(
  repoRoot: string,
  claim: string,
  signature: string,
): LieVaccine {
  const h = simhash64(claim);
  const existing = loadVaccines(repoRoot).find((v) => v.simhash === h);
  const now = new Date().toISOString();
  const vaccine: LieVaccine = existing
    ? { ...existing, refuteCount: existing.refuteCount + 1, lastSeen: now }
    : {
        id: createHash("sha256").update(`${h}|${signature}`).digest("hex").slice(0, 12),
        simhash: h,
        firstSeen: now,
        lastSeen: now,
        refuteCount: 1,
        signature,
        sample: claim.slice(0, 200),
      };
  try {
    const dir = join(repoRoot, ".mneme", "squadron");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(vaccinePath(repoRoot), JSON.stringify(vaccine) + "\n", "utf8");
  } catch { /* best-effort */ }

  // v2.31.0 — HGP composition. Best-effort: every refuted claim also
  // becomes a Hallucination Genome Project record (deterministic
  // CVE-style HGP-ID). Vendor attribution is unavailable from this
  // call-site; downstream callers can use the HGP API directly with
  // vendor info when known. We import lazily to avoid cycles +
  // swallow any failure so vaccine emission stays the hard path.
  try {
    void import("../hgp/index.js").then((hgp) => {
      try {
        hgp.recordHallucination(repoRoot, { claim, signature });
      } catch { /* best-effort */ }
    }).catch(() => { /* best-effort */ });
  } catch { /* best-effort */ }

  return vaccine;
}
