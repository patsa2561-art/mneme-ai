/**
 * v2.0.0 -- BLOODLINE · Personal AI Genetic Strain
 *
 *   "After 6 months, your Mneme is no longer the same species as anyone
 *    else's. They cloned the repo — they got the phenotype, not the
 *    genotype."
 *
 * Mneme already ships:
 *   - MneMeiosis chromosomes (genome of decisions / regrets / wisdoms)
 *   - ATOM karma per chromosome
 *   - apoptosis (cell death) on consistently-bad chromosomes
 *
 * What was MISSING: evolutionary pressure that selects, mutates, and
 * propagates chromosomes over time. BLOODLINE adds it. Three loops:
 *
 *   ✓ verified-good outcome    → reinforce chromosome fitness +0.10
 *   ⚠ hallucination caught    → propagate vaccine variant
 *   ✗ user rejected            → decay branch fitness -0.20
 *
 * Plus a DNA fingerprint that's a deterministic hash of the user's
 * cumulative fitness landscape — guaranteed unique across users after
 * a few weeks of normal use because no two users land the same
 * sequence of verified-good / hallucination / rejection events.
 *
 * Plus a "personality report" that grades this user's genome against a
 * neutral baseline: "your AI is 3.7σ more cautious about Redis than
 * baseline (incident 2026-03-14 still influences your chromosome
 * `c0ff33-redis-sessions`)".
 *
 * Pure function. Deterministic. No external deps.
 * Backward compatible — composes with chromosomes/vaccines that already exist.
 */

import { createHash } from "node:crypto";

export type EventKind = "verified-good" | "hallucination" | "user-rejected" | "user-confirmed";

export interface BloodlineEvent {
  /** Stable id (sha256 prefix). */
  id: string;
  /** Wall-clock when the event happened. */
  ts: number;
  kind: EventKind;
  /** Which chromosome/strain the event refers to. */
  strainId: string;
  /** Free-form narrative for audit. */
  trace: string;
  /** Optional 0..1 magnitude (e.g. severity of hallucination). */
  weight?: number;
}

export interface StrainState {
  id: string;
  /** Fitness 0..∞. Default 1.0. Reinforce adds, decay multiplies. */
  fitness: number;
  /** Number of events this strain has accumulated. */
  events: number;
  /** Number of vaccine variants spawned from this strain. */
  vaccineVariants: number;
  /** Last-touched timestamp. */
  lastTouched: number;
  /** Cumulative reinforcement (positive events). */
  reinforced: number;
  /** Cumulative decay (negative events). */
  decayed: number;
  /** True if strain is below apoptosis threshold (effectively dead). */
  apoptosed: boolean;
}

export interface Genome {
  /** Map strainId → state. */
  strains: Map<string, StrainState>;
  /** All events ever applied, newest last. */
  history: BloodlineEvent[];
}

// ============================================================
// Genome lifecycle
// ============================================================

export function createGenome(): Genome {
  return { strains: new Map(), history: [] };
}

/** Constants tunable per deployment (also exposed for tests). */
export const PRESSURE = {
  REINFORCE_BOOST: 0.10,
  DECAY_FACTOR: 0.80,        // multiply fitness by this on user-rejected
  HALLUCINATION_VARIANT: 0.05, // small fitness bump for the parent strain when a vaccine variant is spawned
  APOPTOSIS_THRESHOLD: 0.10,   // below this fitness → strain marked apoptosed
};

/** Apply one event to the genome. Mutates the genome IN PLACE — pure
 *  in the functional sense that same (genome, event) → same final state. */
export function applyEvolutionaryPressure(genome: Genome, event: BloodlineEvent): StrainState {
  let strain = genome.strains.get(event.strainId);
  if (!strain) {
    strain = {
      id: event.strainId,
      fitness: 1.0,
      events: 0,
      vaccineVariants: 0,
      lastTouched: event.ts,
      reinforced: 0,
      decayed: 0,
      apoptosed: false,
    };
    genome.strains.set(event.strainId, strain);
  }

  const weight = event.weight ?? 1.0;
  switch (event.kind) {
    case "verified-good":
    case "user-confirmed": {
      const boost = PRESSURE.REINFORCE_BOOST * weight;
      strain.fitness += boost;
      strain.reinforced += boost;
      break;
    }
    case "hallucination": {
      // Spawn a vaccine variant for this strain. Slight reinforcement for
      // the parent strain because catching a hallucination IS a fitness signal.
      strain.vaccineVariants += 1;
      const bump = PRESSURE.HALLUCINATION_VARIANT * weight;
      strain.fitness += bump;
      strain.reinforced += bump;
      break;
    }
    case "user-rejected": {
      const factor = Math.pow(PRESSURE.DECAY_FACTOR, weight);
      const beforeFit = strain.fitness;
      strain.fitness *= factor;
      strain.decayed += (beforeFit - strain.fitness);
      break;
    }
  }

  strain.events += 1;
  strain.lastTouched = event.ts;
  strain.apoptosed = strain.fitness < PRESSURE.APOPTOSIS_THRESHOLD;
  genome.history.push(event);
  return strain;
}

