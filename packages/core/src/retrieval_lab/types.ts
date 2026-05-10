/**
 * Mneme Retrieval Lab — types.
 *
 * The thesis: every individual retrieval improvement (cross-encoder,
 * HyDE, voyage embedder, RRF k value, semanticWeight) has measurable
 * leverage. But the BIGGEST leverage is letting the system PICK the
 * best combination automatically by running A/B trials against an
 * eval oracle in the background — and inheriting the winning config
 * across machines + AI vendors via MneMeiosis chromosomes.
 *
 * That's the moat: competitors can copy any single algorithm, but they
 * can't copy a self-improving config-lineage system without the
 * chromosome substrate.
 */

/** A single retrieval configuration the tuner can pick. */
export interface RetrievalConfig {
  /** Stable id ("vec-only" / "rrf-k60-rerank" / "hyde-bge-m3"). Used in
   *  leaderboard + cert ledger. */
  id: string;
  /** Human-readable name for the Lab UI. */
  label: string;
  /** Embedder backend: "bundled-bge-small" | "voyage-3" | "openai-3" | "bge-m3" */
  embedder: EmbedderBackendId;
  /** Reciprocal-rank-fusion constant. TREC default = 60. */
  rrfK: number;
  /** Vector vs BM25 weight, 0..1. 0 = pure BM25, 1 = pure vector. */
  semanticWeight: number;
  /** Reranker id from RERANKER_REGISTRY, or "noop". */
  reranker: RerankerBackendId;
  /** When true, expand the query via HyDE before embed. */
  useHyDE: boolean;
  /** Top-K from first-stage retrieval (before rerank). */
  candidateK: number;
}

export type EmbedderBackendId =
  | "bundled-bge-small"      // existing default; ships in npm bundle
  | "bundled-bge-m3"         // BGE-M3 (multilingual, late chunking ready)
  | "voyage-3"               // voyage AI (highest quality; needs API key)
  | "openai-3-small"         // text-embedding-3-small
  | "openai-3-large";        // text-embedding-3-large

export type RerankerBackendId =
  | "noop"                   // passthrough
  | "term-density"           // existing QueryDensityReranker
  | "cross-encoder-bge-base" // bge-reranker-base via @huggingface/transformers
  | "cohere-rerank-3";       // Cohere Rerank API (paid)

/** A single A/B trial: one config vs eval queries. */
export interface Trial {
  trialId: string;
  configId: string;
  ranAt: string;
  /** Number of eval queries this trial scored. */
  queryCount: number;
  /** Mean precision at K. */
  meanPrecisionAtK: number;
  /** Mean recall at K. */
  meanRecallAtK: number;
  /** Mean NDCG @ K. */
  meanNdcgAtK: number;
  /** Total wall time over all queries (ms). */
  totalLatencyMs: number;
  /** Mean per-query latency. */
  meanLatencyMs: number;
  /** Composite score: 0.6 * f1 + 0.4 * (1 - normalized_latency). 0..1. */
  compositeScore: number;
  /** HMAC-SHA256 of the trial result, keyed by repo identity. */
  signature: string;
}

/** Aggregated leaderboard entry — many trials per config rolled up. */
export interface LeaderboardEntry {
  configId: string;
  config: RetrievalConfig;
  trialCount: number;
  /** Mean composite across all trials of this config. */
  meanComposite: number;
  /** UCB1 upper-confidence-bound score (used by tuner to balance
   *  exploration vs exploitation). */
  ucb1: number;
  /** Most recent trial timestamp. */
  lastTriedAt: string;
  /** Rolling per-metric averages. */
  meanPrecisionAtK: number;
  meanRecallAtK: number;
  meanNdcgAtK: number;
  meanLatencyMs: number;
}

/** Persisted at .mneme/retrieval/leaderboard.json. */
export interface Leaderboard {
  schemaVersion: 1;
  entries: LeaderboardEntry[];
  /** The current "active" config — what every search() call uses. Picked
   *  by the tuner as the best config seen so far. */
  active: string;
  /** Total trials run since this leaderboard started. */
  totalTrials: number;
  /** ISO timestamp last write. */
  lastUpdate: string;
}

/** A single eval case the tuner uses to score configs. Each case has
 *  a query + the IDs of chunks that SHOULD appear in the top-K. */
export interface EvalCase {
  id: string;
  query: string;
  /** Set of chunk IDs (as strings) that are relevant. */
  relevantIds: string[];
  /** Optional short note for triage. */
  note?: string;
}
