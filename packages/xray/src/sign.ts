/**
 * Seal an X-Ray report with an Ed25519 NOTARY receipt so any third party can
 * verify OFFLINE (with the embedded public key) that the report is genuine and
 * untampered — no Mneme instance, no network, no shared secret. This is the
 * "every number is signed, no AI guessed it" guarantee.
 */
import { notary } from "@mneme-ai/core";
import { createHash } from "node:crypto";
import type { XRayReport, SignedXRay } from "./types.js";

export function sealXRay(repoRoot: string, report: XRayReport, issuedAt?: number): SignedXRay {
  const receipt = notary.issueReceipt(repoRoot, {
    kind: "claim-verdict",
    subject: `xray:${report.subject.repoName}@${report.subject.commitHash.slice(0, 12)}`,
    payload: report,
    includePayload: true,
    issuedAt,
  });
  return { report, receipt };
}

export interface XRayVerifyResult {
  valid: boolean;
  reason: string;
  /** Signature algorithm (Ed25519 — asymmetric, offline-verifiable). */
  algorithm: string;
  /** sha256 fingerprint of the issuer's public key (who signed it). */
  issuerFingerprint: string;
  /** The sha256 the engine signed over the canonical metric blocks. */
  signedHash: string;
  /** The sha256 recomputed NOW from the report you are reading. */
  recomputedHash: string;
  /** True iff signedHash === recomputedHash — i.e. not one number was edited. */
  hashesMatch: boolean;
  /** When the report was sealed (ms epoch), when present. */
  signedAt: number | null;
}

export function verifyXRay(signed: SignedXRay): XRayVerifyResult {
  const rec = (signed.receipt || {}) as {
    payloadHash?: string; alg?: string; issuerFingerprint?: string; issuedAt?: number;
  };
  const recomputedHash = createHash("sha256").update(notary.canonicalJson(signed.report)).digest("hex");
  const base = {
    algorithm: (rec.alg || "ed25519").toUpperCase(),
    issuerFingerprint: rec.issuerFingerprint || "",
    signedHash: rec.payloadHash || "",
    recomputedHash,
    hashesMatch: !!rec.payloadHash && rec.payloadHash === recomputedHash,
    signedAt: typeof rec.issuedAt === "number" ? rec.issuedAt : null,
  };
  const r = notary.verifyReceipt(signed.receipt);
  if (!r.valid) return { valid: false, reason: r.reason, ...base };
  // BIND the outer report to the signature: verifyReceipt only checks the
  // receipt's own inline payload, so we must confirm signed.report hashes to
  // the receipt's payloadHash — otherwise a tampered outer report would pass.
  if (!base.hashesMatch) {
    return { valid: false, reason: "report does not match the signed payloadHash (tampered)", ...base };
  }
  return { valid: true, reason: r.reason, ...base };
}
