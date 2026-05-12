/**
 * v1.79.0 -- NEURON: trigram fuzzy similarity (no ML, no API).
 *
 * Used when the user's prompt doesn't exactly match any LATTICE intent
 * trigger but is "close enough" semantically. Splits each string into
 * 3-character sliding windows + computes Jaccard similarity. Fast,
 * deterministic, works for Thai + English alike.
 */

function trigrams(s: string): Set<string> {
  const norm = s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  const padded = `  ${norm}  `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    out.add(padded.slice(i, i + 3));
  }
  return out;
}

export interface TrigramMatch {
  similarity: number;
  shared: number;
  total: number;
}

/** Jaccard similarity over trigram sets. 0..1. */
export function trigramSimilarity(a: string, b: string): TrigramMatch {
  const tA = trigrams(a);
  const tB = trigrams(b);
  let shared = 0;
  for (const t of tA) if (tB.has(t)) shared += 1;
  const total = tA.size + tB.size - shared;
  const similarity = total === 0 ? 0 : shared / total;
  return { similarity, shared, total };
}

export interface FuzzyRanked<T> {
  item: T;
  matched: string;
  similarity: number;
}

/** Rank a list of {item, triggers[]} pairs by best trigram similarity
 *  against the input. Returns sorted descending. */
export function rankByFuzzy<T>(
  input: string,
  candidates: Array<{ item: T; triggers: readonly string[] }>,
  threshold = 0.15,
): FuzzyRanked<T>[] {
  const out: FuzzyRanked<T>[] = [];
  for (const c of candidates) {
    let best = 0;
    let bestTrigger = "";
    for (const t of c.triggers) {
      const { similarity } = trigramSimilarity(input, t);
      if (similarity > best) {
        best = similarity;
        bestTrigger = t;
      }
    }
    if (best >= threshold) {
      out.push({ item: c.item, matched: bestTrigger, similarity: best });
    }
  }
  out.sort((a, b) => b.similarity - a.similarity);
  return out;
}
