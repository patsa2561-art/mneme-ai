import Database from "better-sqlite3";
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type {
  Commit,
  CommitChunk,
  Entity,
  FileChange,
  Incident,
  Correlation,
} from "../types.js";
import { SCHEMA_SQL, SCHEMA_VERSION } from "./schema.js";

export class MnemeStore {
  readonly db: Database.Database;

  constructor(public readonly dbPath: string) {
    if (!existsSync(dirname(dbPath))) mkdirSync(dirname(dbPath), { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("synchronous = NORMAL");
    this.db.pragma("foreign_keys = ON");
    this.db.exec(SCHEMA_SQL);
    this.setMeta("schema_version", String(SCHEMA_VERSION));
  }

  close(): void {
    this.db.close();
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
    const tx = this.db.transaction((batch: Commit[]) => {
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
    const tx = this.db.transaction((batch: FileChange[]) => {
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
    const tx = this.db.transaction((batch: CommitChunk[]) => {
      for (const c of batch) {
        const buf = c.embedding ? Buffer.from(c.embedding.buffer.slice(0)) : null;
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

  /** Iterate every chunk that has an embedding. Used for in-memory cosine search. */
  *iterEmbeddedChunks(): Generator<{ id: string; commitHash: string; text: string; kind: string; vec: Float32Array }> {
    const rows = this.db
      .prepare(
        "SELECT id, commit_hash, kind, text, embedding FROM chunks WHERE embedding IS NOT NULL",
      )
      .iterate() as IterableIterator<{
      id: string;
      commit_hash: string;
      kind: string;
      text: string;
      embedding: Buffer;
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
    const tx = this.db.transaction((batch: Entity[]) => {
      for (const e of batch) {
        const buf = e.embedding ? Buffer.from(e.embedding.buffer.slice(0)) : null;
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
      .iterate() as IterableIterator<{
      id: string;
      kind: Entity["kind"];
      name: string;
      file_path: string;
      start_line: number;
      end_line: number;
      signature: string | null;
      language: string;
      embedding: Buffer;
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
    const tx = this.db.transaction((batch: Incident[]) => {
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

  upsertCorrelations(correlations: Correlation[]): void {
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO correlations
        (id, from_kind, from_id, to_kind, to_id, weight, reason, evidence)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const tx = this.db.transaction((batch: Correlation[]) => {
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

function bufToFloat32(buf: Buffer): Float32Array {
  return new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4);
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
