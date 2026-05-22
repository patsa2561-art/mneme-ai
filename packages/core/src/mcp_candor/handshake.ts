/**
 * v2.23.1 — MCP-CANDOR · HANDSHAKE.
 *
 * Composes the existing verify-self + trust-capsule + coercion
 * taxonomy primitives into a single MCP-CANDOR/0.1 handshake
 * response. Diamond #1 (verify-self) from the v2.22.3 audit becomes
 * a flagship protocol endpoint.
 */

import { createHmac, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { SPEC_NAME, SPEC_VERSION, REQUIRED_ENDPOINTS_STANDARD, type CandorHandshake, type ComplianceLevel, type CandorEndpoint } from "./spec.js";

const KEY_DIR = ".mneme/candor";
const KEY_FILE = "candor.key";

function dir(repoRoot: string): string {
  const d = join(repoRoot, KEY_DIR);
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
  return d;
}

function key(repoRoot: string): string {
  const p = join(dir(repoRoot), KEY_FILE);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  const k = randomBytes(32).toString("base64url");
  writeFileSync(p, k, "utf8");
  return k;
}

function sign(payload: string, k: string): string {
  return createHmac("sha256", k).update(payload).digest("base64url").slice(0, 22);
}

export interface BuildHandshakeOptions {
  repoRoot: string;
  /** Identity capsule URI from trust_capsule.buildCapsule(). */
  identityCapsuleUri: string;
  /** Implementation name/version. */
  impl: { name: string; version: string };
  /** Compliance level declared. */
  level: ComplianceLevel;
  /** Endpoints exposed. Defaults to the spec's REQUIRED_ENDPOINTS_STANDARD. */
  endpoints?: CandorEndpoint[];
  /** Whether the impl's own output passes its own coercion audit. */
  coercionClean: boolean;
  vaccinesUrl?: string;
  auditUrl?: string;
}

export function buildHandshake(opts: BuildHandshakeOptions): CandorHandshake {
  const k = key(opts.repoRoot);
  const generatedAt = new Date().toISOString();
  const endpoints = opts.endpoints ?? [...REQUIRED_ENDPOINTS_STANDARD];
  const canonical = `${SPEC_NAME}|${SPEC_VERSION}|${opts.impl.name}|${opts.impl.version}|${opts.level}|${opts.identityCapsuleUri}|${endpoints.join(",")}|${opts.coercionClean}|${generatedAt}`;
  const sig = sign(canonical, k);
  return {
    spec: SPEC_NAME,
    specVersion: SPEC_VERSION,
    impl: opts.impl,
    level: opts.level,
    identity: opts.identityCapsuleUri,
    endpoints,
    coercionClean: opts.coercionClean,
    generatedAt,
    ...(opts.vaccinesUrl ? { vaccinesUrl: opts.vaccinesUrl } : {}),
    ...(opts.auditUrl ? { auditUrl: opts.auditUrl } : {}),
    sig,
  };
}

/** Verify the HMAC over a handshake. Caller provides the per-install
 *  key (separately fetched + cached); when the call is local, we
 *  read it from the per-repo .mneme/candor/candor.key. */
export function verifyHandshakeSig(repoRoot: string, h: CandorHandshake): { ok: boolean; reason?: string } {
  const k = key(repoRoot);
  const canonical = `${h.spec}|${h.specVersion}|${h.impl.name}|${h.impl.version}|${h.level}|${h.identity}|${h.endpoints.join(",")}|${h.coercionClean}|${h.generatedAt}`;
  const expected = sign(canonical, k);
  if (expected !== h.sig) return { ok: false, reason: "HMAC sig mismatch — handshake forged or signed by a different install" };
  return { ok: true };
}

export function formatHandshake(h: CandorHandshake): string {
  return [
    `🤝 ${h.spec}/${h.specVersion} — handshake`,
    "",
    `  Impl:          ${h.impl.name} v${h.impl.version}`,
    `  Level:         ${h.level}`,
    `  Identity:      ${h.identity.slice(0, 60)}${h.identity.length > 60 ? "…" : ""}`,
    `  Endpoints:     ${h.endpoints.length} (${h.endpoints.join(", ")})`,
    `  Coercion-clean: ${h.coercionClean ? "✓ yes (self-declared)" : "✗ no"}`,
    `  Generated:     ${h.generatedAt}`,
    `  Sig:           ${h.sig.slice(0, 12)}…`,
    ...(h.vaccinesUrl ? [`  Vaccines URL:  ${h.vaccinesUrl}`] : []),
    ...(h.auditUrl ? [`  Audit URL:     ${h.auditUrl}`] : []),
  ].join("\n");
}
