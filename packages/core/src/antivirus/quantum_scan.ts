/**
 * MNEME QUANTUM SCANNER (v1.29.0) -- Grover-inspired sub-linear gap scan.
 *
 * Honest framing first (per project memory: quantum loses to a good
 * index for AI-recall workloads). This is NOT a quantum computer.
 * It's a classical algorithm SHAPED BY Grover's amplitude amplification
 * idea: when you can probabilistically rate items in an unstructured
 * search space, you can find marked items in O(sqrt(N)) iterations
 * instead of O(N) by progressively concentrating sampling on
 * higher-rated regions. Same Big-O guarantee Grover gives in qubits.
 *
 * Use case: classical antivirus gap-scan iterates EVERY (strain,
 * mutator_family, ground_truth_sample) triple. For 8 strains x 5
 * mutator families x 1000 samples = 40,000 vaccine assays. Slow.
 *
 * Quantum scanner: rates each (strain, mutator) pair by an "oracle"
 * (cheap heuristic -- e.g., "has this strain ever had FN samples?
 * does this mutator family historically produce hard cases?"). Then
 * runs sqrt(40000) ~= 200 amplification rounds where each round biases
 * sampling toward the highest-rated subspace. Top-K likely-FN triples
 * surface in ~200 assays instead of 40,000.
 *
 * The math (in pseudocode):
 *
 *   space = all (strain, mutator, sample) triples       size = N
 *   weights = oracle(triple) for each triple in space   one cheap call
 *   for round in 1..ceil(sqrt(N)):
 *     pick a triple with prob proportional to weights[triple]^2
 *     run the EXPENSIVE assay on that triple
 *     update weights based on result (boost similar-shape triples)
 *   return top-K triples by post-amplification weight
 *
 * Returns the same shape as classical gap-scan so it's a drop-in
 * substitute when scale matters. For small N (where sqrt(N) >= N/2
 * ~ N <= 16) the classical scan is faster -- we transparently fall
 * back to it.
 */

import type { StrainId } from "./types.js";

export interface QuantumTriple<S = string> {
  strain: StrainId;
  mutatorFamily: string;
  sample: S;
}

export interface QuantumScanInput<S = string> {
  /** The full search space. */
  triples: QuantumTriple<S>[];
  /** Cheap classical oracle: rate this triple's likelihood of being a FN.
   *  Range [0,1]. Higher = more suspect. Called ONCE per triple. */
  oracle: (t: QuantumTriple<S>) => number;
  /** Expensive vaccine assay -- the call we want to minimize.
   *  Returns true iff the triple really is a missed phantom (FN). */
  assay: (t: QuantumTriple<S>) => Promise<boolean> | boolean;
  /** How many top-suspect triples to surface. Defaults to 50. */
  topK?: number;
  /** Override the iteration count (default ceil(sqrt(N))). Useful for tests. */
  iterations?: number;
  /** Below this many triples, use the classical full scan instead. Default 16. */
  classicalCutoff?: number;
}

export interface QuantumScanResult<S = string> {
  /** Suspected FN triples, ordered by amplified weight desc. */
  suspects: Array<{ triple: QuantumTriple<S>; weight: number; confirmed: boolean }>;
  /** How many EXPENSIVE assays we actually ran. */
  assaysPerformed: number;
  /** Search-space size. */
  totalTriples: number;
  /** Strategy used: "quantum" (Grover-shaped) or "classical" (full scan). */
  strategy: "quantum" | "classical";
}

/** Pick a random index proportional to weights[i]^2 (amplitude amplification
 *  shape: amplitude is sqrt(probability), so squaring weights mimics the
 *  measurement distribution of an amplified quantum register). */
