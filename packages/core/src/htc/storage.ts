/**
 * HTC storage — read/write helpers for the three Hierarchical Token Cache
 * tables (htc_abstracts, htc_clusters, htc_memoir).
 *
 * Pure SQLite wrappers; no LLM calls happen here. The generators in
 * abstract.ts / clusters.ts / memoir.ts produce the typed results, and this
 * module persists + reads them.
 */
import type { MnemeStore } from "../store/sqlite.js";
import type {
  AbstractResult,
  ClusterSummary,
  HtcStats,
  Memoir,
} from "./types.js";
import { estimateTokens } from "./types.js";

/* ───────────────────────  Layer 1 — abstracts  ─────────────────────── */

export function upsertAbstract(store: MnemeStore, a: AbstractResult): void {
  const generatedAt = a.generatedAt ?? new Date().toISOString();
  store.db
    .prepare(
      `INSERT OR REPLACE INTO htc_abstracts
         (commit_hash, abstract, token_count, generated_at, generator, generation_ms)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(a.hash, a.abstract, a.tokenCount, generatedAt, a.generator, a.generationMs);
}

export function upsertAbstracts(store: MnemeStore, batch: AbstractResult[]): void {
  if (batch.length === 0) return;
  const stmt = store.db.prepare(
    `INSERT OR REPLACE INTO htc_abstracts
       (commit_hash, abstract, token_count, generated_at, generator, generation_ms)
     VALUES (?, ?, ?, ?, ?, ?)`,
  );
  const tx = store.db.transaction((items: AbstractResult[]) => {
    for (const a of items) {
      const generatedAt = a.generatedAt ?? new Date().toISOString();
      stmt.run(a.hash, a.abstract, a.tokenCount, generatedAt, a.generator, a.generationMs);
    }
  });
  tx(batch);
}

export function getAbstract(store: MnemeStore, hash: string): AbstractResult | null {
  const row = store.db
    .prepare(
      `SELECT commit_hash, abstract, token_count, generated_at, generator, generation_ms
       FROM htc_abstracts WHERE commit_hash = ?`,
    )
    .get(hash) as
    | {
        commit_hash: string;
        abstract: string;
        token_count: number;
        generated_at: string;
        generator: string;
        generation_ms: number;
      }
    | undefined;
  if (!row) return null;
  return {
    hash: row.commit_hash,
    abstract: row.abstract,
    tokenCount: row.token_count,
    generatedAt: row.generated_at,
    generator: row.generator,
    generationMs: row.generation_ms,
  };
}

export function getAllAbstracts(store: MnemeStore): Map<string, AbstractResult> {
  const rows = store.db
    .prepare(
      `SELECT commit_hash, abstract, token_count, generated_at, generator, generation_ms
       FROM htc_abstracts`,
    )
    .all() as Array<{
    commit_hash: string;
    abstract: string;
    token_count: number;
    generated_at: string;
    generator: string;
    generation_ms: number;
  }>;
  const out = new Map<string, AbstractResult>();
  for (const r of rows) {
    out.set(r.commit_hash, {
      hash: r.commit_hash,
      abstract: r.abstract,
      tokenCount: r.token_count,
      generatedAt: r.generated_at,
      generator: r.generator,
      generationMs: r.generation_ms,
    });
  }
  return out;
}

/** Delete abstracts older than N days. Returns deleted row count. */
export function deleteOldAbstracts(store: MnemeStore, olderThanDays: number): number {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString();
  const info = store.db
    .prepare("DELETE FROM htc_abstracts WHERE generated_at < ?")
    .run(cutoff);
  return info.changes;
}

/* ───────────────────────  Layer 2 — clusters  ──────────────────────── */

export function upsertClusterSummary(store: MnemeStore, c: ClusterSummary): void {
  const generatedAt = c.generatedAt ?? new Date().toISOString();
  store.db
    .prepare(
      `INSERT OR REPLACE INTO htc_clusters
         (cluster_id, label, summary, member_hashes, token_count, generated_at, generator)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      c.clusterId,
      c.label,
      c.summary,
      JSON.stringify(c.memberHashes),
      c.tokenCount,
      generatedAt,
      c.generator,
    );
}

