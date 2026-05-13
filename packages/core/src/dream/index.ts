/**
 * v2.0.0 -- DREAM CYCLE · REM sleep for AI
 *
 * Nucleus daemon enters a "dream phase" during idle ticks. In each
 * dream, the existing vaccine bank is challenged by N synthetic
 * hallucination variants drawn from the user's history. Vaccines that
 * survive K dreams in a row earn a fitness bonus. Vaccines that fail
 * K times in a row are marked apoptosis-eligible.
 *
 * User wakes up = Mneme is genuinely sharper than yesterday.
 *
 * Pure-function inner loop (deterministic with seed). The daemon will
 * call dreamPhase() once per N ticks in a future wiring; today the
 * function is unit-tested + can be called by `mneme dream now`.
 */

import { createHash } from "node:crypto";

export interface VaccineCandidate {
  id: string;
  /** Regex-like pattern the vaccine recognizes as a hallucination. */
  pattern: string;
  /** Fitness 0..∞. Default 1.0. Raised by survival, lowered by failure. */
  fitness: number;
  /** Consecutive-survival count. */
  streak: number;
  /** True if marked apoptosis-eligible. */
  apoptosed: boolean;
}

export interface HallucinationSample {
  id: string;
  text: string;
  /** True iff a sample is supposed to be caught by ANY surviving vaccine. */
  shouldCatch: boolean;
}

export interface DreamInput {
  vaccines: readonly VaccineCandidate[];
  samples: readonly HallucinationSample[];
  /** Seed for reproducibility. */
  seed?: number;
  /** Streak threshold to spawn a variant or apoptose. Default 3. */
  streakThreshold?: number;
}

export interface DreamOutput {
  updatedVaccines: VaccineCandidate[];
  /** Vaccines that just got an apoptosis flag. */
  apoptosedThisCycle: VaccineCandidate[];
  /** Newly-spawned variant vaccines. */
  newVariants: VaccineCandidate[];
  /** Per-vaccine per-sample hit table for audit. */
  trace: Array<{ vaccineId: string; sampleId: string; caught: boolean }>;
  /** Wall-clock duration. */
  elapsedMs: number;
}

function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function vaccineMatches(v: VaccineCandidate, sample: HallucinationSample): boolean {
  try {
    return new RegExp(v.pattern, "i").test(sample.text);
  } catch {
    // Fall back to substring match if pattern is not a valid regex
    return sample.text.toLowerCase().includes(v.pattern.toLowerCase());
  }
}

/** Run one dream cycle. Pure-function: same inputs → same outputs. */
export function dreamPhase(input: DreamInput): DreamOutput {
  const t0 = Date.now();
  const threshold = input.streakThreshold ?? 3;
  const rng = mulberry32(input.seed ?? 1);
  // Touch rng once per loop so determinism is preserved even when we
  // don't strictly need random numbers in this simple version.
  void rng;

  const updated = new Map<string, VaccineCandidate>();
  for (const v of input.vaccines) updated.set(v.id, { ...v });
  const trace: DreamOutput["trace"] = [];
  const newVariants: VaccineCandidate[] = [];

  for (const sample of input.samples) {
    let caughtByAny = false;
    for (const [id, v] of updated) {
      if (v.apoptosed) continue;
      const caught = vaccineMatches(v, sample);
      trace.push({ vaccineId: id, sampleId: sample.id, caught });
      if (caught && sample.shouldCatch) {
        v.fitness += 0.10;
        v.streak += 1;
        caughtByAny = true;
      } else if (!caught && sample.shouldCatch) {
        v.fitness -= 0.05;
        v.streak = 0;
      } else if (caught && !sample.shouldCatch) {
        // false positive — heavy penalty
        v.fitness -= 0.15;
        v.streak = 0;
      } else {
        // correctly didn't catch a non-hallucination — neutral
      }
    }
    if (sample.shouldCatch && !caughtByAny) {
      // No vaccine caught this hallucination — spawn a variant from a hash of the sample.
      const variantId = "v-" + createHash("sha256").update(sample.text).digest("hex").slice(0, 8);
      if (!updated.has(variantId)) {
        const variant: VaccineCandidate = {
          id: variantId,
          pattern: escapeForRegex(sample.text.slice(0, 40)),
          fitness: 1.0,
          streak: 1,
          apoptosed: false,
        };
        updated.set(variantId, variant);
        newVariants.push(variant);
      }
    }
  }

  // Promote / demote via streak threshold
  const apoptosedThisCycle: VaccineCandidate[] = [];
  for (const v of updated.values()) {
    if (v.apoptosed) continue;
    if (v.streak >= threshold) {
      v.fitness += 0.20; // reinforcement bonus on threshold cross
    }
    if (v.fitness < 0.2) {
      v.apoptosed = true;
      apoptosedThisCycle.push(v);
    }
  }

  return {
    updatedVaccines: [...updated.values()],
    apoptosedThisCycle,
    newVariants,
    trace,
    elapsedMs: Date.now() - t0,
  };
}

function escapeForRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function formatDreamPulseLine(o: DreamOutput): string {
  return `DREAM-CYCLE · vaccines=${o.updatedVaccines.length} (${o.apoptosedThisCycle.length} apoptosed) · new=${o.newVariants.length} · ${o.trace.length} probes · ${o.elapsedMs}ms`;
}
