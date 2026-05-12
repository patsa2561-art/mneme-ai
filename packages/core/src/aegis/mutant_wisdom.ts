/**
 * v1.67.0 -- AEGIS A8: MUTANT WISDOM.
 *
 * Adaptive defense. AEGIS thresholds (replication burst window,
 * polygraph drift gate, killswitch grace period) MUTATE based on
 * the attack history Mneme has accumulated. The more attacks we
 * survive, the harder we are to fool.
 *
 *   gradient update:
 *     new = old * (1 - alpha) + sample * alpha
 *
 * where `sample` is the observed attack characteristic and `alpha`
 * is the learning rate (default 0.1). Bounded by per-axis hard
 * limits so a single noisy attack can't drag thresholds to absurd
 * values.
 *
 * Storage: .mneme/aegis/mutant-genome.json
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const AEGIS_DIR = ".mneme/aegis";
const GENOME_FILE = ".mneme/aegis/mutant-genome.json";

export interface MutantGenome {
  schemaVersion: 1;
  /** ISO ts of last mutation. */
  lastMutatedAt: string;
  /** Generation counter (incremented every mutation). */
  generation: number;
  /** Cumulative attack samples seen per axis. */
  samplesSeen: Record<string, number>;
  /** Active threshold per axis. */
  thresholds: {
    /** Replication burst: distinct hosts within window to flag SUSPECTED. */
    burstSuspectedHosts: number;
    /** Replication burst: window in ms. */
    burstWindowMs: number;
    /** Polygraph drift gate. */
    polygraphDriftGate: number;
    /** Killswitch grace period ms. */
    killswitchGraceMs: number;
    /** Honeypot bites/24h before SEVERE federation broadcast. */
    honeypotSevereBiteRate: number;
  };
}

const DEFAULT_GENOME: MutantGenome = {
  schemaVersion: 1,
  lastMutatedAt: new Date(0).toISOString(),
  generation: 0,
  samplesSeen: {},
  thresholds: {
    burstSuspectedHosts: 3,
    burstWindowMs: 10 * 60 * 1000,
    polygraphDriftGate: 0.15,
    killswitchGraceMs: 30_000,
    honeypotSevereBiteRate: 5,
  },
};

/** Hard min/max per axis so mutations can't push thresholds to absurd. */
const BOUNDS = {
  burstSuspectedHosts: { min: 2, max: 8 },
  burstWindowMs: { min: 60_000, max: 60 * 60 * 1000 },
  polygraphDriftGate: { min: 0.05, max: 0.4 },
  killswitchGraceMs: { min: 5_000, max: 5 * 60 * 1000 },
  honeypotSevereBiteRate: { min: 2, max: 50 },
};

function clamp(axis: keyof typeof BOUNDS, v: number): number {
  const b = BOUNDS[axis];
  return Math.max(b.min, Math.min(b.max, v));
}

export function readGenome(repoRoot: string): MutantGenome {
  const path = join(repoRoot, GENOME_FILE);
  if (!existsSync(path)) return { ...DEFAULT_GENOME, thresholds: { ...DEFAULT_GENOME.thresholds } };
  try {
    const j = JSON.parse(readFileSync(path, "utf8")) as MutantGenome;
    // Backfill missing fields if any.
    return {
      ...DEFAULT_GENOME,
      ...j,
      thresholds: { ...DEFAULT_GENOME.thresholds, ...(j.thresholds ?? {}) },
      samplesSeen: { ...(j.samplesSeen ?? {}) },
    };
  } catch {
    return { ...DEFAULT_GENOME, thresholds: { ...DEFAULT_GENOME.thresholds } };
  }
}

function writeGenome(repoRoot: string, g: MutantGenome): void {
  const dir = join(repoRoot, AEGIS_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(repoRoot, GENOME_FILE), JSON.stringify(g, null, 2) + "\n", "utf8");
}

export type MutateAxis = keyof MutantGenome["thresholds"];

export interface MutateInput {
  /** Which axis we're updating. */
  axis: MutateAxis;
  /** Observed sample (attack characteristic). */
  sample: number;
  /** Learning rate [0, 1]. Default 0.1. */
  alpha?: number;
}

/** Apply one gradient mutation. Returns the new genome. */
export function mutate(repoRoot: string, input: MutateInput): MutantGenome {
  const g = readGenome(repoRoot);
  const alpha = input.alpha ?? 0.1;
  const current = g.thresholds[input.axis];
  const next = clamp(input.axis, current * (1 - alpha) + input.sample * alpha);
  g.thresholds[input.axis] = next;
  g.samplesSeen[input.axis] = (g.samplesSeen[input.axis] ?? 0) + 1;
  g.generation += 1;
  g.lastMutatedAt = new Date().toISOString();
  writeGenome(repoRoot, g);
  return g;
}

/** Heal back toward defaults when no recent attacks (slow drift home). */
export function decayTowardDefault(repoRoot: string, decayAlpha = 0.02): MutantGenome {
  const g = readGenome(repoRoot);
  for (const k of Object.keys(g.thresholds) as MutateAxis[]) {
    const def = DEFAULT_GENOME.thresholds[k];
    g.thresholds[k] = clamp(k, g.thresholds[k] * (1 - decayAlpha) + def * decayAlpha);
  }
  g.lastMutatedAt = new Date().toISOString();
  writeGenome(repoRoot, g);
  return g;
}

/** Reset the genome to defaults. */
export function resetGenome(repoRoot: string): MutantGenome {
  const g = { ...DEFAULT_GENOME, thresholds: { ...DEFAULT_GENOME.thresholds } };
  writeGenome(repoRoot, g);
  return g;
}

export interface MutantReport {
  generation: number;
  totalSamples: number;
  lastMutatedAt: string;
  driftFromDefault: number; // 0..1; 0 = default; 1 = at boundary on every axis
  thresholds: MutantGenome["thresholds"];
  headline: string;
}

/** Summarize the genome -- how far has Mneme adapted from defaults? */
export function mutantReport(repoRoot: string): MutantReport {
  const g = readGenome(repoRoot);
  const totalSamples = Object.values(g.samplesSeen).reduce((a, b) => a + b, 0);
  // Drift: per-axis fraction of bounds-span used.
  const driftValues: number[] = [];
  for (const k of Object.keys(g.thresholds) as MutateAxis[]) {
    const cur = g.thresholds[k];
    const def = DEFAULT_GENOME.thresholds[k];
    const b = BOUNDS[k];
    const span = Math.max(1e-9, b.max - b.min);
    driftValues.push(Math.min(1, Math.abs(cur - def) / span));
  }
  const driftFromDefault = driftValues.length === 0 ? 0 : driftValues.reduce((a, b) => a + b, 0) / driftValues.length;
  return {
    generation: g.generation,
    totalSamples,
    lastMutatedAt: g.lastMutatedAt,
    driftFromDefault,
    thresholds: g.thresholds,
    headline: `Mutant genome gen.${g.generation}, ${totalSamples} samples, drift ${(driftFromDefault * 100).toFixed(0)}%.`,
  };
}
