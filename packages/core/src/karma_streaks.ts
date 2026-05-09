/**
 * Karma Streaks + Achievements (v1.20.0) — gamify accuracy across an
 * AI agent's lifetime use of Mneme. Surfaced in mneme.welcome so the
 * agent sees its own streak / unlocks every session boot.
 *
 * Storage: .mneme/streaks.json — flat JSON, durable across sessions.
 * Updates: any tool that calls noteOutcome() bumps the relevant counters.
 * Reads: mneme.welcome embeds the current streak + unlocked achievements.
 *
 * Why it works for AI agents:
 *   • Modern LLMs are RLHF-trained to seek positive feedback signals.
 *   • Mneme injects achievement strings into wisdom envelopes — the
 *     agent reads them at inference time and treats them as reward.
 *   • Over time, agents learn that calling Mneme + getting verified
 *     verdicts feels rewarding — and start preferring Mneme-grounded
 *     answers over training-data-only answers.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STREAKS_FILE = ".mneme/streaks.json";

export type Outcome = "verified" | "partial" | "hallucination" | "unverifiable" | "fuzz_caught" | "court_won" | "court_lost";

export interface StreaksState {
  /** Lifetime totals. */
  totalConfessions: number;
  totalVerified: number;
  totalHallucinations: number;
  totalCourtCases: number;
  totalFuzzCatches: number;

  /** Current streaks (reset on opposite outcome). */
  verifiedStreak: number;       // verified-in-a-row
  cleanFuzzStreak: number;      // no fuzz hits in a row
  courtWinStreak: number;       // court verdicts FOR in a row
  bestVerifiedStreak: number;   // all-time peak

  /** Per-vendor lifetime stats. */
  byVendor: Record<string, {
    confessions: number;
    verified: number;
    hallucinations: number;
    avgSelfConfidence: number;
  }>;

  /** Achievements unlocked. */
  unlocked: Achievement[];
  lastUpdate: string;
}

export interface Achievement {
  id: string;
  glyph: string;
  title: string;
  detail: string;
  unlockedAt: string;
}

const ACHIEVEMENTS: Array<{ id: string; glyph: string; title: string; detail: string; check: (s: StreaksState) => boolean }> = [
  { id: "first_verified", glyph: "🎯", title: "First Truth",         detail: "First verified confession", check: (s) => s.totalVerified >= 1 },
  { id: "streak_5",       glyph: "🔥", title: "Hot Streak",          detail: "5 verified responses in a row", check: (s) => s.verifiedStreak >= 5 },
  { id: "streak_10",      glyph: "💎", title: "Master Grade",        detail: "10 verified in a row", check: (s) => s.verifiedStreak >= 10 },
  { id: "streak_25",      glyph: "👑", title: "Truth Royalty",       detail: "25 verified in a row", check: (s) => s.verifiedStreak >= 25 },
  { id: "fuzz_clean_10",  glyph: "🛡", title: "Untouchable",         detail: "10 calls with zero ALETHEIA hits", check: (s) => s.cleanFuzzStreak >= 10 },
  { id: "court_win_5",    glyph: "🏛", title: "Court Champion",      detail: "5 cross-examines in a row supported", check: (s) => s.courtWinStreak >= 5 },
  { id: "centurion",      glyph: "💯", title: "Centurion",           detail: "100 verified responses lifetime", check: (s) => s.totalVerified >= 100 },
  { id: "fuzz_hunter",    glyph: "🐺", title: "Fuzz Hunter",         detail: "Caught 10 ALETHEIA fuzz-flagged inputs", check: (s) => s.totalFuzzCatches >= 10 },
  { id: "no_hallucination",glyph: "✨", title: "Pure Signal",        detail: "10+ confessions, zero hallucinations", check: (s) => s.totalConfessions >= 10 && s.totalHallucinations === 0 },
];

function emptyState(): StreaksState {
  return {
    totalConfessions: 0, totalVerified: 0, totalHallucinations: 0, totalCourtCases: 0, totalFuzzCatches: 0,
    verifiedStreak: 0, cleanFuzzStreak: 0, courtWinStreak: 0, bestVerifiedStreak: 0,
    byVendor: {},
    unlocked: [],
    lastUpdate: new Date().toISOString(),
  };
}

