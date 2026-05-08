/**
 * Ed25519 signatures for QSAC certificates.
 *
 * v0.47 shipped HMAC-SHA-256 chain signing — symmetric, fine for
 * single-org compliance trails. Ed25519 is asymmetric: the signing key
 * never leaves the audit issuer, and any party with the public key can
 * verify the chain WITHOUT the secret. That's the EU-AI-Act-compatible
 * shape:
 *
 *   - Org private key signs every cert
 *   - Auditor / regulator / vendor uses the public key to verify
 *   - Compromise of a verifier's machine doesn't compromise signing
 *
 * Implementation
 *   Native node:crypto Ed25519 — Node 12.4+ ships it; no extra deps.
 *   `generateKeyPairSync("ed25519")` for keygen; `sign()` / `verify()`
 *   with `null` algorithm (Ed25519 picks SHA-512 internally).
 *
 * Key format
 *   We export keys as PEM (the canonical OpenSSL-compatible form) so
 *   the public key can be shared via static config / GitHub secret /
 *   HSM export. Private keys exported encrypted-at-rest only on
 *   explicit caller request.
 */

import { generateKeyPairSync, sign, verify, createPrivateKey, createPublicKey, type KeyObject } from "node:crypto";

export interface Ed25519KeyPair {
  /** PEM-encoded private key. Never log this. */
  privateKeyPem: string;
  /** PEM-encoded public key. Safe to commit / publish. */
  publicKeyPem: string;
}

/**
 * Generate a fresh Ed25519 keypair. One-time call per org.
 *
 * Recommended workflow:
 *   1. `mneme audit gen-keypair` (CLI thin wrapper, v1.1 ships)
 *   2. Store `privateKeyPem` in a secret manager (Vault / SSM / etc.)
 *   3. Commit `publicKeyPem` to the repo at `.mneme/audit-pubkey.pem`
 *   4. Auditors use the public key to verify the chain offline
 */
export function generateEd25519KeyPair(): Ed25519KeyPair {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  return {
    privateKeyPem: privateKey.export({ format: "pem", type: "pkcs8" }).toString(),
    publicKeyPem: publicKey.export({ format: "pem", type: "spki" }).toString(),
  };
}

/**
 * Sign a payload (string or Buffer) with an Ed25519 private key.
 * Returns the signature as a 128-char hex string (64 bytes raw).
 */
export function signEd25519(payload: string | Buffer, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("Provided key is not Ed25519");
  }
  const data = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  // Ed25519 expects a null algorithm parameter — it picks SHA-512 internally
  const sig = sign(null, data, key);
  return sig.toString("hex");
}

/**
 * Verify an Ed25519 signature. Returns true on valid, false on
 * mismatch. Errors during key parsing throw (caller should treat any
 * thrown error as "invalid").
 */
export function verifyEd25519(
  payload: string | Buffer,
  signatureHex: string,
  publicKeyPem: string,
): boolean {
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== "ed25519") {
    throw new Error("Provided key is not Ed25519");
  }
  const data = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  let sig: Buffer;
  try {
    sig = Buffer.from(signatureHex, "hex");
  } catch {
    return false;
  }
  if (sig.length !== 64) return false;
  try {
    return verify(null, data, key, sig);
  } catch {
    return false;
  }
}

/**
 * Convenience: sign a JSON-serialisable object after canonicalising it.
 * Uses the same canonicalise() function the merkle-chain uses, so
 * signatures bind to the EXACT data the chain hash binds to.
 */
export async function signObjectEd25519(obj: unknown, privateKeyPem: string): Promise<string> {
  const { canonicalise } = await import("./merkle-chain.js");
  return signEd25519(canonicalise(obj), privateKeyPem);
}

export async function verifyObjectEd25519(
  obj: unknown,
  signatureHex: string,
  publicKeyPem: string,
): Promise<boolean> {
  const { canonicalise } = await import("./merkle-chain.js");
  return verifyEd25519(canonicalise(obj), signatureHex, publicKeyPem);
}

/** Strip PEM newlines for compact storage (e.g. JSON). Reverses with `restorePem`. */
export function compactPem(pem: string): string {
  return pem.replace(/\s+/g, "");
}

/** Restore a compacted PEM to the standard 64-char-per-line form. */
export function restorePem(compact: string, kind: "PUBLIC KEY" | "PRIVATE KEY"): string {
  const header = `-----BEGIN ${kind}-----`;
  const footer = `-----END ${kind}-----`;
  let body = compact.replace(/-----[A-Z ]+-----/g, "");
  body = body.replace(/\s+/g, "");
  // re-fold to 64-char lines
  const lines: string[] = [];
  for (let i = 0; i < body.length; i += 64) lines.push(body.slice(i, i + 64));
  return [header, ...lines, footer, ""].join("\n");
}
