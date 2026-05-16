/**
 * v2.19.20 — MNEME PROVENANCE-BY-DNA-HASH
 *
 *   Every product image gets a PERCEPTUAL HASH ("DNA fingerprint") so
 *   slightly-resized / re-compressed copies still match the original.
 *   Mneme records {pHash, claim, sellerFingerprint, ts} per query.
 *   After 90 days of history, 3 flagging algorithms surface:
 *
 *     1. STOLEN PHOTO — same pHash from N≥10 distinct sellers in 90d
 *     2. DISPUTED IDENTITY — same pHash, conflicting claims ≥80% of time
 *     3. FRESH SCAM — brand-new pHash + high-value claim ("$10000 limited")
 *
 *   Uses v2.19.16 FEDERATED TRUTH GRAVITY: perceptual hash is a new
 *   discoverable claim type for cross-instance attestation.
 *
 * Algorithm: average-hash (aHash) — a perceptual hash that is:
 *   - Pure TS, ~50 LOC, zero deps
 *   - Locality-sensitive: identical → identical hash; scaled/recompressed
 *     → Hamming distance < 8 (out of 64 bits)
 *   - Discrimination: random distinct images → Hamming distance > 20
 *   - Deterministic per RGBA input
 *
 * Composes onto:
 *   - v2.19.16 FEDERATED TRUTH (pHash = subject for federated quorum)
 *   - v2.19.18 CSP (overlay context fed by provenance verdict)
 *   - v2.19.0 BOUNTY ledger (seller fingerprints tracked)
 *   - v2.19.13 NEGEV (flag = REJECTED gate for downstream claims)
 *
 * Honest scope:
 *   - aHash is the simplest perceptual hash; better algorithms (pHash-DCT,
 *     wavelet, dHash) exist. We ship aHash for pure-TS simplicity; caller
 *     can supply alternative hashFn for higher robustness.
 *   - Registry persistence is caller's responsibility (filesystem / KV).
 *     Mneme provides the protocol + flagging + signing.
 */

import { createHmac, timingSafeEqual, createHash } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const STOLEN_PHOTO_THRESHOLD = 10;          // ≥N distinct sellers = stolen signal
const DISPUTED_CLAIM_RATIO = 0.8;            // ≥80% conflicting = disputed
const FRESH_HASH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REGISTRY_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;  // 90 days

const HIGH_VALUE_CLAIM_RE = /\$\s*\d{4,}|\b(\d{1,3}[,.]\d{3,})\s*(usd|baht|euro|gbp|yen|krw)?\b|\bsuper\s*rare\b|\blimited\s*edition\b|\bcollector'?s?\b/i;

// ─── INPUT SHAPES ───────────────────────────────────────────────────────

export interface RawImage {
  width: number;
  height: number;
  rgba: Uint8Array;
}

export interface ProvenanceObservation {
  v: typeof PROTOCOL_VERSION;
  pHash: string; // hex of 64-bit aHash
  claim: string;
  sellerFingerprint: string; // pseudonymous seller id (caller-defined)
  ts: number;
  prevSig: string | null;
  sig: string;
}

export interface ProvenanceRegistry {
  v: typeof PROTOCOL_VERSION;
  records: ProvenanceObservation[];
}

// ─── HELPERS ────────────────────────────────────────────────────────────

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_PROV_SECRET"] || `mneme-provenance-dna-v${PROTOCOL_VERSION}`;
}

