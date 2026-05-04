/**
 * Mneme storage schema.
 *
 * Phase 1 — commits, file_changes, chunks (with vector blob)
 * Phase 2 — entities, entity_clusters
 * Phase 3 — incidents, correlations
 * Phase 4 — graph_snapshots (for temporal viz)
 */
export const SCHEMA_VERSION = 1;

export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commits (
  hash TEXT PRIMARY KEY,
  short_hash TEXT NOT NULL,
  author_name TEXT NOT NULL,
  author_email TEXT NOT NULL,
  author_date TEXT NOT NULL,
  committer_date TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  parents TEXT NOT NULL,
  pr_number INTEGER,
  pr_title TEXT,
  pr_body TEXT,
  issue_refs TEXT
);
CREATE INDEX IF NOT EXISTS idx_commits_author_date ON commits(author_date);
CREATE INDEX IF NOT EXISTS idx_commits_pr ON commits(pr_number);

CREATE TABLE IF NOT EXISTS file_changes (
  commit_hash TEXT NOT NULL,
  path TEXT NOT NULL,
  change_kind TEXT NOT NULL,
  insertions INTEGER NOT NULL DEFAULT 0,
  deletions INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (commit_hash, path),
  FOREIGN KEY (commit_hash) REFERENCES commits(hash) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_file_changes_path ON file_changes(path);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  commit_hash TEXT NOT NULL,
  kind TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding BLOB,
  embedding_model TEXT,
  FOREIGN KEY (commit_hash) REFERENCES commits(hash) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chunks_commit ON chunks(commit_hash);
CREATE INDEX IF NOT EXISTS idx_chunks_kind ON chunks(kind);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  id UNINDEXED,
  commit_hash UNINDEXED,
  text,
  tokenize = 'porter unicode61'
);

-- Phase 2: entity graph
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  signature TEXT,
  language TEXT NOT NULL,
  embedding BLOB
);
CREATE INDEX IF NOT EXISTS idx_entities_file ON entities(file_path);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);

-- Phase 3: incidents and correlations (the moat)
CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  external_id TEXT,
  title TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  resolved_at TEXT,
  severity TEXT NOT NULL,
  affected_files TEXT,
  stack_frames TEXT,
  url TEXT,
  metadata TEXT
);
CREATE INDEX IF NOT EXISTS idx_incidents_occurred ON incidents(occurred_at);
CREATE INDEX IF NOT EXISTS idx_incidents_source ON incidents(source);

CREATE TABLE IF NOT EXISTS correlations (
  id TEXT PRIMARY KEY,
  from_kind TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_kind TEXT NOT NULL,
  to_id TEXT NOT NULL,
  weight REAL NOT NULL,
  reason TEXT NOT NULL,
  evidence TEXT
);
CREATE INDEX IF NOT EXISTS idx_corr_from ON correlations(from_kind, from_id);
CREATE INDEX IF NOT EXISTS idx_corr_to ON correlations(to_kind, to_id);

-- Phase 4: temporal graph snapshots
CREATE TABLE IF NOT EXISTS graph_snapshots (
  id TEXT PRIMARY KEY,
  taken_at TEXT NOT NULL,
  payload BLOB NOT NULL
);

-- WILD #1: AI-synthesized notes for commits with poor messages.
-- The original commit is never modified. The synthesized note is searched
-- alongside the original chunks but always marked as kind='synthesized'
-- so users can verify against the underlying diff.
CREATE TABLE IF NOT EXISTS synthesized_notes (
  commit_hash TEXT PRIMARY KEY,
  note TEXT NOT NULL,
  model TEXT NOT NULL,
  diff_chars INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (commit_hash) REFERENCES commits(hash) ON DELETE CASCADE
);
`;
