/**
 * v2.18.0 — MNEME VERIFIED BADGE (the "Energy Star" of AI)
 *
 *   "Vendor with measured falseRateLB < 0.05 (and minimum sample size)
 *    earns the right to display the 🛡 Mneme Verified Trustworthy badge.
 *    Badges are HMAC-signed time-limited certificates. Vendors PAY annual
 *    license to display. Renewal requires re-passing the gate."
 *
 * Tier system:
 *   PLATINUM — falseRateLB < 0.02, totalVerdicts >= 5000
 *   GOLD     — falseRateLB < 0.05, totalVerdicts >= 1000
 *   SILVER   — falseRateLB < 0.10, totalVerdicts >= 200
 *   BRONZE   — falseRateLB < 0.20, totalVerdicts >= 50
 *   FAIL     — none of the above; cannot display the badge
 *
 * Each badge:
 *   - Validity period: 90 days (re-test required)
 *   - Tier-locked (vendor can't claim PLATINUM if measured GOLD)
 *   - HMAC-signed; verifier can confirm any badge in the wild
 *   - Embed-safe SVG generator for marketing pages
 *
 * Composes onto v2.14 BOUNTY (falseRateLB) + v2.16 OBELISK (federated
 * trust graph) + v2.18 ARENA (leaderboard). Pure issuance + verification;
 * no liability — that's MNEME ORACLE.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;

export type BadgeTier = "platinum" | "gold" | "silver" | "bronze" | "fail";

export interface BadgeInput {
  vendor: string;
  /** Vendor's display name on the badge (e.g., "Anthropic Claude"). */
  displayName: string;
  /** Measured falseRateLB from BOUNTY/OBELISK. */
  falseRateLB: number;
  /** Total verdicts in the sample (must clear tier minimum). */
  totalVerdicts: number;
  /** Issuance timestamp; defaults to now. */
  issuedAt?: string;
  /** Validity in days; defaults to 90. */
  validityDays?: number;
  secret?: string;
}

export interface VerifiedBadge {
  v: typeof PROTOCOL_VERSION;
  vendor: string;
  displayName: string;
  tier: BadgeTier;
  measured: {
    falseRateLB: number;
    totalVerdicts: number;
  };
  issuedAt: string;
  validUntil: string;
  /** Public certificate ID for embed. */
  certId: string;
  /** HMAC over the certificate body. */
  sig: string;
}

export interface VerifyResult {
  ok: boolean;
  expired: boolean;
  reason?: string;
  badge?: VerifiedBadge;
}

const TIER_RULES: Array<{ tier: BadgeTier; maxFR: number; minVerdicts: number }> = [
  { tier: "platinum", maxFR: 0.02, minVerdicts: 5000 },
  { tier: "gold",     maxFR: 0.05, minVerdicts: 1000 },
  { tier: "silver",   maxFR: 0.10, minVerdicts: 200 },
  { tier: "bronze",   maxFR: 0.20, minVerdicts: 50 },
];

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_BADGE_SECRET"] || `mneme-verified-badge-v${PROTOCOL_VERSION}`;
}

export function determineTier(falseRateLB: number, totalVerdicts: number): BadgeTier {
  for (const rule of TIER_RULES) {
    if (falseRateLB < rule.maxFR && totalVerdicts >= rule.minVerdicts) {
      return rule.tier;
    }
  }
  return "fail";
}

function rng32(seed: string): string {
  // Deterministic certId derived from canonical body — easier to verify out
  // of band; not a secret, just a pretty handle.
  return createHmac("sha256", "mneme-badge-certid").update(seed).digest("hex").slice(0, 12);
}

