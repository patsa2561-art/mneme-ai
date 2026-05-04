/**
 * Core types for GitWisdom.
 * Designed so phase 1 (archaeology) and phase 3 (error correlation) share one schema.
 */

export interface Commit {
  hash: string;
  shortHash: string;
  authorName: string;
  authorEmail: string;
  authorDate: string; // ISO 8601
  committerDate: string;
  subject: string;
  body: string;
  files: string[];
  parents: string[];
  prNumber?: number;
  prTitle?: string;
  prBody?: string;
  issueRefs?: string[];
}

export interface FileChange {
  commitHash: string;
  path: string;
  changeKind: "A" | "M" | "D" | "R" | "C";
  insertions: number;
  deletions: number;
  renamedFrom?: string;
}

export interface Entity {
  id: string;
  kind: "function" | "class" | "variable" | "module" | "type";
  name: string;
  filePath: string;
  startLine: number;
  endLine: number;
  signature?: string;
  language: string;
}

export interface CommitChunk {
  id: string;
  commitHash: string;
  text: string;
  kind: "subject" | "body" | "pr_title" | "pr_body" | "diff_hunk";
  embedding?: Float32Array;
}

export type IncidentSource = "sentry" | "datadog" | "manual" | "github" | "log";

export interface Incident {
  id: string;
  source: IncidentSource;
  externalId?: string;
  title: string;
  occurredAt: string;
  resolvedAt?: string;
  severity: "info" | "warning" | "error" | "critical";
  affectedFiles?: string[];
  stackFrames?: StackFrame[];
  url?: string;
  metadata?: Record<string, unknown>;
}

export interface StackFrame {
  file: string;
  line: number;
  function?: string;
  module?: string;
}

export interface Correlation {
  id: string;
  fromKind: "commit" | "incident" | "entity";
  fromId: string;
  toKind: "commit" | "incident" | "entity";
  toId: string;
  weight: number; // 0..1
  reason: string;
  evidence: string[]; // ids of supporting commits/incidents
}

export interface SearchResult {
  commit: Commit;
  score: number;
  matchedChunks: CommitChunk[];
}

export interface AskResult {
  question: string;
  summary: string;
  citations: Citation[];
  searchResults: SearchResult[];
}

export interface Citation {
  kind: "commit" | "pr" | "issue";
  id: string;
  title: string;
  url?: string;
  excerpt: string;
}

export interface IndexerProgress {
  phase: "git_log" | "pr_fetch" | "embedding" | "writing" | "done";
  current: number;
  total: number;
  message?: string;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<Float32Array[]>;
}

export interface RepoMeta {
  rootPath: string;
  defaultBranch: string;
  remoteUrl?: string;
  host?: "github" | "gitlab" | "bitbucket" | "other";
  owner?: string;
  repo?: string;
}
