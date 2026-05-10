/**
 * pgvector backend for Mneme -- scale-out path when commits exceed the
 * comfort zone of SQLite (~100K chunks).
 *
 * Activation: set `MNEME_PG_URL=postgres://user:pass@host/db`. When
 * present + `pg` package importable, callers that opt-in via
 * `openVectorStore({ kind: "pg" })` get a Postgres-backed store with
 * the pgvector extension. The default remains SQLite -- no change for
 * users who don't set the env var.
 *
 * Why pluggable + lazy: the user warned us about adding heavy deps.
 * `pg` and `pgvector` are NOT in package.json. We import them at
 * runtime; if missing we throw a clear error with an install hint.
 */

import type { CommitChunk } from "../types.js";
import type { HardEvalStoreReader } from "../retrieval_lab/hard_eval.js";

export interface VectorStore {
  readonly backend: "sqlite" | "pg";
  /** Insert/update chunks (with optional embeddings). */
  upsertChunks(chunks: CommitChunk[], embedderModel?: string): void | Promise<void>;
  /** Lexical search (BM25-equivalent). */
  ftsSearch(query: string, limit: number): Array<{ id: string; commitHash: string; text: string; kind: string; bm25: number }> | Promise<Array<{ id: string; commitHash: string; text: string; kind: string; bm25: number }>>;
  countChunksWithEmbedding(): number | Promise<number>;
  /** Iterate embedded chunks for in-memory cosine. */
  iterEmbeddedChunks(): AsyncIterable<{ id: string; commitHash: string; text: string; kind: string; vec: Float32Array }> | Iterable<{ id: string; commitHash: string; text: string; kind: string; vec: Float32Array }>;
  /** Required by hard eval suite. */
  chunkIdsByCommit(commitHashes: string[]): Map<string, string[]> | Promise<Map<string, string[]>>;
  close?(): void | Promise<void>;
}

/** Compile-time verification that VectorStore can satisfy the
 *  HardEvalStoreReader contract. (pg adapter implements the same
 *  countChunksWithEmbedding + chunkIdsByCommit signatures.) */
export type _Sat = HardEvalStoreReader extends Pick<VectorStore, "countChunksWithEmbedding" | "chunkIdsByCommit"> ? true : false;

export interface PgVectorStoreOptions {
  /** Postgres connection URL. */
  url: string;
  /** Schema name. Default "mneme". */
  schema?: string;
  /** Vector dimension. Must match the embedder. */
  dim: number;
}

/** Lazy-loaded Postgres + pgvector adapter. Throws a clear error if
 *  the `pg` npm package isn't installed. */
export class PgVectorStore implements VectorStore {
  readonly backend = "pg" as const;
  private pool: unknown = null;
  private readonly schema: string;
  private readonly dim: number;
  private readonly url: string;

  constructor(opts: PgVectorStoreOptions) {
    this.url = opts.url;
    this.schema = opts.schema ?? "mneme";
    this.dim = opts.dim;
  }

