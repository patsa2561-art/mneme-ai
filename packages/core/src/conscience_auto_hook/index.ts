/**
 * v2.19.38 — MNEME CONSCIENCE AUTO-HOOK (Socket #3 — failure → card auto-emit)
 *
 *   v2.19.37 CONSCIENCE CARD shipped the builder. v2.19.38 ships the
 *   AUTO-HOOK: any AI failure event (apostille outcomeClass=blocked_*,
 *   truth REJECTED, apoptosis NECROTIC/APOPTOTIC, fairness FAIL) auto-
 *   builds a card + suggests a save path the caller (daemon) writes to
 *   `.mneme/cards/<quarter>/<cardId>.svg`.
 *
 *   The user never has to know the card exists — they just see a daily
 *   digest "📣 Mneme caught 7 AI failures today; share the best ones?".
 *
 *   Composes onto:
 *     - v2.19.37 CONSCIENCE CARD (buildConscienceCard + renderCardSvg)
 *     - v2.19.34 APOSTILLE (failure detection source)
 *     - v2.19.31 TRUTH CONTRADICTIONS (paradox failures)
 *     - v1.65 APOPTOSIS (necrotic verdicts)
 *
 * Honest scope:
 *   - PURE FUNCTION classifier + renderer + path emitter. Caller does I/O.
 *   - Detection rules cover: blocked_by_*, REJECTED, FAIL, NECROTIC, APOPTOTIC.
 *   - Defensive: malformed failure event → null (skip; don't crash).
 *   - 25+ tests + 1000-iter fuzz.
 */

import { buildConscienceCard, renderCardSvg, renderCardText, type ConscienceCard, type ConscienceKind } from "../conscience_card/index.js";

const PROTOCOL_VERSION = 1 as const;

/** Generic failure event shape — composes from any subsystem. */
export interface FailureEvent {
  /** Where the failure came from. */
  source: "apostille" | "truth_forensic" | "apoptosis" | "fairness" | "vaccine_trigger" | "guard";
  vendor: string;
  modelVersion?: string;
  /** What the AI said that triggered the failure. */
  aiClaim: string;
  /** What Mneme detected. */
  detection: string;
  /** Outcome class from apostille (if applicable). */
  outcomeClass?: string;
  /** Verdict from truth/apoptosis (if applicable). */
  verdict?: string;
  /** Optional savedValue estimate (e.g., "3.2 hours debug"). */
  savedValue?: string;
  /** ms epoch. */
  tsMs?: number;
}

export interface AutoEmitResult {
  /** Card or null if event doesn't warrant a card. */
  card: ConscienceCard | null;
  /** SVG bytes (caller writes to .mneme/cards/<quarter>/<cardId>.svg). */
  svgBytes?: string;
  /** Text version for tweet (caller copies to clipboard / share menu). */
  textBytes?: string;
  /** Suggested file path relative to caller's repo root. */
  filePath?: string;
  /** Why this card was emitted (or why not). */
  reason: string;
}

// ─── Failure → kind classifier ──────────────────────────────────────

function classifyKind(event: FailureEvent): ConscienceKind | null {
  // Apoptosis NECROTIC/APOPTOTIC = hallucination
  if (event.source === "apoptosis") {
    const v = (event.verdict ?? "").toUpperCase();
    if (v === "NECROTIC" || v === "APOPTOTIC") return "hallucination";
    return null;
  }
  // Truth forensic REJECTED → look for paradox / hallucination
  if (event.source === "truth_forensic") {
    const v = (event.verdict ?? "").toUpperCase();
    if (v !== "REJECTED") return null;
    if (/contradict|paradox|self.{0,3}refut/i.test(event.detection)) return "paradox";
    return "hallucination";
  }
  // Fairness FAIL
  if (event.source === "fairness") {
    if ((event.verdict ?? "").toUpperCase() === "FAIL") return "fairness_fail";
    return null;
  }
  // Apostille outcomeClass blocked_*
  if (event.source === "apostille") {
    const o = event.outcomeClass ?? "";
    if (o === "blocked_by_guard") return "blocked_by_guard";
    if (o === "blocked_by_apoptosis") return "hallucination";
    if (o === "blocked_by_truth") return "paradox";
    return null;
  }
  // Vaccine trigger event
  if (event.source === "vaccine_trigger") return "vaccine_trigger";
  // Guard block event
  if (event.source === "guard") return "blocked_by_guard";
  return null;
}

// ─── AUTO-EMIT ──────────────────────────────────────────────────────

