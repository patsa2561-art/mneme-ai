/**
 * A2 — Phantom-Path Search.
 *
 * Most search engines find what IS there. Phantom-Path finds what
 * SHOULD be there, based on the canonical pattern of past successful
 * changes in this repo.
 *
 * Example:
 *   Query: "login validation"
 *   Standard search returns: src/auth/legacy-login.ts (line 42)
 *   Phantom-Path also returns:
 *     "Canonical login validation pattern in this repo's history is the
 *      shape used by commit a3f9b21 (services/auth/v2/) — your candidate
 *      file matches that shape with sim=0.42, so the canonical phantom
 *      file would live at services/auth/v2/login.ts"
 *
 * Pure function. Combines F2 (HWC) for similarity and F4 (TBP) for
 * federation-prior weighting.
 */

import { hwc, tbp } from "./formulas.js";

export interface CanonicalPattern {
  /** Stable id (e.g., "successful-pattern-stripe-pricing"). */
  id: string;
  /** Where this pattern lives canonically (path or virtual location). */
  canonicalLocation: string;
  /** Embedding of the pattern. */
  embedding: number[];
  /** Optional human label. */
  label?: string;
  /** Federation upvotes from cross-repo successes (k-anon). */
  upvotes?: number;
  /** Federation downvotes. */
  downvotes?: number;
}

export interface PhantomPathInput {
  /** Embedding of the user's query / candidate file. */
  queryEmbedding: number[];
  /** Known canonical patterns from this repo's successful history. */
  canonicalPatterns: CanonicalPattern[];
  /** Hebbian co-activations per pattern id. */
  coActivations?: Record<string, number>;
  /** Top-K results returned. Default 5. */
  topK?: number;
}

export interface PhantomPathSuggestion {
  /** Canonical pattern id this phantom maps to. */
  patternId: string;
  /** Where the canonical version of this query "should live". */
  canonicalLocation: string;
  /** Score combining HWC similarity and TBP federation prior. */
  score: number;
  /** Pure HWC similarity (for transparency). */
  similarity: number;
  /** TBP-derived prior (for transparency). */
  federationPrior: number;
  /** Optional human label of the matched pattern. */
  label?: string;
}

/**
 * Suggest "phantom paths" — locations where the canonical version of
 * the user's query should live, based on past successful patterns.
 */
export function phantomPathSearch(input: PhantomPathInput): PhantomPathSuggestion[] {
  const topK = Math.max(1, input.topK ?? 5);
  const out: PhantomPathSuggestion[] = [];
  for (const p of input.canonicalPatterns) {
    const co = input.coActivations?.[p.id] ?? 0;
    const sim = hwc({
      queryEmbedding: input.queryEmbedding,
      codeEmbedding: p.embedding,
      coActivationCount: co,
    });
    const score = tbp({
      localLikelihood: sim,
      federationUpvotes: p.upvotes ?? 0,
      federationDownvotes: p.downvotes ?? 0,
    });
    // Compute the federation prior on its own for transparency
    const a = (p.upvotes ?? 0) + 1;
    const b = (p.downvotes ?? 0) + 1;
    const federationPrior = a / (a + b);
    out.push({
      patternId: p.id,
      canonicalLocation: p.canonicalLocation,
      score,
      similarity: sim,
      federationPrior,
      label: p.label,
    });
  }
  out.sort((x, y) => y.score - x.score || x.patternId.localeCompare(y.patternId));
  return out.slice(0, topK);
}
