/**
 * Seal an X-Ray report with an Ed25519 NOTARY receipt so any third party can
 * verify OFFLINE (with the embedded public key) that the report is genuine and
 * untampered — no Mneme instance, no network, no shared secret. This is the
 * "every number is signed, no AI guessed it" guarantee.
 */
import { notary } from "@mneme-ai/core";
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

export function verifyXRay(signed: SignedXRay): { valid: boolean; reason: string } {
  const r = notary.verifyReceipt(signed.receipt);
  return { valid: r.valid, reason: r.reason };
}
