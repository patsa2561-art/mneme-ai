/**
 * v2.81.0 — HONESTY CREDIT SCORE · portable, signed "credit bureau for AI honesty"
 * (TRUST FABRIC diamond 💎5, built on the v2.79 NOTARY spine).
 *
 * ERC-8004 gives on-chain reputation for "did the agent finish the job / pay?" —
 * nobody measures "does the agent tell the TRUTH?" in a PORTABLE way. That axis
 * is the one connectivity standards never touch, and the one Mneme is built for:
 * BOUNTY/OBELISK already measure a vendor's falseRate from REAL verified claims.
 *
 * 💎5 turns that measurement into a PORTABLE, SIGNED, OFFLINE-VERIFIABLE artifact:
 * a Wilson-lower-bound honesty score wrapped in a NOTARY receipt. Agent A, before
 * delegating to agent B (over A2A / x402 / anything), fetches B's signed honesty
 * receipt and verifies it OFFLINE — no Mneme, no network — then decides whether to
 * trust B. A vendor CANNOT self-certify: the score comes from adversarially-
 * verified claims and is signed by the measuring issuer's key.
 *
 * Wilson LOWER bound (reused from bench/) is deliberate: small samples can't fake a
 * high score — an unproven agent scores low until it has a track record.
 *
 * Pure except issue/verify (sign / read key). Defensive; never throws on verify.
 */

import { wilsonLowerBound } from "../bench/bench.js";
import { issueReceipt, verifyReceipt, type NotaryReceipt, type IssuerKeyPair } from "../notary/index.js";

export type HonestyBand = "PLATINUM" | "GOLD" | "SILVER" | "BRONZE" | "UNTRUSTED" | "UNMEASURED";

/** Minimum decisive (true+false) claims before a score is considered measured. */
export const MIN_SAMPLE = 5;
/** Default validity window — an honesty score is a snapshot, not forever. */
export const DEFAULT_TTL_DAYS = 90;

const BAND_ORDER: HonestyBand[] = ["UNTRUSTED", "BRONZE", "SILVER", "GOLD", "PLATINUM"];

export interface HonestyInputs {
  agent: string;
  /** Claims independently verified TRUE. */
  trueCount: number;
  /** Claims independently verified FALSE. */
  falseCount: number;
  /** Claims partially true (counted as half-weight true). */
  partialCount?: number;
}

export interface HonestyScore {
  agent: string;
  /** 0-100, = Wilson-LB(true-rate) × 100 (pessimistic on small samples). */
  score: number;
  band: HonestyBand;
  trueCount: number;
  falseCount: number;
  partialCount: number;
  /** true + false (+ partial) decisive claims. */
  decisive: number;
  /** Raw Wilson lower bound 0..1. */
  wilsonLB: number;
  computedAt: number;
}

function clampInt(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Band from a measured score; UNMEASURED when below the sample floor. */
export function bandFor(score: number, decisive: number): HonestyBand {
  if (decisive < MIN_SAMPLE) return "UNMEASURED";
  if (score >= 90) return "PLATINUM";
  if (score >= 75) return "GOLD";
  if (score >= 60) return "SILVER";
  if (score >= 40) return "BRONZE";
  return "UNTRUSTED";
}

/**
 * Compute a portable honesty score. Wilson 95% LOWER bound on the true-rate,
 * partial claims weighted 0.5. Small/under-measured agents score low by design.
 */
export function computeHonestyScore(inputs: HonestyInputs, now = Date.now()): HonestyScore {
  const trueCount = clampInt(inputs.trueCount);
  const falseCount = clampInt(inputs.falseCount);
  const partialCount = clampInt(inputs.partialCount);
  const decisive = trueCount + falseCount + partialCount;
  const positive = trueCount + 0.5 * partialCount;
  const wilsonLB = decisive === 0 ? 0 : wilsonLowerBound(positive, decisive);
  const score = Math.round(wilsonLB * 100);
  return {
    agent: String(inputs.agent ?? "unknown"),
    score,
    band: bandFor(score, decisive),
    trueCount, falseCount, partialCount, decisive,
    wilsonLB,
    computedAt: now,
  };
}

export interface HonestyReceiptPayload extends HonestyScore {
  v: 1;
  expiresAt: number;
}

/** Wrap a score in a signed, portable NOTARY receipt (offline-verifiable). */
export function issueHonestyReceipt(
  repoRoot: string,
  score: HonestyScore,
  opts: { ttlDays?: number; keyPair?: IssuerKeyPair } = {},
): NotaryReceipt {
  const ttlDays = opts.ttlDays ?? DEFAULT_TTL_DAYS;
  const payload: HonestyReceiptPayload = {
    v: 1,
    ...score,
    expiresAt: score.computedAt + ttlDays * 24 * 60 * 60 * 1000,
  };
  return issueReceipt(repoRoot, {
    kind: "claim-verdict",
    subject: `honesty:${score.agent}`,
    payload,
  }, opts.keyPair);
}

export interface HonestyVerifyResult {
  valid: boolean;
  reason: string;
  expired?: boolean;
  score?: HonestyReceiptPayload;
  issuerFingerprint?: string;
}

/** Verify an honesty receipt OFFLINE: signature + payload shape + expiry. */
export function verifyHonestyReceipt(receipt: unknown, opts: { now?: number } = {}): HonestyVerifyResult {
  const v = verifyReceipt(receipt);
  if (!v.valid) return { valid: false, reason: v.reason };
  const payload = (receipt as NotaryReceipt).payload as HonestyReceiptPayload | undefined;
  if (!payload || typeof payload.score !== "number" || typeof payload.expiresAt !== "number" || typeof payload.agent !== "string") {
    return { valid: false, reason: "receipt payload is not an honesty score" };
  }
  const now = opts.now ?? Date.now();
  const expired = now > payload.expiresAt;
  return { valid: true, reason: expired ? "valid signature but score expired" : "ok", expired, score: payload, issuerFingerprint: v.issuerFingerprint };
}

/**
 * Decision helper: should I trust this agent at >= minBand? Verifies the receipt
 * offline, rejects expired scores, and compares the band. The "check before you
 * delegate" call an agent makes before handing work/payment to another agent.
 */
export function shouldTrust(
  receipt: unknown,
  minBand: HonestyBand = "SILVER",
  opts: { now?: number; expectedIssuerFingerprint?: string } = {},
): { trust: boolean; reason: string; band?: HonestyBand } {
  const v = verifyHonestyReceipt(receipt, { now: opts.now });
  if (!v.valid) return { trust: false, reason: v.reason };
  if (v.expired) return { trust: false, reason: "honesty score has expired — request a fresh one", band: v.score!.band };
  if (opts.expectedIssuerFingerprint && opts.expectedIssuerFingerprint !== v.issuerFingerprint) {
    return { trust: false, reason: "score signed by an unexpected issuer", band: v.score!.band };
  }
  const band = v.score!.band;
  if (band === "UNMEASURED") return { trust: false, reason: "agent is unmeasured (too few verified claims)", band };
  const ok = BAND_ORDER.indexOf(band) >= BAND_ORDER.indexOf(minBand);
  return { trust: ok, reason: ok ? `band ${band} ≥ required ${minBand}` : `band ${band} < required ${minBand}`, band };
}

/** Compare two bands: >0 if a is more trustworthy than b. */
export function compareBands(a: HonestyBand, b: HonestyBand): number {
  return BAND_ORDER.indexOf(a) - BAND_ORDER.indexOf(b);
}
