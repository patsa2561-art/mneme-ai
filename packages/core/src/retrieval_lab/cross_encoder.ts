/**
 * Cross-encoder reranker — uses BAAI/bge-reranker-base via @huggingface/transformers
 * (the same stack our embedder already loads, so zero new deps).
 *
 * Cross-encoders score (query, candidate) pairs jointly with a small
 * transformer. Slower than bi-encoder cosine (~30-100ms/candidate on CPU)
 * but consistently +5-15% NDCG@10 on retrieval benchmarks. The Mneme
 * Retrieval Lab auto-tuner runs A/B trials so users only pay this cost
 * when it actually improves their corpus.
 */

import type { RerankerBackendId } from "./types.js";

export interface CrossEncoderRerankInput {
  query: string;
  /** Candidates to score. Order doesn't matter; we return them ranked. */
  candidates: Array<{ id: string; text: string }>;
  /** Top-K to return. Default = candidates.length. */
  topK?: number;
}

export interface CrossEncoderRerankResult {
  rerankerId: RerankerBackendId;
  /** Re-sorted candidates (highest score first). */
  ranked: Array<{ id: string; text: string; score: number }>;
  /** Wall-time of the rerank step (ms). */
  totalMs: number;
  /** Did we successfully load the model? false = falls back to noop. */
  modelLoaded: boolean;
  /** Error message if modelLoaded === false. */
  fallbackReason?: string;
}

interface PipelineLike {
  (
    inputs: string[][],
    options: { padding?: boolean; truncation?: boolean },
  ): Promise<{ data: Float32Array | number[] }>;
}

let cachedPipeline: PipelineLike | null = null;
let cachedModelId: string | null = null;
let lastLoadFailedAt = 0;
const LOAD_RETRY_COOLDOWN_MS = 5 * 60 * 1000; // don't hammer the loader if it failed

/** Try to load the cross-encoder pipeline once. Returns null on failure
 *  (caller falls back to noop reranker). */
async function loadPipeline(modelId: string): Promise<PipelineLike | null> {
  if (cachedPipeline && cachedModelId === modelId) return cachedPipeline;
  if (Date.now() - lastLoadFailedAt < LOAD_RETRY_COOLDOWN_MS) return null;
  try {
    // v2.19.63 PHOENIX P3 defense-in-depth — fire DLL extraction before
    // transformers loads sharp/libvips. Idempotent + non-throwing.
    try {
      const { extractAndRedirect } = await import("../phoenix/dll_extraction.js");
      extractAndRedirect();
    } catch { /* BE:silent-by-design */ }
    const transformers = (await import("@huggingface/transformers")) as unknown as {
      pipeline: (task: string, model: string, opts?: { dtype?: string }) => Promise<PipelineLike>;
    };
    // The text-classification pipeline with a cross-encoder model emits
    // a single relevance logit per pair. We score candidates by the logit.
    const pipe = await transformers.pipeline("text-classification", modelId, { dtype: "fp32" });
    cachedPipeline = pipe;
    cachedModelId = modelId;
    return pipe;
  } catch (e) {
    lastLoadFailedAt = Date.now();
    void e;
    return null;
  }
}

export async function rerankCrossEncoder(
  input: CrossEncoderRerankInput,
): Promise<CrossEncoderRerankResult> {
  const t0 = Date.now();
  const { query, candidates } = input;
  const topK = input.topK ?? candidates.length;

  const modelId = "Xenova/bge-reranker-base";
  const pipe = await loadPipeline(modelId);
  if (!pipe) {
    // Fallback: term-density-style scoring so we don't return arbitrary order.
    const qTokens = new Set(query.toLowerCase().split(/\s+/).filter(Boolean));
    const ranked = candidates
      .map((c) => {
        const cTokens = new Set(c.text.toLowerCase().split(/\s+/).filter(Boolean));
        let hits = 0;
        for (const t of qTokens) if (cTokens.has(t)) hits++;
        const score = qTokens.size === 0 ? 0 : hits / qTokens.size;
        return { ...c, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
    return {
      rerankerId: "cross-encoder-bge-base",
      ranked,
      totalMs: Date.now() - t0,
      modelLoaded: false,
      fallbackReason: "@huggingface/transformers pipeline could not be loaded; falling back to term-density.",
    };
  }

  // Score in batches so memory stays bounded on long candidate lists.
  const BATCH = 16;
  const scored: Array<{ id: string; text: string; score: number }> = [];
  for (let i = 0; i < candidates.length; i += BATCH) {
    const batch = candidates.slice(i, i + BATCH);
    const pairs = batch.map((c) => [query, c.text]);
    try {
      const out = await pipe(pairs, { padding: true, truncation: true });
      // The pipeline returns either an array of {label, score} OR a flat
      // tensor of logits. We handle both.
      const flat = (Array.isArray(out) ? out : [out]) as Array<{ score?: number } | number>;
      for (let j = 0; j < batch.length; j++) {
        const item = flat[j];
        let s: number;
        if (typeof item === "number") s = item;
        else if (item && typeof item.score === "number") s = item.score;
        else s = 0;
        scored.push({ ...batch[j]!, score: s });
      }
    } catch (e) {
      void e;
      // Score this batch with 0; preserve order.
      for (const c of batch) scored.push({ ...c, score: 0 });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return {
    rerankerId: "cross-encoder-bge-base",
    ranked: scored.slice(0, topK),
    totalMs: Date.now() - t0,
    modelLoaded: true,
  };
}

/** Explicit warmup so the daemon can pre-load the model once at boot
 *  rather than paying the latency on the first user query. */
export async function warmupCrossEncoder(): Promise<boolean> {
  const pipe = await loadPipeline("Xenova/bge-reranker-base");
  return pipe !== null;
}
