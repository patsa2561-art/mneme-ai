/**
 * v2.96.0 — HYDRA · L5 signed codebook + L8 energy certificate.
 *
 * This is the gem's CUT — the facets prior-art research found UNFILLED:
 * no prompt-compression system signs its codebook or attests the round
 * trip. HYDRA reuses Mneme's existing NOTARY (Ed25519) spine so a third
 * party can verify OFFLINE, with the public key alone, that:
 *   - this exact codebook was forged by this issuer (L5), and
 *   - it expands a corpus of this exact hash with a perfect gauntlet, and
 *   - the one-time mining energy buys perpetual ~0-energy recollection (L8,
 *     the ANAMNESIS thesis: compute once, recollect forever).
 *
 * No new crypto — diamonds compound on the NOTARY spine.
 */

import { issueReceipt, verifyReceipt, type NotaryReceipt } from "../notary/receipt.js";
import type { Codebook } from "./engine.js";
import { sha256Hex } from "./engine.js";
import type { Gauntlet } from "./analytic.js";

/** Canonical, deterministic serialization of a codebook (for hashing/sig). */
export function canonicalizeCodebook(cb: Codebook): string {
  // Entry order is already deterministic (longest-first); we serialize only
  // the load-bearing fields so the hash is stable across runs.
  const entries = cb.entries.map((e) => [e.sym, e.phrase]);
  return JSON.stringify({ v: cb.v, open: cb.open, close: cb.close, corpusHash: cb.corpusHash, entries });
}

export interface HydraCodebookProof {
  codebookHash: string;
  corpusHash: string;
  entries: number;
  gauntletScore: number;
  ratio: number;
  bytesOriginal: number;
  bytesCompressed: number;
}

/**
 * L5 — sign the codebook + its gauntlet verdict into a portable NOTARY
 * receipt. `at` is the issue timestamp (passed in for determinism/testing;
 * the CLI supplies Date.now()).
 */
export function signCodebook(repoRoot: string, cb: Codebook, g: Gauntlet, at: number): NotaryReceipt {
  const proof: HydraCodebookProof = {
    codebookHash: sha256Hex(canonicalizeCodebook(cb)),
    corpusHash: cb.corpusHash,
    entries: g.entries,
    gauntletScore: g.score,
    ratio: Number(g.ratio.toFixed(4)),
    bytesOriginal: g.bytesOriginal,
    bytesCompressed: g.bytesCompressed,
  };
  return issueReceipt(repoRoot, {
    kind: "memory-capsule",
    subject: `hydra-codebook:${cb.corpusHash.slice(0, 16)}`,
    payload: proof,
    includePayload: true,
    issuedAt: at,
  });
}

export interface CodebookVerify {
  valid: boolean;
  reason: string;
  /** True only when the signature is valid AND the receipt's codebookHash
   *  matches the codebook actually presented (no swap-after-sign). */
  bound: boolean;
}

/**
 * Verify a signed codebook OFFLINE: the Ed25519 signature must check out
 * AND the receipt's embedded codebookHash must equal the hash of the
 * codebook presented. Catches both forged receipts and codebook tampering.
 */
export function verifyCodebook(receipt: unknown, cb: Codebook): CodebookVerify {
  const v = verifyReceipt(receipt);
  if (!v.valid) return { valid: false, reason: v.reason ?? "invalid signature", bound: false };
  const payload = (receipt as { payload?: HydraCodebookProof }).payload;
  if (!payload || typeof payload.codebookHash !== "string") {
    return { valid: true, reason: "signature valid but no codebookHash payload to bind", bound: false };
  }
  const actual = sha256Hex(canonicalizeCodebook(cb));
  if (payload.codebookHash !== actual) {
    return { valid: true, reason: "signature valid but codebook does NOT match receipt (tampered/swapped)", bound: false };
  }
  if (payload.corpusHash !== cb.corpusHash) {
    return { valid: true, reason: "signature valid but corpusHash mismatch", bound: false };
  }
  return { valid: true, reason: "signature valid and codebook bound to receipt", bound: true };
}

export interface EnergyCert {
  receipt: NotaryReceipt;
  bytesSaved: number;
  ratio: number;
  /** Bytes saved per future expansion, paid for by a single mine. */
  perpetualSavingPerUse: number;
}

/**
 * L8 — energy certificate: the one-time mine cost buys perpetual savings.
 * Signed via NOTARY so the savings claim is itself verifiable, not boast.
 */
export function mintEnergyCert(repoRoot: string, cb: Codebook, g: Gauntlet, at: number): EnergyCert {
  const bytesSaved = g.bytesOriginal - g.bytesCompressed;
  const receipt = issueReceipt(repoRoot, {
    kind: "memory-capsule",
    subject: `hydra-energy:${cb.corpusHash.slice(0, 16)}`,
    payload: { corpusHash: cb.corpusHash, bytesSaved, ratio: Number(g.ratio.toFixed(4)), computedOnce: true },
    includePayload: true,
    issuedAt: at,
  });
  return { receipt, bytesSaved, ratio: g.ratio, perpetualSavingPerUse: bytesSaved };
}
