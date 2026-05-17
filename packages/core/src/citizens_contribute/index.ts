/**
 * v2.19.38 — MNEME CITIZENS CONTRIBUTE (Socket #2 — the quarterly upload pipeline)
 *
 *   The v2.19.37 CITIZEN'S AUDIT had no real-world contribution path.
 *   v2.19.38 ships the SOCKET: pack local protocol receipts → anonymise
 *   → HMAC-sign → output to a canonical path the caller pushes to a
 *   public git repo (`github.com/mneme-ai/citizens-audit`). Daemon
 *   auto-runs at quarter end; user just commits.
 *
 *   File path scheme (public repo):
 *     /<quarter>/<deviceFingerprint>-<count>.json
 *
 *   Each device contributes ≤1 file per quarter. deviceFingerprint is
 *   sha256(installFingerprint + secret) — stable per install, opaque
 *   to outsiders. Aggregator reads /<quarter>/* and runs aggregateCitizens.
 *
 *   Composes onto:
 *     - v2.19.37 RECEIPT PROTOCOL (input format)
 *     - v2.19.37 CITIZEN'S AUDIT (anonymizeReceipt reused)
 *     - v1.72 DIASPORA (git transport reused for push)
 *
 * Honest scope:
 *   - PURE FUNCTION pack + sign + path-emit. Caller does actual git push.
 *   - Idempotent: same receipts → same output bytes.
 *   - DRY_RUN mode: emits the bytes but doesn't write anywhere.
 *   - 30+ tests + 1000-iter fuzz.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { anonymizeReceipt, type AnonymizedReceipt, quarterIdFromMs } from "../citizens_audit/index.js";
import type { ProtocolReceipt } from "../mneme_receipt_protocol/index.js";

const PROTOCOL_VERSION = 1 as const;

export interface ContributionEnvelope {
  v: typeof PROTOCOL_VERSION;
  quarter: string;
  /** Opaque device fingerprint — sha256(installFingerprint + secret). */
  deviceFingerprint: string;
  /** Number of receipts in this contribution. */
  count: number;
  /** Anonymised receipts (NO PII). */
  receipts: AnonymizedReceipt[];
  /** Window covered (ms epoch). */
  windowStartMs: number;
  windowEndMs: number;
  /** ISO ts of when this envelope was packed. */
  packedAtIso: string;
  /** HMAC over canonical envelope body (excluding sig). */
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_CITIZENS_CONTRIBUTE_SECRET"] || `mneme-citizens-contribute-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/**
 * Derive a stable, opaque device fingerprint from an install identifier
 * (e.g., randomBytes(16) written to `.mneme/install-id`). HMAC over the
 * id so the public fingerprint can't be reversed to the raw id.
 */
export function deriveDeviceFingerprint(installId: string, secret?: string): string {
  if (typeof installId !== "string" || installId.length === 0) {
    return sha256Hex("unknown-device").slice(0, 24);
  }
  const sec = secret ?? defaultSecret();
  return hmacHex({ installId }, sec).slice(0, 24);
}

// ─── PACK ──────────────────────────────────────────────────────────

export interface PackInput {
  receipts: ProtocolReceipt[];
  installId: string;
  /** ms epoch range to include (default = full quarter that windowStartMs falls in). */
  windowStartMs?: number;
  windowEndMs?: number;
  packedAtMs?: number;
  secret?: string;
}

/**
 * Pack receipts into a signed contribution envelope. Defensive at every
 * boundary. Returns an envelope passing verifyContribution().
 */