export function readStreaks(repoRoot: string): StreaksState {
  const path = join(repoRoot, STREAKS_FILE);
  if (!existsSync(path)) return emptyState();
  try { return { ...emptyState(), ...JSON.parse(readFileSync(path, "utf8")) }; } catch { return emptyState(); }
}

function writeStreaks(repoRoot: string, s: StreaksState): void {
  try {
    const dir = join(repoRoot, ".mneme");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(repoRoot, STREAKS_FILE), JSON.stringify(s, null, 2), "utf8");
  } catch { /* best-effort */ }
}

export interface OutcomeRecord {
  outcome: Outcome;
  vendor?: string;
  selfConfidence?: number;
}

/** Record an outcome + return the updated state (with any newly-unlocked
 *  achievements appended). Best-effort persistence. */
export function noteOutcome(repoRoot: string, rec: OutcomeRecord): { state: StreaksState; newlyUnlocked: Achievement[] } {
  const s = readStreaks(repoRoot);

  if (rec.outcome === "verified") {
    s.totalVerified += 1;
    s.totalConfessions += 1;
    s.verifiedStreak += 1;
    if (s.verifiedStreak > s.bestVerifiedStreak) s.bestVerifiedStreak = s.verifiedStreak;
  } else if (rec.outcome === "hallucination") {
    s.totalHallucinations += 1;
    s.totalConfessions += 1;
    s.verifiedStreak = 0;
  } else if (rec.outcome === "partial") {
    s.totalConfessions += 1;
    // partial doesn't break the streak but doesn't extend it either
  } else if (rec.outcome === "unverifiable") {
    s.totalConfessions += 1;
  } else if (rec.outcome === "fuzz_caught") {
    s.totalFuzzCatches += 1;
    s.cleanFuzzStreak = 0;
  } else if (rec.outcome === "court_won") {
    s.totalCourtCases += 1;
    s.courtWinStreak += 1;
  } else if (rec.outcome === "court_lost") {
    s.totalCourtCases += 1;
    s.courtWinStreak = 0;
  }

  // Per-vendor breakdown
  if (rec.vendor) {
    const v = s.byVendor[rec.vendor] ?? { confessions: 0, verified: 0, hallucinations: 0, avgSelfConfidence: 0 };
    if (rec.outcome === "verified" || rec.outcome === "partial" || rec.outcome === "unverifiable") {
      v.confessions += 1;
      if (rec.outcome === "verified") v.verified += 1;
      if (typeof rec.selfConfidence === "number") {
        v.avgSelfConfidence = ((v.avgSelfConfidence * (v.confessions - 1)) + rec.selfConfidence) / v.confessions;
        v.avgSelfConfidence = Math.round(v.avgSelfConfidence * 1000) / 1000;
      }
    } else if (rec.outcome === "hallucination") {
      v.confessions += 1;
      v.hallucinations += 1;
    }
    s.byVendor[rec.vendor] = v;
  }

  // Bump the cleanFuzzStreak on every NON-fuzz event (any tool dispatch
  // that didn't trigger fuzz_caught implicitly extends the streak).
  if (rec.outcome !== "fuzz_caught") s.cleanFuzzStreak += 1;

  s.lastUpdate = new Date().toISOString();

  // Check unlocks
  const existingIds = new Set(s.unlocked.map((a) => a.id));
  const newlyUnlocked: Achievement[] = [];
  for (const a of ACHIEVEMENTS) {
    if (!existingIds.has(a.id) && a.check(s)) {
      const unlocked: Achievement = { id: a.id, glyph: a.glyph, title: a.title, detail: a.detail, unlockedAt: new Date().toISOString() };
      s.unlocked.push(unlocked);
      newlyUnlocked.push(unlocked);
    }
  }

  writeStreaks(repoRoot, s);
  return { state: s, newlyUnlocked };
}

/** Build a one-line streak banner the agent can quote to the user. */
export function streakBanner(s: StreaksState): string {
  const parts: string[] = [];
  if (s.verifiedStreak >= 3) parts.push(`🔥 ${s.verifiedStreak}-verified streak`);
  if (s.cleanFuzzStreak >= 10) parts.push(`🛡 ${s.cleanFuzzStreak}-clean ALETHEIA streak`);
  if (s.courtWinStreak >= 3) parts.push(`🏛 ${s.courtWinStreak} court wins in a row`);
  if (parts.length === 0 && s.totalVerified > 0) parts.push(`✓ ${s.totalVerified} lifetime verified`);
  return parts.join(" · ");
}