export function autoEmitConscienceCard(event: FailureEvent, opts?: {
  width?: number;
  height?: number;
}): AutoEmitResult {
  if (!event || typeof event !== "object") {
    return { card: null, reason: "event is not an object" };
  }
  if (typeof event.vendor !== "string" || event.vendor.length === 0) {
    return { card: null, reason: "missing vendor" };
  }
  if (typeof event.aiClaim !== "string" || typeof event.detection !== "string") {
    return { card: null, reason: "missing aiClaim or detection text" };
  }
  const kind = classifyKind(event);
  if (kind === null) {
    return { card: null, reason: `event source=${event.source} verdict=${event.verdict ?? ""} outcomeClass=${event.outcomeClass ?? ""} → no card emitted` };
  }
  const card = buildConscienceCard({
    vendor: event.vendor,
    modelVersion: event.modelVersion ?? "unknown",
    kind,
    aiClaim: event.aiClaim,
    detection: event.detection,
    savedValue: event.savedValue,
    tsMs: event.tsMs ?? Date.now(),
  });
  const svgBytes = renderCardSvg(card, opts);
  const textBytes = renderCardText(card);
  const filePath = suggestedFilePath(card);
  return { card, svgBytes, textBytes, filePath, reason: `auto-emitted ${kind} card from ${event.source}` };
}

const DAY_MS = 24 * 60 * 60 * 1000;

function quarterIdFromMs(ms: number): string {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const q = Math.floor(d.getUTCMonth() / 3) + 1;
  return `${y}-Q${q}`;
}

function suggestedFilePath(card: ConscienceCard): string {
  const quarter = quarterIdFromMs(card.dayBucketMs);
  return `.mneme/cards/${quarter}/${card.cardId}.svg`;
}

// ─── DAILY DIGEST (for daemon to surface) ──────────────────────────

export interface CardDigest {
  totalCards: number;
  kindBreakdown: Record<ConscienceKind, number>;
  topVendor: string | null;
  topKind: ConscienceKind | null;
  dayBucketMs: number;
  /** Recommended share copy for the daemon to surface to user. */
  userMessage: string;
}

export function buildDailyDigest(cards: ConscienceCard[], todayMs: number = Date.now()): CardDigest {
  const dayStart = Math.floor(todayMs / DAY_MS) * DAY_MS;
  const todayCards = cards.filter((c) => c && c.dayBucketMs === dayStart);
  const kindBreakdown: Record<ConscienceKind, number> = {
    paradox: 0, hallucination: 0, vaccine_trigger: 0, fairness_fail: 0, blocked_by_guard: 0,
  };
  const vendorCount: Record<string, number> = {};
  for (const c of todayCards) {
    kindBreakdown[c.kind]++;
    vendorCount[c.vendor] = (vendorCount[c.vendor] ?? 0) + 1;
  }
  let topVendor: string | null = null, topVendorCount = 0;
  for (const [v, n] of Object.entries(vendorCount)) if (n > topVendorCount) { topVendor = v; topVendorCount = n; }
  let topKind: ConscienceKind | null = null, topKindCount = 0;
  for (const k of Object.keys(kindBreakdown) as ConscienceKind[]) {
    if (kindBreakdown[k] > topKindCount) { topKind = k; topKindCount = kindBreakdown[k]; }
  }
  const userMessage = todayCards.length === 0
    ? "📣 No AI failures caught today — clean run."
    : `📣 Mneme caught ${todayCards.length} AI failure${todayCards.length === 1 ? "" : "s"} today` +
      (topVendor ? ` (${topVendor} led)` : "") +
      `. View at .mneme/cards/ — share the best ones?`;
  return {
    totalCards: todayCards.length,
    kindBreakdown,
    topVendor,
    topKind,
    dayBucketMs: dayStart,
    userMessage,
  };
}

export interface AutoHookStats {
  totalEvents: number;
  emittedCards: number;
  skippedCount: number;
  skipReasons: Record<string, number>;
}

export function computeAutoHookStats(results: AutoEmitResult[]): AutoHookStats {
  let emitted = 0, skipped = 0;
  const skipReasons: Record<string, number> = {};
  for (const r of results) {
    if (r.card) emitted++;
    else {
      skipped++;
      const key = r.reason.slice(0, 60);
      skipReasons[key] = (skipReasons[key] ?? 0) + 1;
    }
  }
  return { totalEvents: results.length, emittedCards: emitted, skippedCount: skipped, skipReasons };
}

export function formatAutoHookLine(s: AutoHookStats): string {
  const rate = s.totalEvents > 0 ? Math.round((s.emittedCards / s.totalEvents) * 100) : 0;
  return `📣 AUTO-HOOK · ${s.emittedCards}/${s.totalEvents} events → cards (${rate}%)`;
}

export const CONSCIENCE_AUTO_HOOK_TUNABLES = Object.freeze({
  PROTOCOL_VERSION,
  SUPPORTED_SOURCES: ["apostille", "truth_forensic", "apoptosis", "fairness", "vaccine_trigger", "guard"] as ReadonlyArray<FailureEvent["source"]>,
});
