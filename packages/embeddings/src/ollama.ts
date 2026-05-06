import type { EmbeddingProvider } from "@mneme-ai/core";

export interface OllamaOptions {
  model?: string;
  baseUrl?: string;
  dimensions?: number;
  /** Per-request timeout in ms. Default 180000 (3 min — first call may load model into memory). */
  timeoutMs?: number;
  /** Hook called as each text completes in fallback (singular) mode — useful for fine-grained progress. */
  onItemDone?: (done: number, total: number) => void;
}

const DEFAULT_MODEL = "nomic-embed-text";
const DEFAULT_DIMS = 768;
const DEFAULT_URL = "http://localhost:11434";
const DEFAULT_TIMEOUT_MS = 180_000;

interface BatchResp {
  embeddings?: number[][];
}

interface SingularResp {
  embedding?: number[];
}

export class OllamaEmbedder implements EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly onItemDone?: (done: number, total: number) => void;
  /** Once we learn the server lacks /api/embed (404), skip it on every later batch. */
  private batchEndpointBroken = false;

  constructor(opts: OllamaOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.baseUrl = (opts.baseUrl ?? DEFAULT_URL).replace(/\/$/, "");
    this.dimensions = opts.dimensions ?? DEFAULT_DIMS;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onItemDone = opts.onItemDone;
    this.name = `ollama:${this.model}`;
  }

  async embed(texts: string[]): Promise<Float32Array[]> {
    if (texts.length === 0) return [];

    // Fast path: Ollama's batch endpoint (Ollama >= 0.3) — one HTTP round-trip
    // for the whole batch. Falls back to singular if server returns 404.
    if (!this.batchEndpointBroken) {
      try {
        const vecs = await this.embedBatch(texts);
        if (this.onItemDone) this.onItemDone(texts.length, texts.length);
        return vecs;
      } catch (err) {
        // 404 → server is older Ollama without /api/embed; switch to singular.
        // Other errors propagate immediately so the user sees them.
        if (!(err instanceof OllamaNotFoundError)) throw err;
        this.batchEndpointBroken = true;
      }
    }

    // Fallback: singular endpoint with per-item progress so the user never
    // sees a frozen progress bar while a batch crunches.
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      out.push(await this.embedOne(texts[i]!));
      if (this.onItemDone) this.onItemDone(i + 1, texts.length);
    }
    return out;
  }

  private async embedBatch(texts: string[]): Promise<Float32Array[]> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/api/embed`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (res.status === 404) {
      throw new OllamaNotFoundError("/api/embed not available on this Ollama version");
    }
    if (!res.ok) {
      throw new Error(`Ollama embed failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as BatchResp;
    if (!json.embeddings || !Array.isArray(json.embeddings)) {
      throw new Error("Ollama batch endpoint returned no embeddings");
    }
    if (json.embeddings.length !== texts.length) {
      throw new Error(
        `Ollama returned ${json.embeddings.length} embeddings for ${texts.length} inputs`,
      );
    }
    return json.embeddings.map((v) => Float32Array.from(v));
  }

  private async embedOne(text: string): Promise<Float32Array> {
    const res = await this.fetchWithTimeout(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!res.ok) {
      throw new Error(`Ollama embed failed (${res.status}): ${await res.text()}`);
    }
    const json = (await res.json()) as SingularResp;
    if (!json.embedding) throw new Error("Ollama returned no embedding");
    return Float32Array.from(json.embedding);
  }

  private async fetchWithTimeout(url: string, init: RequestInit): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } catch (err) {
      // Surface a clearer message than "AbortError: This operation was aborted"
      if ((err as { name?: string })?.name === "AbortError") {
        throw new Error(
          `Ollama did not respond within ${this.timeoutMs}ms — check that \`ollama serve\` is running and the model is loaded (\`ollama list\`). First request after a fresh pull can take longer; consider re-running.`,
        );
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  async ping(): Promise<boolean> {
    try {
      const res = await this.fetchWithTimeout(`${this.baseUrl}/api/tags`, { method: "GET" });
      return res.ok;
    } catch {
      return false;
    }
  }
}

/** Internal sentinel for "server doesn't support /api/embed yet". */
class OllamaNotFoundError extends Error {}
