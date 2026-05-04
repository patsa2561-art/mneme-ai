/**
 * Standard IR (information retrieval) metrics.
 *
 * Notation:
 *   - retrieved: ordered list of doc ids returned for a query
 *   - relevant:  unordered set of ground-truth doc ids
 */

export function recallAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  if (relevant.size === 0) return retrieved.length === 0 ? 1 : 0;
  let hits = 0;
  for (let i = 0; i < Math.min(k, retrieved.length); i++) {
    if (relevant.has(retrieved[i]!)) hits++;
  }
  return hits / Math.min(relevant.size, k);
}

export function precisionAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  if (k === 0 || retrieved.length === 0) return 0;
  let hits = 0;
  for (let i = 0; i < Math.min(k, retrieved.length); i++) {
    if (relevant.has(retrieved[i]!)) hits++;
  }
  return hits / Math.min(k, retrieved.length);
}

/** Mean Reciprocal Rank — 1/rank of the first relevant hit; 0 if not found in top-K. */
export function reciprocalRank(retrieved: string[], relevant: Set<string>, k: number): number {
  for (let i = 0; i < Math.min(k, retrieved.length); i++) {
    if (relevant.has(retrieved[i]!)) return 1 / (i + 1);
  }
  return 0;
}

/** Normalized Discounted Cumulative Gain at k. Binary relevance (0/1). */
export function ndcgAtK(retrieved: string[], relevant: Set<string>, k: number): number {
  let dcg = 0;
  for (let i = 0; i < Math.min(k, retrieved.length); i++) {
    if (relevant.has(retrieved[i]!)) {
      dcg += 1 / Math.log2(i + 2);
    }
  }
  let idcg = 0;
  const ideal = Math.min(relevant.size, k);
  for (let i = 0; i < ideal; i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg === 0 ? 0 : dcg / idcg;
}

/** Aggregate per-query metrics into a single report. */
export interface PerQueryMetrics {
  queryId: string;
  recallAt1: number;
  recallAt3: number;
  recallAt10: number;
  precisionAt3: number;
  mrr: number;
  ndcgAt10: number;
  retrieved: string[];
  relevant: string[];
  hit: boolean;
}

export interface AggregateMetrics {
  numQueries: number;
  recallAt1: number;
  recallAt3: number;
  recallAt10: number;
  precisionAt3: number;
  mrr: number;
  ndcgAt10: number;
  hitRate: number;
}

export function evaluate(
  retrieved: string[],
  relevant: Set<string>,
  queryId: string,
): PerQueryMetrics {
  const r1 = recallAtK(retrieved, relevant, 1);
  const r3 = recallAtK(retrieved, relevant, 3);
  const r10 = recallAtK(retrieved, relevant, 10);
  const p3 = precisionAtK(retrieved, relevant, 3);
  const mrr = reciprocalRank(retrieved, relevant, 10);
  const ndcg = ndcgAtK(retrieved, relevant, 10);
  return {
    queryId,
    recallAt1: r1,
    recallAt3: r3,
    recallAt10: r10,
    precisionAt3: p3,
    mrr,
    ndcgAt10: ndcg,
    retrieved,
    relevant: Array.from(relevant),
    hit: mrr > 0 || (relevant.size === 0 && retrieved.length === 0),
  };
}

export function aggregate(rows: PerQueryMetrics[]): AggregateMetrics {
  const n = rows.length;
  if (n === 0) {
    return {
      numQueries: 0,
      recallAt1: 0,
      recallAt3: 0,
      recallAt10: 0,
      precisionAt3: 0,
      mrr: 0,
      ndcgAt10: 0,
      hitRate: 0,
    };
  }
  const sum = (key: keyof PerQueryMetrics) => rows.reduce((s, r) => s + (r[key] as number), 0);
  return {
    numQueries: n,
    recallAt1: sum("recallAt1") / n,
    recallAt3: sum("recallAt3") / n,
    recallAt10: sum("recallAt10") / n,
    precisionAt3: sum("precisionAt3") / n,
    mrr: sum("mrr") / n,
    ndcgAt10: sum("ndcgAt10") / n,
    hitRate: rows.filter((r) => r.hit).length / n,
  };
}
