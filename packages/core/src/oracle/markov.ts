/**
 * MNEME ORACLE -- Markov bigram model.
 *
 * Pure-functional. All state is in/out parameters, so the persistence
 * layer (oracle.ts) can decide when to read/write JSON.
 */

import type { OracleObservation, BigramCount } from "./types.js";

/**
 * Build bigram counts from a chronological observation log.
 * Honors a sessionGapMs: if two consecutive observations are more than
 * `sessionGapMs` apart, they don't form a bigram (the AI was idle long
 * enough that the second isn't a "follow-up" of the first).
 */
export function buildBigrams(
  observations: OracleObservation[],
  sessionGapMs = 30 * 60 * 1000, // 30 minutes
): BigramCount[] {
  if (observations.length < 2) return [];
  const map = new Map<string, BigramCount>();
  for (let i = 1; i < observations.length; i++) {
    const a = observations[i - 1]!;
    const b = observations[i]!;
    const dt = Date.parse(b.at) - Date.parse(a.at);
    if (!Number.isFinite(dt) || dt < 0 || dt > sessionGapMs) continue;
    const key = `${a.tool}${b.tool}`;
    const existing = map.get(key);
    if (existing) {
      existing.count++;
      existing.lastSeen = b.at;
    } else {
      map.set(key, { prev: a.tool, next: b.tool, count: 1, lastSeen: b.at });
    }
  }
  return Array.from(map.values());
}

/**
 * P(next | prev) = count(prev, next) / sum_k count(prev, k).
 * Returns [{ next, p }] sorted by p desc. Empty array when prev never
 * appeared as a predecessor.
 */
export function transitionProbabilities(
  bigrams: BigramCount[],
  prev: string,
): Array<{ next: string; p: number; count: number }> {
  const candidates = bigrams.filter((b) => b.prev === prev);
  if (candidates.length === 0) return [];
  const total = candidates.reduce((s, c) => s + c.count, 0);
  return candidates
    .map((c) => ({ next: c.next, p: c.count / total, count: c.count }))
    .sort((a, b) => b.p - a.p);
}

/**
 * Top-K most likely tools to follow `prev`, by Markov probability alone.
 * (For the combined score we mix this with pheromone in oracle.ts.)
 */
export function topKMarkov(
  bigrams: BigramCount[],
  prev: string,
  k: number,
): Array<{ next: string; p: number; count: number }> {
  return transitionProbabilities(bigrams, prev).slice(0, k);
}

/**
 * Distinct tool names ever observed. Useful for /stats and for finding
 * "cold" tools that have NO transition data (Oracle should fall back to
 * uniform prior in that case).
 */
export function uniqueTools(observations: OracleObservation[]): string[] {
  const set = new Set<string>();
  for (const o of observations) set.add(o.tool);
  return Array.from(set).sort();
}
