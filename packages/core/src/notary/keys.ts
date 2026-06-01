/**
 * v2.79.0 — NOTARY · issuer key management (Ed25519).
 *
 * Mneme's FIRST asymmetric-crypto primitive. Every prior ledger uses HMAC
 * (symmetric) — fine for "did THIS machine tamper with its own log", useless
 * for "can a THIRD PARTY (vendor / court / insurer) verify this without
 * holding our secret". A notarized receipt is signed with an Ed25519 PRIVATE
 * key; anyone verifies it with the PUBLIC key alone — no Mneme, no network,
 * no shared secret.
 *
 * Key storage:
 *   .mneme/notary/issuer.key   — PKCS8 PEM private key (mode 0600)
 *   .mneme/notary/issuer.pub   — base64(DER SPKI) public key + fingerprint
 *
 * Node's crypto ships Ed25519 natively (node ≥ 16), so this is zero-dependency.
 */

import { generateKeyPairSync, createPrivateKey, createPublicKey, createHash, type KeyObject } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

export interface IssuerKeyPair {
  privateKey: KeyObject;
  publicKey: KeyObject;
  /** base64(DER SPKI) — embedded in every receipt as `issuer`. */
  publicKeyB64: string;
  /** sha256(DER SPKI) sliced to 16 hex — short, stable issuer id. */
  fingerprint: string;
}

/** base64(DER SPKI) of a public key. */
export function publicKeyToB64(publicKey: KeyObject): string {
  const der = publicKey.export({ type: "spki", format: "der" });
  return Buffer.from(der).toString("base64");
}

/** Reconstruct a public KeyObject from base64(DER SPKI). Throws on garbage. */
export function publicKeyFromB64(b64: string): KeyObject {
  const der = Buffer.from(b64, "base64");
  return createPublicKey({ key: der, format: "der", type: "spki" });
}

/** Stable 16-hex issuer fingerprint from the base64 public key. */
export function fingerprintOf(publicKeyB64: string): string {
  return createHash("sha256").update(publicKeyB64, "utf8").digest("hex").slice(0, 16);
}

function notaryDir(repoRoot: string): string {
  // Guard: a null/empty repoRoot (extreme garbage from a "total" caller) must
  // never throw inside join() — default to cwd. Fixes the "issueReceipt
  // throws on null repoRoot" class for every caller at once (v2.73 principle:
  // push the fix down into the shared core both layers call).
  const root = typeof repoRoot === "string" && repoRoot.length > 0 ? repoRoot : ".";
  return join(root, ".mneme", "notary");
}

/**
 * v2.132.0 — in-process keypair cache, keyed by the on-disk key path (which
 * encodes repoRoot). THE READ-ONLY-FS FIX: when the filesystem can't be written
 * (a read-only mount, a sandbox, a CI cache layer), the persist step below
 * silently fails — and pre-v2.132 EVERY call then generated a FRESH ephemeral
 * key, so two receipts signed in the same process had DIFFERENT issuers and
 * couldn't cross-verify (a notarized chain would break with no error). Memoizing
 * makes the issuer key CONSISTENT for the whole process even when it can't be
 * persisted — receipts still verify against each other; the only lost property
 * is cross-process stability, which a read-only fs cannot provide anyway.
 */
const KEY_CACHE = new Map<string, IssuerKeyPair>();

/** Clear the in-process key cache (tests only). */
export function _resetIssuerKeyCache(): void { KEY_CACHE.clear(); }

/**
 * Load the repo's issuer keypair, generating + persisting one on first use.
 * Idempotent: the same repo always returns the same key (cached in-process, and
 * persisted to disk when writable). Private key is written with mode 0600.
 */
export function getIssuerKeyPair(repoRoot: string): IssuerKeyPair {
  const dir = notaryDir(repoRoot);
  const privPath = join(dir, "issuer.key");

  // 1. in-process cache — guarantees a consistent issuer key per process even on
  //    a read-only filesystem (see header). Keyed by privPath, so distinct repos
  //    still get distinct keys.
  const cached = KEY_CACHE.get(privPath);
  if (cached) return cached;

  // 2. load a persisted key if present.
  if (existsSync(privPath)) {
    try {
      const pem = readFileSync(privPath, "utf8");
      const privateKey = createPrivateKey(pem);
      const publicKey = createPublicKey(privateKey);
      const publicKeyB64 = publicKeyToB64(publicKey);
      const kp: IssuerKeyPair = { privateKey, publicKey, publicKeyB64, fingerprint: fingerprintOf(publicKeyB64) };
      KEY_CACHE.set(privPath, kp);
      return kp;
    } catch {
      // Corrupt key file — fall through and regenerate (never throw).
    }
  }

  // 3. generate, best-effort persist, and ALWAYS cache so the process is stable.
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyB64 = publicKeyToB64(publicKey);
  try {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }) as string;
    writeFileSync(privPath, pem, { encoding: "utf8", mode: 0o600 });
    writeFileSync(join(dir, "issuer.pub"), JSON.stringify({
      v: 1, alg: "ed25519", publicKeyB64, fingerprint: fingerprintOf(publicKeyB64),
    }, null, 2), { encoding: "utf8", mode: 0o644 });
  } catch {
    // Persist best-effort; the in-process cache below keeps the ephemeral key
    // consistent for the whole run (the read-only-fs degradation path).
  }
  const kp: IssuerKeyPair = { privateKey, publicKey, publicKeyB64, fingerprint: fingerprintOf(publicKeyB64) };
  KEY_CACHE.set(privPath, kp);
  return kp;
}
