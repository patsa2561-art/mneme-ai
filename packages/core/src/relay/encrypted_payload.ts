/**
 * v1.85.0 -- RELAY: symmetric encryption using NEXUS code as key.
 *
 * Strangers fetching a paste URL get garbage. Only the user (who knows
 * the 6-char NEXUS code, shared out-of-band) can decrypt.
 *
 * Crypto: AES-256-GCM (auth-encrypt) with PBKDF2-SHA256 key derivation
 * from (NEXUS code + salt). Salt is embedded in the ciphertext header
 * so the destination only needs the code.
 *
 * NEXUS code is 6 chars over a 31-char alphabet -> ~30 bits of entropy.
 * This is intentionally LOW so the user can type it on a phone -- not
 * a password. PBKDF2 with 200k iterations adds compute cost so brute
 * force against a captured ciphertext requires real work. Combined
 * with the URL being short-lived (7-30 days on paste services), this
 * is appropriate threat-model security for AI conversation snippets.
 */

import { randomBytes, createCipheriv, createDecipheriv, pbkdf2Sync } from "node:crypto";

const KDF_ITERATIONS = 200_000;
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const ENVELOPE_PREFIX = "MNEME-NEXUS-ENC-1\n";

export interface EncryptedEnvelope {
  /** Base64url-encoded payload: prefix\nbase64url(salt|iv|tag|ciphertext) */
  text: string;
  algorithm: "aes-256-gcm";
  iterations: number;
}

function deriveKey(code: string, salt: Buffer): Buffer {
  return pbkdf2Sync(code, salt, KDF_ITERATIONS, 32, "sha256");
}

export function encryptWithCode(plaintext: string, nexusCode: string): EncryptedEnvelope {
  const salt = randomBytes(SALT_BYTES);
  const iv = randomBytes(IV_BYTES);
  const key = deriveKey(nexusCode, salt);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const combined = Buffer.concat([salt, iv, tag, ct]);
  return {
    text: ENVELOPE_PREFIX + combined.toString("base64url"),
    algorithm: "aes-256-gcm",
    iterations: KDF_ITERATIONS,
  };
}

export type DecryptResult =
  | { ok: true; plaintext: string }
  | { ok: false; reason: "not-envelope" | "malformed" | "wrong-code-or-tampered" };

export function decryptWithCode(envelope: string, nexusCode: string): DecryptResult {
  if (!envelope.startsWith(ENVELOPE_PREFIX)) {
    return { ok: false, reason: "not-envelope" };
  }
  try {
    const body = envelope.slice(ENVELOPE_PREFIX.length).trim();
    const combined = Buffer.from(body, "base64url");
    if (combined.length < SALT_BYTES + IV_BYTES + TAG_BYTES + 1) {
      return { ok: false, reason: "malformed" };
    }
    const salt = combined.subarray(0, SALT_BYTES);
    const iv = combined.subarray(SALT_BYTES, SALT_BYTES + IV_BYTES);
    const tag = combined.subarray(SALT_BYTES + IV_BYTES, SALT_BYTES + IV_BYTES + TAG_BYTES);
    const ct = combined.subarray(SALT_BYTES + IV_BYTES + TAG_BYTES);
    const key = deriveKey(nexusCode, salt);
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(tag);
    const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
    return { ok: true, plaintext: pt.toString("utf8") };
  } catch {
    return { ok: false, reason: "wrong-code-or-tampered" };
  }
}
