/**
 * `mneme drawdown` — find the worst "losing streaks" in repo history.
 *
 * In finance, a drawdown is a peak-to-trough decline. In a codebase, it's
 * a stretch of bug-fix-only commits with no feature progress — pure
 * firefighting. Surfacing these is gold for retrospectives:
 *
 *   "We spent 3 weeks last September shipping nothing but fixes."
 *
 * Pure data analysis. No LLM. Tested via TDD against synthetic histories.
 */

import type { Commit } from "../types.js";
import { isNoiseFile } from "../util/noise.js";

export interface Drawdown {
  /** Start commit (peak — last feat before the drawdown). */
  startHash: string;
  startDate: string;
  /** End commit (trough — last fix in the streak). */
  endHash: string;
  endDate: string;
  /** Number of consecutive non-feat commits in the streak. */
  length: number;
  /** Days between start and end. */
  durationDays: number;
  /** Sample fix subjects from inside the streak (up to 3). */
  sampleFixes: string[];
  /** Severity tier from length × duration. */
  tier: "minor" | "moderate" | "severe" | "critical";
  /** Most-touched files across all commits in the streak (top 5 by count).
   *  Answers "which area of the codebase kept breaking?" — far more
   *  actionable than the commit subjects alone. */
  hotFiles: Array<{ path: string; count: number }>;
}

const FEAT_RE = /^feat[(:]/i;
const FIX_RE = /^(fix|hotfix|bug|revert|patch)[(:]/i;

/** Decide whether a commit subject is a "fix" (counts toward drawdown). */
export function isFixCommit(c: Commit): boolean {
  return FIX_RE.test(c.subject);
}

/** Decide whether a commit subject is a "feature" (resets the streak). */
export function isFeatCommit(c: Commit): boolean {
  return FEAT_RE.test(c.subject);
}

/**
 * Detect drawdowns — runs of ≥ minLength consecutive non-feat commits
 * where ≥ fixRatio of those commits are explicit fixes.
 */
export function detectDrawdowns(
  commits: Commit[],
  opts: { minLength?: number; fixRatio?: number; topN?: number } = {},
): Drawdown[] {
  const minLength = opts.minLength ?? 3;
  const fixRatio = opts.fixRatio ?? 0.5;
  const topN = opts.topN ?? 10;
  const sorted = [...commits].sort((a, b) => a.authorDate.localeCompare(b.authorDate));

  const out: Drawdown[] = [];
  let i = 0;
  while (i < sorted.length) {
    if (isFeatCommit(sorted[i]!)) {
      i += 1;
      continue;
    }
    // Walk forward while non-feat.
    let j = i;
    let fixCount = 0;
    while (j < sorted.length && !isFeatCommit(sorted[j]!)) {
      if (isFixCommit(sorted[j]!)) fixCount += 1;
      j += 1;
    }
    const length = j - i;
    const ratio = length === 0 ? 0 : fixCount / length;
    if (length >= minLength && ratio >= fixRatio) {
      const start = sorted[i]!;
      const end = sorted[j - 1]!;
      const dur = (new Date(end.authorDate).getTime() - new Date(start.authorDate).getTime()) / 86_400_000;
      const streak = sorted.slice(i, j);
      const samples = streak.filter(isFixCommit).slice(0, 3).map((c) => c.subject);
      // Aggregate file touches across the whole streak — answers "which
      // module kept breaking?" Lock-files / generated junk are filtered
      // because they pollute every drawdown without being actionable.
      const fileCounts = new Map<string, number>();
      for (const c of streak) {
        for (const f of c.files ?? []) {
          if (isNoiseFile(f)) continue;
          fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1);
        }
      }
      const hotFiles = [...fileCounts.entries()]
        .map(([path, count]) => ({ path, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 5);
      out.push({
        startHash: start.shortHash || start.hash.slice(0, 7),
        startDate: start.authorDate.slice(0, 10),
        endHash: end.shortHash || end.hash.slice(0, 7),
        endDate: end.authorDate.slice(0, 10),
        length,
        durationDays: Math.round(dur * 10) / 10,
        sampleFixes: samples,
        tier: classifyDrawdown(length, dur),
        hotFiles,
      });
    }
    i = j === i ? i + 1 : j;
  }

  // Sort by severity (length × duration), desc.
  out.sort((a, b) => b.length * Math.max(b.durationDays, 1) - a.length * Math.max(a.durationDays, 1));
  return out.slice(0, topN);
}

export function classifyDrawdown(length: number, durationDays: number): Drawdown["tier"] {
  if (length >= 15 || durationDays >= 30) return "critical";
  if (length >= 8 || durationDays >= 14) return "severe";
  if (length >= 5 || durationDays >= 7) return "moderate";
  return "minor";
}

export interface DrawdownSummary {
  total: number;
  longestStreak: number;
  totalFixingDays: number;
  /** Fraction of the repo's lifespan spent in drawdown. */
  drawdownFraction: number;
}

export function summarizeDrawdowns(commits: Commit[], drawdowns: Drawdown[]): DrawdownSummary {
  if (commits.length === 0) {
    return { total: 0, longestStreak: 0, totalFixingDays: 0, drawdownFraction: 0 };
  }
  const sorted = [...commits].sort((a, b) => a.authorDate.localeCompare(b.authorDate));
  const repoSpan =
    (new Date(sorted[sorted.length - 1]!.authorDate).getTime() -
      new Date(sorted[0]!.authorDate).getTime()) /
    86_400_000;
  const totalFixingDays = drawdowns.reduce((s, d) => s + d.durationDays, 0);
  const longest = drawdowns.reduce((m, d) => Math.max(m, d.length), 0);
  return {
    total: drawdowns.length,
    longestStreak: longest,
    totalFixingDays: Math.round(totalFixingDays * 10) / 10,
    drawdownFraction: repoSpan === 0 ? 0 : totalFixingDays / repoSpan,
  };
}
