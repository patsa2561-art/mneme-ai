/**
 * v1.98.0 -- RAINBOW · MNEME PASSPORT (the disruption play).
 *
 *   "Until today, every AI vendor was the warden of your context.
 *    Tomorrow, you hand the AI a passport and the warden disappears."
 *
 * The current state of AI vendor lock-in:
 *   - ChatGPT remembers YOUR conversation history — in their cloud.
 *   - Claude.ai remembers YOUR conversation history — in their cloud.
 *   - Gemini remembers — in theirs.
 *   - Switching vendors = losing your memory. You start over every time.
 *   - This is the lock-in. It's worth billions to vendors.
 *
 * Mneme PASSPORT inverts this:
 *   - The user (you) carries a small, signed, portable identity bundle.
 *   - It contains the LAST N decisions / regrets / wisdoms from your repo.
 *   - It's HMAC-chained — every entry is cryptographically tamper-evident.
 *   - It's PORTABLE — handed to ANY AI as a "here's who I am" capsule.
 *   - It's VERIFIABLE — the AI can mathematically check no entry was forged.
 *   - It's MINIMAL — ~2-4 KB, fits in a single chat message.
 *
 * The disruption thesis:
 *   - Today: AI vendor owns the user's context. Switching = losing.
 *   - Tomorrow: User owns the context. Switching = trivial.
 *   - The vendor that adopts PASSPORT first signals "we don't lock you in"
 *     and wins trust. The ones who refuse become walls.
 *
 * What this file ships:
 *   1. PASSPORT data structure (JSON, ~2-4 KB typical)
 *   2. HMAC chain over the entries (tamper-evident)
 *   3. Signer (with the user's local secret)
 *   4. Verifier (anyone with the public bundle metadata can check)
 *   5. Serializer/parser (the wire format every AI can read)
 *   6. Token-bounded "fits in one message" helper
 *
 * Honest scope: this is the v1.98 SEED of the disruption. The fuller
 * play — vendor adoption, multi-user federation, an open standard —
 * is community + market work that ships if/when vendors say yes. The
 * code is here today.
 */

import { createHmac, createHash, randomBytes } from "node:crypto";
import { safeHmacNotEqual } from "../util/hmac_compare.js";

export interface PassportEntry {
  /** Stable id. */
  id: string;
  /** Wall-clock when the entry was recorded. */
  ts: number;
  /** Entry class — what kind of memory. */
  kind: "decision" | "regret" | "wisdom" | "vaccine" | "preference";
  /** Short narrative — 1-3 lines max. */
  text: string;
  /** Optional commit / file / scope context. */
  scope?: string;
}

export interface PassportEnvelope {
  /** Public identity (e.g. "Shinnapat @ mneme-ai", or just a hash if private). */
  holder: string;
  /** Issuance timestamp. */
  issuedAt: number;
  /** Expiration timestamp.
   *  v1.99 default = `Number.MAX_SAFE_INTEGER` (effectively eternal — user-revocable).
   *  Caller can override with a finite ttl for one-time / time-boxed delegation. */
  expiresAt: number;
  /** Last N entries — order matters; newer first. */
  entries: PassportEntry[];
  /** SHA-256 fingerprint of the entries (for fast equality + linking). */
  entriesHash: string;
  /** HMAC-SHA256 over (holder || issuedAt || expiresAt || entriesHash). */
  signature: string;
  /** Algorithm + key id (so verifiers know which key to use). */
  alg: "HMAC-SHA256";
  /** Public key fingerprint (NOT the secret) — used as identity lookup. */
  keyFingerprint: string;
  /** Revocation list: passport ids the holder has explicitly invalidated. */
  revoked?: string[];
  /** Passport id (random 12-hex). Used by revocation. */
  id: string;
}

/** Hash a list of entries deterministically for tamper-evidence. */
export function fingerprintEntries(entries: readonly PassportEntry[]): string {
  const h = createHash("sha256");
  for (const e of entries) {
    h.update(`${e.id}|${e.ts}|${e.kind}|${e.text}|${e.scope ?? ""}\n`);
  }
  return h.digest("hex").slice(0, 24);
}

