/**
 * v2.33.0 — Differential privacy primitives for MNEMNET.
 *
 * Laplace mechanism: noise ~ Laplace(0, 1/ε). Each contributor adds
 * noise BEFORE leaving the node — the aggregator never sees raw
 * counts. We provide a deterministic-seed variant for tests.
 */

import { createHash } from "node:crypto";

/** Laplace sample with scale b. Uses U ~ Uniform(-0.5, 0.5) inversion. */
export function laplaceSample(scale: number, rng: () => number = Math.random): number {
  const u = rng() - 0.5;
  // sign(u) * b * ln(1 - 2|u|)
  return -scale * Math.sign(u) * Math.log(1 - 2 * Math.abs(u));
}

export function makeDeterministicRng(seed: string): () => number {
  let state = parseInt(createHash("sha256").update(seed).digest("hex").slice(0, 12), 16);
  return () => {
    // xorshift32-ish — deterministic per seed; fine for tests.
    state = (state ^ (state << 13)) >>> 0;
    state = (state ^ (state >>> 17)) >>> 0;
    state = (state ^ (state << 5)) >>> 0;
    return (state >>> 0) / 0xffffffff;
  };
}

/** Add Laplace noise to a count under ε-DP. Returns floor-clamped >= 0. */
export function noisedCount(trueCount: number, epsilon: number, rng: () => number = Math.random): number {
  if (epsilon <= 0) return trueCount; // no privacy budget = no noise (caller bears risk)
  const noise = laplaceSample(1 / epsilon, rng);
  return Math.max(0, Math.round(trueCount + noise));
}
