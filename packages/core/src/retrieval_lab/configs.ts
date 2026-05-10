/**
 * Curated arm pool — the configs the tuner picks among. We keep this
 * small + well-spaced so the UCB1 explorer converges fast.
 *
 * To add a new arm, append here. The tuner picks it up automatically
 * on the next caretaker pass.
 */

import type { RetrievalConfig } from "./types.js";

export const CANDIDATE_CONFIGS: RetrievalConfig[] = [
  {
    id: "bge-small-rrf60",
    label: "BGE-small + RRF k=60 (baseline)",
    embedder: "bundled-bge-small",
    rrfK: 60,
    semanticWeight: 0.65,
    reranker: "noop",
    useHyDE: false,
    candidateK: 50,
  },
  {
    id: "bge-small-rrf60-density",
    label: "BGE-small + term-density rerank",
    embedder: "bundled-bge-small",
    rrfK: 60,
    semanticWeight: 0.65,
    reranker: "term-density",
    useHyDE: false,
    candidateK: 50,
  },
  {
    id: "bge-small-rrf60-cross",
    label: "BGE-small + cross-encoder rerank",
    embedder: "bundled-bge-small",
    rrfK: 60,
    semanticWeight: 0.65,
    reranker: "cross-encoder-bge-base",
    useHyDE: false,
    candidateK: 50,
  },
  {
    id: "bge-small-rrf60-hyde-cross",
    label: "BGE-small + HyDE + cross-encoder",
    embedder: "bundled-bge-small",
    rrfK: 60,
    semanticWeight: 0.65,
    reranker: "cross-encoder-bge-base",
    useHyDE: true,
    candidateK: 50,
  },
  {
    id: "bge-small-rrf30-cross",
    label: "BGE-small + RRF k=30 + cross-encoder",
    embedder: "bundled-bge-small",
    rrfK: 30,
    semanticWeight: 0.7,
    reranker: "cross-encoder-bge-base",
    useHyDE: false,
    candidateK: 80,
  },
  {
    id: "bge-m3-rrf60-cross",
    label: "BGE-M3 + cross-encoder (multilingual)",
    embedder: "bundled-bge-m3",
    rrfK: 60,
    semanticWeight: 0.7,
    reranker: "cross-encoder-bge-base",
    useHyDE: false,
    candidateK: 50,
  },
  {
    id: "bge-m3-rrf60-hyde-cross",
    label: "BGE-M3 + HyDE + cross-encoder (premium)",
    embedder: "bundled-bge-m3",
    rrfK: 60,
    semanticWeight: 0.75,
    reranker: "cross-encoder-bge-base",
    useHyDE: true,
    candidateK: 80,
  },
  {
    id: "voyage3-rrf60-cohere",
    label: "voyage-3 + Cohere rerank (best-quality, paid)",
    embedder: "voyage-3",
    rrfK: 60,
    semanticWeight: 0.8,
    reranker: "cohere-rerank-3",
    useHyDE: false,
    candidateK: 100,
  },
];

/** Look up a config by id; throws if unknown. */
export function getConfig(id: string): RetrievalConfig {
  const c = CANDIDATE_CONFIGS.find((x) => x.id === id);
  if (!c) throw new Error(`unknown retrieval config: ${id}`);
  return c;
}

/** Default config when no leaderboard exists yet. */
export const DEFAULT_CONFIG: RetrievalConfig = CANDIDATE_CONFIGS[0]!;
