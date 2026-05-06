import type { EmbeddingProvider } from "@mneme-ai/core";
import { OllamaEmbedder } from "./ollama.js";
import { OpenAIEmbedder } from "./openai.js";
import { HashEmbedder } from "./hash.js";

export interface ResolveOptions {
  provider?: "auto" | "ollama" | "openai" | "hash";
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Auto-select an embedder.
 *
 *   auto: prefer Ollama → OpenAI (if key) → hash fallback
 *   ollama / openai / hash: explicit
 */
export async function resolveEmbedder(opts: ResolveOptions = {}): Promise<EmbeddingProvider> {
  const provider = opts.provider ?? "auto";

  if (provider === "ollama" || provider === "auto") {
    const ollama = new OllamaEmbedder({ model: opts.model, baseUrl: opts.baseUrl });
    if (await ollama.ping()) return ollama;
    if (provider === "ollama") {
      throw new Error(
        `Ollama not reachable at ${opts.baseUrl ?? "http://127.0.0.1:11434"}. Start it with: ollama serve`,
      );
    }
  }

  const apiKey = opts.apiKey ?? process.env["OPENAI_API_KEY"];
  if ((provider === "openai" || provider === "auto") && apiKey) {
    return new OpenAIEmbedder({ apiKey, model: opts.model, baseUrl: opts.baseUrl });
  }

  if (provider === "openai") {
    throw new Error("No OpenAI API key. Set OPENAI_API_KEY or pass --api-key.");
  }

  return new HashEmbedder();
}
