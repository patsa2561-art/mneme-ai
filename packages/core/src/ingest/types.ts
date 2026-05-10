/**
 * Mneme Ingest+ -- pull external context (PR reviews, linked issues)
 * into Mneme's chunk store. Each ingested item becomes a regular
 * indexable chunk so retrieve/search picks it up alongside commits.
 */

export interface IngestedChunk {
  /** Stable id with source prefix (e.g., "pr-review:42:c1"). */
  id: string;
  /** Source taxonomy. */
  source: "pr-review" | "linear-issue" | "jira-issue" | "github-issue";
  /** External URL (audit trail). */
  url?: string;
  /** Plain text body (already PII-scrub-safe -- caller's responsibility). */
  text: string;
  /** Original author name (best-effort). */
  author?: string;
  /** Original timestamp. */
  createdAt: string;
  /** Optional links: file paths / commit shas referenced in the body. */
  refs?: { files?: string[]; commits?: string[] };
}

export interface IngestStats {
  source: string;
  fetchedCount: number;
  chunkCount: number;
  startedAt: string;
  completedAt: string;
  errors: string[];
}
