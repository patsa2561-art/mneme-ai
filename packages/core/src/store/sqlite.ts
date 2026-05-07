/**
 * MnemeStore — SQLite-backed persistence layer.
 *
 * Why `node:sqlite` and not `better-sqlite3`?
 *   - Zero native compile. Ships with Node itself (stable in 22.13+).
 *   - No prebuild lottery — works on every (OS × arch) Node supports,
 *     including Windows ARM64 + Node 24 (the case that broke v0.33).
 *   - FTS5 + WAL still supported (built into Node's bundled SQLite).
 *
 * API differences vs better-sqlite3 we work around here:
 *   - No `.pragma()` — use `exec("PRAGMA …")`.
 *   - No `.transaction(fn)` — we expose `MnemeStore.transaction(fn)` that
 *     wraps the callback in BEGIN / COMMIT / ROLLBACK.
 *   - BLOB rows come back as `Uint8Array`, not `Buffer` — `bufToFloat32`
 *     handles both.
 */
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType, StatementSync } from "node:sqlite";

// Vite/vitest's static analyser doesn't recognise the `node:sqlite` builtin
// (added in Node 22.5, stable in 22.13). Loading it via createRequire keeps
// the resolution at runtime, where Node's loader handles it natively. The
// type import above is erased at compile time so it doesn't trigger Vite.
const req = createRequire(import.meta.url);
const { DatabaseSync } = req("node:sqlite") as typeof import("node:sqlite");
import type {
  Commit,
  CommitChunk,
  Entity,
  FileChange,
  Incident,
  Correlation,
} from "../types.js";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";

/**
 * Loose alias for the Node sqlite Database handle. We keep it `any`-like
 * via `unknown` so consumer modules (htc/storage.ts, counterfactual/index.ts,
 * etc.) only need to call methods we expose; we don't leak the Node-version-
 * specific `StatementSync` shape across module boundaries.
 */
export type MnemeDb = DatabaseSyncType;

export class MnemeStore {
  readonly db: MnemeDb;

  constructor(public readonly dbPath: string) {
    if (dbPath !== ":memory:" && !existsSync(dirname(dbPath))) {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL");
    this.db.exec("PRAGMA synchronous = NORMAL");
    this.db.exec("PRAGMA foreign_keys = ON");
    this.db.exec(SCHEMA_SQL);

    // v2 → v3 migration: FTS5 tokenizer changed from `porter unicode61` to
    // `trigram` for cross-language support (Thai, CJK, Arabic). Re-create the
    // FTS table and let the next `mneme index` re-populate from chunks.
    const previousVersion = Number(this.getMeta("schema_version") ?? "0");
    if (previousVersion > 0 && previousVersion < 3) {
      this.migrateFtsToTrigram();
    }

    this.setMeta("schema_version", String(SCHEMA_VERSION));
  }

  /** Drop + recreate chunks_fts with the new trigram tokenizer, then rebuild from chunks. */
  private migrateFtsToTrigram(): void {
    this.db.exec("DROP TABLE IF EXISTS chunks_fts");
    this.db.exec(`
      CREATE VIRTUAL TABLE chunks_fts USING fts5(
        id UNINDEXED,
        commit_hash UNINDEXED,
        text,
        tokenize = 'trigram'
      );
    `);
    // Re-populate from existing chunks rows (no re-embedding needed).
    this.db.exec(`
      INSERT INTO chunks_fts (id, commit_hash, text)
      SELECT id, commit_hash, text FROM chunks
    `);
  }

  close(): void {
    this.db.close();
  }

  /**
   * Run `fn` inside a single transaction. Mirrors better-sqlite3's
   * `db.transaction(fn)` API: returns a function you call with the
   * batch payload. Auto-commits on return; rolls back on throw.
   *
   * Why this shape: every existing caller already expects
   * `const tx = store.transaction((items) => {...}); tx(items)`.
   * Keeping the API stable means consumer modules don't change.
   */
  transaction<T extends unknown[], R>(fn: (...args: T) => R): (...args: T) => R {
    const db = this.db;
    return (...args: T): R => {
      db.exec("BEGIN");
      try {
        const result = fn(...args);
        db.exec("COMMIT");
        return result;
      } catch (err) {
        try {
          db.exec("ROLLBACK");
        } catch {
          /* rollback may fail if the connection is already in a bad state */
        }
        throw err;
      }
    };
  }

  setMeta(key: string, value: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)")
      .run(key, value);
  }

