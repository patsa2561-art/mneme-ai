/**
 * v1.83.0 -- AURA: same-WiFi auto-discovery + owner-only pairing.
 *
 * User raised a real privacy concern (May 2026): on an office WiFi,
 * if Mneme bridge auto-broadcasts, anyone on the network could pull
 * the soul. Also -- user shouldn't type URLs manually.
 *
 * AURA solves both with a single "pairing payload": a compact base64
 * string that bundles (lanUrl + NEXUS code + expiry + owner fingerprint).
 * Source generates it once; destination receives it via QR scan or
 * NEXUS code lookup. The destination's AI uses it to fetch the soul
 * AUTOMATICALLY with NO manual entry.
 *
 * Owner-only guard: the payload carries the owner's local fingerprint.
 * Only devices that belong to the same owner (same identity keypair)
 * accept the payload. Random WiFi neighbours can't even parse it
 * meaningfully because the URL is opaque + the bridge requires the
 * code as an auth token.
 *
 * No cloud, no mDNS dependency, no broadcast. Privacy by default.
 */

import { createHmac, createHash } from "node:crypto";
import { safeHmacNotEqual } from "../util/hmac_compare.js";

export interface PairPayload {
  /** Format version. */
  v: 1;
  /** LAN URL of the source's HTTP bridge. */
  lanUrl: string;
  /** NEXUS code (acts as one-time auth token alongside bearer). */
  code: string;
  /** Expiry timestamp (ISO). */
  expiresAt: string;
  /** Owner fingerprint (sha256 of identity pubkey, 16 hex). */
  owner: string;
  /** HMAC over the entire payload using the owner secret. */
  sig: string;
}

export interface PairInput {
  lanUrl: string;
  code: string;
  expiresAt: string;
  ownerSecret: string;
  ownerPubKeyHash: string;
}

function canonical(p: Omit<PairPayload, "sig">): string {
  return JSON.stringify({ v: p.v, lanUrl: p.lanUrl, code: p.code, expiresAt: p.expiresAt, owner: p.owner });
}

function ownerFingerprint(pubKeyHash: string): string {
  return createHash("sha256").update(pubKeyHash).digest("hex").slice(0, 16);
}

/** Build a signed pairing payload + encode it to a single base64url string. */
export function encodePairing(input: PairInput): { payload: PairPayload; token: string } {
  const owner = ownerFingerprint(input.ownerPubKeyHash);
  const body: Omit<PairPayload, "sig"> = {
    v: 1,
    lanUrl: input.lanUrl,
    code: input.code,
    expiresAt: input.expiresAt,
    owner,
  };
  const sig = createHmac("sha256", input.ownerSecret).update(canonical(body)).digest("hex");
  const payload: PairPayload = { ...body, sig };
  const token = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { payload, token };
}

export type DecodeResult =
  | { ok: true; payload: PairPayload }
  | { ok: false; reason: "malformed" | "wrong-owner" | "bad-sig" | "expired" };

/** Decode + verify a pairing payload. Verifies signature with the local
 *  owner secret and rejects payloads that don't match the local owner
 *  fingerprint -- so a stranger's payload (even captured on the same
 *  WiFi) cannot trigger an auto-fetch on this device. */
export function decodePairing(
  token: string,
  expectedOwnerPubKeyHash: string,
  ownerSecret: string,
  now: Date = new Date(),
): DecodeResult {
  let payload: PairPayload;
  try {
    const json = Buffer.from(token, "base64url").toString("utf8");
    payload = JSON.parse(json);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!payload || payload.v !== 1 || !payload.lanUrl || !payload.code || !payload.owner || !payload.sig) {
    return { ok: false, reason: "malformed" };
  }
  const expectedOwner = ownerFingerprint(expectedOwnerPubKeyHash);
  if (payload.owner !== expectedOwner) {
    return { ok: false, reason: "wrong-owner" };
  }
  const expectedSig = createHmac("sha256", ownerSecret).update(canonical(payload)).digest("hex");
  if (safeHmacNotEqual(expectedSig, payload.sig)) {
    return { ok: false, reason: "bad-sig" };
  }
  if (new Date(payload.expiresAt).getTime() < now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  return { ok: true, payload };
}
