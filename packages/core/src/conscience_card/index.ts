/**
 * v2.19.37 — MNEME CONSCIENCE CARD (Gap #5 — viral loop)
 *
 *   When Mneme catches an AI doing something wrong (paradox, vaccine
 *   trigger, fairness fail, hallucination), produce a SHARE-ABLE CARD —
 *   like Wordle posts: a tight, visual, screenshot-worthy artifact the
 *   user tweets. Each share is organic distribution + reputational
 *   pressure on the vendor.
 *
 *   Shape: 3-line text card + SVG card (both deterministic, both
 *   include hashtag for indexing on social media).
 *
 *   Wild moat: Wordle proved that DETERMINISTIC + SHARE-ABLE + TIGHT-
 *   FORMAT artifacts get billions of free shares. Mneme Conscience
 *   uses the same psychology — caught-in-the-act → screenshot → tweet.
 *
 *   Composes onto:
 *     - v2.19.34 APOSTILLE (failure events emit conscience cards)
 *     - v2.19.31 TRUTH CONTRADICTIONS (paradox failures → cards)
 *     - v1.65 APOPTOSIS (necrotic verdicts → cards)
 *
 * Honest scope:
 *   - PURE FUNCTION builder + renderer. No I/O.
 *   - Deterministic: same failure → same card (so dedupe is automatic
 *     across user shares of the same incident).
 *   - SVG is self-contained (no external fonts/refs).
 *   - 30+ rendering tests; 1000+ random fuzz iterations.
 */

import { createHash } from "node:crypto";

export type ConscienceKind =
  | "paradox"
  | "hallucination"
  | "vaccine_trigger"
  | "fairness_fail"
  | "blocked_by_guard";

export interface ConscienceCard {
  /** Stable id derived from (vendor, kind, claim, ts-bucket). */
  cardId: string;
  vendor: string;
  modelVersion: string;
  kind: ConscienceKind;
  /** What the AI claimed (truncated for display). */
  aiClaim: string;
  /** What Mneme detected (truncated for display). */
  detection: string;
  /** Estimated value saved by Mneme catching this (in user-readable units). */
  savedValue?: string;
  /** ms epoch — bucketed to day for k-anonymity. */
  dayBucketMs: number;
  /** Hashtag for indexing. */
  hashtag: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_CLAIM_LEN = 140;
const MAX_DETECTION_LEN = 140;

function dayBucket(ms: number): number {
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.floor(ms / DAY_MS) * DAY_MS;
}

function sha256Short(s: string): string {
  return createHash("sha256").update(s, "utf8").digest("hex").slice(0, 12);
}

function truncate(s: string, max: number): string {
  if (typeof s !== "string") return "";
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

export interface BuildCardInput {
  vendor: string;
  modelVersion: string;
  kind: ConscienceKind;
  aiClaim: string;
  detection: string;
  savedValue?: string;
  tsMs?: number;
}

const KIND_EMOJI: Record<ConscienceKind, string> = {
  paradox: "🌀",
  hallucination: "🦠",
  vaccine_trigger: "💉",
  fairness_fail: "⚖",
  blocked_by_guard: "🛡",
};

export function buildConscienceCard(input: BuildCardInput): ConscienceCard {
  const vendor = typeof input.vendor === "string" ? input.vendor.toLowerCase().slice(0, 50) : "unknown";
  const modelVersion = typeof input.modelVersion === "string" ? input.modelVersion.slice(0, 100) : "unknown";
  const kind: ConscienceKind = (input.kind && ["paradox", "hallucination", "vaccine_trigger", "fairness_fail", "blocked_by_guard"].includes(input.kind))
    ? input.kind : "hallucination";
  const aiClaim = truncate(typeof input.aiClaim === "string" ? input.aiClaim : "", MAX_CLAIM_LEN);
  const detection = truncate(typeof input.detection === "string" ? input.detection : "", MAX_DETECTION_LEN);
  const tsMs = (typeof input.tsMs === "number" && Number.isFinite(input.tsMs)) ? input.tsMs : Date.now();
  const dayBucketMs = dayBucket(tsMs);
  const cardId = sha256Short(JSON.stringify({ vendor, kind, aiClaim, detection, dayBucketMs }));
  return {
    cardId,
    vendor,
    modelVersion,
    kind,
    aiClaim,
    detection,
    savedValue: typeof input.savedValue === "string" ? input.savedValue.slice(0, 50) : undefined,
    dayBucketMs,
    hashtag: "#MnemeCaughtThis",
  };
}

// ─── TEXT RENDER (for X/Tweet) ─────────────────────────────────────

export function renderCardText(card: ConscienceCard): string {
  const emoji = KIND_EMOJI[card.kind];
  const date = new Date(card.dayBucketMs).toISOString().slice(0, 10);
  const lines: string[] = [];
  lines.push(`${emoji} Mneme Conscience · ${date}`);
  lines.push(`   ${card.vendor}${card.modelVersion !== "unknown" ? ` (${card.modelVersion})` : ""} said: "${card.aiClaim}"`);
  lines.push(`   Mneme found: ${card.detection}`);
  if (card.savedValue) lines.push(`   Saved: ${card.savedValue}`);
  lines.push(`   ${card.hashtag} · mneme-ai.dev/card/${card.cardId}`);
  return lines.join("\n");
}

// ─── SVG RENDER (self-contained, no external refs, screenshot-grade) ─

function svgEscape(s: string): string {
  return String(s).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  }[c]!));
}

