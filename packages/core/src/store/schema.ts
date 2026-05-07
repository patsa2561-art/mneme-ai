/**
 * Mneme storage schema.
 *
 * Phase 1 — commits, file_changes, chunks (with vector blob)
 * Phase 2 — entities, entity_clusters
 * Phase 3 — incidents, correlations
 * Phase 4 — graph_snapshots (for temporal viz)
 * Phase 5 — htc (Hierarchical Token Cache) — abstracts, clusters, memoir
 */
export const SCHEMA_VERSION = 4;

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

-- FTS5 with trigram tokenizer — works for Thai, CJK, Arabic, and any
-- non-space-separated language. The tradeoff vs porter is that BM25 is
-- slightly less precise for English, but the gain in cross-language
-- coverage is enormous. Also: trigram makes substring search free.
CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  id UNINDEXED,
  commit_hash UNINDEXED,
  text,
  tokenize = 'trigram'
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

-- Phase 4 - Wisdom Mutant Engine
-- The "always-learning" loop. Three append-only tables that record what the
-- system saw, what it tried, and how well it worked. Per-repo, never leaves
-- the machine. Honest contract: every recommendation in mneme adapt and
-- every threshold in mneme ask is traceable back to a row here.

-- Every query records its result-set fingerprint. was_helpful is set later,
-- either by the user (--feedback up/down) or by an implicit signal (the
-- query was not re-run with a refined version within 60s, or one of the
-- returned commits was navigated to via mneme why).
CREATE TABLE IF NOT EXISTS wisdom_feedback (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  result_hashes TEXT NOT NULL,        -- JSON array of commit hashes returned
  top_score REAL,                     -- top RRF score at query time
  was_helpful INTEGER,                -- 1=yes, 0=no, NULL=unknown
  source TEXT NOT NULL,               -- 'explicit' | 'implicit-reuse' | 'implicit-revisit'
  semantic_weight REAL,               -- the search config that produced this result
  min_sem_cosine REAL,
  rrf_k INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feedback_created ON wisdom_feedback(created_at);
CREATE INDEX IF NOT EXISTS idx_feedback_helpful ON wisdom_feedback(was_helpful);

-- The current calibration of search/retrieval knobs. One row per knob.
-- Updated by the auto-calibrator after evaluating against the feedback set.
CREATE TABLE IF NOT EXISTS wisdom_calibration (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,                -- JSON
  metric_value REAL,                  -- the metric this calibration achieved
  metric_name TEXT,                   -- e.g. "hit_rate", "recall_at_3"
  calibrated_at TEXT NOT NULL,
  notes TEXT
);

-- Append-only history of self-eval runs. Lets the user (and any auditor)
-- see whether quality is trending up or down over time.
CREATE TABLE IF NOT EXISTS wisdom_eval_run (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at TEXT NOT NULL,
  variant TEXT NOT NULL,              -- 'baseline' | 'reranked' | 'calibrated' | ...
  recall_at_3 REAL NOT NULL,
  mrr REAL NOT NULL,
  ndcg_at_10 REAL,
  hit_rate REAL NOT NULL,
  semantic_weight REAL,
  min_sem_cosine REAL,
  rrf_k INTEGER,
  num_queries INTEGER NOT NULL,
  notes TEXT
);
CREATE INDEX IF NOT EXISTS idx_eval_ran_at ON wisdom_eval_run(ran_at);

-- Phase 5 — Hierarchical Token Cache (HTC)
-- The world-first compression-as-storage layer. Mneme pre-compresses an
-- entire codebase's git history into LLM-consumable form at index-time.
-- 50,000 commits fit in one LLM prompt; token cost paid ONCE; reused forever.
--
-- Three layers:
--   Layer 1 — htc_abstracts: ~30 tok/commit, LLM-generated once, cached
--   Layer 2 — htc_clusters:  ~100 tok/cluster, summarized from Layer 1
--   Layer 3 — htc_memoir:    ~500 tok, generated from Layer 2

CREATE TABLE IF NOT EXISTS htc_abstracts (
  commit_hash TEXT PRIMARY KEY REFERENCES commits(hash) ON DELETE CASCADE,
  abstract TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  generated_at TEXT NOT NULL,
  generator TEXT NOT NULL,
  generation_ms INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_htc_abstracts_generated ON htc_abstracts(generated_at);

CREATE TABLE IF NOT EXISTS htc_clusters (
  cluster_id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  summary TEXT NOT NULL,
  member_hashes TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  generated_at TEXT NOT NULL,
  generator TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS htc_memoir (
  id INTEGER PRIMARY KEY,
  narrative TEXT NOT NULL,
  total_commits INTEGER NOT NULL,
  total_clusters INTEGER NOT NULL,
  token_count INTEGER NOT NULL,
  generated_at TEXT NOT NULL,
  generator TEXT NOT NULL
);
`;