function signObservation(body: Omit<ProvenanceObservation, "sig">, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

// ─── PERCEPTUAL HASH (aHash) ────────────────────────────────────────────

const PHASH_SIZE = 8; // 8x8 = 64-bit hash

/**
 * Average-hash perceptual fingerprint.
 *   1. Downsample to 8x8 using box-average resampling.
 *   2. Convert to grayscale (Rec.709 weights).
 *   3. Compute the mean intensity.
 *   4. For each pixel: 1 if > mean, 0 else.
 *   5. Pack 64 bits into 16-char hex.
 *
 * Properties:
 *   - Deterministic per input
 *   - Identical input → identical hash
 *   - Similar input (resize, mild compression) → Hamming distance < 8
 *   - Random pair → Hamming distance > 20 expected
 */
export function perceptualHash(image: RawImage): string {
  const { width: W, height: H } = image;
  if (W < 1 || H < 1 || image.rgba.length !== W * H * 4) {
    throw new Error("provenance: invalid image");
  }
  const downsampled = new Uint8Array(PHASH_SIZE * PHASH_SIZE);
  const cellW = W / PHASH_SIZE;
  const cellH = H / PHASH_SIZE;
  for (let cy = 0; cy < PHASH_SIZE; cy++) {
    for (let cx = 0; cx < PHASH_SIZE; cx++) {
      let sum = 0, count = 0;
      const x0 = Math.floor(cx * cellW);
      const y0 = Math.floor(cy * cellH);
      const x1 = Math.max(x0 + 1, Math.floor((cx + 1) * cellW));
      const y1 = Math.max(y0 + 1, Math.floor((cy + 1) * cellH));
      for (let y = y0; y < Math.min(H, y1); y++) {
        for (let x = x0; x < Math.min(W, x1); x++) {
          const idx = (y * W + x) * 4;
          // Rec.709 grayscale
          const g = 0.2126 * image.rgba[idx + 0]! + 0.7152 * image.rgba[idx + 1]! + 0.0722 * image.rgba[idx + 2]!;
          sum += g;
          count++;
        }
      }
      downsampled[cy * PHASH_SIZE + cx] = count === 0 ? 0 : Math.round(sum / count);
    }
  }
  // Mean across the 64 cells
  let total = 0;
  for (let i = 0; i < downsampled.length; i++) total += downsampled[i]!;
  const mean = total / downsampled.length;
  // Pack bits
  const bits = new Uint8Array(8);
  for (let i = 0; i < 64; i++) {
    if (downsampled[i]! > mean) {
      bits[i >> 3] |= 1 << (7 - (i & 7));
    }
  }
  return Buffer.from(bits).toString("hex");
}

/** Hamming distance between two pHash hex strings (number of differing bits). */
export function hammingDistance(a: string, b: string): number {
  if (a.length !== b.length) throw new Error("hamming: length mismatch");
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  let dist = 0;
  for (let i = 0; i < bufA.length; i++) {
    let x = bufA[i]! ^ bufB[i]!;
    while (x) { dist += x & 1; x >>= 1; }
  }
  return dist;
}

// ─── REGISTRY ───────────────────────────────────────────────────────────

export function emptyRegistry(): ProvenanceRegistry {
  return { v: PROTOCOL_VERSION, records: [] };
}

export interface RecordObservationInput {
  registry: ProvenanceRegistry;
  pHash: string;
  claim: string;
  sellerFingerprint: string;
  nowMs?: number;
  secret?: string;
}

export function recordObservation(input: RecordObservationInput): ProvenanceRegistry {
  const prev = input.registry.records[input.registry.records.length - 1];
  const body: Omit<ProvenanceObservation, "sig"> = {
    v: PROTOCOL_VERSION,
    pHash: input.pHash,
    claim: input.claim,
    sellerFingerprint: input.sellerFingerprint,
    ts: input.nowMs ?? Date.now(),
    prevSig: prev ? prev.sig : null,
  };
  const sig = signObservation(body, input.secret ?? defaultSecret());
  return { v: PROTOCOL_VERSION, records: [...input.registry.records, { ...body, sig }] };
}

export function verifyRegistry(registry: ProvenanceRegistry, secret?: string): { ok: boolean; brokenAt?: number; reason?: string } {
  const sec = secret ?? defaultSecret();
  let prevSig: string | null = null;
  for (let i = 0; i < registry.records.length; i++) {
    const r = registry.records[i]!;
    const { sig, ...body } = r;
    if (body.prevSig !== prevSig) return { ok: false, brokenAt: i, reason: `prevSig mismatch at step ${i}` };
    if (!safeEqHex(signObservation(body, sec), sig)) return { ok: false, brokenAt: i, reason: `HMAC mismatch at step ${i}` };
    prevSig = sig;
  }
  return { ok: true };
}

// ─── FLAGGING ALGORITHMS ────────────────────────────────────────────────

export type ProvenanceFlag = "STOLEN_PHOTO" | "DISPUTED_IDENTITY" | "FRESH_SCAM" | "CLEAN";

export interface ProvenanceVerdict {
  pHash: string;
  flags: ProvenanceFlag[];
  distinctSellers: number;
  totalObservations: number;
  conflictingClaimRatio: number;
  oldestObservationMs: number | null;
  newestObservationMs: number | null;
  hashAgeDays: number;
  evidence: string[];
}

export function evaluatePhash(opts: {
  registry: ProvenanceRegistry;
  pHash: string;
  /** Caller's currently-asserted claim — checked against history for "fresh scam". */
  candidateClaim?: string;
  /** Hamming-distance tolerance: pHashes within this distance count as "same". Default 4. */
  hammingTolerance?: number;
  nowMs?: number;
}): ProvenanceVerdict {
  const tol = opts.hammingTolerance ?? 4;
  const nowMs = opts.nowMs ?? Date.now();
  const windowStart = nowMs - REGISTRY_WINDOW_MS;
  // Find matching records via Hamming distance ≤ tol
  const matching = opts.registry.records.filter((r) => {
    if (r.ts < windowStart) return false;
    return hammingDistance(r.pHash, opts.pHash) <= tol;
  });
  const distinctSellers = new Set(matching.map((r) => r.sellerFingerprint));
  const flags: ProvenanceFlag[] = [];
  const evidence: string[] = [];
  // STOLEN PHOTO: ≥ STOLEN_PHOTO_THRESHOLD distinct sellers
  if (distinctSellers.size >= STOLEN_PHOTO_THRESHOLD) {
    flags.push("STOLEN_PHOTO");
    evidence.push(`${distinctSellers.size} distinct sellers used this image in 90d (≥${STOLEN_PHOTO_THRESHOLD} threshold)`);
  }
  // DISPUTED IDENTITY: most-common claim < 1-DISPUTED_CLAIM_RATIO of total
  const claimCounts = new Map<string, number>();
  for (const r of matching) claimCounts.set(r.claim, (claimCounts.get(r.claim) ?? 0) + 1);
  const topClaim = Array.from(claimCounts.entries()).sort((a, b) => b[1] - a[1])[0];
  let conflictingRatio = 0;
  if (matching.length > 0 && topClaim) {
    const conflicting = matching.length - topClaim[1];
    conflictingRatio = conflicting / matching.length;
    if (conflictingRatio >= DISPUTED_CLAIM_RATIO) {
      flags.push("DISPUTED_IDENTITY");
      evidence.push(`top claim '${topClaim[0]}' is only ${(100 - conflictingRatio * 100).toFixed(0)}% of observations (≥${DISPUTED_CLAIM_RATIO * 100}% conflict threshold)`);
    }
  }
  // FRESH SCAM: no historical observations + candidate claim has high-value words
  const timestamps = matching.map((r) => r.ts);
  const oldest = timestamps.length === 0 ? null : Math.min(...timestamps);
  const newest = timestamps.length === 0 ? null : Math.max(...timestamps);
  const hashAgeDays = oldest === null ? 0 : (nowMs - oldest) / (24 * 60 * 60 * 1000);
  if (oldest === null || (nowMs - oldest) < FRESH_HASH_WINDOW_MS) {
    if (opts.candidateClaim && HIGH_VALUE_CLAIM_RE.test(opts.candidateClaim)) {
      flags.push("FRESH_SCAM");
      evidence.push(`hash is <7d old + candidate claim '${opts.candidateClaim}' contains high-value scam phrase`);
    }
  }
  if (flags.length === 0) {
    flags.push("CLEAN");
    evidence.push(matching.length === 0 ? "no historical observations" : `${matching.length} observations consistent`);
  }
  return {
    pHash: opts.pHash,
    flags,
    distinctSellers: distinctSellers.size,
    totalObservations: matching.length,
    conflictingClaimRatio: Number(conflictingRatio.toFixed(4)),
    oldestObservationMs: oldest,
    newestObservationMs: newest,
    hashAgeDays: Number(hashAgeDays.toFixed(2)),
    evidence,
  };
}

// ─── HELPERS ────────────────────────────────────────────────────────────

export function fingerprintSeller(opts: { vendor: string; sessionId?: string; salt?: string }): string {
  return "sf-" + createHash("sha256")
    .update(`${opts.vendor}|${opts.sessionId ?? "anon"}|${opts.salt ?? ""}`)
    .digest("hex").slice(0, 14);
}

export function formatVerdictLine(v: ProvenanceVerdict): string {
  const tag = v.flags.includes("STOLEN_PHOTO") ? "🚨"
    : v.flags.includes("DISPUTED_IDENTITY") ? "⚖"
    : v.flags.includes("FRESH_SCAM") ? "🆕"
    : "✓";
  return `${tag} PROVENANCE · ${v.flags.join(",")} · sellers=${v.distinctSellers}/total=${v.totalObservations} · age=${v.hashAgeDays}d`;
}
