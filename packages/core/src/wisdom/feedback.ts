/**
 * Feedback collector — every `mneme ask` writes one row.
 *
 * was_helpful starts NULL and is filled by:
 *   - explicit:        `mneme feedback <id> up|down`
 *   - implicit-revisit: the user ran `mneme why <commit>` on a returned commit
 *                       within 5 minutes — strong positive signal.
 *   - implicit-reuse:   the user did not re-ask a slightly-different version of
 *                       the same query within 60s — weak positive signal.
 *
 * Why these heuristics: they require zero UX work from the user. The
 * explicit path exists for power users; the implicit paths cover the 95%.
 */

import { randomUUID } from "node:crypto";
import type { MnemeStore } from "../store/sqlite.js";
import type { FeedbackRow } from "./types.js";

export interface RecordFeedbackInput {
  query: string;
  resultHashes: string[];
  topScore?: number;
  semanticWeight?: number;
  minSemCosine?: number;
  rrfK?: number;
}

/** Insert a pending feedback row. Returns the id so callers can update it later. */
export function recordQuery(store: MnemeStore, input: RecordFeedbackInput): string {
  const id = randomUUID();
  const now = new Date().toISOString();
  store.db
    .prepare(
      `INSERT INTO wisdom_feedback
       (id, query, result_hashes, top_score, was_helpful, source,
        semantic_weight, min_sem_cosine, rrf_k, created_at)
       VALUES (?, ?, ?, ?, NULL, 'pending', ?, ?, ?, ?)`,
    )
    .run(
      id,
      input.query,
      JSON.stringify(input.resultHashes),
      input.topScore ?? null,
      input.semanticWeight ?? null,
      input.minSemCosine ?? null,
      input.rrfK ?? null,
      now,
    );
  return id;
}

/** Set was_helpful for a feedback row. */
export function setHelpful(
  store: MnemeStore,
  id: string,
  wasHelpful: boolean,
  source: FeedbackRow["source"] = "explicit",
): boolean {
  const result = store.db
    .prepare(`UPDATE wisdom_feedback SET was_helpful = ?, source = ? WHERE id = ?`)
    .run(wasHelpful ? 1 : 0, source, id);
  // node:sqlite types `.changes` as `number | bigint`; coerce for the
  // boolean comparison so TS doesn't trip on the bigint branch.
  return Number(result.changes) > 0;
}

/**
 * Implicit positive signal: the user looked at one of the returned commits
 * via `mneme why`. We mark the most recent matching pending row as helpful.
 */
export function recordImplicitRevisit(store: MnemeStore, commitHash: string): number {
  const recent = store.db
    .prepare(
      `SELECT id, result_hashes FROM wisdom_feedback
       WHERE was_helpful IS NULL
         AND created_at >= datetime('now', '-5 minutes')
       ORDER BY created_at DESC
       LIMIT 20`,
    )
    .all() as Array<{ id: string; result_hashes: string }>;
  let updated = 0;
  for (const row of recent) {
    try {
      const hashes = JSON.parse(row.result_hashes) as string[];
      if (hashes.includes(commitHash)) {
        if (setHelpful(store, row.id, true, "implicit-revisit")) updated += 1;
      }
    } catch {
      // ignore corrupt JSON; the row is just an inert breadcrumb in that case
    }
  }
  return updated;
}

export function listFeedback(store: MnemeStore, opts: { since?: string; limit?: number } = {}): FeedbackRow[] {
  const where: string[] = [];
  const params: Array<string | number | null> = [];
  if (opts.since) {
    where.push("created_at >= ?");
    params.push(opts.since);
  }
  const sql = `
    SELECT id, query, result_hashes, top_score, was_helpful, source,
           semantic_weight, min_sem_cosine, rrf_k, created_at
    FROM wisdom_feedback
    ${where.length ? "WHERE " + where.join(" AND ") : ""}
    ORDER BY created_at DESC
    LIMIT ?
  `;
  params.push(opts.limit ?? 1000);
  const rows = store.db.prepare(sql).all(...params) as Array<{
    id: string;
    query: string;
    result_hashes: string;
    top_score: number | null;
    was_helpful: number | null;
    source: FeedbackRow["source"];
    semantic_weight: number | null;
    min_sem_cosine: number | null;
    rrf_k: number | null;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    query: r.query,
    resultHashes: JSON.parse(r.result_hashes) as string[],
    topScore: r.top_score ?? undefined,
    wasHelpful: r.was_helpful === 1 ? 1 : r.was_helpful === 0 ? 0 : undefined,
    source: r.source,
    semanticWeight: r.semantic_weight ?? undefined,
    minSemCosine: r.min_sem_cosine ?? undefined,
    rrfK: r.rrf_k ?? undefined,
    createdAt: r.created_at,
  }));
}

export interface FeedbackSummary {
  total: number;
  helpful: number;
  unhelpful: number;
  pending: number;
  hitRate: number;
}

export function summarizeFeedback(store: MnemeStore, since?: string): FeedbackSummary {
  const params: Array<string | number | null> = [];
  let where = "";
  if (since) {
    where = "WHERE created_at >= ?";
    params.push(since);
  }
  const row = store.db
    .prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN was_helpful = 1 THEN 1 ELSE 0 END) AS helpful,
         SUM(CASE WHEN was_helpful = 0 THEN 1 ELSE 0 END) AS unhelpful,
         SUM(CASE WHEN was_helpful IS NULL THEN 1 ELSE 0 END) AS pending
       FROM wisdom_feedback ${where}`,
    )
    .get(...params) as { total: number; helpful: number; unhelpful: number; pending: number };
  const decided = row.helpful + row.unhelpful;
  const hitRate = decided === 0 ? 0 : row.helpful / decided;
  return {
    total: row.total,
    helpful: row.helpful,
    unhelpful: row.unhelpful,
    pending: row.pending,
    hitRate,
  };
}
