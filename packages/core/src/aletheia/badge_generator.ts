/**
 * ALETHEIA BADGE GENERATOR (v1.43.0 — Demon Stage 1.3).
 *
 * Generates a static SVG badge per vendor — drop-in replacement for
 * shields.io style badges. Two sizes: standard (88×20) and large
 * (160×40). Used by the future public dashboard + by README badge
 * embeds in vendors' own repos.
 *
 * Design: pure SVG string, no external deps. Color tier follows the
 * vendor's badge field (verified=green, trusted=blue, baseline=gray,
 * flagged=red). The composite score is the right-hand value.
 *
 * Free-first: badge generation is local + free. The PAID future
 * ("Mneme Inside" verified badge program at $100k/yr per vendor)
 * remains in pricing_tier metadata only — the badge SVG itself does
 * NOT include any "paid" / "premium" indicator until we explicitly
 * decide to monetize.
 */

import type { VendorScore } from "./vendor_scoring.js";

const COLORS: Record<VendorScore["badge"], { left: string; right: string }> = {
  verified: { left: "#1f2937", right: "#16a34a" },   // gray-800 / green-600
  trusted:  { left: "#1f2937", right: "#2563eb" },   // gray-800 / blue-600
  baseline: { left: "#1f2937", right: "#6b7280" },   // gray-800 / gray-500
  flagged:  { left: "#1f2937", right: "#dc2626" },   // gray-800 / red-600
};

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c] ?? c);
}

export interface BadgeOptions {
  /** "small" = 88×20 (shields.io-style); "large" = 160×40 with vendor name */
  size?: "small" | "large";
  /** Override the right-hand label — default is `${composite}/100`. */
  rightLabel?: string;
  /** Override the left-hand label — default "mneme aletheia". */
  leftLabel?: string;
}

export function generateBadgeSvg(score: VendorScore, opts: BadgeOptions = {}): string {
  const size = opts.size ?? "small";
  const left = opts.leftLabel ?? "mneme aletheia";
  const right = opts.rightLabel ?? `${score.composite}/100`;
  const colors = COLORS[score.badge];

  if (size === "small") {
    const leftWidth = 90;
    const rightWidth = 50;
    const total = leftWidth + rightWidth;
    return [
      `<svg xmlns="http://www.w3.org/2000/svg" width="${total}" height="20" role="img" aria-label="${escapeXml(left)} ${escapeXml(right)}">`,
      `<title>${escapeXml(left)}: ${escapeXml(right)} (${escapeXml(score.vendor)})</title>`,
      `<linearGradient id="g" x2="0" y2="100%"><stop offset="0" stop-color="#fff" stop-opacity=".15"/><stop offset="1" stop-opacity=".15"/></linearGradient>`,
      `<clipPath id="r"><rect width="${total}" height="20" rx="3"/></clipPath>`,
      `<g clip-path="url(#r)">`,
      `<rect width="${leftWidth}" height="20" fill="${colors.left}"/>`,
      `<rect x="${leftWidth}" width="${rightWidth}" height="20" fill="${colors.right}"/>`,
      `<rect width="${total}" height="20" fill="url(#g)"/>`,
      `</g>`,
      `<g fill="#fff" text-anchor="middle" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11">`,
      `<text x="${leftWidth / 2}" y="14">${escapeXml(left)}</text>`,
      `<text x="${leftWidth + rightWidth / 2}" y="14">${escapeXml(right)}</text>`,
      `</g>`,
      `</svg>`,
    ].join("");
  }

  // large
  const w = 160, h = 40;
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" role="img" aria-label="${escapeXml(score.vendor)} ${escapeXml(right)}">`,
    `<title>${escapeXml(score.vendor)}: Mneme Aletheia ${escapeXml(right)} (${escapeXml(score.badge)})</title>`,
    `<rect width="${w}" height="${h}" rx="6" fill="${colors.left}"/>`,
    `<rect x="80" width="80" height="${h}" rx="6" fill="${colors.right}"/>`,
    `<g fill="#fff" font-family="DejaVu Sans,Verdana,Geneva,sans-serif" font-size="11" text-anchor="middle">`,
    `<text x="40" y="16">mneme aletheia</text>`,
    `<text x="40" y="30" font-size="9" opacity=".75">${escapeXml(score.vendor.slice(0, 16))}</text>`,
    `<text x="120" y="20" font-size="14" font-weight="bold">${escapeXml(String(score.composite))}</text>`,
    `<text x="120" y="32" font-size="9" opacity=".85">${escapeXml(score.badge)}</text>`,
    `</g>`,
    `</svg>`,
  ].join("");
}

/** Public-facing JSON shape — explicitly EXCLUDES pricingTier so the
 *  hidden monetization metadata never leaks via this renderer. */
export function generateBadgeJson(score: VendorScore): {
  vendor: string;
  composite: number;
  badge: VendorScore["badge"];
  components: VendorScore["components"];
  sampleSize: number;
  confidenceNote: string;
  computedAt: string;
} {
  return {
    vendor: score.vendor,
    composite: score.composite,
    badge: score.badge,
    components: score.components,
    sampleSize: score.sampleSize,
    confidenceNote: score.confidenceNote,
    computedAt: score.computedAt,
  };
}
