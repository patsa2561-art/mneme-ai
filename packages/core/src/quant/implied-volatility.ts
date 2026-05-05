/**
 * `mneme implied-volatility` — predict project chaos from commit message TONE.
 *
 * Wall Street's "implied volatility" measures market expectation of future
 * turbulence FROM option prices, before realized volatility shows up in
 * actual price moves. We do the same with commit messages: signals that
 * predict bug-rate spikes BEFORE the bugs actually land.
 *
 * Tone signals (per commit):
 *   • exclamation density:    !!! → urgency
 *   • all-caps words:         BROKEN, ARGH → frustration
 *   • emoji density:          🔥💀⚠️ → emotional load
 *   • profanity (mild):       wtf, ugh → friction
 *   • hedging language:       "kinda", "should work?", "maybe" → uncertainty
 *
 * Aggregate per week → IV index (0-100). Backtests against subsequent
 * fix-commit rate to validate.
 */

import type { Commit } from "../types.js";

export interface CommitTone {
  /** Hash of the commit. */
  hash: string;
  date: string;
  /** Number of consecutive '!' marks. */
  exclamationScore: number;
  /** Number of all-caps words (≥ 3 chars). */
  allCapsScore: number;
  /** Estimated number of emoji code points. */
  emojiScore: number;
  /** Mild-profanity / frustration markers. */
  frictionScore: number;
  /** Hedging / uncertainty markers. */
  hedgeScore: number;
  /** Aggregate tone (0..1) — calibrated weight of all signals. */
  toneScore: number;
}

export interface VolatilityWindow {
  /** ISO week label e.g. "2024-W32". */
  week: string;
  /** Average tone across commits in this window. */
  avgTone: number;
  /** Number of commits in the window. */
  commitCount: number;
  /** Volatility index (0..100) = avgTone × 100. */
  iv: number;
}

const FRICTION_WORDS = new Set([
  "wtf", "ugh", "argh", "ffs", "damn", "shit", "fuck", "fucking",
  "wth", "omg", "yikes", "oof", "ouch",
  "broken", "borked", "fucked", "cursed",
]);

const HEDGE_WORDS = new Set([
  "maybe", "probably", "kinda", "sorta", "perhaps",
  "should", "might", "could", "hopefully", "fingers",
  "untested", "experimental", "tentative", "wip",
]);

const ALL_CAPS_WORD_RE = /\b[A-Z]{3,}\b/g;
const EXCLAMATION_RE = /!+/g;
// Heuristic emoji match: any code point ≥ U+2600 not in regular Latin block
const EMOJI_RE = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu;

/**
 * Score the tone of a single commit subject + body. Pure function.
 */
export function scoreTone(c: Commit): CommitTone {
  const text = `${c.subject} ${c.body || ""}`;

  // Exclamation density: count sequences of '!' (any count of !!!! is one event).
  let exMatches = 0;
  for (const m of text.matchAll(EXCLAMATION_RE)) {
    exMatches += m[0].length; // double-count !!!!
  }

  // All-caps words.
  const capMatches = text.match(ALL_CAPS_WORD_RE) ?? [];
  const allCapsScore = capMatches.length;

  // Emoji.
  const emoji = text.match(EMOJI_RE) ?? [];

  // Friction words.
  const lower = text.toLowerCase();
  let frictionScore = 0;
  for (const w of FRICTION_WORDS) {
    const re = new RegExp(`\\b${w}\\b`, "g");
    const m = lower.match(re);
    if (m) frictionScore += m.length;
  }

  // Hedge words.
  let hedgeScore = 0;
  for (const w of HEDGE_WORDS) {
    const re = new RegExp(`\\b${w}\\b`, "g");
    const m = lower.match(re);
    if (m) hedgeScore += m.length;
  }

  // Calibrated tone score (0..1).
  const raw =
    0.25 * Math.min(exMatches, 5) / 5 +
    0.20 * Math.min(allCapsScore, 5) / 5 +
    0.15 * Math.min(emoji.length, 5) / 5 +
    0.25 * Math.min(frictionScore, 3) / 3 +
    0.15 * Math.min(hedgeScore, 3) / 3;

  return {
    hash: c.hash,
    date: c.authorDate.slice(0, 10),
    exclamationScore: exMatches,
    allCapsScore,
    emojiScore: emoji.length,
    frictionScore,
    hedgeScore,
    toneScore: Math.min(1, raw),
  };
}

/**
 * Aggregate tones into weekly volatility windows.
 */
export function impliedVolatility(commits: Commit[]): VolatilityWindow[] {
  if (commits.length === 0) return [];
  const tones = commits.map(scoreTone);
  const buckets = new Map<string, { sum: number; count: number }>();
  for (const t of tones) {
    const week = isoWeek(new Date(t.date));
    if (!buckets.has(week)) buckets.set(week, { sum: 0, count: 0 });
    const b = buckets.get(week)!;
    b.sum += t.toneScore;
    b.count += 1;
  }

  const windows: VolatilityWindow[] = [];
  for (const [week, b] of buckets) {
    const avgTone = b.sum / b.count;
    windows.push({
      week,
      avgTone: Math.round(avgTone * 1000) / 1000,
      commitCount: b.count,
      iv: Math.round(avgTone * 100),
    });
  }
  windows.sort((a, b) => a.week.localeCompare(b.week));
  return windows;
}

function isoWeek(d: Date): string {
  const target = new Date(d.valueOf());
  const dayNr = (d.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = target.valueOf();
  target.setUTCMonth(0, 1);
  if (target.getUTCDay() !== 4) {
    target.setUTCMonth(0, 1 + ((4 - target.getUTCDay() + 7) % 7));
  }
  const weekNumber = 1 + Math.ceil((firstThursday - target.valueOf()) / (7 * 86_400_000));
  return `${d.getUTCFullYear()}-W${String(weekNumber).padStart(2, "0")}`;
}

export interface VolatilitySummary {
  windows: VolatilityWindow[];
  /** Latest IV (most recent week). */
  latestIV: number;
  /** Trend over the last 4 weeks: rising / falling / flat. */
  trend: "rising" | "falling" | "flat" | "insufficient-data";
  /** A 1-line interpretation. */
  interpretation: string;
}

export function summarizeVolatility(commits: Commit[]): VolatilitySummary {
  const windows = impliedVolatility(commits);
  if (windows.length === 0) {
    return { windows: [], latestIV: 0, trend: "insufficient-data", interpretation: "No commits indexed." };
  }
  const latest = windows[windows.length - 1]!.iv;
  let trend: VolatilitySummary["trend"] = "insufficient-data";
  if (windows.length >= 4) {
    const recent = windows.slice(-4).map((w) => w.iv);
    const first = recent[0]!;
    const last = recent[recent.length - 1]!;
    const delta = last - first;
    trend = delta > 5 ? "rising" : delta < -5 ? "falling" : "flat";
  }
  return { windows, latestIV: latest, trend, interpretation: buildVolInterpretation(latest, trend) };
}

function buildVolInterpretation(iv: number, trend: VolatilitySummary["trend"]): string {
  if (trend === "rising" && iv >= 30) {
    return `IV is ${iv} (rising) — commit message tone is signaling stress. Expect more bug fixes in the next 1-2 weeks.`;
  }
  if (iv >= 50) return `IV is ${iv} (very high). Team is in firefighting mode.`;
  if (iv <= 10 && trend === "flat") return `IV is ${iv} (low + flat). Calm waters; commits are unemotional.`;
  return `IV is ${iv} (${trend}). Watch for rising trends as a leading indicator of bugs.`;
}
