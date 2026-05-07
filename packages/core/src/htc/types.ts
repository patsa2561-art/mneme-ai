/**
 * Hierarchical Token Cache (HTC) — shared types.
 *
 * The big idea: Mneme pre-compresses an entire codebase's git history into
 * LLM-consumable form at index-time. 50,000 commits fit in one Claude prompt.
 * Token cost paid ONCE; reused forever.
 *
 * Three layers:
 *   Layer 1 — Semantic abstracts (~30 tok/commit, LLM-generated once, cached)
 *   Layer 2 — Topic clusters     (~100 tok/cluster, summarized from Layer 1)
 *   Layer 3 — Repo memoir        (~500 tok, generated from Layer 2)
 */

/**
 * Subset of EnricherProvider needed by HTC. We avoid a hard dependency on
 * @mneme-ai/embeddings to keep core dep-free; callers pass an enricher in.
 */
export interface HtcEnricher {
  readonly name: string;
  enrich(input: {
    system: string;
    user: string;
    temperature?: number;
    maxTokens?: number;
  }): Promise<{ text: string }>;
}

/** Layer 1 result: ~30-token abstract for a single commit. */
export interface AbstractResult {
  hash: string;
  /** ~30-token plain-English condensation of WHAT changed + WHY. */
  abstract: string;
  /** Estimated token count (text.split / words × 1.3). */
  tokenCount: number;
  generationMs: number;
  /** Provider name + model for provenance, e.g. "ollama:qwen2.5:3b". */
  generator: string;
  /** ISO timestamp; populated by storage layer when reading back. */
  generatedAt?: string;
}

/** Layer 2 result: ~100-token summary for a group of related commits. */
export interface ClusterSummary {
  clusterId: string;
  /** Short topic name, e.g. "auth refactor". */
  label: string;
  /** ~100-token paragraph: topic + major changes + sequence. */
  summary: string;
  memberHashes: string[];
  tokenCount: number;
  generationMs: number;
  generator: string;
  generatedAt?: string;
}

/** Layer 3 result: ~500-token narrative of the entire repo. */
export interface Memoir {
  /** ~500-token plain-English narrative covering opening, topics, current state. */
  narrative: string;
  totalCommits: number;
  totalClusters: number;
  tokenCount: number;
  generationMs: number;
  generator: string;
  generatedAt?: string;
}

/** Aggregate stats / coverage for the HTC across all three layers. */
export interface HtcStats {
  totalCommits: number;
  abstractsGenerated: number;
  /** Fraction of commits with a Layer-1 abstract (0..1). */
  abstractsCoverage: number;
  clustersGenerated: number;
  memoirGenerated: boolean;
  /** Days since the memoir was last generated; undefined when no memoir exists. */
  memoirAgeDays?: number;
  /** Sum of token_count across abstracts + clusters + memoir. */
  totalCachedTokens: number;
  /** Estimated tokens of raw commit bodies+subjects — for compression comparison. */
  estimatedRawTokens: number;
  /** estimatedRawTokens / totalCachedTokens; 0 when nothing cached yet. */
  compressionRatio: number;
}

/** Estimate token count without pulling a tokenizer dependency.
 *  Heuristic: words × 1.3 (rounds up sub-word breaks for typical English/code).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words * 1.3);
}
