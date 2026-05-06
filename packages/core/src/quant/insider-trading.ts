/**
 * `mneme insider-trading` — find authors who repeatedly fix bugs they
 * themselves introduced.
 *
 * The pattern tells you two things at once:
 *   1. This person has the deepest domain knowledge (only they understand
 *      this code well enough to BOTH ship and break it).
 *   2. They have an execution gap — knowing more isn't translating to
 *      better quality.
 *
 * Concrete coaching opportunity: pair them with someone who has zero
 * defects on the same files.
 *
 * Pure data. Detects pairs of (commit, follow-up commit) by SAME author
 * touching the SAME files where the follow-up is a fix.
 */

import type { Commit } from "../types.js";
import { isNoiseFile } from "../util/noise.js";

const FIX_RE = /\b(fix(?:es|ed)?|hotfix|bug|crashed?|broken|regression)\b/i;

export interface InsiderPattern {
  /** Original commit that introduced the bug. */
  shipped: Commit;
  /** Same-author commit that fixed it. */
  fixed: Commit;
  /** Days between ship and fix. */
  daysToFix: number;
  /** The shared file path that triggered the match. */
  sharedFile: string;
}

export interface InsiderProfile {
  authorName: string;
  authorEmail: string;
  /** Number of self-introduced + self-fixed bug pairs. */
  patternCount: number;
  /** Files where the pattern repeats. */
  affectedFiles: string[];
  /** Sample patterns (up to 3) for display. */
  samples: InsiderPattern[];
  /** Risk tier — used for output labeling. */
  tier: "high-pattern" | "elevated" | "watch" | "low";
  /** Suggested pairing partner from another author (if any). */
  pairSuggestion?: string;
  /** Top files (by combined ship+fix touch count) where this author's
   *  insider pattern keeps recurring — top 5, noise-filtered. Answers
   *  "where in the codebase do they keep breaking + fixing?" */
  hotFiles: Array<{ path: string; count: number }>;
}

export interface InsiderTradingOptions {
  /** Maximum days between ship and fix to count as a pattern. */
  windowDays?: number;
  /** Minimum patterns for an author to be flagged. */
  minPatterns?: number;
  /** Top-N profiles to return. */
  topN?: number;
}

/**
 * Detect insider patterns across commits + suggest a pairing partner per
 * flagged author. Pure analysis — caller must pre-load commits.
 */
export function detectInsiderTrading(
  commits: Commit[],
  opts: InsiderTradingOptions = {},
): InsiderProfile[] {
  const windowDays = opts.windowDays ?? 14;
  const minPatterns = opts.minPatterns ?? 2;
  const topN = opts.topN ?? 10;
  const windowMs = windowDays * 86_400_000;

  const sorted = [...commits].sort((a, b) => a.authorDate.localeCompare(b.authorDate));

  // Step 1: collect all patterns across ALL authors.
  const allPatterns: InsiderPattern[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const shipped = sorted[i]!;
    if (FIX_RE.test(shipped.subject)) continue; // skip if shipped IS itself a fix
    const shippedTime = new Date(shipped.authorDate).getTime();
    const shippedAuthor = `${shipped.authorName}|${shipped.authorEmail}`;
    const shippedFiles = new Set(shipped.files ?? []);
    if (shippedFiles.size === 0) continue;

    for (let j = i + 1; j < sorted.length; j++) {
      const fixed = sorted[j]!;
      const dt = new Date(fixed.authorDate).getTime() - shippedTime;
      if (dt > windowMs) break;
      // Same author requirement — that's the "insider" part.
      if (`${fixed.authorName}|${fixed.authorEmail}` !== shippedAuthor) continue;
      // Must look like a fix.
      if (!FIX_RE.test(fixed.subject)) continue;
      // Must touch a shared file.
      const shared = (fixed.files ?? []).find((f) => shippedFiles.has(f));
      if (!shared) continue;

      allPatterns.push({
        shipped,
        fixed,
        daysToFix: Number((dt / 86_400_000).toFixed(1)),
        sharedFile: shared,
      });
      break; // one pattern per shipped commit
    }
  }

  // Step 2: aggregate by author.
  type Bucket = {
    authorName: string;
    authorEmail: string;
    patterns: InsiderPattern[];
    files: Set<string>;
  };
  const byAuthor = new Map<string, Bucket>();
  for (const p of allPatterns) {
    const key = `${p.shipped.authorName}|${p.shipped.authorEmail}`;
    if (!byAuthor.has(key)) {
      byAuthor.set(key, {
        authorName: p.shipped.authorName,
        authorEmail: p.shipped.authorEmail,
        patterns: [],
        files: new Set(),
      });
    }
    const b = byAuthor.get(key)!;
    b.patterns.push(p);
    b.files.add(p.sharedFile);
  }

  // Step 3: build per-author profiles + pairing suggestions.
  const profiles: InsiderProfile[] = [];
  for (const b of byAuthor.values()) {
    if (b.patterns.length < minPatterns) continue;
    const tier = classifyInsiderTier(b.patterns.length);
    const pairSuggestion = findPairPartner(commits, b.authorName, [...b.files]);
    // Aggregate touches across each pattern's shipped + fixed commits to
    // surface the file(s) the author keeps cycling on.
    const fileCounts = new Map<string, number>();
    for (const p of b.patterns) {
      for (const f of [...(p.shipped.files ?? []), ...(p.fixed.files ?? [])]) {
        if (isNoiseFile(f)) continue;
        fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1);
      }
    }
    const hotFiles = [...fileCounts.entries()]
      .map(([path, count]) => ({ path, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    profiles.push({
      authorName: b.authorName,
      authorEmail: b.authorEmail,
      patternCount: b.patterns.length,
      affectedFiles: [...b.files],
      samples: b.patterns.slice(0, 3),
      tier,
      pairSuggestion,
      hotFiles,
    });
  }

  profiles.sort((a, b) => b.patternCount - a.patternCount);
  return profiles.slice(0, topN);
}

export function classifyInsiderTier(count: number): InsiderProfile["tier"] {
  if (count >= 5) return "high-pattern";
  if (count >= 3) return "elevated";
  if (count >= 2) return "watch";
  return "low";
}

/**
 * Find a pairing partner — the author who has touched the same files
 * with ZERO insider patterns themselves. Returns the first match.
 */
function findPairPartner(commits: Commit[], avoidAuthor: string, files: string[]): string | undefined {
  if (files.length === 0) return undefined;
  const fileSet = new Set(files);
  // Count touches per author on the affected files.
  const otherAuthors = new Map<string, number>();
  for (const c of commits) {
    if (c.authorName === avoidAuthor) continue;
    if (!c.files?.some((f) => fileSet.has(f))) continue;
    otherAuthors.set(c.authorName, (otherAuthors.get(c.authorName) ?? 0) + 1);
  }
  if (otherAuthors.size === 0) return undefined;
  // Pick the most active OTHER author.
  return [...otherAuthors.entries()].sort((a, b) => b[1] - a[1])[0]![0];
}
