/**
 * Lineage identity — Ed25519 keypair that anchors a user's lineage across
 * machines. The PUBLIC key is the "account ID" — the user owns it; no
 * Mneme cloud, no vendor login. The PRIVATE key signs every chromosome
 * before it leaves the machine.
 *
 * Privacy model:
 *   - Private key lives at .mneme/lineage/identity/private.pem (mode 0600).
 *   - Private key is NEVER written to a chromosome file, NEVER pushed to
 *     spore, NEVER logged.
 *   - Public key is included in every chromosome's `signedBy` field so
 *     verification works without out-of-band key exchange.
 *
 * The keypair is generated lazily — first call to `loadOrCreateIdentity`
 * either reads the existing pair or creates a fresh one. Subsequent calls
 * are idempotent.
 */

import { generateKeyPairSync, createPrivateKey, createPublicKey, sign as cryptoSign, verify as cryptoVerify, createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { identityDir, identityPrivatePath, identityPublicPath } from "./paths.js";

export interface LineageIdentity {
  /** PEM-encoded Ed25519 public key (multiline). */
  publicPem: string;
  /** Stable 16-char fingerprint of the public key — used as account ID
   *  in human-facing output ("you are signed in as `f3a8b2...`"). */
  fingerprint: string;
}

interface FullIdentity extends LineageIdentity {
  /** PEM-encoded Ed25519 private key. NEVER serialize this. */
  privatePem: string;
}

function fingerprintOf(publicPem: string): string {
  // Hash the canonical key (strip headers/whitespace) for stability.
  const compact = publicPem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  return createHash("sha256").update(compact).digest("hex").slice(0, 16);
}

/** Load existing identity or create a fresh Ed25519 keypair. Idempotent. */
export function loadOrCreateIdentity(repoRoot: string): LineageIdentity {
  const dir = identityDir(repoRoot);
  const privPath = identityPrivatePath(repoRoot);
  const pubPath = identityPublicPath(repoRoot);

  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  if (existsSync(privPath) && existsSync(pubPath)) {
    const publicPem = readFileSync(pubPath, "utf8");
    return { publicPem, fingerprint: fingerprintOf(publicPem) };
  }

  // Generate fresh.
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicPem = publicKey.export({ format: "pem", type: "spki" }).toString();
  const privatePem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
  writeFileSync(pubPath, publicPem, "utf8");
  writeFileSync(privPath, privatePem, "utf8");
  // Restrict private key permissions on POSIX (no-op on Windows but harmless).
  try { chmodSync(privPath, 0o600); } catch { /* Windows */ }
  return { publicPem, fingerprint: fingerprintOf(publicPem) };
}

/** Internal: load full keypair (private included). Used only by sign(). */
function loadFullIdentity(repoRoot: string): FullIdentity {
  const pub = loadOrCreateIdentity(repoRoot);
  const privatePem = readFileSync(identityPrivatePath(repoRoot), "utf8");
  return { ...pub, privatePem };
}

/** Sign a payload (hex-encoded, 64-byte Ed25519 signature). */
export function signPayload(repoRoot: string, payload: string | Buffer): string {
  const { privatePem } = loadFullIdentity(repoRoot);
  const key = createPrivateKey(privatePem);
  const buf = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
  return cryptoSign(null, buf, key).toString("hex");
}

/** Verify a signature against a known public key (PEM). */
export function verifyPayload(publicPem: string, payload: string | Buffer, signatureHex: string): boolean {
  try {
    const key = createPublicKey(publicPem);
    const buf = typeof payload === "string" ? Buffer.from(payload, "utf8") : payload;
    const sig = Buffer.from(signatureHex, "hex");
    return cryptoVerify(null, buf, key, sig);
  } catch {
    return false;
  }
}

/** Reset (only for tests) — wipe identity files so next load regenerates. */
export function _resetIdentityForTests(repoRoot: string): void {
  try { rmSync(identityDir(repoRoot), { recursive: true, force: true }); } catch { /* ignore */ }
}
