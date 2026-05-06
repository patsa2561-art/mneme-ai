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
// Use 127.0.0.1 (NOT localhost) — Node 18+/undici prefers IPv6 (::1) which
// Ollama doesn't listen on by default. Causes silent "fetch failed" on Windows.
const DEFAULT_URL = "http://127.0.0.1:11434";
const DEFAULT_TIMEOUT_MS = 180_000;
const RETRYABLE_FETCH = ["fetch failed", "ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EAI_AGAIN", "socket hang up"];

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
    // Auto-rewrite localhost → 127.0.0.1 so users who pass their own URL
    // don't trip the same IPv6 trap that bit us with the default.
    const raw = (opts.baseUrl ?? DEFAULT_URL).replace(/\/$/, "");
    this.baseUrl = raw.replace(/^http:\/\/localhost(:|$|\/)/i, "http://127.0.0.1$1");
    this.dimensions = opts.dimensions ?? DEFAULT_DIMS;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.onItemDone = opts.onItemDone;
    this.name = `ollama:${this.model}`;
  }

  /** Cheap pre-flight: verify Ollama is reachable AND the model is available
   *  AND a 1-token embed actually returns a vector. Run this BEFORE the
   *  long-running indexer loop so failures surface in seconds, not after
   *  minutes of redaction work. */
  async verify(): Promise<{ ok: true } | { ok: false; reason: string; remedy: string }> {
    try {
      const tags = await this.fetchWithTimeout(`${this.baseUrl}/api/tags`, { method: "GET" });
      if (!tags.ok) {
        return {
          ok: false,
          reason: `Ollama responded with HTTP ${tags.status} on /api/tags.`,
          remedy: "Restart Ollama: `ollama serve` in a new terminal.",
        };
      }
      const list = (await tags.json()) as { models?: Array<{ name: string }> };
      const have = (list.models ?? []).map((m) => m.name);
      const matches = have.some((n) => n === this.model || n.startsWith(this.model + ":"));
      if (!matches) {
        return {
          ok: false,
          reason: `Model '${this.model}' is not pulled. Available: ${have.join(", ") || "(none)"}.`,
          remedy: `Run:  ollama pull ${this.model}`,
        };
      }
      // One-token sanity embed — proves the model is loaded + responds.
      await this.embedOne("ok");
      return { ok: true };
    } catch (err) {
      const msg = friendlyError(err, this.baseUrl, this.model);
      return { ok: false, reason: msg.reason, remedy: msg.remedy };
    }
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

  private async fetchWithTimeout(url: string, init: RequestInit, attempt = 0): Promise<Response> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      return await fetch(url, { ...init, signal: ctrl.signal });
    } catch (err) {
      const e = err as { name?: string; message?: string; cause?: { code?: string; message?: string } };
      // Surface a clearer message than "AbortError: This operation was aborted"
      if (e?.name === "AbortError") {
        throw new Error(
          `Ollama did not respond within ${this.timeoutMs}ms at ${this.baseUrl}.\n` +
            `   Check that 'ollama serve' is running and the model is loaded ('ollama list').`,
        );
      }
      // Retry once on transient network errors — covers cold-start socket churn.
      const code = e?.cause?.code ?? "";
      const msg = e?.message ?? "";
      const transient = RETRYABLE_FETCH.some((s) => code.includes(s) || msg.includes(s));
      if (transient && attempt === 0) {
        await new Promise((r) => setTimeout(r, 500));
        return this.fetchWithTimeout(url, init, 1);
      }
      // Re-throw with the underlying cause stitched in so users see WHY it failed.
      const why = e?.cause?.code ?? e?.cause?.message ?? "";
      const detail = why ? `${msg} (${why})` : msg || String(err);
      throw new Error(
        `Cannot reach Ollama at ${this.baseUrl}: ${detail}.\n` +
          `   Fixes:\n` +
          `     1. Start Ollama:  ollama serve\n` +
          `     2. Verify model:  ollama list  (must show ${this.model})\n` +
          `     3. If 'localhost' was used, switch to 127.0.0.1 (Node prefers IPv6 on Windows).`,
      );
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

/** Translate any fetch/server error into a (reason, remedy) pair the CLI can show.
 *  Decoupled from CLI rendering so we can also use it in MCP / programmatic callers. */
function friendlyError(
  err: unknown,
  baseUrl: string,
  model: string,
): { reason: string; remedy: string } {
  const e = err as { message?: string; cause?: { code?: string; message?: string } };
  const code = e?.cause?.code ?? "";
  if (code === "ECONNREFUSED") {
    return {
      reason: `Ollama isn't running at ${baseUrl}.`,
      remedy: "Open a new terminal and run:  ollama serve",
    };
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return {
      reason: `Cannot resolve host in ${baseUrl}.`,
      remedy: "Check the URL — for local Ollama use http://127.0.0.1:11434.",
    };
  }
  if (e?.message?.includes("did not respond within")) {
    return {
      reason: e.message,
      remedy: `First call may load the model into memory. Try:  ollama run ${model} 'hi'  to warm it up, then re-run.`,
    };
  }
  return {
    reason: e?.message ?? String(err),
    remedy: `Verify Ollama is up:  ollama list   ·   if ${model} is missing:  ollama pull ${model}`,
  };
}
