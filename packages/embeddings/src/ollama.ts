import type { EmbeddingProvider } from "@mneme-ai/core";

export interface OllamaOptions {
  model?: string;
  baseUrl?: string;
  dimensions?: number;
}

const DEFAULT_MODEL = "nomic-embed-text";
const DEFAULT_DIMS = 768;
const DEFAULT_URL = "http://localhost:11434";

export class OllamaEmbedder implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  private readonly baseUrl: string;
  private readonly model: string;

  constructor(opts: OllamaOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_URL).replace(/\/$/, "");
    this.dimensions = opts.dimensions ?? DEFAULT_DIMS;
    this.name = `ollama:${this.model}`;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (const text of texts) {
      const res = await fetch(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt: text }),
      });
      if (!res.ok) {
        throw new Error(`Ollama embed failed (${res.status}): ${await res.text()}`);
      }
      const json = (await res.json()) as { embedding: number[] };
      if (!json.embedding) throw new Error("Ollama returned no embedding");
      out.push(Float32Array.from(json.embedding));
    }
    return out;
  }

  async ping(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`);
      return res.ok;
    } catch {
      return false;
    }
  }
}
