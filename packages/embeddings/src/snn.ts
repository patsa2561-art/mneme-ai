/**
 * v2.19.16 — SNN EmbeddingProvider adapter
 *
 *   Wraps the v2.19.13 NEUROMORPHIC SPIKING EMBEDDER (32 populations ×
 *   64 neurons → 2048-dim sparse firing-rate vector) as an
 *   `EmbeddingProvider` so it slots into the resolve.ts fallback ladder
 *   BETWEEN bundled (WASM, may fail) and hash (deterministic last resort).
 *
 *   Why this matters:
 *     - Pure TypeScript, no WASM bridge, no native deps → never EBUSY.
 *     - Deterministic per seed → identical embeddings across machines.
 *     - 2048-dim sparse firing rates → genuine semantic structure,
 *       unlike hash:fnv-256 which just sprays bits.
 *     - Adversarially tunable via mneme.snn.finetune (per-repo phenotype).
 *
 *   Honest scope: SNN loses ~15-20% to transformers on MTEB English-
 *   general. For Mneme's code-corpus + Markdown + prose use cases it's
 *   a real upgrade over hash:fnv-256.
 */

import type { EmbeddingProvider } from "@mneme-ai/core";
import { neuromorphicEmbedder } from "@mneme-ai/core";

export interface SnnEmbedderOptions {
  /** PRNG seed for reproducible per-machine phenotype. Default 1. */
  seed?: number;
  /** Populations × neuronsPerPop = embedding dim. Defaults 32 × 64 = 2048. */
  populations?: number;
  neuronsPerPop?: number;
  /** SNN timesteps per embed call. Default 50. */
  steps?: number;
}

export class SnnEmbedder implements EmbeddingProvider {
  readonly name = "snn:lif-32x64";
  readonly dimensions: number;
  private readonly embedder: ReturnType<typeof neuromorphicEmbedder.createEmbedder>;

  constructor(opts: SnnEmbedderOptions = {}) {
    const populations = opts.populations ?? 32;
    const neuronsPerPop = opts.neuronsPerPop ?? 64;
    this.dimensions = populations * neuronsPerPop;
    this.embedder = neuromorphicEmbedder.createEmbedder({
      seed: opts.seed ?? 1,
      populations,
      neuronsPerPop,
      steps: opts.steps ?? 50,
    });
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => neuromorphicEmbedder.embed(this.embedder, t).vector);
  }
}
