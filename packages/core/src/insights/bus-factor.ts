/**
 * `mneme bus-factor` — surface single-source-of-truth knowledge holders.
 *
 * For each indexed file: compute author distribution. Files where one
 * author owns >75% of commits AND the file is touched frequently are
 * "fragile knowledge zones" — if that person leaves, the knowledge dies.
 *
 * This is different from `who-knows`:
 *   - `who-knows`  → "who knows about X?"   (answer + backup)
 *   - `bus-factor` → "what knowledge is fragile?"  (per-file ownership risk)
 *
 * Output ranks by criticality = ownerShare × log(touchCount). High-touch
 * solo-owned files are the highest risk. Concrete pairing recommendations
 * are attached when a backup author exists.
 */

import type { MnemeStore } from "../store/sqlite.js";

export interface FileRisk {
  filePath: string;
  /** Total commits that touched this file. */
  totalTouches: number;
  /** Top owner — name + email + share. */
  topOwner: { name: string; email: string; touches: number; sharePct: number; lastTouch: string };
  /** Closest second-place author (for pair recommendation). Undefined if solo-only. */
  backup?: { name: string; email: string; touches: number; lastTouch: string };
  /**
   * Risk tier from criticality score:
   *   critical: ownerShare ≥ 0.85 AND touches ≥ 10
   *   high:     ownerShare ≥ 0.75 AND touches ≥ 5
   *   medium:   ownerShare ≥ 0.6  AND touches ≥ 3
   *   low:      everything else (still surfaced when solo-touched)
   */
  tier: "critical" | "high" | "medium" | "low";
  /** Numeric criticality — for sorting. */
  score: number;
  /** A 1-line lesson/recommendation. */
  recommendation: string;
}

export interface BusFactorOptions {
  /** Skip files that match these glob-like fragments. Defaults to lockfiles, generated dirs. */
  excludePatterns?: string[];
  /** Minimum touches for a file to be considered. Below this we don't have enough signal. */
  minTouches?: number;
  /** Cap on results returned. */
  topN?: number;
}

const DEFAULT_EXCLUDES = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "node_modules/",
  "dist/",
  ".min.js",
  ".min.css",
  "/generated/",
];

export function busFactor(store: MnemeStore, opts: BusFactorOptions = {}): FileRisk[] {
  const minTouches = opts.minTouches ?? 3;
  const excludes = opts.excludePatterns ?? DEFAULT_EXCLUDES;
  const topN = opts.topN ?? 20;

  // Aggregate per-file author counts via JOIN of file_changes + commits.
  const rows = store.db
    .prepare(
      `SELECT
         fc.path                                       AS path,
         c.author_name                                 AS author_name,
         c.author_email                                AS author_email,
         COUNT(*)                                      AS touches,
         MAX(c.author_date)                            AS last_touch
       FROM file_changes fc
       JOIN commits c ON c.hash = fc.commit_hash
       GROUP BY fc.path, c.author_name, c.author_email
       ORDER BY fc.path, touches DESC`,
    )
    .all() as Array<{
    path: string;
    author_name: string;
    author_email: string;
    touches: number;
    last_touch: string;
  }>;

  // Group by file.
  type Bucket = {
    filePath: string;
    authors: Array<{ name: string; email: string; touches: number; lastTouch: string }>;
    totalTouches: number;
  };
  const byFile = new Map<string, Bucket>();
  for (const r of rows) {
    if (excludes.some((p) => r.path.includes(p))) continue;
    if (!byFile.has(r.path)) byFile.set(r.path, { filePath: r.path, authors: [], totalTouches: 0 });
    const b = byFile.get(r.path)!;
    b.authors.push({ name: r.author_name, email: r.author_email, touches: r.touches, lastTouch: r.last_touch });
    b.totalTouches += r.touches;
  }

  const risks: FileRisk[] = [];
  for (const b of byFile.values()) {
    if (b.totalTouches < minTouches) continue;
    b.authors.sort((a, c) => c.touches - a.touches);
    const top = b.authors[0]!;
    const sharePct = Math.round((top.touches / b.totalTouches) * 100);
    const share = top.touches / b.totalTouches;
    const score = share * Math.log2(b.totalTouches + 1);

    const { tier, recommendation } = classifyRisk(share, b.totalTouches, b.authors);
    risks.push({
      filePath: b.filePath,
      totalTouches: b.totalTouches,
      topOwner: {
        name: top.name,
        email: top.email,
        touches: top.touches,
        sharePct,
        lastTouch: top.lastTouch,
      },
      backup: b.authors[1]
        ? {
            name: b.authors[1]!.name,
            email: b.authors[1]!.email,
            touches: b.authors[1]!.touches,
            lastTouch: b.authors[1]!.lastTouch,
          }
        : undefined,
      tier,
      score,
      recommendation,
    });
  }

  risks.sort((a, b) => b.score - a.score);
  return risks.slice(0, topN);
}

function classifyRisk(
  share: number,
  touches: number,
  authors: Array<{ name: string }>,
): { tier: FileRisk["tier"]; recommendation: string } {
  if (share >= 0.85 && touches >= 10) {
    return {
      tier: "critical",
      recommendation:
        authors.length > 1
          ? `Pair with ${authors[1]!.name} this sprint — they are the only backup signal in history.`
          : "Find a pairing partner before this person leaves. No backup currently exists.",
    };
  }
  if (share >= 0.75 && touches >= 5) {
    return {
      tier: "high",
      recommendation:
        authors.length > 1
          ? `Encourage ${authors[1]!.name} to pick up small changes here to spread the knowledge.`
          : "Solo-owned. Pair-program the next change to spread context.",
    };
  }
  if (share >= 0.6 && touches >= 3) {
    return {
      tier: "medium",
      recommendation: "Knowledge is concentrated but not critical. Watch for owner departure.",
    };
  }
  return {
    tier: "low",
    recommendation: "Knowledge is reasonably distributed.",
  };
}
