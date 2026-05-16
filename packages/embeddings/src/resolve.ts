import type { EmbeddingProvider } from "@mneme-ai/core";
import { OllamaEmbedder } from "./ollama.js";
import { OpenAIEmbedder } from "./openai.js";
import { BundledEmbedder } from "./bundled.js";
import { HashEmbedder } from "./hash.js";
import { SnnEmbedder } from "./snn.js";

export interface ResolveOptions {
  /**
   * `auto` (default) walks the fallback ladder so the user gets the highest
   * quality embedder that's actually available, with hash always reachable
   * as the last resort:
   *
   *   1. OpenAI    (★★★★★ paid)   — if OPENAI_API_KEY is set
   *   2. Ollama    (★★★★ free)   — if /api/tags responds + model pulled
   *   3. Bundled   (★★★ free)    — WASM model, ~25MB lazy download
   *   4. SNN       (★★★ free)    — v2.19.16: pure-TS spiking net, no deps,
   *                                deterministic; reached when bundled WASM
   *                                fails at runtime (EBUSY, require-not-
   *                                defined, missing onnxruntime-web). Replaces
   *                                the old direct fall-through to hash.
   *   5. Hash      (★★)          — deterministic, zero deps, last escape hatch
   *
   * Pass an explicit value to skip the ladder.
   */
  provider?: "auto" | "ollama" | "openai" | "bundled" | "snn" | "hash";
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  /** Optional callback for bundled-model download progress. */
  onBundledProgress?: NonNullable<
    ConstructorParameters<typeof BundledEmbedder>[0]
  >["onProgress"];
  /** v1.11.1 — TOFU manifest path (per-repo, e.g. `<repo>/.mneme/model-checksums.json`).
   *  When provided, the bundled embedder pins/verifies the cache. */
  tofuManifestPath?: string;
}

export async function resolveEmbedder(opts: ResolveOptions = {}): Promise<EmbeddingProvider> {
  const provider = opts.provider ?? "auto";

  // ── Explicit picks ──────────────────────────────────────────────────
  if (provider === "openai") {
    const apiKey = opts.apiKey ?? process.env["OPENAI_API_KEY"];
    if (!apiKey) {
      throw new Error("No OpenAI API key. Set OPENAI_API_KEY or pass --api-key.");
    }
    return new OpenAIEmbedder({ apiKey, model: opts.model, baseUrl: opts.baseUrl });
  }

  if (provider === "ollama") {
    const ollama = new OllamaEmbedder({ model: opts.model, baseUrl: opts.baseUrl });
    if (await ollama.ping()) return ollama;
    throw new Error(
      `Ollama not reachable at ${opts.baseUrl ?? "http://127.0.0.1:11434"}. Start it with: ollama serve`,
    );
  }

  if (provider === "bundled") {
    return new BundledEmbedder({ model: opts.model, onProgress: opts.onBundledProgress, tofuManifestPath: opts.tofuManifestPath });
  }

  if (provider === "snn") {
    return new SnnEmbedder();
  }

  if (provider === "hash") {
    return new HashEmbedder();
  }

  // ── auto: walk the ladder, NEVER block the user ────────────────────
  // Each step is health-checked. A failing step quietly falls to the next.
  // The user always ends up with a working embedder (worst case = hash).

  // 1. OpenAI key wins — best quality, no install.
  const apiKey = opts.apiKey ?? process.env["OPENAI_API_KEY"];
  if (apiKey) {
    return new OpenAIEmbedder({ apiKey, model: opts.model, baseUrl: opts.baseUrl });
  }

  // 2. Ollama — only if a SHORT sanity embed succeeds. We had real users
  //    where /api/tags responded but /api/embeddings hung for minutes; that
  //    used to surface as a hard error. Now we just fall through silently.
  const ollama = new OllamaEmbedder({
    model: opts.model,
    baseUrl: opts.baseUrl,
    timeoutMs: 10_000, // short for the auto-detect probe — full timeout used after
  });
  if (await ollama.ping()) {
    const ver = await ollama.verify();
    if (ver.ok) {
      // Reset to the normal long timeout for the real workload.
      return new OllamaEmbedder({ model: opts.model, baseUrl: opts.baseUrl });
    }
    // Ollama is reachable but unhealthy — explicitly skip and try the next step.
    // We swallow the reason: the user picked auto, they want it to JUST WORK.
  }

  // 3. Bundled WASM (MiniLM) — ★★★, ~25MB auto-download. We wrap it so
  //    that any runtime failure (EBUSY on Windows, require-not-defined in
  //    pure-ESM, missing onnxruntime-web) silently falls to SNN — never
  //    to hash. The user gets a real semantic embedding either way.
  const bundled = new BundledEmbedder({ model: opts.model, onProgress: opts.onBundledProgress, tofuManifestPath: opts.tofuManifestPath });
  return new BundledOrSnnEmbedder(bundled);

  // 4. SNN (★★★) is reached automatically by BundledOrSnnEmbedder on
  //    bundled-WASM failure. SnnEmbedder is also explicitly addressable
  //    via --embedder snn.
  //
  // 5. Hash is the FINAL escape hatch — only chosen by explicit `--embedder
  //    hash` or by callers that don't want network/download.
}

/**
 * v2.19.16 — try bundled WASM first; on ANY error from .embed(), silently
 * promote to the pure-TS SNN. Prevents the historical "fall to hash:fnv-256
 * forever" regression caused by v2.19.6 onnxruntime EBUSY + ESM/CJS bridge
 * issues. The user always gets a real semantic embedder.
 */
export class BundledOrSnnEmbedder implements EmbeddingProvider {
  /** Proxies to the inner embedder's name so observers see "bundled:..."
   *  until/unless a runtime failure promotes us to SNN. */
  get name(): string { return this.inner.name; }
  readonly dimensions: number;
  private inner: EmbeddingProvider;
  private promotedToSnn = false;
  constructor(private readonly bundled: EmbeddingProvider) {
    this.inner = bundled;
    this.dimensions = bundled.dimensions;
  }
  async embed(texts: string[]): Promise<Float32Array[]> {
    if (!this.promotedToSnn) {
      try {
        return await this.inner.embed(texts);
      } catch (e) {
        // Promote silently. The user's run never blocks on a bundled failure.
        this.inner = new SnnEmbedder();
        this.promotedToSnn = true;
        return await this.inner.embed(texts);
      }
    }
    return this.inner.embed(texts);
  }
  isPromoted(): boolean {
    return this.promotedToSnn;
  }
}

/** Helper for callers that explicitly want the deterministic offline path. */
export function hashEmbedder(): EmbeddingProvider {
  return new HashEmbedder();
}
