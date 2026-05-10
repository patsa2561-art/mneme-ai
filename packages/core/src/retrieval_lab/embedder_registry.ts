/**
 * Pluggable embedder backends.
 *
 * "bundled-bge-small" is the existing default (free, ships in npm).
 * "bundled-bge-m3"     is the new multilingual upgrade (free, larger).
 * "voyage-3"           uses Voyage AI (highest-quality, paid; needs key).
 * "openai-3-small"     uses OpenAI text-embedding-3-small (paid; needs key).
 * "openai-3-large"     uses OpenAI text-embedding-3-large (paid; needs key).
 *
 * Free path: bundled-* always works without keys. The Lab tuner only
 * picks paid backends when an API key is detected in the environment
 * (and even then, only if its trial F1 beats the free baseline).
 */

import type { EmbedderBackendId } from "./types.js";

export interface EmbedderBackend {
  id: EmbedderBackendId;
  /** Plain-English name for the Lab UI. */
  label: string;
  /** Output vector dimension. */
  dim: number;
  /** Where this backend runs: in-process WASM or external API. */
  execMode: "in-process" | "remote-api";
  /** Required env var(s) for paid backends, if any. */
  apiKeyEnvVar?: string;
  /** True when this backend is usable RIGHT NOW (free or key present). */
  available: () => boolean;
}

export const EMBEDDER_REGISTRY: Record<EmbedderBackendId, EmbedderBackend> = {
  "bundled-bge-small": {
    id: "bundled-bge-small",
    label: "BGE-small-en (bundled, free)",
    dim: 384,
    execMode: "in-process",
    available: () => true,
  },
  "bundled-bge-m3": {
    id: "bundled-bge-m3",
    label: "BGE-M3 (bundled, multilingual, free)",
    dim: 1024,
    execMode: "in-process",
    available: () => true,
  },
  "voyage-3": {
    id: "voyage-3",
    label: "Voyage-3 (top quality; paid)",
    dim: 1024,
    execMode: "remote-api",
    apiKeyEnvVar: "VOYAGE_API_KEY",
    available: () => Boolean(process.env["VOYAGE_API_KEY"]),
  },
  "openai-3-small": {
    id: "openai-3-small",
    label: "OpenAI text-embedding-3-small (paid)",
    dim: 1536,
    execMode: "remote-api",
    apiKeyEnvVar: "OPENAI_API_KEY",
    available: () => Boolean(process.env["OPENAI_API_KEY"]),
  },
  "openai-3-large": {
    id: "openai-3-large",
    label: "OpenAI text-embedding-3-large (paid)",
    dim: 3072,
    execMode: "remote-api",
    apiKeyEnvVar: "OPENAI_API_KEY",
    available: () => Boolean(process.env["OPENAI_API_KEY"]),
  },
};

/** Return the subset of backends usable right now (free + keys-present). */
export function availableEmbedders(): EmbedderBackend[] {
  return Object.values(EMBEDDER_REGISTRY).filter((e) => e.available());
}

/** Embed a batch of texts using the named backend. Free backends use
 *  the existing @huggingface/transformers pipeline; remote backends
 *  POST to the vendor's API. Returns Float32Array per text. */
export async function embedWithBackend(
  backend: EmbedderBackendId,
  texts: string[],
): Promise<number[][]> {
  const spec = EMBEDDER_REGISTRY[backend];
  if (spec.execMode === "in-process") {
    return embedInProcess(backend, texts);
  }
  if (backend === "voyage-3") return embedVoyage(texts);
  if (backend === "openai-3-small") return embedOpenAI(texts, "text-embedding-3-small");
  if (backend === "openai-3-large") return embedOpenAI(texts, "text-embedding-3-large");
  throw new Error(`unknown embedder backend: ${backend}`);
}

async function embedInProcess(backend: EmbedderBackendId, texts: string[]): Promise<number[][]> {
  const modelId = backend === "bundled-bge-m3" ? "Xenova/bge-m3" : "Xenova/bge-small-en-v1.5";
  const transformers = (await import("@huggingface/transformers")) as unknown as {
    pipeline: (task: string, model: string) => Promise<(t: string[], opts: { pooling: string; normalize: boolean }) => Promise<{ data: Float32Array }>>;
  };
  const pipe = await transformers.pipeline("feature-extraction", modelId);
  const out = await pipe(texts, { pooling: "mean", normalize: true });
  // Output shape: [N, dim] flattened to Float32Array.
  const dim = out.data.length / texts.length;
  const result: number[][] = [];
  for (let i = 0; i < texts.length; i++) {
    const slice = Array.from(out.data.slice(i * dim, (i + 1) * dim));
    result.push(slice);
  }
  return result;
}

async function embedVoyage(texts: string[]): Promise<number[][]> {
  const key = process.env["VOYAGE_API_KEY"];
  if (!key) throw new Error("VOYAGE_API_KEY not set");
  const r = await fetch("https://api.voyageai.com/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${key}` },
    body: JSON.stringify({ input: texts, model: "voyage-3" }),
  });
  if (!r.ok) throw new Error(`voyage embed failed: HTTP ${r.status}`);
  const data = await r.json() as { data: Array<{ embedding: number[] }> };
  return data.data.map((d) => d.embedding);
}

async function embedOpenAI(texts: string[], model: string): Promise<number[][]> {
  const key = process.env["OPENAI_API_KEY"];
  if (!key) throw new Error("OPENAI_API_KEY not set");
  const r = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json", "authorization": `Bearer ${key}` },
    body: JSON.stringify({ input: texts, model }),
  });
  if (!r.ok) throw new Error(`openai embed failed: HTTP ${r.status}`);
  const data = await r.json() as { data: Array<{ embedding: number[] }> };
  return data.data.map((d) => d.embedding);
}