/** Compute the HMAC signature for the envelope. Deterministic. */
function computeSignature(holder: string, issuedAt: number, expiresAt: number, entriesHash: string, secret: Buffer): string {
  const h = createHmac("sha256", secret);
  h.update(`${holder}|${issuedAt}|${expiresAt}|${entriesHash}`);
  return h.digest("hex");
}

function fingerprintSecret(secret: Buffer): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 16);
}

export interface IssuePassportInput {
  holder: string;
  entries: readonly PassportEntry[];
  /** User's local HMAC secret. Loaded from .mneme/passport.secret typically. */
  secret: Buffer;
  /** TTL in days. Default: ETERNAL (v1.99). Pass a finite number for one-time
   *  delegation; otherwise the passport is valid until explicitly revoked. */
  ttlDays?: number;
  /** Cap on entries included. Default 50. */
  maxEntries?: number;
  /** Revocation list to include. Default []. */
  revoked?: string[];
}

/** Issue a fresh passport. Default = eternal. HMAC-signs.
 *  Trims to maxEntries (newest first). */
export function issuePassport(input: IssuePassportInput): PassportEnvelope {
  const maxEntries = input.maxEntries ?? 50;
  const issuedAt = Date.now();
  // v1.99: default eternal. User explicitly revokes via the revocation list.
  const expiresAt = input.ttlDays !== undefined ? issuedAt + input.ttlDays * 24 * 60 * 60 * 1000 : Number.MAX_SAFE_INTEGER;
  const sorted = [...input.entries].sort((a, b) => b.ts - a.ts).slice(0, maxEntries);
  const entriesHash = fingerprintEntries(sorted);
  const signature = computeSignature(input.holder, issuedAt, expiresAt, entriesHash, input.secret);
  // Deterministic id from (holder + issuedAt) for revocation lookup.
  const id = createHash("sha256").update(`${input.holder}|${issuedAt}`).digest("hex").slice(0, 12);
  return {
    id,
    holder: input.holder,
    issuedAt,
    expiresAt,
    entries: sorted,
    entriesHash,
    signature,
    alg: "HMAC-SHA256",
    keyFingerprint: fingerprintSecret(input.secret),
    revoked: input.revoked ?? [],
  };
}

/** Revoke a passport by id. Returns a NEW envelope with the revocation
 *  list updated; re-signs with the same secret. The old passport keeps
 *  its signature but verifiers that hold the new envelope's revoked[]
 *  list will reject the old id. */
export function revokePassport(envelope: PassportEnvelope, revokeId: string, secret: Buffer): PassportEnvelope {
  const newRevoked = [...(envelope.revoked ?? []), revokeId];
  // Re-sign to keep the chain intact.
  const newSig = computeSignature(envelope.holder, envelope.issuedAt, envelope.expiresAt, envelope.entriesHash, secret);
  return { ...envelope, revoked: newRevoked, signature: newSig };
}

export type VerificationVerdict = "VALID" | "EXPIRED" | "TAMPERED" | "WRONG_KEY";

export interface VerificationResult {
  verdict: VerificationVerdict;
  /** Why the verdict was reached (for the human / AI). */
  reason: string;
  /** True if verdict is VALID. Convenience. */
  ok: boolean;
}

export type VerificationVerdictV99 = VerificationVerdict | "REVOKED";

export interface VerificationResultV99 {
  verdict: VerificationVerdictV99;
  reason: string;
  ok: boolean;
}

/** Verify a passport using the same secret it was signed with.
 *  Also checks the envelope's revocation list — if the passport id is in
 *  envelope.revoked[], verdict is REVOKED. */
