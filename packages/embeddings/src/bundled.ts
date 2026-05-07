/**
 * BundledEmbedder — zero-install WASM embeddings.
 *
 * Uses @huggingface/transformers (the maintained successor to
 * @xenova/transformers from the same author, WASM-first by default,
 * onnxruntime-web — zero native deps). The tool runs on Windows / Mac /
 * Linux out of the box, including ARM64 + Node 24. The model file is
 * lazy-downloaded on first use (~25MB to a local cache), giving users a
 * "★★★ semantic quality" path without installing Ollama.
 *
 * Fallback order in resolveEmbedder():
 *   OpenAI (★★★★★ paid)  →  Ollama (★★★★ free local)
 *   →  Bundled WASM (★★★ free, no install)  →  Hash (★★ deterministic)
 */
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { EmbeddingProvider } from "@mneme-ai/core";

export interface BundledOptions {
  /** HuggingFace repo id. all-MiniLM-L6-v2 = 25MB / 384-dim — best size/quality. */
  model?: string;
  /** Override cache dir. Default: ~/.cache/mneme/models. */
  cacheDir?: string;
  /** Hook for download/load progress (lazy load can take ~5–60s on cold start). */
  onProgress?: (info: { status: string; loaded?: number; total?: number; file?: string }) => void;
}

const DEFAULT_MODEL = "Xenova/all-MiniLM-L6-v2";
const DEFAULT_DIMS = 384;

// We type the @huggingface/transformers pipeline result loosely — its public
// types are large and we only need .data (Float32Array-like).
interface PipelineResult {
  data: ArrayLike<number>;
}
type FeatureExtractor = (
  text: string,
  opts: { pooling: "mean"; normalize: true },
) => Promise<PipelineResult>;

export class BundledEmbedder implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  private readonly model: string;
  private readonly cacheDir: string;
  private readonly onProgress?: BundledOptions["onProgress"];
  private extractor: FeatureExtractor | null = null;
  private loadPromise: Promise<FeatureExtractor> | null = null;

  constructor(opts: BundledOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.dimensions = DEFAULT_DIMS;
    this.cacheDir = opts.cacheDir ?? defaultCacheDir();
    this.onProgress = opts.onProgress;
    this.name = `bundled:${this.model}`;
  }

  /** Cheap pre-flight — instantiates the pipeline (downloads if needed) and
   *  runs a 1-token sanity embed. Use BEFORE the long indexer loop. */
  async verify(): Promise<{ ok: true } | { ok: false; reason: string; remedy: string }> {
    try {
      await this.load();
      await this.embed(["ok"]);
      return { ok: true };
    } catch (err) {
      const msg = (err as Error).message ?? String(err);
      return {
        ok: false,
        reason: `Bundled WASM model failed: ${msg}`,
        remedy:
          "First run requires internet to download ~25MB. " +
          "If you're offline, set --embedder hash to use the deterministic fallback.",
      };
    }
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    // Fast path: empty input never triggers the lazy load — keeps tests
    // and trivial calls free of the 25MB model download.
    if (texts.length === 0) return [];
    const ext = await this.load();
    const out: Float32Array[] = new Array(texts.length);
    // Sequential: the WASM pipeline isn't designed for concurrency; one at a
    // time is the predictable, memory-safe path. For 1000 chunks this takes
    // ~10–20s on consumer laptops — acceptable for a one-time index.
    for (let i = 0; i < texts.length; i++) {
      const result = await ext(texts[i]!, { pooling: "mean", normalize: true });
      // result.data is Float32Array-like — copy into a fresh typed array.
      out[i] = Float32Array.from(result.data);
    }
    return out;
  }

  /** Lazy load — done at most once, even under concurrent embed() calls. */
  private async load(): Promise<FeatureExtractor> {
    if (this.extractor) return this.extractor;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.bootPipeline();
    this.extractor = await this.loadPromise;
    return this.extractor;
  }

  private async bootPipeline(): Promise<FeatureExtractor> {
    // Ensure cache dir exists so transformers.js can write the ONNX model.
    try {
      mkdirSync(this.cacheDir, { recursive: true });
    } catch {
      /* permission errors surface later via the pipeline */
    }

    // Dynamic import — keeps the heavy WASM init out of cold-start path
    // for users who never touch this provider.
    const transformers = (await import("@huggingface/transformers")) as unknown as {
      pipeline: (
        task: string,
        model: string,
        opts: Record<string, unknown>,
      ) => Promise<FeatureExtractor>;
      env: {
        cacheDir?: string;
        // @huggingface/transformers v3 added a separate "useFSCache" knob for
        // node and renamed the cache root used at runtime. Both paths still
        // exist for back-compat; assigning is a no-op when unsupported.
        useFSCache?: boolean;
        allowRemoteModels: boolean;
        localModelPath?: string;
      };
    };

    transformers.env.cacheDir = this.cacheDir;
    transformers.env.allowRemoteModels = true;

    // Force the WASM execution provider so we never touch onnxruntime-node
    // (the native ONNX backend has no Windows-ARM64 binary; WASM ships in
    // the package itself and runs on every Node platform).
    const onProgress = this.onProgress;
    return await transformers.pipeline("feature-extraction", this.model, {
      device: "wasm",
      progress_callback: onProgress
        ? (info: Record<string, unknown>) =>
            onProgress({
              status: String(info["status"] ?? ""),
              loaded: typeof info["loaded"] === "number" ? (info["loaded"] as number) : undefined,
              total: typeof info["total"] === "number" ? (info["total"] as number) : undefined,
              file: typeof info["file"] === "string" ? (info["file"] as string) : undefined,
            })
        : undefined,
    });
  }
}

/** Default cache dir: ~/.cache/mneme/models. User can `rm -rf` to reset. */
export function defaultCacheDir(): string {
  return join(homedir(), ".cache", "mneme", "models");
}
