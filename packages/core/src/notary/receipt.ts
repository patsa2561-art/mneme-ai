/**
 * v2.79.0 — NOTARY · the portable proof-of-provenance receipt.
 *
 * A self-contained, Ed25519-signed artifact that ANYONE verifies OFFLINE with
 * only the embedded public key — no Mneme instance, no network, no shared
 * secret. The shared spine of the v2.79+ TRUST FABRIC: a claim verdict, a
 * cross-protocol hop, a memory capsule, or a reasoning trace can each carry one,
 * and they chain (prev → receiptId) into a tamper-evident, attributable history.
 *
 * Relationship to `mneme_receipt_protocol`: that module defines the open,
 * HASH-addressed receipt shape (anyone can mint one — it only proves internal
 * consistency). NOTARY adds the SIGNATURE: proof of WHO issued it + that it is
 * unforgeable. `notarize()` wraps any payload (incl. a ProtocolReceipt).
 *
 * Pure + deterministic except for issue() (signs) which needs a private key.
 * verify() is pure and offline. Malformed input never throws — structured fail.
 */

import { sign as edSign, verify as edVerify, createHash } from "node:crypto";
import { getIssuerKeyPair, publicKeyFromB64, fingerprintOf, type IssuerKeyPair } from "./keys.js";

export type ReceiptKind =
  | "claim-verdict"      // Mneme verified a factual claim → verdict
  | "protocol-hop"       // a cross-protocol hop (MCP↔A2A↔x402↔ERC-8004) — for the BGP router
  | "memory-capsule"     // a portable brain capsule digest — for BYOB
  | "reasoning-trace"    // an HMAC/reasoning trace digest — for the Flight Recorder
  | "generic";

export interface NotaryReceipt {
  v: 1;
  alg: "ed25519";
  kind: ReceiptKind;
  /** What is attested — caller-defined opaque string (an id, a hash, a URL). */
  subject: string;
  /** sha256 of the canonical payload. Always present, even when payload omitted. */
  payloadHash: string;
  /** Optional inline payload. Omit for privacy (hash-only attestation). */
  payload?: unknown;
  /** base64(DER SPKI) Ed25519 public key of the issuer. Self-describing. */
  issuer: string;
  /** sha256(issuer)[:16] — short stable issuer id. */
  issuerFingerprint: string;
  /** ms since Unix epoch. */
  issuedAt: number;
  /** Previous receipt's receiptId for chaining, or null/absent for a root. */
  prev?: string | null;
  /** sha256 over the canonical body (every field except sig + receiptId). */
  receiptId: string;
  /** base64 Ed25519 signature over the receiptId bytes. */
  sig: string;
}

export interface IssueInput {
  kind?: ReceiptKind;
  subject: string;
  /** Payload to attest. Hashed into payloadHash; included inline unless includePayload=false. */
  payload?: unknown;
  /** Default true. Set false to emit a privacy-preserving hash-only receipt. */
  includePayload?: boolean;
  /** Previous receipt's receiptId to chain onto. */
  prev?: string | null;
  /** Override issue time (tests / determinism). */
  issuedAt?: number;
}

export interface VerifyResult {
  valid: boolean;
  reason: string;
  issuerFingerprint?: string;
  kind?: ReceiptKind;
  subject?: string;
}

// ── canonical JSON (sorted keys, recursive, drops undefined) ────────────
export function canonicalJson(v: unknown): string {
  if (v === undefined) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v) ?? "null";
  if (Array.isArray(v)) return "[" + v.map(canonicalJson).join(",") + "]";
  const obj = v as Record<string, unknown>;
  const keys = Object.keys(obj).filter((k) => obj[k] !== undefined).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

/** The signed body — everything that the receiptId commits to. */
function receiptBody(r: Omit<NotaryReceipt, "receiptId" | "sig">): string {
  return canonicalJson({
    v: r.v, alg: r.alg, kind: r.kind, subject: r.subject,
    payloadHash: r.payloadHash, issuer: r.issuer, issuerFingerprint: r.issuerFingerprint,
    issuedAt: r.issuedAt, prev: r.prev ?? null,
  });
}

/**
 * Issue a signed receipt. Uses the repo's issuer key (loaded/generated once),
 * or an explicitly supplied keypair (tests / cross-issuer scenarios).
 */
export function issueReceipt(repoRoot: string, input: IssueInput, keyPair?: IssuerKeyPair): NotaryReceipt {
  const kp = keyPair ?? getIssuerKeyPair(repoRoot);
  const includePayload = input.includePayload !== false;
  const payloadHash = sha256Hex(canonicalJson(input.payload ?? null));
  const base: Omit<NotaryReceipt, "receiptId" | "sig"> = {
    v: 1,
    alg: "ed25519",
    kind: input.kind ?? "generic",
    subject: String(input.subject),
    payloadHash,
    ...(includePayload && input.payload !== undefined ? { payload: input.payload } : {}),
    issuer: kp.publicKeyB64,
    issuerFingerprint: kp.fingerprint,
    issuedAt: typeof input.issuedAt === "number" ? input.issuedAt : Date.now(),
    prev: input.prev ?? null,
  };
  const receiptId = sha256Hex(receiptBody(base));
  const sig = edSign(null, Buffer.from(receiptId, "hex"), kp.privateKey).toString("base64");
  return { ...base, receiptId, sig };
}

