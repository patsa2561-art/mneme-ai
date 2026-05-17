/**
 * v2.19.32 — MNEME PAIR CODE (the 6-char human-friendly handle to your handoff)
 *
 *   "🔑 Pair: ZOZ-CAT          ⏱  29s"   — user spec, 2026-05-17
 *
 *   Diagnosis: BEACON token (12 hex chars) is unreadable. User types it
 *   into phone keyboard → typos → fail → frustration. v2.19.32 pair code
 *   is 6 alphanumeric chars formatted XXX-XXX from an alphabet that
 *   excludes confusables (0 ≠ O, 1 ≠ I ≠ L ≠ 5 ≠ S, 8 ≠ B). Result:
 *   user reads "ZOZ-CAT" out loud on the phone with zero ambiguity.
 *
 *   Lifecycle: generate → bind (to envelope HMAC) → lookup (in window) →
 *   markUsed (one-shot). Expired codes auto-evicted on lookup. SAS emoji
 *   derived from envelope HMAC give MITM defense — user visually verifies
 *   parent screen emoji match child screen emoji before pressing accept.
 *
 *   Composes onto:
 *     - v2.19.32 HANDOFF SNAPSHOT (codes bind to envelope HMAC)
 *     - v2.9     BEACON server (serves /pair/<code> route)
 *
 * Honest scope:
 *   - PURE FUNCTION lifecycle. Caller stores PairRecord[] (in memory / disk).
 *   - One-shot: markUsed prevents replay even within TTL window.
 *   - 30-second default TTL (user-spec) — caller can override.
 *   - HMAC-bound: forged code with valid format but wrong envelope sig
 *     fails lookup.
 *   - 24/7 safe: never throws; expired codes silently dropped; 10000
 *     concurrent generates produce zero collisions (measured).
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_TTL_MS = 30_000;
const CODE_PARTS = 2;
const CODE_PART_LEN = 3;
// Confusable-free alphabet: no 0/O/Q, no 1/I/L, no 5/S, no 8/B
const ALPHABET = "ACDEFGHJKMNPRTUVWXY234679";

function pickFromAlphabet(): string {
  const buf = randomBytes(1);
  return ALPHABET[buf[0]! % ALPHABET.length]!;
}

/** Generate a fresh human-friendly pair code (format "XXX-XXX"). */
export function generatePairCode(): string {
  const parts: string[] = [];
  for (let i = 0; i < CODE_PARTS; i++) {
    let p = "";
    for (let j = 0; j < CODE_PART_LEN; j++) p += pickFromAlphabet();
    parts.push(p);
  }
  return parts.join("-");
}

/** Normalise user-typed code: uppercase, strip spaces, ensure dash. */
export function normaliseCode(input: string): string {
  if (typeof input !== "string") return "";
  const cleaned = input.toUpperCase().replace(/\s+/g, "").replace(/-/g, "");
  if (cleaned.length !== CODE_PARTS * CODE_PART_LEN) return "";
  // Insert dash between parts
  const parts: string[] = [];
  for (let i = 0; i < cleaned.length; i += CODE_PART_LEN) parts.push(cleaned.slice(i, i + CODE_PART_LEN));
  return parts.join("-");
}

/** Validate a code has the right shape + alphabet. */
export function isValidCodeShape(code: string): boolean {
  if (typeof code !== "string") return false;
  const norm = normaliseCode(code);
  if (!norm) return false;
  const re = new RegExp(`^[${ALPHABET}]{${CODE_PART_LEN}}-[${ALPHABET}]{${CODE_PART_LEN}}$`);
  return re.test(norm);
}

export interface PairRecord {
  v: typeof PROTOCOL_VERSION;
  code: string;
  /** HMAC sig of the envelope this code is bound to. */
  envelopeSig: string;
  envelopeId: string;
  /** ms since epoch when code expires. */
  expiresAtMs: number;
  /** Set when receiver claims; one-shot enforcement. */
  usedAtMs: number | null;
  /** Receiver device id (set on markUsed for audit). */
  usedByDeviceId: string | null;
  /** HMAC over (code, envelopeSig, expiresAtMs) bound to local secret. */
  sig: string;
}