  getMeta(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  upsertCommits(commits: Commit[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO commits
        (hash, short_hash, author_name, author_email, author_date, committer_date,
         subject, body, parents, pr_number, pr_title, pr_body, issue_refs)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = this.transaction((batch: Commit[]) => {
      for (const c of batch) {
        stmt.run(
          c.hash,
          c.shortHash,
          c.authorName,
          c.authorEmail,
          c.authorDate,
          c.committerDate,
          c.subject,
          c.body,
          c.parents.join(" "),
          c.prNumber ?? null,
          c.prTitle ?? null,
          c.prBody ?? null,
          c.issueRefs?.length ? JSON.stringify(c.issueRefs) : null,
        );
      }
    });
    tx(commits);
  }

  upsertFileChanges(changes: FileChange[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO file_changes
        (commit_hash, path, change_kind, insertions, deletions)
      VALUES (?, ?, ?, ?, ?)
    `);
    const tx = this.transaction((batch: FileChange[]) => {
      for (const c of batch) {
        stmt.run(c.commitHash, c.path, c.changeKind, c.insertions, c.deletions);
      }
    });
    tx(changes);
  }

  upsertChunks(chunks: CommitChunk[], embeddingModel?: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO chunks
        (id, commit_hash, kind, text, embedding, embedding_model)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const ftsDel = this.db.prepare("DELETE FROM chunks_fts WHERE id = ?");
    const ftsIns = this.db.prepare(
      "INSERT INTO chunks_fts (id, commit_hash, text) VALUES (?, ?, ?)",
    );
    const tx = this.transaction((batch: CommitChunk[]) => {
      for (const c of batch) {
        const buf = c.embedding ? float32ToUint8(c.embedding) : null;
        stmt.run(c.id, c.commitHash, c.kind, c.text, buf, embeddingModel ?? null);
        ftsDel.run(c.id);
        ftsIns.run(c.id, c.commitHash, c.text);
      }
    });
    tx(chunks);
  }

  getCommit(hash: string): Commit | undefined {
    const row = this.db.prepare("SELECT * FROM commits WHERE hash = ?").get(hash) as
      | RawCommit
      | undefined;
    if (!row) return undefined;
    return rawToCommit(row, this.filesForCommit(hash));
  }

  filesForCommit(hash: string): string[] {
    const rows = this.db
      .prepare("SELECT path FROM file_changes WHERE commit_hash = ?")
      .all(hash) as Array<{ path: string }>;
    return rows.map((r) => r.path);
  }

  countCommits(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM commits").get() as { n: number };
    return row.n;
  }

  countChunks(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM chunks").get() as { n: number };
    return row.n;
  }

  countChunksWithEmbedding(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM chunks WHERE embedding IS NOT NULL")
      .get() as { n: number };
    return row.n;
  }

  /**
   * Iterate every chunk that has an embedding. Used for in-memory cosine search.
   *
   * We use `.all()` (not `.iterate()`) for portability across all Node 22.13+
   * versions — `StatementSync.iterate()` only landed in 22.18. The memory
   * cost is bounded: a 50k-chunk repo is ~75MB of Float32 vectors, which is
   * well within process budget for the read-once cosine sweep.
   */
  *iterEmbeddedChunks(): Generator<{ id: string; commitHash: string; text: string; kind: string; vec: Float32Array }> {
    const rows = this.db
      .prepare(
        "SELECT id, commit_hash, kind, text, embedding FROM chunks WHERE embedding IS NOT NULL",
      )
      .all() as Array<{
      id: string;
      commit_hash: string;
      kind: string;
      text: string;
      embedding: BlobLike;
    }>;
    for (const r of rows) {
      yield {
        id: r.id,
        commitHash: r.commit_hash,
        kind: r.kind,
        text: r.text,
        vec: bufToFloat32(r.embedding),
      };
    }
  }

  ftsSearch(query: string, limit: number): Array<{ id: string; commitHash: string; text: string; kind: string; bm25: number }> {
    const sanitized = sanitizeFts(query);
    if (!sanitized) return [];
    const rows = this.db
      .prepare(
        `SELECT c.id AS id, c.commit_hash AS commitHash, c.text AS text, c.kind AS kind,
                bm25(chunks_fts) AS bm25
         FROM chunks_fts
         JOIN chunks c ON c.id = chunks_fts.id
         WHERE chunks_fts MATCH ?
         ORDER BY bm25 ASC
         LIMIT ?`,
      )
      .all(sanitized, limit) as Array<{
      id: string;
      commitHash: string;
      text: string;
      kind: string;
      bm25: number;
    }>;
    return rows;
  }

  upsertEntities(entities: Entity[], embeddingModel?: string): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO entities
        (id, kind, name, file_path, start_line, end_line, signature, language, embedding)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = this.transaction((batch: Entity[]) => {
      for (const e of batch) {
        const buf = e.embedding ? float32ToUint8(e.embedding) : null;
        stmt.run(
          e.id,
          e.kind,
          e.name,
          e.filePath,
          e.startLine,
          e.endLine,
          e.signature ?? null,
          e.language,
          buf,
        );
      }
    });
    tx(entities);
    if (embeddingModel) this.setMeta("entity_embedder", embeddingModel);
  }

  countEntities(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS n FROM entities").get() as { n: number };
    return row.n;
  }

  countEntitiesWithEmbedding(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM entities WHERE embedding IS NOT NULL")
      .get() as { n: number };
    return row.n;
  }

  countEntitiesByLanguage(): Array<{ language: string; n: number }> {
    return this.db
      .prepare("SELECT language, COUNT(*) AS n FROM entities GROUP BY language ORDER BY n DESC")
      .all() as Array<{ language: string; n: number }>;
  }

  *iterEmbeddedEntities(): Generator<Entity> {
    const rows = this.db
      .prepare(
        `SELECT id, kind, name, file_path, start_line, end_line, signature, language, embedding
         FROM entities WHERE embedding IS NOT NULL`,
      )
      .all() as Array<{
      id: string;
      kind: Entity["kind"];
      name: string;
      file_path: string;
      start_line: number;
      end_line: number;
      signature: string | null;
      language: string;
      embedding: BlobLike;
    }>;
    for (const r of rows) {
      yield {
        id: r.id,
        kind: r.kind,
        name: r.name,
        filePath: r.file_path,
        startLine: r.start_line,
        endLine: r.end_line,
        signature: r.signature ?? undefined,
        language: r.language,
        embedding: bufToFloat32(r.embedding),
      };
    }
  }

  upsertIncidents(incidents: Incident[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO incidents
        (id, source, external_id, title, occurred_at, resolved_at, severity,
         affected_files, stack_frames, url, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = this.transaction((batch: Incident[]) => {
      for (const i of batch) {
        stmt.run(
          i.id,
          i.source,
          i.externalId ?? null,
          i.title,
          i.occurredAt,
          i.resolvedAt ?? null,
          i.severity,
          i.affectedFiles?.length ? JSON.stringify(i.affectedFiles) : null,
          i.stackFrames?.length ? JSON.stringify(i.stackFrames) : null,
          i.url ?? null,
          i.metadata ? JSON.stringify(i.metadata) : null,
        );
      }
    });
    tx(incidents);
  }

  upsertSynthesizedNote(commitHash: string, note: string, model: string, diffChars: number): void {
    this.db
      .prepare(
        `INSERT OR REPLACE INTO synthesized_notes
           (commit_hash, note, model, diff_chars, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(commitHash, note, model, diffChars, new Date().toISOString());
  }

  getSynthesizedNote(
    commitHash: string,
  ): { note: string; model: string; createdAt: string } | undefined {
    const row = this.db
      .prepare("SELECT note, model, created_at FROM synthesized_notes WHERE commit_hash = ?")
      .get(commitHash) as { note: string; model: string; created_at: string } | undefined;
    if (!row) return undefined;
    return { note: row.note, model: row.model, createdAt: row.created_at };
  }

  countSynthesizedNotes(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM synthesized_notes")
      .get() as { n: number };
    return row.n;
  }

  upsertCorrelations(correlations: Correlation[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO correlations
        (id, from_kind, from_id, to_kind, to_id, weight, reason, evidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = this.transaction((batch: Correlation[]) => {
      for (const c of batch) {
        stmt.run(
          c.id,
          c.fromKind,
          c.fromId,
          c.toKind,
          c.toId,
          c.weight,
          c.reason,
          c.evidence?.length ? JSON.stringify(c.evidence) : null,
        );
      }
    });
    tx(correlations);
  }
}

interface RawCommit {
  hash: string;
  short_hash: string;
  author_name: string;
  author_email: string;
  author_date: string;
  committer_date: string;
  subject: string;
  body: string;
  parents: string;
  pr_number: number | null;
  pr_title: string | null;
  pr_body: string | null;
  issue_refs: string | null;
}

function rawToCommit(r: RawCommit, files: string[]): Commit {
  return {
    hash: r.hash,
    shortHash: r.short_hash,
    authorName: r.author_name,
    authorEmail: r.author_email,
    authorDate: r.author_date,
    committerDate: r.committer_date,
    subject: r.subject,
    body: r.body,
    parents: r.parents.split(/\s+/).filter(Boolean),
    prNumber: r.pr_number ?? undefined,
    prTitle: r.pr_title ?? undefined,
    prBody: r.pr_body ?? undefined,
    issueRefs: r.issue_refs ? JSON.parse(r.issue_refs) : undefined,
    files,
  };
}

/**
 * BLOB rows from `node:sqlite` are `Uint8Array`; from `better-sqlite3` they
 * were `Buffer` (which is also a Uint8Array). We accept either to keep
 * round-tripping with old DB files transparent.
 */
type BlobLike = Uint8Array | Buffer;

function bufToFloat32(buf: BlobLike): Float32Array {
  // Make a fresh ArrayBuffer-backed Float32Array view. Both Buffer and the
  // Uint8Array returned by node:sqlite carry .buffer / .byteOffset; we copy
  // out of it to decouple the lifetime of the view from the underlying blob.
  const copy = new Uint8Array(buf.byteLength);
  copy.set(buf);
  return new Float32Array(copy.buffer, 0, copy.byteLength / 4);
}

/**
 * Convert a Float32Array embedding into a Uint8Array for storage. We use
 * `Uint8Array` (not `Buffer`) because `node:sqlite` accepts the standard
 * typed-array as a BLOB parameter — and we want code that works under any
 * Node 22.13+ install without leaning on Buffer-specific APIs.
 */
function float32ToUint8(vec: Float32Array): Uint8Array {
  const bytes = new Uint8Array(vec.byteLength);
  bytes.set(new Uint8Array(vec.buffer, vec.byteOffset, vec.byteLength));
  return bytes;
}

function sanitizeFts(query: string): string {
  const tokens = query
    .replace(/["'`]/g, " ")
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 2);
  if (!tokens.length) return "";
  return tokens.map((t) => `"${t}"`).join(" OR ");
}

// Re-export the prepared-statement type so consumer modules can annotate
// without re-importing from `node:sqlite` directly.
export type { StatementSync };
