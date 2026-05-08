import type { EmbeddingProvider } from "@mneme-ai/core";
import { OllamaEmbedder } from "./ollama.js";
import { OpenAIEmbedder } from "./openai.js";
import { BundledEmbedder } from "./bundled.js";
import { HashEmbedder } from "./hash.js";

export interface ResolveOptions {
  /**
   * `auto` (default) walks the fallback ladder so the user gets the highest
   * quality embedder that's actually available, with hash always reachable
   * as the last resort:
   *
   *   1. OpenAI    (★★★★★ paid)   — if OPENAI_API_KEY is set
   *   2. Ollama    (★★★★ free)   — if /api/tags responds + model pulled
   *   3. Bundled   (★★★ free)    — WASM model, ~25MB lazy download
   *   4. Hash      (★★)          — deterministic, zero deps, always works
   *
   * Pass an explicit value to skip the ladder.
   */
  provider?: "auto" | "ollama" | "openai" | "bundled" | "hash";
  model?: string;
  apiKey?: string;
  baseUrl?: string;
  /** Optional callback for bundled-model download progress. */
  onBundledProgress?: NonNullable<
    ConstructorParameters<typeof BundledEmbedder>[0]
  >["onProgress"];
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
    return new BundledEmbedder({ model: opts.model, onProgress: opts.onBundledProgress });
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

  // 3. Bundled WASM (MiniLM) — ★★★, ~25MB auto-download. Doesn't need a
  //    "ping" — the module is in the npm install. We instantiate eagerly;
  //    the actual model download happens lazily on first embed (or via
  //    verify()). Returned unconditionally because:
  //      - verify() forces the 25MB download before any work, blowing
  //        first-run time budget.
  //      - if verify fails later (offline run on a fresh machine), the
  //        index command surfaces a clear error + suggests --embedder hash.
  return new BundledEmbedder({ model: opts.model, onProgress: opts.onBundledProgress });

  // 4. Hash is the FINAL escape hatch — only chosen by explicit `--embedder
  //    hash` or by callers that don't want network/download. Auto-detect
  //    prefers bundled because it returns true semantic vectors with no setup.
}

/** Helper for callers that explicitly want the deterministic offline path. */
export function hashEmbedder(): EmbeddingProvider {
  return new HashEmbedder();
}