/**
 * Verify a receipt OFFLINE using only the embedded public key. Checks:
 *   1. structural shape
 *   2. receiptId matches the recomputed canonical body
 *   3. payloadHash matches the inline payload (when present)
 *   4. the Ed25519 signature is valid for the embedded issuer key
 * Optionally also asserts the issuer is one you trust (expectedIssuerFingerprint
 * or expectedIssuer base64). Never throws.
 */
export function verifyReceipt(
  receipt: unknown,
  opts: { expectedIssuerFingerprint?: string; expectedIssuer?: string } = {},
): VerifyResult {
  if (receipt === null || typeof receipt !== "object" || Array.isArray(receipt)) {
    return { valid: false, reason: "receipt must be a non-null object" };
  }
  const r = receipt as Record<string, unknown>;
  if (r.v !== 1) return { valid: false, reason: "unsupported version" };
  if (r.alg !== "ed25519") return { valid: false, reason: "unsupported alg" };
  for (const f of ["kind", "subject", "payloadHash", "issuer", "issuerFingerprint", "receiptId", "sig"] as const) {
    if (typeof r[f] !== "string") return { valid: false, reason: `missing/invalid field: ${f}` };
  }
  if (typeof r.issuedAt !== "number" || !Number.isFinite(r.issuedAt)) {
    return { valid: false, reason: "missing/invalid field: issuedAt" };
  }
  // issuerFingerprint must match the embedded public key (no fingerprint spoofing).
  if (fingerprintOf(r.issuer as string) !== r.issuerFingerprint) {
    return { valid: false, reason: "issuerFingerprint does not match issuer key" };
  }
  // payloadHash must match an inline payload when present.
  if ("payload" in r) {
    const recomputed = sha256Hex(canonicalJson(r.payload));
    if (recomputed !== r.payloadHash) return { valid: false, reason: "payloadHash does not match inline payload" };
  }
  // receiptId must match the canonical body.
  const recomputedId = sha256Hex(receiptBody({
    v: 1, alg: "ed25519",
    kind: r.kind as ReceiptKind, subject: r.subject as string,
    payloadHash: r.payloadHash as string, issuer: r.issuer as string,
    issuerFingerprint: r.issuerFingerprint as string, issuedAt: r.issuedAt as number,
    prev: (r.prev ?? null) as string | null,
  }));
  if (recomputedId !== r.receiptId) return { valid: false, reason: "receiptId does not match canonical body" };
  // Signature.
  let sigOk = false;
  try {
    const pub = publicKeyFromB64(r.issuer as string);
    sigOk = edVerify(null, Buffer.from(r.receiptId as string, "hex"), pub, Buffer.from(r.sig as string, "base64"));
  } catch {
    return { valid: false, reason: "issuer key or signature is malformed" };
  }
  if (!sigOk) return { valid: false, reason: "signature does not verify against issuer key" };
  // Optional trust assertion.
  if (opts.expectedIssuer && opts.expectedIssuer !== r.issuer) {
    return { valid: false, reason: "issuer is not the expected key", issuerFingerprint: r.issuerFingerprint as string };
  }
  if (opts.expectedIssuerFingerprint && opts.expectedIssuerFingerprint !== r.issuerFingerprint) {
    return { valid: false, reason: "issuer fingerprint is not the expected one", issuerFingerprint: r.issuerFingerprint as string };
  }
  return {
    valid: true, reason: "ok",
    issuerFingerprint: r.issuerFingerprint as string,
    kind: r.kind as ReceiptKind, subject: r.subject as string,
  };
}

/**
 * Verify a chain of receipts: every receipt valid + each `prev` equals the
 * previous receipt's receiptId + (optionally) all from the same issuer.
 */
export function verifyChain(
  receipts: NotaryReceipt[],
  opts: { sameIssuer?: boolean } = {},
): { valid: boolean; reason: string; brokenAt?: number } {
  if (!Array.isArray(receipts) || receipts.length === 0) return { valid: false, reason: "empty chain" };
  let prevId: string | null = null;
  let firstIssuer: string | undefined;
  for (let i = 0; i < receipts.length; i++) {
    const v = verifyReceipt(receipts[i]);
    if (!v.valid) return { valid: false, reason: `receipt ${i}: ${v.reason}`, brokenAt: i };
    const r = receipts[i]!;
    if ((r.prev ?? null) !== prevId) return { valid: false, reason: `chain break at ${i}: prev mismatch`, brokenAt: i };
    if (opts.sameIssuer) {
      if (firstIssuer === undefined) firstIssuer = r.issuer;
      else if (firstIssuer !== r.issuer) return { valid: false, reason: `chain break at ${i}: issuer changed`, brokenAt: i };
    }
    prevId = r.receiptId;
  }
  return { valid: true, reason: "ok" };
}

/** Bridge: wrap an existing mneme-receipt-protocol ProtocolReceipt (hash-only)
 *  in a signed, attributable NOTARY receipt. Old spec + new signature. */
export function notarizeProtocolReceipt(
  repoRoot: string,
  protocolReceipt: { contentHash?: string } & Record<string, unknown>,
  keyPair?: IssuerKeyPair,
): NotaryReceipt {
  return issueReceipt(repoRoot, {
    kind: "generic",
    subject: typeof protocolReceipt.contentHash === "string" ? protocolReceipt.contentHash : "protocol-receipt",
    payload: protocolReceipt,
  }, keyPair);
}