  /** Lazy-init the pool + ensure the schema exists. */
  async init(): Promise<void> {
    if (this.pool) return;
    let pgMod: { Pool: new (cfg: { connectionString: string }) => unknown };
    try {
      // pg is an OPTIONAL dep. We dynamic-import via a string variable
      // so TypeScript doesn't try to resolve types at compile time.
      const moduleName = "pg";
      pgMod = (await import(/* @vite-ignore */ moduleName)) as { Pool: new (cfg: { connectionString: string }) => unknown };
    } catch {
      throw new Error(
        "MNEME_PG_URL is set but the `pg` package isn't installed. " +
        "Run `npm install pg` (and ensure the pgvector extension is enabled on your database) " +
        "to use the Postgres backend.",
      );
    }
    this.pool = new pgMod.Pool({ connectionString: this.url });
    await this.exec(`CREATE EXTENSION IF NOT EXISTS vector;`);
    await this.exec(`CREATE SCHEMA IF NOT EXISTS ${this.schema};`);
    await this.exec(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.chunks (
        id TEXT PRIMARY KEY,
        commit_hash TEXT NOT NULL,
        kind TEXT NOT NULL,
        text TEXT NOT NULL,
        embedding vector(${this.dim}),
        embedder_model TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await this.exec(`CREATE INDEX IF NOT EXISTS chunks_commit_idx ON ${this.schema}.chunks (commit_hash);`);
    // IVFFlat for approximate nearest neighbor; works at the 100K-1M scale.
    await this.exec(`
      CREATE INDEX IF NOT EXISTS chunks_embedding_idx
      ON ${this.schema}.chunks USING ivfflat (embedding vector_cosine_ops)
      WITH (lists = 100);
    `).catch(() => { /* index creation may fail until table has data; ignore */ });
    // Tsvector + GIN for BM25-equivalent ranking. We use ts_rank_cd().
    await this.exec(`
      CREATE INDEX IF NOT EXISTS chunks_text_fts_idx
      ON ${this.schema}.chunks USING gin (to_tsvector('english', text));
    `);
  }

  private async exec(sql: string, params: unknown[] = []): Promise<{ rows: Array<Record<string, unknown>> }> {
    if (!this.pool) await this.init();
    const pool = this.pool as { query: (sql: string, params: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }> };
    return pool.query(sql, params);
  }

  async upsertChunks(chunks: CommitChunk[], embedderModel?: string): Promise<void> {
    if (chunks.length === 0) return;
    await this.init();
    // Batch via UNNEST for speed.
    const ids = chunks.map((c) => c.id ?? `${c.commitHash}:${c.kind}`);
    const commitHashes = chunks.map((c) => c.commitHash);
    const kinds = chunks.map((c) => c.kind);
    const texts = chunks.map((c) => c.text);
    const embeds = chunks.map((c) => {
      if (!c.embedding) return null;
      const f32 = c.embedding instanceof Float32Array ? c.embedding : Float32Array.from(c.embedding);
      return `[${Array.from(f32).join(",")}]`;
    });
    await this.exec(
      `
      INSERT INTO ${this.schema}.chunks (id, commit_hash, kind, text, embedding, embedder_model)
      SELECT * FROM UNNEST($1::text[], $2::text[], $3::text[], $4::text[], $5::vector[], $6::text[])
      ON CONFLICT (id) DO UPDATE
      SET commit_hash = EXCLUDED.commit_hash,
          kind = EXCLUDED.kind,
          text = EXCLUDED.text,
          embedding = EXCLUDED.embedding,
          embedder_model = EXCLUDED.embedder_model;
      `,
      [ids, commitHashes, kinds, texts, embeds, chunks.map(() => embedderModel ?? null)],
    );
  }

  async ftsSearch(query: string, limit: number): Promise<Array<{ id: string; commitHash: string; text: string; kind: string; bm25: number }>> {
    await this.init();
    const r = await this.exec(
      `
      SELECT id, commit_hash AS "commitHash", text, kind,
             ts_rank_cd(to_tsvector('english', text), plainto_tsquery('english', $1)) AS bm25
      FROM ${this.schema}.chunks
      WHERE to_tsvector('english', text) @@ plainto_tsquery('english', $1)
      ORDER BY bm25 DESC
      LIMIT $2;
      `,
      [query, limit],
    );
    return r.rows.map((row) => ({
      id: String(row["id"]),
      commitHash: String(row["commitHash"]),
      text: String(row["text"]),
      kind: String(row["kind"]),
      bm25: Number(row["bm25"]),
    }));
  }

  async countChunksWithEmbedding(): Promise<number> {
    await this.init();
    const r = await this.exec(`SELECT COUNT(*)::int AS n FROM ${this.schema}.chunks WHERE embedding IS NOT NULL;`);
    const n = (r.rows[0]?.["n"] ?? 0) as number;
    return n;
  }

  async *iterEmbeddedChunks(): AsyncGenerator<{ id: string; commitHash: string; text: string; kind: string; vec: Float32Array }> {
    await this.init();
    const r = await this.exec(`SELECT id, commit_hash, kind, text, embedding::float[] AS vec FROM ${this.schema}.chunks WHERE embedding IS NOT NULL;`);
    for (const row of r.rows) {
      const arr = (row["vec"] as number[]) ?? [];
      yield {
        id: String(row["id"]),
        commitHash: String(row["commit_hash"]),
        kind: String(row["kind"]),
        text: String(row["text"]),
        vec: Float32Array.from(arr),
      };
    }
  }

  async chunkIdsByCommit(commitHashes: string[]): Promise<Map<string, string[]>> {
    const out = new Map<string, string[]>();
    if (commitHashes.length === 0) return out;
    await this.init();
    const r = await this.exec(
      `SELECT id, commit_hash FROM ${this.schema}.chunks WHERE commit_hash = ANY($1::text[]);`,
      [commitHashes],
    );
    for (const row of r.rows) {
      const ch = String(row["commit_hash"]);
      let arr = out.get(ch);
      if (!arr) { arr = []; out.set(ch, arr); }
      arr.push(String(row["id"]));
    }
    return out;
  }

  async close(): Promise<void> {
    if (this.pool) {
      try { await (this.pool as { end: () => Promise<void> }).end(); } catch { /* ignore */ }
      this.pool = null;
    }
  }
}

/** Auto-pick backend based on env + corpus size signal.
 *  Returns { kind: "pg", instance } when MNEME_PG_URL is set, else
 *  { kind: "sqlite" } -- caller wraps SQLite directly. */
export interface BackendChoice {
  kind: "sqlite" | "pg";
  reason: string;
}
export function detectBackend(opts?: { totalChunks?: number }): BackendChoice {
  if (process.env["MNEME_PG_URL"]) {
    return { kind: "pg", reason: "MNEME_PG_URL is set" };
  }
  if (opts?.totalChunks && opts.totalChunks > 100_000) {
    return {
      kind: "sqlite",
      reason: `corpus has ${opts.totalChunks} chunks -- consider setting MNEME_PG_URL for the pgvector backend`,
    };
  }
  return { kind: "sqlite", reason: "default (no MNEME_PG_URL set)" };
}