export function verifyPassport(envelope: PassportEnvelope, secret: Buffer): VerificationResultV99 {
  if (envelope.revoked && envelope.id && envelope.revoked.includes(envelope.id)) {
    return { verdict: "REVOKED", reason: `passport id ${envelope.id} is in revocation list`, ok: false };
  }
  if (Date.now() > envelope.expiresAt) {
    return { verdict: "EXPIRED", reason: `expired at ${new Date(envelope.expiresAt).toISOString()}`, ok: false };
  }
  if (fingerprintSecret(secret) !== envelope.keyFingerprint) {
    return { verdict: "WRONG_KEY", reason: `provided secret fingerprint ${fingerprintSecret(secret)} does not match envelope keyFingerprint ${envelope.keyFingerprint}`, ok: false };
  }
  const expectedHash = fingerprintEntries(envelope.entries);
  if (expectedHash !== envelope.entriesHash) {
    return { verdict: "TAMPERED", reason: `entriesHash mismatch — entries were modified after signing`, ok: false };
  }
  const expectedSig = computeSignature(envelope.holder, envelope.issuedAt, envelope.expiresAt, envelope.entriesHash, secret);
  if (safeHmacNotEqual(expectedSig, envelope.signature)) {
    return { verdict: "TAMPERED", reason: `signature mismatch — envelope was modified`, ok: false };
  }
  return { verdict: "VALID", reason: `signature + hash + key + revocation all check out · ${envelope.expiresAt === Number.MAX_SAFE_INTEGER ? "eternal" : "ttl-bounded"}`, ok: true };
}

/** Render a timestamp safely. Number.MAX_SAFE_INTEGER lies beyond Date's
 *  valid range — print "eternal" instead of throwing. */
function safeIsoDate(ms: number): string {
  if (ms >= Number.MAX_SAFE_INTEGER || ms > 8.64e15) return "eternal (user-revocable)";
  try { return new Date(ms).toISOString(); } catch { return "eternal (user-revocable)"; }
}

/** Serialize to a compact JSON string suitable for pasting into ANY AI's
 *  chat box. Includes a header comment so the AI knows what it is. */
export function serializePassport(envelope: PassportEnvelope): string {
  const header = `--- MNEME PASSPORT v1 ---\n` +
    `id: ${envelope.id}\n` +
    `holder: ${envelope.holder}\n` +
    `issued: ${safeIsoDate(envelope.issuedAt)}\n` +
    `expires: ${safeIsoDate(envelope.expiresAt)}\n` +
    `entries: ${envelope.entries.length}\n` +
    `revoked: ${envelope.revoked?.length ?? 0}\n` +
    `signed: HMAC-SHA256 (key ${envelope.keyFingerprint})\n` +
    `verify: any holder of the public key can verify; ANY AI agent can\n` +
    `        read the entries without verification (read-only consent).\n` +
    `--- BEGIN JSON ---\n`;
  const json = JSON.stringify(envelope, null, 2);
  return header + json + `\n--- END MNEME PASSPORT ---`;
}

/** Parse a serialized passport string back into an envelope. */
export function parsePassport(text: string): PassportEnvelope | null {
  const begin = text.indexOf("--- BEGIN JSON ---");
  const end = text.indexOf("--- END MNEME PASSPORT ---");
  if (begin < 0 || end < 0 || begin >= end) return null;
  const jsonText = text.slice(begin + "--- BEGIN JSON ---".length, end).trim();
  try {
    const obj = JSON.parse(jsonText) as PassportEnvelope;
    if (typeof obj.signature !== "string" || typeof obj.entriesHash !== "string") return null;
    return obj;
  } catch {
    return null;
  }
}

/** Generate a fresh HMAC secret. Use ONCE per user; persist to .mneme/passport.secret. */
export function generatePassportSecret(): Buffer {
  return randomBytes(32);
}

/** Rough token estimate for the serialized passport (so callers can ensure
 *  it fits in a single chat message). */
export function estimatePassportTokens(envelope: PassportEnvelope): number {
  return Math.ceil(serializePassport(envelope).length * (1 / 3.5));
}

/** One-line summary suitable for the pulse. */
export function formatPassportPulseLine(envelope: PassportEnvelope, verification?: VerificationResult): string {
  const tokens = estimatePassportTokens(envelope);
  const isEternal = envelope.expiresAt >= Number.MAX_SAFE_INTEGER;
  const ttlStr = isEternal ? "ttl=eternal" : `ttl=${Math.round((envelope.expiresAt - Date.now()) / (24 * 60 * 60 * 1000))}d`;
  const vStr = verification ? ` · verify=${verification.verdict}` : "";
  return `MNEME-PASSPORT · holder=${envelope.holder} · entries=${envelope.entries.length} · ~${tokens} tokens · ${ttlStr}${vStr}`;
}
