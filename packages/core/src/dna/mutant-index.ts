/**
 * A1 — Mutant Index Evolution.
 *
 * Genetic-algorithm loop on index strategies. Each "strategy" is a vector
 * of weights describing how to allocate compute across the 6 underlying
 * indices (trigram, symbol, AST, graph, vector, type). Strategies that
 * lead to high F8 (MF) fitness reproduce; low fitness gets pruned.
 *
 * Selection · Crossover · Mutation · all deterministic given a seed.
 *
 * Pure functions — no I/O. Caller persists population to disk.
 */

import { mf } from "./formulas.js";

export const INDEX_KINDS = ["trigram", "symbol", "ast", "graph", "vector", "type"] as const;
export type IndexKind = typeof INDEX_KINDS[number];

export interface Strategy {
  /** Stable id (unique within population). */
  id: string;
  /** Weight per index kind. Always normalized to sum=1. */
  weights: Record<IndexKind, number>;
  /** Per-strategy outcome samples (CTR + TTUR). */
  samples: Array<{ ctr: number; ttur: number }>;
  /** Generation counter (increments each evolution tick). */
  generation: number;
}

export interface EvolutionConfig {
  /** Population size after evolution. */
  populationSize: number;
  /** Top-K strategies preserved as elites (no mutation). */
  eliteCount: number;
  /** Probability of single-gene mutation per child. */
  mutationRate: number;
  /** Magnitude of mutation (Gaussian noise stddev). */
  mutationSigma: number;
  /** Deterministic RNG seed. */
  seed: number;
}

const DEFAULT_CONFIG: EvolutionConfig = {
  populationSize: 12,
  eliteCount: 2,
  mutationRate: 0.3,
  mutationSigma: 0.1,
  seed: 42,
};

// ─── Deterministic RNG (Mulberry32) ──────────────────────────────────

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Strategy operations ─────────────────────────────────────────────

export function normalize(weights: Record<IndexKind, number>): Record<IndexKind, number> {
  const sum = INDEX_KINDS.reduce((s, k) => s + Math.max(0, weights[k] ?? 0), 0);
  if (sum === 0) {
    // All-zero → uniform fallback
    const uniform: Partial<Record<IndexKind, number>> = {};
    for (const k of INDEX_KINDS) uniform[k] = 1 / INDEX_KINDS.length;
    return uniform as Record<IndexKind, number>;
  }
  const out: Partial<Record<IndexKind, number>> = {};
  for (const k of INDEX_KINDS) out[k] = Math.max(0, weights[k] ?? 0) / sum;
  return out as Record<IndexKind, number>;
}

export function fitness(strategy: Strategy): number {
  return mf({ samples: strategy.samples });
}

function crossover(a: Strategy, b: Strategy, rng: () => number, newId: string, generation: number): Strategy {
  // Uniform crossover: each gene picked from a or b with 50/50
  const w: Partial<Record<IndexKind, number>> = {};
  for (const k of INDEX_KINDS) {
    w[k] = rng() < 0.5 ? a.weights[k] : b.weights[k];
  }
  return {
    id: newId,
    weights: normalize(w as Record<IndexKind, number>),
    samples: [],
    generation,
  };
}

function mutate(strategy: Strategy, cfg: EvolutionConfig, rng: () => number): Strategy {
  const w: Partial<Record<IndexKind, number>> = {};
  for (const k of INDEX_KINDS) {
    if (rng() < cfg.mutationRate) {
      // Gaussian-ish noise via Box-Muller
      const u1 = Math.max(1e-9, rng());
      const u2 = rng();
      const noise = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2) * cfg.mutationSigma;
      w[k] = Math.max(0, strategy.weights[k] + noise);
    } else {
      w[k] = strategy.weights[k];
    }
  }
  return {
    id: strategy.id,
    weights: normalize(w as Record<IndexKind, number>),
    samples: strategy.samples,
    generation: strategy.generation,
  };
}

/**
 * Evolve a population by one generation. Pure function — same population
 * + config + seed → same next population.
 */
export function evolveGeneration(
  population: Strategy[],
  config: Partial<EvolutionConfig> = {},
): Strategy[] {
  const cfg: EvolutionConfig = { ...DEFAULT_CONFIG, ...config };
  if (population.length === 0) return [];

  // Sort by fitness desc
  const ranked = [...population].sort((a, b) => fitness(b) - fitness(a) || a.id.localeCompare(b.id));

  const rng = mulberry32(cfg.seed);
  const elites = ranked.slice(0, Math.max(0, cfg.eliteCount)).map((s) => ({ ...s, generation: s.generation + 1 }));
  const nextPop: Strategy[] = [...elites];
  let counter = 0;
  const generation = (ranked[0]?.generation ?? 0) + 1;

  // Tournament-of-2 selection over the top half (preserves quality + diversity)
  const breedingPool = ranked.slice(0, Math.max(2, Math.ceil(ranked.length / 2)));

  while (nextPop.length < cfg.populationSize) {
    const parent1 = breedingPool[Math.floor(rng() * breedingPool.length)]!;
    const parent2 = breedingPool[Math.floor(rng() * breedingPool.length)]!;
    const childId = `g${generation}-c${counter++}`;
    const child = crossover(parent1, parent2, rng, childId, generation);
    nextPop.push(mutate(child, cfg, rng));
  }
  return nextPop;
}

/**
 * Build an initial population with random uniform-ish weights.
 * Deterministic for the same seed.
 */
export function seedPopulation(size: number, seed: number = DEFAULT_CONFIG.seed): Strategy[] {
  const rng = mulberry32(seed);
  const out: Strategy[] = [];
  for (let i = 0; i < size; i++) {
    const w: Partial<Record<IndexKind, number>> = {};
    for (const k of INDEX_KINDS) w[k] = rng();
    out.push({
      id: `seed-${i}`,
      weights: normalize(w as Record<IndexKind, number>),
      samples: [],
      generation: 0,
    });
  }
  return out;
}