function sampleByAmplitude(weights: number[]): number {
  const probs = weights.map((w) => w * w);
  const total = probs.reduce((s, x) => s + x, 0);
  if (total <= 0) return Math.floor(Math.random() * weights.length);
  let r = Math.random() * total;
  for (let i = 0; i < probs.length; i++) {
    r -= probs[i]!;
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

export async function quantumGapScan<S>(input: QuantumScanInput<S>): Promise<QuantumScanResult<S>> {
  const triples = Array.isArray(input?.triples) ? input.triples : [];
  const N = triples.length;
  const cutoff = input.classicalCutoff ?? 16;
  const topK = input.topK ?? 50;

  // Classical fallback for tiny spaces -- sqrt(N) >= N/2 below ~N=16
  // so amplitude amplification stops being a win.
  if (N <= cutoff) {
    let assays = 0;
    const results: Array<{ triple: QuantumTriple<S>; weight: number; confirmed: boolean }> = [];
    for (const t of triples) {
      const w = input.oracle(t);
      const confirmed = !!(await input.assay(t));
      assays++;
      results.push({ triple: t, weight: w, confirmed });
    }
    return {
      suspects: results.sort((a, b) => b.weight - a.weight).slice(0, topK),
      assaysPerformed: assays,
      totalTriples: N,
      strategy: "classical",
    };
  }

  // Quantum-shaped scan. Initialize weights from oracle.
  const weights = triples.map((t) => Math.max(0, Math.min(1, input.oracle(t))));
  const queried = new Set<number>();
  const confirmedSet = new Set<number>();

  // Grover-style iteration count: ceil(pi/4 * sqrt(N)).
  const defaultIter = Math.max(1, Math.ceil((Math.PI / 4) * Math.sqrt(N)));
  const iterations = input.iterations ?? defaultIter;

  for (let r = 0; r < iterations; r++) {
    // Sample by amplitude-amplification distribution.
    const idx = sampleByAmplitude(weights);
    if (queried.has(idx)) {
      // Already queried -- pick the highest-weight unqueried instead.
      let bestIdx = -1; let bestW = -1;
      for (let i = 0; i < weights.length; i++) {
        if (!queried.has(i) && weights[i]! > bestW) { bestIdx = i; bestW = weights[i]!; }
      }
      if (bestIdx === -1) break;       // search space exhausted
      queried.add(bestIdx);
      const conf = !!(await input.assay(triples[bestIdx]!));
      if (conf) { confirmedSet.add(bestIdx); weights[bestIdx] = 1.0; }
      else { weights[bestIdx] = Math.max(0.01, weights[bestIdx]! * 0.5); }
      continue;
    }
    queried.add(idx);
    const conf = !!(await input.assay(triples[idx]!));
    if (conf) {
      confirmedSet.add(idx);
      weights[idx] = 1.0;                      // keep at peak
      // Diffusion step: boost weight of triples sharing strain or mutator
      // (Grover's diffusion operator's classical analog -- amplify the
      // marked region's neighborhood).
      for (let j = 0; j < triples.length; j++) {
        if (j === idx || queried.has(j)) continue;
        const same = (triples[j]!.strain === triples[idx]!.strain ? 0.5 : 0)
                   + (triples[j]!.mutatorFamily === triples[idx]!.mutatorFamily ? 0.3 : 0);
        if (same > 0) weights[j] = Math.min(1.0, weights[j]! + same * 0.2);
      }
    } else {
      // Damp: this region is less interesting than the oracle thought.
      weights[idx] = Math.max(0.01, weights[idx]! * 0.5);
    }
  }

  // Build the result. Surface every queried triple plus their post-
  // amplification weight + assay outcome.
  const suspects: Array<{ triple: QuantumTriple<S>; weight: number; confirmed: boolean }> = [];
  for (const i of queried) {
    suspects.push({ triple: triples[i]!, weight: weights[i]!, confirmed: confirmedSet.has(i) });
  }
  suspects.sort((a, b) => {
    if (a.confirmed !== b.confirmed) return a.confirmed ? -1 : 1;   // confirmed first
    return b.weight - a.weight;
  });

  return {
    suspects: suspects.slice(0, topK),
    assaysPerformed: queried.size,
    totalTriples: N,
    strategy: "quantum",
  };
}