/** Batch-apply many events. */
export function batchApply(genome: Genome, events: readonly BloodlineEvent[]): void {
  for (const e of events) applyEvolutionaryPressure(genome, e);
}

// ============================================================
// DNA Fingerprint
// ============================================================

/** Compute a deterministic 16-hex DNA fingerprint that's unique across
 *  users after a handful of events. Sensitive to both WHICH strains and
 *  WHAT ORDER events arrived in. */
export function computeDnaFingerprint(genome: Genome): string {
  const h = createHash("sha256");
  // Sort strains by id for stable hashing.
  const sorted = [...genome.strains.values()].sort((a, b) => a.id.localeCompare(b.id));
  for (const s of sorted) {
    h.update(`${s.id}|${s.fitness.toFixed(6)}|${s.events}|${s.vaccineVariants}|${s.apoptosed ? "X" : "."};`);
  }
  // Also include event arrival ORDER (a unique-to-user signal).
  for (const e of genome.history) {
    h.update(`${e.kind}|${e.strainId};`);
  }
  return h.digest("hex").slice(0, 16);
}

// ============================================================
// Personality report — sigma deviation from baseline
// ============================================================

export interface BaselineStats {
  /** Map strainId → expected mean fitness in the population. */
  meanFitness: Record<string, number>;
  /** Map strainId → population stddev. */
  stdDev: Record<string, number>;
}

export interface PersonalityReport {
  totalStrains: number;
  apoptosedStrains: number;
  topReinforced: Array<{ strainId: string; fitness: number; reinforced: number }>;
  topDecayed: Array<{ strainId: string; fitness: number; decayed: number }>;
  sigmaDeviations: Array<{ strainId: string; fitness: number; baseline: number; sigma: number }>;
  /** Cumulative reinforcement minus decay — overall colony health. */
  healthScore: number;
  /** Best-effort one-liner for AI agent to surface. */
  summary: string;
}

/** Compute the personality report given the user's genome and an
 *  optional population baseline. */
export function personalityReport(genome: Genome, baseline?: BaselineStats): PersonalityReport {
  const all = [...genome.strains.values()];
  const apoptosed = all.filter((s) => s.apoptosed).length;
  const topReinforced = [...all].sort((a, b) => b.reinforced - a.reinforced).slice(0, 5).map((s) => ({ strainId: s.id, fitness: s.fitness, reinforced: s.reinforced }));
  const topDecayed = [...all].sort((a, b) => b.decayed - a.decayed).slice(0, 5).map((s) => ({ strainId: s.id, fitness: s.fitness, decayed: s.decayed }));

  const sigmaDeviations: PersonalityReport["sigmaDeviations"] = [];
  if (baseline) {
    for (const s of all) {
      const mean = baseline.meanFitness[s.id];
      const sd = baseline.stdDev[s.id];
      if (mean === undefined || sd === undefined || sd === 0) continue;
      const sigma = (s.fitness - mean) / sd;
      if (Math.abs(sigma) >= 1) sigmaDeviations.push({ strainId: s.id, fitness: s.fitness, baseline: mean, sigma });
    }
    sigmaDeviations.sort((a, b) => Math.abs(b.sigma) - Math.abs(a.sigma));
  }

  const healthScore = all.reduce((sum, s) => sum + s.reinforced - s.decayed, 0);

  let summary = `BLOODLINE · ${all.length} strain(s) · ${apoptosed} apoptosed · health=${healthScore.toFixed(2)}`;
  if (sigmaDeviations.length > 0) {
    const top = sigmaDeviations[0]!;
    const direction = top.sigma > 0 ? "more aggressive at reinforcing" : "more cautious about";
    summary += ` · top deviation: ${top.sigma.toFixed(1)}σ ${direction} '${top.strainId}'`;
  }

  return { totalStrains: all.length, apoptosedStrains: apoptosed, topReinforced, topDecayed, sigmaDeviations, healthScore, summary };
}

// ============================================================
// Pulse line + serialization
// ============================================================

export function formatBloodlinePulseLine(genome: Genome): string {
  const dna = computeDnaFingerprint(genome);
  const r = personalityReport(genome);
  return `BLOODLINE · DNA=${dna} · ${r.totalStrains} strain(s) · ${r.apoptosedStrains} apoptosed · health=${r.healthScore.toFixed(2)}`;
}

/** Serialize the genome to JSON for persistence in .mneme/bloodline.json. */
export function serializeGenome(genome: Genome): string {
  // StrainState already has an `id` field; just dump the values.
  return JSON.stringify({
    strains: [...genome.strains.values()],
    history: genome.history,
  });
}

export function parseGenome(text: string): Genome | null {
  try {
    const obj = JSON.parse(text);
    if (!obj || !Array.isArray(obj.strains) || !Array.isArray(obj.history)) return null;
    const strains = new Map<string, StrainState>();
    for (const s of obj.strains) strains.set(s.id, s);
    return { strains, history: obj.history };
  } catch {
    return null;
  }
}
