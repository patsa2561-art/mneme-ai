/**
 * `mneme black-swan` — find rare-but-catastrophic file patterns.
 *
 * Inspired by Taleb: real risk lives in the tail. Files touched rarely
 * but tied to high-severity incidents are far more dangerous than
 * frequently-touched files with proportional bug counts.
 *
 *   tail_risk = log(avg_severity + 1) × (1 / max(touch_frequency, 1))
 *
 * Files surface ranked by tail_risk — the silent assassins that look
 * stable but explode when touched.
 *
 * Pure store-backed analysis. No LLM.
 */

import type { MnemeStore } from "../store/sqlite.js";

export interface BlackSwanCandidate {
  filePath: string;
  /** Total commits that ever touched this file. */
  touchCount: number;
  /** Days since the last touch. */
  daysSinceTouch: number;
  /** Number of incidents associated with this file. */
  incidentCount: number;
  /** Mean severity (1=low, 5=critical). */
  avgSeverity: number;
  /** Tail-risk score — see formula above. */
  tailRisk: number;
  /** Tier label for output. */
  tier: "deceptive-calm" | "elevated" | "watch" | "background";
  /** A 1-line operational recommendation. */
  recommendation: string;
}

const SEVERITY_RANK: Record<string, number> = {
  critical: 5,
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};

/**
 * Walk every indexed file, compute touch frequency + linked-incident
 * severity, and rank by tail risk. Conservative defaults: files with
 * < incidents are skipped (no tail without trouble).
 */
export function findBlackSwans(
  store: MnemeStore,
  opts: { topN?: number; minIncidents?: number; maxTouches?: number; now?: Date } = {},
): BlackSwanCandidate[] {
  const topN = opts.topN ?? 10;
  const minIncidents = opts.minIncidents ?? 1;
  const maxTouches = opts.maxTouches ?? 30;
  const now = opts.now ?? new Date();

  // Pull file → (touch count, last touch).
  const fileRows = store.db
    .prepare(
      `SELECT
         fc.path                      AS path,
         COUNT(*)                     AS touches,
         MAX(c.author_date)           AS last_touch
       FROM file_changes fc
       JOIN commits c ON c.hash = fc.commit_hash
       GROUP BY fc.path
       HAVING touches <= ?`,
    )
    .all(maxTouches) as Array<{ path: string; touches: number; last_touch: string }>;

  // Pull file → incidents (parsed from incidents.affected_files).
  const incidentRows = store.db
    .prepare(`SELECT severity, affected_files FROM incidents`)
    .all() as Array<{ severity: string; affected_files: string | null }>;

  // Build file → { incidentCount, severities[] }
  const incidentsByFile = new Map<string, number[]>();
  for (const r of incidentRows) {
    if (!r.affected_files) continue;
    let files: string[] = [];
    try {
      const parsed = JSON.parse(r.affected_files);
      if (Array.isArray(parsed)) files = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      // Fallback: comma-separated paths
      files = r.affected_files.split(",").map((s) => s.trim()).filter(Boolean);
    }
    const sev = SEVERITY_RANK[r.severity?.toLowerCase()] ?? 3;
    for (const f of files) {
      if (!incidentsByFile.has(f)) incidentsByFile.set(f, []);
      incidentsByFile.get(f)!.push(sev);
    }
  }

  const candidates: BlackSwanCandidate[] = [];
  for (const r of fileRows) {
    const sevs = incidentsByFile.get(r.path) ?? [];
    if (sevs.length < minIncidents) continue;
    const avgSeverity = sevs.reduce((s, x) => s + x, 0) / sevs.length;
    const daysSinceTouch = (now.getTime() - new Date(r.last_touch).getTime()) / 86_400_000;
    const tailRisk = Math.log(avgSeverity + 1) * (1 / Math.max(r.touches, 1));
    candidates.push({
      filePath: r.path,
      touchCount: r.touches,
      daysSinceTouch: Math.round(daysSinceTouch),
      incidentCount: sevs.length,
      avgSeverity: Math.round(avgSeverity * 10) / 10,
      tailRisk,
      tier: classifyBlackSwanTier(tailRisk, r.touches, avgSeverity),
      recommendation: buildBlackSwanRecommendation(r.touches, avgSeverity, daysSinceTouch),
    });
  }

  candidates.sort((a, b) => b.tailRisk - a.tailRisk);
  return candidates.slice(0, topN);
}

export function classifyBlackSwanTier(
  tailRisk: number,
  touches: number,
  avgSeverity: number,
): BlackSwanCandidate["tier"] {
  if (tailRisk >= 0.8 && touches <= 3 && avgSeverity >= 4) return "deceptive-calm";
  if (tailRisk >= 0.5 && avgSeverity >= 3) return "elevated";
  if (tailRisk >= 0.2) return "watch";
  return "background";
}

function buildBlackSwanRecommendation(
  touches: number,
  avgSeverity: number,
  daysSinceTouch: number,
): string {
  if (touches <= 2 && avgSeverity >= 4) {
    return "Mandatory pair-program + canary deploy. This file LOOKS stable but its track record is catastrophic.";
  }
  if (avgSeverity >= 4) {
    return "Code-freeze without 2 reviewers + load test required. High tail risk on edits.";
  }
  if (daysSinceTouch > 365) {
    return "Untouched for 1+ year. Schedule a review session before the next change.";
  }
  return "Monitor closely. Run mneme blast on any commit that touches this file.";
}
