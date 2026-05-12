/**
 * v1.88.0 -- ANCHOR: parent-pole identity.
 *
 * The architecture user described: "parent คือเสา, child = เชือก
 * ที่ลากต่อความสัมพันธ์ไป". Parent generates a stable identity
 * (PolePoint). Every child receives a signed ROPE TOKEN that proves
 * it is rooted to that pole. As long as the rope hasn't expired
 * (or been revoked), the child can:
 *
 *   - resume conversations from the parent
 *   - sync with OTHER children of the same pole (child↔child)
 *   - inherit upgrades the parent has applied (next connection)
 *
 * Pole identity = (poleId, polePublicKey, poleSecret).
 * Rope = HMAC(poleSecret, child_id || expires || scope || nonce).
 *
 * Child-to-child sync verifies both children carry valid ropes that
 * share a poleId -- so a stranger's rope (different pole) is
 * automatically rejected even on the same LAN.
 */

import { createHash, createHmac, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const POLE_DIR = ".mneme/anchor";
const POLE_FILE = "pole.json";

export interface PolePoint {
  poleId: string;
  publicKey: string;
  /** ISO timestamp when this pole was created. */
  createdAt: string;
}

export interface PoleSecret {
  poleId: string;
  /** Hex-encoded HMAC key. NEVER share this. */
  secret: string;
}

export interface RopeToken {
  v: 1;
  poleId: string;
  childId: string;
  expiresAt: string;
  scope: ReadonlyArray<"sync" | "resume" | "upgrade-notify">;
  nonce: string;
  sig: string;
}

function genId(): string {
  return createHash("sha256").update(randomBytes(32)).digest("hex").slice(0, 16);
}

function poleSecretPath(repoRoot: string): string {
  return join(repoRoot, POLE_DIR, "pole-secret.json");
}

function polePublicPath(repoRoot: string): string {
  return join(repoRoot, POLE_DIR, POLE_FILE);
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    let raw = readFileSync(path, "utf8");
    if (raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    return JSON.parse(raw.trim()) as T;
  } catch {
    return null;
  }
}

/** Read OR create the parent pole identity for this repo. Idempotent. */
export function ensurePole(repoRoot: string): { point: PolePoint; secret: PoleSecret } {
  const dir = join(repoRoot, POLE_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const existingSecret = readJson<PoleSecret>(poleSecretPath(repoRoot));
  const existingPoint = readJson<PolePoint>(polePublicPath(repoRoot));
  if (existingSecret && existingPoint) {
    return { point: existingPoint, secret: existingSecret };
  }
  const poleId = genId();
  const secret = randomBytes(32).toString("hex");
  const publicKey = createHash("sha256").update(secret).digest("hex");
  const point: PolePoint = { poleId, publicKey, createdAt: new Date().toISOString() };
  const sec: PoleSecret = { poleId, secret };
  writeFileSync(polePublicPath(repoRoot), JSON.stringify(point, null, 2), "utf8");
  writeFileSync(poleSecretPath(repoRoot), JSON.stringify(sec, null, 2), "utf8");
  return { point, secret: sec };
}

function canonical(t: Omit<RopeToken, "sig">): string {
  return JSON.stringify({ v: t.v, poleId: t.poleId, childId: t.childId, expiresAt: t.expiresAt, scope: t.scope, nonce: t.nonce });
}

/** Issue a rope token for a child. Each child gets its own token. */
export function issueRope(
  secret: PoleSecret,
  childId: string,
  opts: { ttlMs?: number; scope?: RopeToken["scope"] } = {},
): RopeToken {
  const ttl = opts.ttlMs ?? 30 * 24 * 60 * 60 * 1000;
  const scope = opts.scope ?? ["sync", "resume", "upgrade-notify"];
  const body: Omit<RopeToken, "sig"> = {
    v: 1,
    poleId: secret.poleId,
    childId,
    expiresAt: new Date(Date.now() + ttl).toISOString(),
    scope,
    nonce: randomBytes(8).toString("hex"),
  };
  const sig = createHmac("sha256", secret.secret).update(canonical(body)).digest("hex");
  return { ...body, sig };
}

export type RopeVerdict =
  | { ok: true; rope: RopeToken }
  | { ok: false; reason: "bad-sig" | "expired" | "wrong-pole" | "malformed" };

/** Verify a rope token against the local pole secret. */
export function verifyRope(secret: PoleSecret, token: RopeToken): RopeVerdict {
  if (!token || token.v !== 1 || !token.poleId || !token.childId || !token.sig) {
    return { ok: false, reason: "malformed" };
  }
  if (token.poleId !== secret.poleId) return { ok: false, reason: "wrong-pole" };
  const expected = createHmac("sha256", secret.secret).update(canonical(token)).digest("hex");
  if (expected !== token.sig) return { ok: false, reason: "bad-sig" };
  if (new Date(token.expiresAt).getTime() < Date.now()) return { ok: false, reason: "expired" };
  return { ok: true, rope: token };
}

/** Child↔child sync gate: both children must carry valid ropes from
 *  the SAME pole. Stranger's rope from a different pole is rejected. */
export function canChildrenSync(secret: PoleSecret, ropeA: RopeToken, ropeB: RopeToken): { ok: boolean; reason?: string } {
  const a = verifyRope(secret, ropeA);
  if (!a.ok) return { ok: false, reason: `ropeA: ${a.reason}` };
  const b = verifyRope(secret, ropeB);
  if (!b.ok) return { ok: false, reason: `ropeB: ${b.reason}` };
  if (a.rope.poleId !== b.rope.poleId) return { ok: false, reason: "different-pole" };
  if (!a.rope.scope.includes("sync") || !b.rope.scope.includes("sync")) {
    return { ok: false, reason: "scope-lacks-sync" };
  }
  return { ok: true };
}
