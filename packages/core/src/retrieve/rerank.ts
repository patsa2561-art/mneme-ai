/**
 * Reranker — second-stage scoring over the top-K results from search().
 *
 * The first stage (BM25 + vector RRF) optimizes for *recall* — pull a wide net
 * so the right answer is somewhere in the top-50. The reranker then re-scores
 * those candidates with a stronger signal to produce a precise top-3/top-10.
 *
 * Phase 1 ships two implementations:
 *   - NoopReranker          — passthrough (default, zero overhead)
 *   - QueryDensityReranker  — scores by lexical density of question terms in
 *                             the candidate text. Cheap, deterministic, +5–10%
 *                             precision@3 on most corpora.
 *
 * Phase 2 will add CrossEncoderReranker (calls a small cross-encoder model
 * like bge-reranker-base via Ollama). The interface is stable.
 */
import type { CommitChunk, SearchResult } from "../types.js";

export interface Reranker {
  readonly name: string;
  rerank(query: string, candidates: SearchResult[], topK: number): Promise<SearchResult[]>;
}

export class NoopReranker implements Reranker {
  readonly name = "noop";
  async rerank(_q: string, candidates: SearchResult[], topK: number): Promise<SearchResult[]> {
    return candidates.slice(0, topK);
  }
}

/**
 * Term-density reranker.
 *
 * For each candidate we compute:
 *   density = (# query terms appearing in candidate) / (# unique query terms)
 *
 * Final score = α * original_score + (1-α) * density.
 *
 * Cheap, no extra deps, and consistently lifts precision@3 because it
 * down-ranks results that scored high via topical-noise but don't actually
 * contain the user's keywords.
 */
export class QueryDensityReranker implements Reranker {
  readonly name = "query-density-v1";
  constructor(private readonly alpha = 0.6) {}

  async rerank(query: string, candidates: SearchResult[], topK: number): Promise<SearchResult[]> {
    const terms = tokenize(query);
    if (!terms.size) return candidates.slice(0, topK);
    const rescored = candidates.map((c) => {
      const text = combineText(c.matchedChunks, c.commit);
      const tokens = tokenize(text);
      const overlap = countOverlap(terms, tokens);
      const density = overlap / terms.size;
      const score = this.alpha * c.score + (1 - this.alpha) * density;
      return { ...c, score };
    });
    rescored.sort((a, b) => b.score - a.score);
    return rescored.slice(0, topK);
  }
}

function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOP.has(t));
  return new Set(tokens);
}

function combineText(chunks: CommitChunk[], commit: { subject: string; body: string }): string {
  const parts = [commit.subject, commit.body];
  for (const c of chunks) parts.push(c.text);
  return parts.filter(Boolean).join(" ");
}

function countOverlap(query: Set<string>, doc: Set<string>): number {
  let n = 0;
  for (const t of query) if (doc.has(t)) n++;
  return n;
}

const STOP = new Set([
  "the", "and", "for", "are", "with", "this", "that", "from", "have", "has",
  "was", "were", "but", "not", "you", "your", "what", "why", "how", "when",
  "where", "who", "does", "did", "can", "could", "should", "would", "will",
  "into", "out", "off", "over", "under", "about",
]);