export function issueBadge(input: BadgeInput): VerifiedBadge {
  const tier = determineTier(input.falseRateLB, input.totalVerdicts);
  const issuedAt = input.issuedAt ?? new Date().toISOString();
  const validityDays = input.validityDays ?? 90;
  const validUntil = new Date(Date.parse(issuedAt) + validityDays * 24 * 60 * 60 * 1000).toISOString();
  const certIdSeed = `${input.vendor}|${tier}|${issuedAt}|${input.falseRateLB}`;
  const body: Omit<VerifiedBadge, "sig"> = {
    v: PROTOCOL_VERSION,
    vendor: input.vendor,
    displayName: input.displayName,
    tier,
    measured: {
      falseRateLB: Math.round(input.falseRateLB * 100000) / 100000,
      totalVerdicts: input.totalVerdicts,
    },
    issuedAt,
    validUntil,
    certId: rng32(certIdSeed),
  };
  const sig = createHmac("sha256", input.secret ?? defaultSecret()).update(canon(body)).digest("hex");
  return { ...body, sig };
}

export function verifyBadge(badge: VerifiedBadge, secret?: string): VerifyResult {
  const { sig: claimed, ...body } = badge;
  const expected = createHmac("sha256", secret ?? defaultSecret()).update(canon(body)).digest("hex");
  let okSig = false;
  try { okSig = timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(claimed, "hex")); }
  catch { okSig = false; }
  if (!okSig) return { ok: false, expired: false, reason: "badge sig mismatch — forged or wrong key" };
  const expired = Date.now() > Date.parse(badge.validUntil);
  if (expired) return { ok: false, expired: true, reason: "badge expired", badge };
  if (badge.tier === "fail") return { ok: false, expired: false, reason: "tier=fail; vendor cannot display badge" };
  return { ok: true, expired: false, badge };
}

/**
 * Generate an embed-safe SVG for the badge. Width/height fixed at 240×60
 * for marketing footers. Tier color: platinum silver-blue, gold yellow-orange,
 * silver gray, bronze copper. Includes the certId so verifiers can lookup.
 */
export function badgeSvg(badge: VerifiedBadge): string {
  const colors: Record<BadgeTier, { bg: string; ring: string; text: string }> = {
    platinum: { bg: "#1e293b", ring: "#94a3b8", text: "#e2e8f0" },
    gold:     { bg: "#3a2e0a", ring: "#fbbf24", text: "#fef3c7" },
    silver:   { bg: "#27272a", ring: "#a1a1aa", text: "#f4f4f5" },
    bronze:   { bg: "#3a1f0e", ring: "#d97706", text: "#fed7aa" },
    fail:     { bg: "#1a1015", ring: "#6b7280", text: "#9ca3af" },
  };
  const c = colors[badge.tier];
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="60" viewBox="0 0 240 60" role="img" aria-label="Mneme Verified Trustworthy ${badge.tier} for ${badge.vendor}">
  <rect width="240" height="60" rx="8" fill="${c.bg}" stroke="${c.ring}" stroke-width="2"/>
  <text x="14" y="22" font-family="system-ui, sans-serif" font-size="11" fill="${c.ring}" letter-spacing="1.5">🛡 MNEME VERIFIED</text>
  <text x="14" y="42" font-family="system-ui, sans-serif" font-size="14" font-weight="700" fill="${c.text}">${escape(badge.displayName)}</text>
  <text x="226" y="22" text-anchor="end" font-family="system-ui, sans-serif" font-size="11" fill="${c.ring}" font-weight="700" letter-spacing="2">${badge.tier.toUpperCase()}</text>
  <text x="226" y="42" text-anchor="end" font-family="ui-monospace, monospace" font-size="9" fill="${c.text}" opacity="0.65">cert:${badge.certId}</text>
</svg>`;
}

/** One-line pulse summary. */
export function formatBadgeLine(b: VerifiedBadge): string {
  return `BADGE 🛡 · ${b.displayName} · ${b.tier} · expires ${b.validUntil.slice(0, 10)}`;
}

/** Tier-pricing model (informational; the actual billing is out of band). */
export function tierAnnualLicense(tier: BadgeTier): number {
  // USD/year. Defensible numbers based on certification industry comparables.
  return { platinum: 50000, gold: 12000, silver: 3000, bronze: 500, fail: 0 }[tier];
}