export function getAllClusterSummaries(store: MnemeStore): ClusterSummary[] {
  const rows = store.db
    .prepare(
      `SELECT cluster_id, label, summary, member_hashes, token_count, generated_at, generator
       FROM htc_clusters
       ORDER BY generated_at ASC`,
    )
    .all() as Array<{
    cluster_id: string;
    label: string;
    summary: string;
    member_hashes: string;
    token_count: number;
    generated_at: string;
    generator: string;
  }>;
  return rows.map((r) => ({
    clusterId: r.cluster_id,
    label: r.label,
    summary: r.summary,
    memberHashes: safeJsonArray(r.member_hashes),
    tokenCount: r.token_count,
    generatedAt: r.generated_at,
    generator: r.generator,
    // generationMs is per-call telemetry — not persisted (write-only at gen time).
    generationMs: 0,
  }));
}

/* ───────────────────────  Layer 3 — memoir  ────────────────────────── */

export function upsertMemoir(store: MnemeStore, m: Memoir): void {
  const generatedAt = m.generatedAt ?? new Date().toISOString();
  store.db
    .prepare(
      `INSERT OR REPLACE INTO htc_memoir
         (id, narrative, total_commits, total_clusters, token_count, generated_at, generator)
       VALUES (1, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      m.narrative,
      m.totalCommits,
      m.totalClusters,
      m.tokenCount,
      generatedAt,
      m.generator,
    );
}

export function getMemoir(store: MnemeStore): Memoir | null {
  const row = store.db
    .prepare(
      `SELECT narrative, total_commits, total_clusters, token_count, generated_at, generator
       FROM htc_memoir WHERE id = 1`,
    )
    .get() as
    | {
        narrative: string;
        total_commits: number;
        total_clusters: number;
        token_count: number;
        generated_at: string;
        generator: string;
      }
    | undefined;
  if (!row) return null;
  return {
    narrative: row.narrative,
    totalCommits: row.total_commits,
    totalClusters: row.total_clusters,
    tokenCount: row.token_count,
    generatedAt: row.generated_at,
    generator: row.generator,
    generationMs: 0,
  };
}

/* ───────────────────────  Stats  ───────────────────────────────────── */

export function getHtcStats(store: MnemeStore): HtcStats {
  const totalCommits = (
    store.db.prepare("SELECT COUNT(*) AS n FROM commits").get() as { n: number }
  ).n;

  const absRow = store.db
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(token_count), 0) AS tok FROM htc_abstracts",
    )
    .get() as { n: number; tok: number };

  const clusterRow = store.db
    .prepare(
      "SELECT COUNT(*) AS n, COALESCE(SUM(token_count), 0) AS tok FROM htc_clusters",
    )
    .get() as { n: number; tok: number };

  const memoirRow = store.db
    .prepare(
      "SELECT token_count, generated_at FROM htc_memoir WHERE id = 1",
    )
    .get() as { token_count: number; generated_at: string } | undefined;

  // Estimate raw token cost: subject + body for every commit.
  const rawRow = store.db
    .prepare(
      "SELECT COALESCE(SUM(LENGTH(subject) + LENGTH(body)), 0) AS chars FROM commits",
    )
    .get() as { chars: number };
  // Rough chars→tokens conversion: ~4 chars per token.
  const estimatedRawTokens = Math.ceil(rawRow.chars / 4);

  const totalCachedTokens =
    Number(absRow.tok) + Number(clusterRow.tok) + Number(memoirRow?.token_count ?? 0);

  const memoirGenerated = !!memoirRow;
  let memoirAgeDays: number | undefined;
  if (memoirRow) {
    const ageMs = Date.now() - new Date(memoirRow.generated_at).getTime();
    memoirAgeDays = Math.max(0, Math.floor(ageMs / (24 * 60 * 60 * 1000)));
  }

  const compressionRatio =
    totalCachedTokens > 0 ? Number((estimatedRawTokens / totalCachedTokens).toFixed(2)) : 0;

  return {
    totalCommits,
    abstractsGenerated: absRow.n,
    abstractsCoverage: totalCommits === 0 ? 0 : Number((absRow.n / totalCommits).toFixed(4)),
    clustersGenerated: clusterRow.n,
    memoirGenerated,
    memoirAgeDays,
    totalCachedTokens,
    estimatedRawTokens,
    compressionRatio,
  };
}

/* ───────────────────────  internals  ───────────────────────────────── */

function safeJsonArray(s: string): string[] {
  try {
    const v = JSON.parse(s);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

// Re-export estimateTokens so callers don't need a second import.
export { estimateTokens };
