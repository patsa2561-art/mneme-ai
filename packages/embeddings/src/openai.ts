import type { EmbeddingProvider } from "@mneme-ai/core";

export interface OpenAIOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  dimensions?: number;
}

const DEFAULT_MODEL = "text-embedding-3-small";
const DEFAULT_DIMS = 1536;
const DEFAULT_URL = "https://api.openai.com/v1";

export class OpenAIEmbedder implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;

  constructor(opts: OpenAIOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_URL).replace(/\/$/, "");
    this.dimensions = opts.dimensions ?? DEFAULT_DIMS;
    this.name = `openai:${this.model}`;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (!texts.length) return [];
    const res = await fetch(`${this.baseUrl}/embeddings`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI embed failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as {
      data: Array<{ embedding: number[]; index: number }>;
    };
    json.data.sort((a, b) => a.index - b.index);
    return json.data.map((d) => Float32Array.from(d.embedding));
  }
}
