/**
 * A6 — Anti-Pattern Repulsion.
 *
 * Final-stage rerank that downranks results which sit too close (in
 * embedding space) to known regret patterns. A perfect-relevance match
 * living in deprecated/regret-aligned code gets pushed down — what's
 * the point of finding it if shipping it would echo a past mistake?
 *
 * Pure function. Uses F5 (RED) for distance, then multiplies relevance
 * by the penalty. A6 is what makes "search ≠ recommend".
 */

import { red } from "./formulas.js";

export interface RankedCandidate {
  /** Stable id for the candidate. */
  id: string;
  /** Embedding (used for distance to regrets). */
  embedding: number[];
  /** Initial relevance score from upstream search. */
  baseRelevance: number;
  /** Optional context (file path, snippet) — passed through. */
  meta?: Record<string, unknown>;
}

export interface RepulsionInput {
  candidates: RankedCandidate[];
  /** Embeddings of known regret patterns. */
  regretEmbeddings: number[][];
  /** Distance below which the penalty applies (default 0.2). */
  distanceFloor?: number;
}

export interface RepulsionResult {
  id: string;
  /** Final relevance after repulsion. */
  finalRelevance: number;
  /** Distance to nearest regret. */
  regretDistance: number;
  /** Multiplier in [0,1] applied to baseRelevance. */
  penalty: number;
  /** Index of nearest regret pattern (-1 if no regrets). */
  closestRegretIndex: number;
  meta?: Record<string, unknown>;
}

/**
 * Apply F5 (RED) penalty to each candidate, then re-sort by final
 * relevance.
 *
 * Key property: a candidate with HIGH baseRelevance but LOW regret
 * distance will be downranked below a candidate with slightly lower
 * baseRelevance but no regret nearby. We prefer "good and clean" to
 * "great but echoes a past mistake".
 */
export function applyRepulsion(input: RepulsionInput): RepulsionResult[] {
  const out: RepulsionResult[] = [];
  for (const c of input.candidates) {
    const r = red({
      fileEmbedding: c.embedding,
      regretEmbeddings: input.regretEmbeddings,
    }, input.distanceFloor);
    out.push({
      id: c.id,
      finalRelevance: c.baseRelevance * r.penaltyMultiplier,
      regretDistance: r.distance,
      penalty: r.penaltyMultiplier,
      closestRegretIndex: r.closestRegretIndex,
      meta: c.meta,
    });
  }
  out.sort((a, b) => b.finalRelevance - a.finalRelevance || a.id.localeCompare(b.id));
  return out;
}
