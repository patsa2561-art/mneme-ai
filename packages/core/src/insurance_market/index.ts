/**
 * v2.19.0 — MNEME INSURANCE MARKET (Lloyd's of AI; vendors EARN their premium discount)
 *
 *   "ORACLE v2.18 priced AI liability by tier. INSURANCE MARKET v2.19
 *    prices it by vendor. Each AI vendor carries a measured risk
 *    multiplier — a Wilson-LB-grounded number that says how much extra
 *    premium a subscriber pays when the change rides on this vendor's
 *    output. Cheap, established vendors get x0.8; brand-new vendors with
 *    no track record (looking at you, grok-build at $300/mo) start at
 *    x1.5 and have to EARN their way down by performing in ARENA +
 *    BOUNTY. Mneme becomes the market maker — the vendor leaderboard
 *    isn't bragging rights, it's pricing power."
 *
 * Vendor-agnostic: every vendor in the Mneme enum has a multiplier.
 * Multipliers are signed and rebalanced periodically from the federated
 * OBELISK trust graph + local BOUNTY ledger.
 *
 * Honest scope:
 *   - INSURANCE MARKET is a pricing layer ON TOP OF v2.18 ORACLE — it
 *     does NOT change ORACLE's cap or refuse logic. It only adjusts the
 *     premium quote.
 *   - The market multiplier is a DEFENSIBLE NUMBER, not a real insurance
 *     rate. Real underwriting still requires actuarial review.
 *   - Multipliers are bounded ([0.5, 3.0]) so a single bad day for a
 *     vendor can't price them out of the market.
 *
 * Composes onto v2.18 ORACLE LIABILITY + v2.14 BOUNTY + v2.16 OBELISK.
 * Pure additive layer.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { tierPremiumUsd, type CoverageTier } from "../oracle_liability/index.js";
import type { Vendor } from "../arena/index.js";

const PROTOCOL_VERSION = 1 as const;

const MULT_MIN = 0.5;
const MULT_MAX = 3.0;
/** Sample size below which we treat a vendor as "unknown" and apply a penalty. */
const MIN_SAMPLE_FOR_DISCOUNT = 100;

export interface VendorTrust {
  vendor: Vendor;
  /** Wilson-LB-style measured falseRate, e.g., from BOUNTY. */
  falseRateLB: number;
  /** Total samples backing the falseRate. */
  totalSamples: number;
}

export interface VendorMultiplier {
  vendor: Vendor;
  multiplier: number;
  /** Why this multiplier — for transparency. */
  reasons: string[];
  /** Trust snapshot the multiplier was computed from. */
  trust: VendorTrust;
}

export interface MarketBoard {
  v: typeof PROTOCOL_VERSION;
  computedAt: string;
  multipliers: VendorMultiplier[];
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_INSURANCE_SECRET"] || `mneme-insurance-market-v${PROTOCOL_VERSION}`;
}

/** Compute a multiplier from a single vendor's trust snapshot. */
export function vendorMultiplier(trust: VendorTrust): VendorMultiplier {
  const reasons: string[] = [];
  // Base: 1.0 at falseRateLB=0.05 (the "expected good vendor" baseline).
  // Linearly scale: each percentage point above 5% adds 0.10 multiplier;
  // each percentage point below subtracts 0.05 (asymmetric: harder to
  // earn discount, easy to incur penalty — matches insurer behaviour).
  const baselineFR = 0.05;
  const delta = trust.falseRateLB - baselineFR;
  let mult = delta >= 0
    ? 1.0 + delta * 10        // 6% → 1.10, 10% → 1.50, 20% → 2.50
    : 1.0 + delta * 5;        // 4% → 0.95, 2% → 0.85, 0% → 0.75
  reasons.push(`falseRateLB ${trust.falseRateLB.toFixed(3)} vs baseline ${baselineFR} → base ${mult.toFixed(2)}`);

  // Sample-size penalty for under-measured vendors (unknown-vendor risk).
  if (trust.totalSamples < MIN_SAMPLE_FOR_DISCOUNT) {
    const penalty = (MIN_SAMPLE_FOR_DISCOUNT - trust.totalSamples) / MIN_SAMPLE_FOR_DISCOUNT * 0.5;
    mult += penalty;
    reasons.push(`under-measured penalty (${trust.totalSamples} < ${MIN_SAMPLE_FOR_DISCOUNT}): +${penalty.toFixed(2)}`);
  }

  // Clamp.
  const before = mult;
  mult = Math.max(MULT_MIN, Math.min(MULT_MAX, mult));
  if (mult !== before) reasons.push(`clamped to [${MULT_MIN}, ${MULT_MAX}]`);

  return {
    vendor: trust.vendor,
    multiplier: Math.round(mult * 100) / 100,
    reasons,
    trust,
  };
}

export function buildMarketBoard(trusts: VendorTrust[], secret?: string): MarketBoard {
  const computedAt = new Date().toISOString();
  const multipliers = trusts
    .map(vendorMultiplier)
    .sort((a, b) => a.multiplier - b.multiplier); // cheap → expensive
  const body: Omit<MarketBoard, "sig"> = {
    v: PROTOCOL_VERSION,
    computedAt,
    multipliers,
  };
  const sig = createHmac("sha256", secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

export function verifyMarketBoard(b: MarketBoard, secret?: string): boolean {
  const { sig: claimed, ...body } = b;
  const expected = createHmac("sha256", secret ?? defaultSecret()).update(canon(body)).digest("hex");
  try { return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(claimed, "hex")); }
  catch { return false; }
}

export interface QuoteInput {
  vendor: Vendor;
  tier: CoverageTier;
  /** Caller-supplied board (cached or freshly built). */
  board: MarketBoard;
}

export interface QuoteResult {
  vendor: Vendor;
  tier: CoverageTier;
  baseAnnualPremiumUsd: number;
  multiplier: number;
  finalAnnualPremiumUsd: number;
  reasons: string[];
  /** "x1.5" or "x0.8" — easy badge label. */
  badge: string;
}

export function quotePremium(input: QuoteInput): QuoteResult {
  const base = tierPremiumUsd(input.tier);
  const vm = input.board.multipliers.find((m) => m.vendor === input.vendor);
  if (!vm) {
    // No data → default conservative 1.5x.
    return {
      vendor: input.vendor,
      tier: input.tier,
      baseAnnualPremiumUsd: base,
      multiplier: 1.5,
      finalAnnualPremiumUsd: Math.round(base * 1.5),
      reasons: [`vendor ${input.vendor} not in market board → default x1.5`],
      badge: "x1.5",
    };
  }
  const final = Math.round(base * vm.multiplier);
  return {
    vendor: input.vendor,
    tier: input.tier,
    baseAnnualPremiumUsd: base,
    multiplier: vm.multiplier,
    finalAnnualPremiumUsd: final,
    reasons: vm.reasons,
    badge: `x${vm.multiplier}`,
  };
}

export function formatInsuranceLine(q: QuoteResult): string {
  return `💰 INSURANCE · ${q.vendor} · ${q.tier} · base $${q.baseAnnualPremiumUsd.toLocaleString()} × ${q.badge} = $${q.finalAnnualPremiumUsd.toLocaleString()}/yr`;
}