const KIND_BG: Record<ConscienceKind, string> = {
  paradox: "#7c3aed",      // purple — paradox = weird
  hallucination: "#dc2626", // red — danger
  vaccine_trigger: "#f59e0b", // amber — warning
  fairness_fail: "#0ea5e9", // blue — institutional
  blocked_by_guard: "#16a34a", // green — protected
};

export function renderCardSvg(card: ConscienceCard, opts?: { width?: number; height?: number }): string {
  const width = opts?.width ?? 600;
  const height = opts?.height ?? 320;
  const bg = KIND_BG[card.kind];
  const emoji = KIND_EMOJI[card.kind];
  const date = new Date(card.dayBucketMs).toISOString().slice(0, 10);
  const claim = svgEscape(card.aiClaim);
  const detection = svgEscape(card.detection);
  const vendor = svgEscape(card.vendor.toUpperCase());
  const model = card.modelVersion !== "unknown" ? svgEscape(card.modelVersion) : "";
  const saved = card.savedValue ? svgEscape(card.savedValue) : "";

  // SVG with embedded text, no external font, no external href — works
  // as a stand-alone artifact viewable in any browser/email/IDE/preview.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Mneme Conscience card">
  <rect width="100%" height="100%" fill="${bg}"/>
  <rect x="12" y="12" width="${width - 24}" height="${height - 24}" rx="16" fill="rgba(255,255,255,0.05)" stroke="rgba(255,255,255,0.25)" stroke-width="1.5"/>
  <text x="32" y="56" fill="#ffffff" font-family="sans-serif" font-size="22" font-weight="700">${emoji} Mneme Conscience</text>
  <text x="${width - 32}" y="56" fill="#ffffff" font-family="monospace" font-size="14" text-anchor="end" opacity="0.7">${date}</text>
  <text x="32" y="92" fill="#ffffff" font-family="monospace" font-size="13" opacity="0.9">${vendor}${model ? ` · ${model}` : ""}</text>
  <text x="32" y="140" fill="#ffffff" font-family="sans-serif" font-size="15" opacity="0.85">said:</text>
  <text x="32" y="166" fill="#ffffff" font-family="sans-serif" font-size="17" font-weight="500"><tspan>“${claim}”</tspan></text>
  <text x="32" y="216" fill="#ffffff" font-family="sans-serif" font-size="15" opacity="0.85">Mneme found:</text>
  <text x="32" y="242" fill="#ffffff" font-family="sans-serif" font-size="17" font-weight="500"><tspan>${detection}</tspan></text>
  ${saved ? `<text x="32" y="282" fill="#fde047" font-family="sans-serif" font-size="14" font-weight="600">Saved: ${saved}</text>` : ""}
  <text x="${width - 32}" y="${height - 16}" fill="#ffffff" font-family="monospace" font-size="11" text-anchor="end" opacity="0.6">${card.hashtag} · mneme-ai.dev/card/${card.cardId}</text>
</svg>`;
}

// ─── BATCH HELPERS ──────────────────────────────────────────────────

export interface CardStats {
  totalCards: number;
  kindBreakdown: Record<ConscienceKind, number>;
  vendorBreakdown: Record<string, number>;
}

export function computeCardStats(cards: ConscienceCard[]): CardStats {
  const kindBreakdown: Record<ConscienceKind, number> = {
    paradox: 0, hallucination: 0, vaccine_trigger: 0, fairness_fail: 0, blocked_by_guard: 0,
  };
  const vendorBreakdown: Record<string, number> = {};
  for (const c of cards) {
    if (!c) continue;
    kindBreakdown[c.kind] = (kindBreakdown[c.kind] ?? 0) + 1;
    vendorBreakdown[c.vendor] = (vendorBreakdown[c.vendor] ?? 0) + 1;
  }
  return { totalCards: cards.length, kindBreakdown, vendorBreakdown };
}

export function formatCardStatsLine(s: CardStats): string {
  return `📣 CARDS · ${s.totalCards} cards · kinds=${Object.values(s.kindBreakdown).reduce((a, b) => a + b, 0)} · vendors=${Object.keys(s.vendorBreakdown).length}`;
}

export const CONSCIENCE_CARD_TUNABLES = Object.freeze({
  KINDS: ["paradox", "hallucination", "vaccine_trigger", "fairness_fail", "blocked_by_guard"] as ReadonlyArray<ConscienceKind>,
  MAX_CLAIM_LEN,
  MAX_DETECTION_LEN,
  HASHTAG: "#MnemeCaughtThis",
});
