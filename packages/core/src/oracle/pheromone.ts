/**
 * MNEME ORACLE -- ACO (Ant Colony Optimization) pheromone layer.
 *
 * The classical Ant System update rule:
 *
 *     tau(i,j) <- (1 - rho) * tau(i,j) + delta_tau(i,j)
 *
 * where rho in (0,1) is the evaporation rate and delta_tau is the
 * reinforcement (typically 1/L_k where L_k is path length, but in our
 * "AI tool sequence" use case there's no path length to optimize, so
 * we just reinforce by a constant `r` whenever we observe the edge).
 *
 * Why this on top of Markov:
 *
 *   - Markov gives a stationary count: "across all history, after A
 *     comes B 23% of the time."
 *   - Pheromone gives a *time-decaying* signal: "in the past hour, the
 *     A->B edge has been hot." Old habits fade; new habits surface
 *     fast.
 *   - Combined, you get a forecaster that's stable AND adaptive.
 *
 * Pure-functional. State is in/out parameters.
 */

import type { PheromoneEdge } from "./types.js";

/** Find the edge in the table; null if it doesn't exist yet. */
function findEdge(table: PheromoneEdge[], prev: string, next: string): PheromoneEdge | null {
  for (const e of table) if (e.prev === prev && e.next === next) return e;
  return null;
}

/**
 * Evaporate every edge by factor rho. Removes edges whose strength
 * falls below floor (default 0.01) so the table doesn't grow unbounded.
 *
 * Returns a NEW table; doesn't mutate input.
 */
export function evaporate(table: PheromoneEdge[], rho: number, floor = 0.01): PheromoneEdge[] {
  if (rho <= 0) return table.slice();
  const now = new Date().toISOString();
  return table
    .map((e) => ({ ...e, tau: e.tau * (1 - rho), lastTouched: now }))
    .filter((e) => e.tau >= floor);
}

/**
 * Reinforce a single edge. If it doesn't exist, append. Returns a NEW
 * table (immutable update -- easy to JSON-write).
 */
export function reinforce(
  table: PheromoneEdge[],
  prev: string,
  next: string,
  amount: number,
): PheromoneEdge[] {
  const now = new Date().toISOString();
  const idx = table.findIndex((e) => e.prev === prev && e.next === next);
  if (idx < 0) {
    return [...table, { prev, next, tau: amount, lastTouched: now }];
  }
  const edge = table[idx]!;
  const next_ = [...table];
  next_[idx] = { ...edge, tau: edge.tau + amount, lastTouched: now };
  return next_;
}

/**
 * Pheromone "transition probability" from prev:
 *     P_pheromone(j | i) = tau(i,j) / sum_k tau(i,k)
 *
 * Returns ranked candidates with normalized score in [0, 1].
 */
export function pheromoneScores(
  table: PheromoneEdge[],
  prev: string,
): Array<{ next: string; score: number; tau: number }> {
  const cands = table.filter((e) => e.prev === prev);
  if (cands.length === 0) return [];
  const total = cands.reduce((s, e) => s + e.tau, 0);
  if (total <= 0) return cands.map((e) => ({ next: e.next, score: 0, tau: e.tau }));
  return cands
    .map((e) => ({ next: e.next, score: e.tau / total, tau: e.tau }))
    .sort((a, b) => b.score - a.score);
}

/** Lookup the strength for one edge. 0 if absent. */
export function tauOf(table: PheromoneEdge[], prev: string, next: string): number {
  const e = findEdge(table, prev, next);
  return e ? e.tau : 0;
}
