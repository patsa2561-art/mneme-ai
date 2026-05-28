/**
 * v2.82.0 — TRUTH-STAKING · money backs the words (TRUST FABRIC 💎6, on the NOTARY spine).
 *
 * ERC-8004 gives reputation from HISTORY. TRUTH-STAKING turns reputation into a
 * BET: an agent stakes value (x402 / USDC micros) behind a checkable claim with a
 * deadline. If the claim is REFUTED inside the window → the stake is SLASHED; if it
 * survives the window unrefuted → the stake is RETURNED. Combines payment-rail
 * value × verification × time-lock — nobody else fuses all three.
 *
 * Composes: NOTARY (the stake + its resolution are signed, offline-verifiable
 * receipts) + the chronostasis "survive an adversarial window" idea + the honesty
 * score (a slash is a verified FALSE that drags the staker's credit down).
 *
 * Pure logic except create/resolve (sign). Never throws on verify.
 */

import { createHash } from "node:crypto";
import { issueReceipt, verifyReceipt, type NotaryReceipt, type IssuerKeyPair } from "../notary/index.js";

export type StakeStatus = "PENDING" | "RETURNED" | "SLASHED";

export interface Stake {
  v: 1;
  staker: string;
  claim: string;
  claimHash: string;
  amountMicros: number;
  currency: string;
  createdAt: number;
  /** Window length in ms — the claim must survive unrefuted until createdAt + deadlineMs. */
  deadlineMs: number;
}

export interface StakeResolution {
  v: 1;
  claimHash: string;
  staker: string;
  status: StakeStatus;
  slashedMicros: number;
  returnedMicros: number;
  refuted: boolean;
  resolvedAt: number;
  evidence?: string;
}

function sha256Hex(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex");
}

function clampMicros(n: unknown): number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0;
}

/** Open a stake behind a claim. Returns the stake + a signed NOTARY receipt. */
export function createStake(
  repoRoot: string,
  input: { staker: string; claim: string; amountMicros: number; currency?: string; deadlineMs: number; createdAt?: number },
  keyPair?: IssuerKeyPair,
): { stake: Stake; receipt: NotaryReceipt } {
  const claim = String(input.claim ?? "");
  const stake: Stake = {
    v: 1,
    staker: String(input.staker ?? "unknown"),
    claim,
    claimHash: sha256Hex(claim),
    amountMicros: clampMicros(input.amountMicros),
    currency: typeof input.currency === "string" ? input.currency : "USDC",
    createdAt: typeof input.createdAt === "number" ? input.createdAt : Date.now(),
    deadlineMs: clampMicros(input.deadlineMs),
  };
  const receipt = issueReceipt(repoRoot, { kind: "claim-verdict", subject: `stake:${stake.claimHash}`, payload: stake }, keyPair);
  return { stake, receipt };
}

/**
 * Resolve a stake. The rules are deterministic + time-locked:
 *   - REFUTED within the window (at ≤ createdAt+deadlineMs) → SLASHED (full amount).
 *   - NOT refuted AND the window has elapsed (at ≥ createdAt+deadlineMs) → RETURNED.
 *   - otherwise (still inside the window, not yet refuted) → PENDING.
 * A late refutation (after the window) does NOT slash — the claim already crystallized.
 */
export function resolveStake(
  repoRoot: string,
  stake: Stake,
  input: { refuted: boolean; at?: number; evidence?: string },
  keyPair?: IssuerKeyPair,
): { resolution: StakeResolution; receipt: NotaryReceipt } {
  const at = typeof input.at === "number" ? input.at : Date.now();
  const windowEnd = stake.createdAt + stake.deadlineMs;
  const refutedInWindow = input.refuted && at <= windowEnd;
  let status: StakeStatus;
  if (refutedInWindow) status = "SLASHED";
  else if (at >= windowEnd) status = "RETURNED";
  else status = "PENDING";
  const slashedMicros = status === "SLASHED" ? stake.amountMicros : 0;
  const returnedMicros = status === "RETURNED" ? stake.amountMicros : 0;
  const resolution: StakeResolution = {
    v: 1,
    claimHash: stake.claimHash,
    staker: stake.staker,
    status,
    slashedMicros,
    returnedMicros,
    refuted: input.refuted,
    resolvedAt: at,
    ...(input.evidence ? { evidence: input.evidence } : {}),
  };
  const receipt = issueReceipt(repoRoot, { kind: "claim-verdict", subject: `stake-resolution:${stake.claimHash}`, payload: resolution }, keyPair);
  return { resolution, receipt };
}

/** Verify a stake or resolution receipt OFFLINE (signature + shape). */
export function verifyStakeReceipt(receipt: unknown): { valid: boolean; reason: string } {
  const v = verifyReceipt(receipt);
  if (!v.valid) return { valid: false, reason: v.reason };
  const p = (receipt as NotaryReceipt).payload as Record<string, unknown> | undefined;
  if (!p || typeof p["claimHash"] !== "string" || typeof p["staker"] !== "string") {
    return { valid: false, reason: "not a stake receipt" };
  }
  return { valid: true, reason: "ok" };
}
