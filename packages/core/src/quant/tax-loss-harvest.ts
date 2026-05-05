/**
 * `mneme tax-loss-harvest` — find dead code that can be deleted to "offset"
 * technical debt.
 *
 * The metaphor: in finance, you sell losing positions to harvest tax losses,
 * which offset gains elsewhere. In a codebase, deleting dead code reduces
 * cognitive surface area, freeing up budget to absorb new debt elsewhere.
 *
 * Scoring per file:
 *   • staleness         — days since last touch
 *   • commit count      — fewer commits = less load-bearing
 *   • entity references — files with no entities or no inbound refs
 *   • risk if deleted   — files with incidents historically = higher risk
 *
 *   harvest_score = staleness × (1 / max(commits, 1)) × (1 - risk)
 *
 * Pure data analysis. No LLM. Output is a candidate list with risk gauges.
 */

import type { MnemeStore } from "../store/sqlite.js";

export interface HarvestCandidate {
  filePath: string;
  /** Days since last commit. */
  daysSinceTouch: number;
  /** Total commits ever touching this file. */
  commitCount: number;
  /** Number of entities (functions/classes) parsed from this file. 0 = likely dead. */
  entityCount: number;
  /** Number of past incidents that mentioned this file. */
  incidentCount: number;
  /** Composite harvest score — higher = better deletion candidate. */
  harvestScore: number;
  /** Risk tier of deletion. */
  risk: "safe" | "low-risk" | "moderate" | "risky";
  /** A 1-line action recommendation. */
  recommendation: string;
}

export interface HarvestOptions {
  /** Minimum days since last touch to consider. Default 180. */
  minStaleDays?: number;
  /** Maximum total commits to consider. Default 5 (low-load). */
  maxCommits?: number;
  /** Top-N candidates. */
  topN?: number;
  /** Override "now" for deterministic tests. */
  now?: Date;
}

export function findHarvestCandidates(
  store: MnemeStore,
  opts: HarvestOptions = {},
): HarvestCandidate[] {
  const minStale = opts.minStaleDays ?? 180;
  const maxCommits = opts.maxCommits ?? 5;
  const topN = opts.topN ?? 20;
  const now = opts.now ?? new Date();

  // 1. Per-file commit count + last touch.
  const fileRows = store.db
    .prepare(
      `SELECT
         fc.path                AS path,
         COUNT(*)               AS commits,
         MAX(c.author_date)     AS last_touch
       FROM file_changes fc
       JOIN commits c ON c.hash = fc.commit_hash
       GROUP BY fc.path`,
    )
    .all() as Array<{ path: string; commits: number; last_touch: string }>;

  // 2. Entity count per file.
  const entityRows = store.db
    .prepare(`SELECT file_path, COUNT(*) AS n FROM entities GROUP BY file_path`)
    .all() as Array<{ file_path: string; n: number }>;
  const entityCountByFile = new Map(entityRows.map((r) => [r.file_path, r.n]));

  // 3. Incident-affected files (best-effort).
  const incidentRows = store.db
    .prepare(`SELECT affected_files FROM incidents`)
    .all() as Array<{ affected_files: string | null }>;
  const incidentCountByFile = new Map<string, number>();
  for (const r of incidentRows) {
    if (!r.affected_files) continue;
    let files: string[] = [];
    try {
      const parsed = JSON.parse(r.affected_files);
      if (Array.isArray(parsed)) files = parsed.filter((x): x is string => typeof x === "string");
    } catch {
      files = r.affected_files.split(",").map((s) => s.trim()).filter(Boolean);
    }
    for (const f of files) incidentCountByFile.set(f, (incidentCountByFile.get(f) ?? 0) + 1);
  }

  // 4. Score each candidate.
  const candidates: HarvestCandidate[] = [];
  for (const r of fileRows) {
    const days = (now.getTime() - new Date(r.last_touch).getTime()) / 86_400_000;
    if (days < minStale) continue;
    if (r.commits > maxCommits) continue;

    const entities = entityCountByFile.get(r.path) ?? 0;
    const incidents = incidentCountByFile.get(r.path) ?? 0;

    // Risk: incident history makes deletion riskier.
    const risk = Math.min(1, incidents / 5);
    const harvestScore = (days / 365) * (1 / Math.max(r.commits, 1)) * (1 - risk);

    candidates.push({
      filePath: r.path,
      daysSinceTouch: Math.round(days),
      commitCount: r.commits,
      entityCount: entities,
      incidentCount: incidents,
      harvestScore: Math.round(harvestScore * 1000) / 1000,
      risk: classifyHarvestRisk(incidents, entities, r.commits),
      recommendation: buildHarvestRecommendation(days, entities, incidents),
    });
  }

  candidates.sort((a, b) => b.harvestScore - a.harvestScore);
  return candidates.slice(0, topN);
}

export function classifyHarvestRisk(
  incidents: number,
  entities: number,
  commits: number,
): HarvestCandidate["risk"] {
  if (incidents >= 3) return "risky";
  if (incidents >= 1 || entities >= 10) return "moderate";
  if (commits >= 4) return "low-risk";
  return "safe";
}

function buildHarvestRecommendation(days: number, entities: number, incidents: number): string {
  if (incidents >= 3) {
    return "Risky to delete — past incidents associated with this file. Inspect manually.";
  }
  if (entities === 0 && days > 365) {
    return "Likely safe to delete — no entities parsed and untouched for over a year.";
  }
  if (entities === 0) {
    return "Probably dead — no entities. Verify no runtime imports before deleting.";
  }
  if (days > 730) {
    return "Untouched for 2+ years. Strong candidate, but check downstream usage first.";
  }
  return "Stale candidate. Run static analysis to confirm no inbound references.";
}

export interface HarvestSummary {
  candidateCount: number;
  /** Sum of (lines saved if all deleted) — best-effort approximation. */
  estimatedLinesSaved: number;
  /** Net risk-adjusted savings — savings × (1 - avg risk). */
  netSavings: number;
  /** A 1-line summary. */
  summary: string;
}

export function summarizeHarvest(candidates: HarvestCandidate[]): HarvestSummary {
  if (candidates.length === 0) {
    return { candidateCount: 0, estimatedLinesSaved: 0, netSavings: 0, summary: "No harvestable candidates." };
  }
  // Approximate 50 LOC per file as a rough heuristic — refine by reading file size if needed.
  const linesPerFile = 50;
  const estLines = candidates.length * linesPerFile;
  const avgRisk = candidates.reduce((s, c) => s + (c.risk === "risky" ? 1 : c.risk === "moderate" ? 0.5 : 0.1), 0) / candidates.length;
  const netSavings = Math.round(estLines * (1 - avgRisk));
  return {
    candidateCount: candidates.length,
    estimatedLinesSaved: estLines,
    netSavings,
    summary: `${candidates.length} harvestable files — ~${estLines} LOC potential, ~${netSavings} net of risk.`,
  };
}
