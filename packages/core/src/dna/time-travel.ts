/**
 * A5 — Time-Travel Search.
 *
 * Standard search hits HEAD only. Time-Travel searches every historical
 * snapshot (compressed via delta encoding) and ranks results across the
 * time axis using F6 (TPS) for "age resonance."
 *
 * Use cases:
 *   • "Where did we used to handle Stripe pricing before the v2 refactor?"
 *   • "Show me when this regex first appeared in the codebase"
 *   • "Was there ever a version of this function that did X?"
 *
 * Pure function. Operates on pre-computed snapshot summaries (caller
 * builds the index using git log + content-defined chunking).
 */

import { tps } from "./formulas.js";

export interface SnapshotMatch {
  /** Commit hash where the match was observed. */
  commitHash: string;
  /** ISO timestamp of the commit. */
  timestamp: string;
  /** File path at this snapshot. */
  path: string;
  /** Line number at this snapshot. */
  line: number;
  /** Snippet content for display. */
  snippet: string;
  /** Match relevance from upstream search (0..1). */
  baseRelevance: number;
  /** Days from this commit to the present (precomputed). */
  ageDays: number;
}

export interface TimeTravelInput {
  /** Pre-collected matches across all relevant snapshots. */
  matches: SnapshotMatch[];
  /** Days from the user's query intent (e.g. "last week" = 7). */
  queryAgeDays: number;
  /** TPS sigma — width of the resonance bell (default 1.5). */
  sigma?: number;
  /** Top-K results returned. Default 20. */
  topK?: number;
}

export interface TimeTravelResult {
  commitHash: string;
  timestamp: string;
  path: string;
  line: number;
  snippet: string;
  /** Relevance × time-phase score. */
  finalScore: number;
  /** Pure F6 TPS factor (for transparency). */
  phaseScore: number;
  /** Original baseRelevance (for transparency). */
  baseRelevance: number;
}

/**
 * Rank historical matches by combined relevance × time-phase resonance.
 * Returns top-K, deterministically ordered (score desc, commit asc).
 */
export function timeTravelSearch(input: TimeTravelInput): TimeTravelResult[] {
  const topK = Math.max(1, input.topK ?? 20);
  const out: TimeTravelResult[] = [];
  for (const m of input.matches) {
    const phased = tps({
      baseRelevance: m.baseRelevance,
      fileAgeDays: m.ageDays,
      queryAgeDays: input.queryAgeDays,
      sigma: input.sigma,
    });
    const phaseFactor = m.baseRelevance === 0 ? 0 : phased / m.baseRelevance;
    out.push({
      commitHash: m.commitHash,
      timestamp: m.timestamp,
      path: m.path,
      line: m.line,
      snippet: m.snippet,
      finalScore: phased,
      phaseScore: phaseFactor,
      baseRelevance: m.baseRelevance,
    });
  }
  out.sort(
    (a, b) =>
      b.finalScore - a.finalScore ||
      a.commitHash.localeCompare(b.commitHash) ||
      a.line - b.line,
  );
  return out.slice(0, topK);
}

/**
 * Group time-travel results by file path → list of (commit, snippet, score).
 * Useful for showing the AI agent "this file's evolution":
 *
 *   src/auth.ts:
 *     - 2024-01-15 commit a3f9b21 (score 0.91): used JWT
 *     - 2024-08-03 commit b1c8d4e (score 0.85): switched to opaque tokens
 *     - 2025-02-20 commit c9d4e5f (score 0.65): split into auth-v2 module
 */
export function groupByPath(results: TimeTravelResult[]): Map<string, TimeTravelResult[]> {
  const m = new Map<string, TimeTravelResult[]>();
  for (const r of results) {
    if (!m.has(r.path)) m.set(r.path, []);
    m.get(r.path)!.push(r);
  }
  // Sort each group by timestamp ASC (oldest first → tells a story)
  for (const arr of m.values()) {
    arr.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }
  return m;
}