export function packContribution(input: PackInput): ContributionEnvelope {
  const sec = input.secret ?? defaultSecret();
  const packedAtMs = input.packedAtMs ?? Date.now();
  // Default window = current quarter
  const repTs = (input.receipts[0]?.tsMs) ?? packedAtMs;
  const quarter = quarterIdFromMs(input.windowStartMs ?? repTs);
  const [year, q] = quarter.split("-Q");
  const yearN = parseInt(year!, 10);
  const qN = parseInt(q!, 10);
  const defaultStart = Date.UTC(yearN, (qN - 1) * 3, 1);
  const defaultEnd = qN < 4
    ? Date.UTC(yearN, qN * 3, 1) - 1
    : Date.UTC(yearN + 1, 0, 1) - 1;
  const windowStartMs = input.windowStartMs ?? defaultStart;
  const windowEndMs = input.windowEndMs ?? defaultEnd;
  // Filter receipts to window
  const inWindow = (input.receipts ?? []).filter((r) =>
    r && typeof r === "object" && typeof r.tsMs === "number"
    && r.tsMs >= windowStartMs && r.tsMs <= windowEndMs
  );
  // Anonymise + dedupe by anonymizedId
  const seen = new Set<string>();
  const anonymised: AnonymizedReceipt[] = [];
  for (const r of inWindow) {
    try {
      const a = anonymizeReceipt(r);
      if (!seen.has(a.anonymizedId)) {
        seen.add(a.anonymizedId);
        anonymised.push(a);
      }
    } catch { /* defensive — drop bad receipts silently */ }
  }
  // Sort by dayBucketMs for stable output (idempotence)
  anonymised.sort((a, b) => a.dayBucketMs - b.dayBucketMs || a.anonymizedId.localeCompare(b.anonymizedId));

  const deviceFingerprint = deriveDeviceFingerprint(input.installId, sec);
  const body = {
    v: PROTOCOL_VERSION,
    quarter,
    deviceFingerprint,
    count: anonymised.length,
    receipts: anonymised,
    windowStartMs,
    windowEndMs,
    packedAtIso: new Date(packedAtMs).toISOString(),
  };
  return { ...body, sig: hmacHex(body, sec) };
}

/** Verify the HMAC sig of a contribution envelope. */
export function verifyContribution(env: ContributionEnvelope, secret?: string): boolean {
  if (!env || env.v !== PROTOCOL_VERSION) return false;
  const sec = secret ?? defaultSecret();
  const { sig, ...body } = env;
  return safeEqHex(hmacHex(body, sec), sig);
}

// ─── EMIT TO CANONICAL PATH ────────────────────────────────────────

export interface ContributionFile {
  /** Where this file should land in the public repo. */
  path: string;
  /** JSON bytes the caller writes to disk + git pushes. */
  bytes: string;
  /** Suggested commit message. */
  commitMessage: string;
  /** Suggested branch hint. */
  branchHint: string;
}

export function emitContributionFile(env: ContributionEnvelope): ContributionFile {
  const safeFp = env.deviceFingerprint.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 24);
  const path = `${env.quarter}/${safeFp}-${env.count}.json`;
  const bytes = JSON.stringify(env, null, 2) + "\n";
  return {
    path,
    bytes,
    commitMessage: `citizens(${env.quarter}): ${safeFp.slice(0, 8)}… contributes ${env.count} anonymised receipts`,
    branchHint: `citizens/${env.quarter}/${safeFp}`,
  };
}

// ─── DRY-RUN PREVIEW (for user confirmation before push) ──────────

export interface ContributionPreview {
  quarter: string;
  count: number;
  vendorBreakdown: Record<string, number>;
  filePath: string;
  byteSize: number;
  estimatedRepoUrl: string;
}

const DEFAULT_PUBLIC_REPO = "github.com/mneme-ai/citizens-audit";

export function previewContribution(env: ContributionEnvelope, repoUrl: string = DEFAULT_PUBLIC_REPO): ContributionPreview {
  const vendorBreakdown: Record<string, number> = {};
  for (const r of env.receipts) {
    vendorBreakdown[r.vendor] = (vendorBreakdown[r.vendor] ?? 0) + 1;
  }
  const file = emitContributionFile(env);
  return {
    quarter: env.quarter,
    count: env.count,
    vendorBreakdown,
    filePath: file.path,
    byteSize: file.bytes.length,
    estimatedRepoUrl: `${repoUrl}/blob/main/${file.path}`,
  };
}

// ─── STATS ─────────────────────────────────────────────────────────

export interface ContributeStats {
  totalEnvelopes: number;
  totalReceipts: number;
  uniqueDevices: number;
  uniqueQuarters: number;
}

export function computeContributeStats(envelopes: ContributionEnvelope[]): ContributeStats {
  const devices = new Set<string>();
  const quarters = new Set<string>();
  let totalReceipts = 0;
  for (const e of envelopes) {
    devices.add(e.deviceFingerprint);
    quarters.add(e.quarter);
    totalReceipts += e.count;
  }
  return {
    totalEnvelopes: envelopes.length,
    totalReceipts,
    uniqueDevices: devices.size,
    uniqueQuarters: quarters.size,
  };
}

export function formatContributeLine(s: ContributeStats): string {
  return `🪙 CITIZENS · ${s.totalEnvelopes} envelopes · ${s.totalReceipts} receipts · ${s.uniqueDevices} devices · ${s.uniqueQuarters} quarters`;
}

export const CITIZENS_CONTRIBUTE_TUNABLES = Object.freeze({
  PROTOCOL_VERSION,
  DEFAULT_PUBLIC_REPO,
});