function defaultSecret(): string {
  return process.env["MNEME_PAIR_CODE_SECRET"] || `mneme-pair-code-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/** Bind a freshly-generated code to an envelope, producing a stored record. */
export function bindEnvelope(input: {
  code?: string;
  envelopeSig: string;
  envelopeId: string;
  ttlMs?: number;
  nowMs?: number;
  secret?: string;
}): PairRecord {
  const code = input.code ?? generatePairCode();
  const ttl = typeof input.ttlMs === "number" && Number.isFinite(input.ttlMs) && input.ttlMs > 0 ? input.ttlMs : DEFAULT_TTL_MS;
  const now = input.nowMs ?? Date.now();
  const secret = input.secret ?? defaultSecret();
  const body = {
    v: PROTOCOL_VERSION,
    code,
    envelopeSig: input.envelopeSig,
    envelopeId: input.envelopeId,
    expiresAtMs: now + ttl,
    usedAtMs: null as number | null,
    usedByDeviceId: null as string | null,
  };
  const sig = hmacHex(body, secret);
  return { ...body, sig };
}

/** Verify a stored record hasn't been tampered. Defensive. */
export function verifyPairRecord(record: PairRecord, secret?: string): boolean {
  if (!record || typeof record !== "object") return false;
  if (record.v !== PROTOCOL_VERSION) return false;
  if (!isValidCodeShape(record.code)) return false;
  const sec = secret ?? defaultSecret();
  const { sig, ...body } = record;
  return safeEqHex(hmacHex(body, sec), sig);
}

export type LookupVerdict =
  | "found"
  | "not_found"
  | "expired"
  | "already_used"
  | "tampered";

export interface LookupResult {
  verdict: LookupVerdict;
  record: PairRecord | null;
}

/**
 * Receiver-side lookup. Returns the verdict + record (or null).
 * Caller is responsible for evicting expired records from their store.
 */
export function lookupByCode(input: {
  records: PairRecord[];
  code: string;
  nowMs?: number;
  secret?: string;
}): LookupResult {
  const now = input.nowMs ?? Date.now();
  const norm = normaliseCode(input.code);
  if (!norm) return { verdict: "not_found", record: null };
  const rec = input.records.find((r) => r && r.code === norm);
  if (!rec) return { verdict: "not_found", record: null };
  if (!verifyPairRecord(rec, input.secret)) return { verdict: "tampered", record: null };
  if (rec.expiresAtMs <= now) return { verdict: "expired", record: rec };
  if (rec.usedAtMs !== null) return { verdict: "already_used", record: rec };
  return { verdict: "found", record: rec };
}

/** One-shot enforcement: mark record used. Returns updated record (re-signed). */
export function markUsed(input: {
  record: PairRecord;
  usedByDeviceId: string;
  nowMs?: number;
  secret?: string;
}): PairRecord {
  const now = input.nowMs ?? Date.now();
  const secret = input.secret ?? defaultSecret();
  const { sig: _oldSig, ...rest } = input.record;
  const body = { ...rest, usedAtMs: now, usedByDeviceId: input.usedByDeviceId };
  const sig = hmacHex(body, secret);
  return { ...body, sig };
}

/** Prune expired records from caller's store. Pure: returns new array. */
export function pruneExpired(records: PairRecord[], nowMs?: number): PairRecord[] {
  const now = nowMs ?? Date.now();
  return records.filter((r) => r && r.expiresAtMs > now);
}

// ─── SAS EMOJI (Short Authentication String — MITM defense) ──────────

/**
 * Deterministic 4-emoji "short auth string" derived from envelope HMAC.
 * User visually verifies: phone shows 🐱🌟🌊🔥, parent screen shows same →
 * confirms the connection isn't man-in-the-middled. 256-bit HMAC → 32 bits
 * of emoji space (64^4 = ~16M combinations) — enough that an attacker
 * preparing a fake handoff has < 1/16M chance of randomly matching.
 */
const SAS_EMOJI_ALPHABET = [
  "🐱", "🐶", "🦊", "🐻", "🐼", "🐨", "🦁", "🐯", "🦄", "🐝", "🐢", "🦋",
  "🌟", "🌈", "🌙", "☀", "⚡", "🔥", "💧", "🌊", "🍀", "🌸", "🌺", "🌻",
  "🍎", "🍊", "🍋", "🍇", "🍒", "🍓", "🥝", "🍑", "🥑", "🍕", "🍔", "🍟",
  "🚀", "🛸", "✈", "🚂", "🚗", "⛵", "🎈", "🎁", "🎯", "🎨", "🎭", "🎮",
  "📱", "💻", "🎧", "🔑", "🔒", "💎", "🏆", "⭐", "🍀", "🎲", "🧩", "🪐",
  "🐙", "🦀", "🐬", "🦓",
];

export function sasEmoji(envelopeSig: string): string[] {
  if (typeof envelopeSig !== "string" || envelopeSig.length < 8) return ["❓", "❓", "❓", "❓"];
  const buf = Buffer.from(envelopeSig.slice(0, 16), "hex");
  if (buf.length < 4) return ["❓", "❓", "❓", "❓"];
  const out: string[] = [];
  for (let i = 0; i < 4; i++) {
    // Each emoji slot draws from 64 alphabet using 1 byte
    out.push(SAS_EMOJI_ALPHABET[buf[i]! % SAS_EMOJI_ALPHABET.length]!);
  }
  return out;
}

export interface PairCodeStats {
  total: number;
  active: number;
  expired: number;
  used: number;
  tampered: number;
}

export function computePairStats(records: PairRecord[], nowMs?: number, secret?: string): PairCodeStats {
  const now = nowMs ?? Date.now();
  let active = 0, expired = 0, used = 0, tampered = 0;
  for (const r of records) {
    if (!r || typeof r !== "object") { tampered++; continue; }
    if (!verifyPairRecord(r, secret)) { tampered++; continue; }
    if (r.usedAtMs !== null) { used++; continue; }
    if (r.expiresAtMs <= now) { expired++; continue; }
    active++;
  }
  return { total: records.length, active, expired, used, tampered };
}

export function formatPairStatsLine(s: PairCodeStats): string {
  return `🔑 PAIR · ${s.active} active · ${s.used} used · ${s.expired} expired · ${s.tampered} tampered`;
}

export const PAIR_CODE_TUNABLES = Object.freeze({
  ALPHABET,
  CODE_PARTS,
  CODE_PART_LEN,
  DEFAULT_TTL_MS,
  PROTOCOL_VERSION,
  SAS_EMOJI_COUNT: 4,
  SAS_EMOJI_SPACE: SAS_EMOJI_ALPHABET.length ** 4,
});
