/**
 * v2.79.0 — NOTARY · portable, offline-verifiable proof-of-provenance.
 *
 * The TRUST FABRIC spine: Ed25519-signed receipts that any third party verifies
 * with the public key alone (no Mneme, no network, no shared secret). The shared
 * foundation for the BGP notarizing router, BYOB portable memory, and the AI
 * Flight Recorder.
 */
export {
  getIssuerKeyPair,
  publicKeyToB64,
  publicKeyFromB64,
  fingerprintOf,
  type IssuerKeyPair,
} from "./keys.js";

export {
  issueReceipt,
  verifyReceipt,
  verifyChain,
  notarizeProtocolReceipt,
  canonicalJson,
  type NotaryReceipt,
  type ReceiptKind,
  type IssueInput,
  type VerifyResult,
} from "./receipt.js";
