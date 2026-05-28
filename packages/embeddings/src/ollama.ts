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
// v2.76.0 — Ollama sometimes returns 5xx (model still loading / transient OOM)
// OR a NaN-poisoned embedding on a SPECIFIC input (observed with bge-m3 on
// certain text, e.g. "...may encrypt where feasible..."). These are NOT fatal:
// retry, then sanitize + retry, then substitute a SAME-DIMENSION deterministic
// vector so one bad chunk never aborts a whole index. Server-DOWN (network)
// errors still propagate — those are real outages, not bad inputs.
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const EMBED_MAX_ATTEMPTS = 3;
const EMBED_SANITIZE_CHARS = 8192;

/** A vector is usable iff it is non-empty and every element is a finite number
 *  (no NaN / ±Infinity — the bge-m3 failure mode). */
function isFiniteVec(v: number[] | Float32Array | undefined | null): v is number[] {
  if (!v || v.length === 0) return false;
  for (let i = 0; i < v.length; i++) { const x = v[i]!; if (!Number.isFinite(x)) return false; }
  return true;
}

/** Strip control chars + hard-truncate. Some model inputs trigger a 500/NaN;
 *  a sanitized retry usually succeeds before we resort to the fallback vector. */
function sanitizeForEmbed(text: string): string {
  // Drop C0/C1 control chars (keep tab/LF/CR) by codepoint, then truncate.
  let out = "";
  for (const ch of text) {
    const x = ch.codePointAt(0) ?? 0;
    if (x === 9 || x === 10 || x === 13 || (x >= 32 && !(x >= 127 && x <= 159))) out += ch;
    if (out.length >= EMBED_SANITIZE_CHARS) break;
  }
  return out;
}

/** Deterministic FNV-1a bag-of-features vector, L2-normalized to `dim`. Used
 *  ONLY as a last-resort substitute for an input the model cannot embed, so
 *  the index stays dimension-consistent + the run completes. Same algorithm
 *  shape as the hash-tier embedder; reproducible per (text, dim). */
function fallbackVector(text: string, dim: number): Float32Array {
  const v = new Float32Array(dim);
  const toks = (text.toLowerCase().match(/[a-z0-9]+/g) ?? []);
  for (const t of toks) {
    let h = 0x811c9dc5;
    for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    let sgn = 0x811c9dc5; for (let i = 0; i < t.length; i++) { sgn ^= t.charCodeAt(i) + 7; sgn = Math.imul(sgn, 0x01000193) >>> 0; }
    v[h % dim] += (sgn & 1) === 0 ? 1 : -1;
  }
  let norm = 0; for (let i = 0; i < dim; i++) norm += v[i]! * v[i]!;
  norm = Math.sqrt(norm);
  if (norm > 0) for (let i = 0; i < dim; i++) v[i]! /= norm;
  return v;
}

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

  /**
   * v2.27.0 — TAGS-ONLY verify. Returns ok=true iff /api/tags responds AND
   * the configured model is in the catalog. Does NOT do a sanity embed
   * (that's the job of the first real embed call). Used by auto-detect
   * to avoid the cold-start timeout that was downgrading users to bundled.
   */
  async verifyTags(): Promise<{ ok: true } | { ok: false; reason: string }> {
    try {
      const tags = await this.fetchWithTimeout(`${this.baseUrl}/api/tags`, { method: "GET" });
      if (!tags.ok) return { ok: false, reason: `HTTP ${tags.status} on /api/tags` };
      const list = (await tags.json()) as { models?: Array<{ name: string }> };
      const have = (list.models ?? []).map((m) => m.name);
      const matches = have.some((n) => n === this.model || n.startsWith(this.model + ":"));
      if (!matches) return { ok: false, reason: `model '${this.model}' not pulled (have: ${have.join(", ")})` };
      return { ok: true };
    } catch (err) {
      return { ok: false, reason: (err as Error).message };
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
        // 404 → older Ollama without /api/embed; switch to singular permanently.
        if (err instanceof OllamaNotFoundError) { this.batchEndpointBroken = true; }
        // v2.76.0 — a 5xx OR a NaN-poisoned embedding in the batch is NOT fatal:
        // fall through to SINGULAR for THIS batch so the one bad input is
        // isolated + retried/fallback'd (without disabling the fast batch path).
        else if (!(err instanceof OllamaBatchUnhealthyError)) throw err;
      }
    }

    // Fallback: singular endpoint, per-input — isolates a bad chunk, gives
    // per-item progress, and lets embedOne retry / sanitize / substitute so one
    // input that the model 500s/NaNs on can never abort the whole index.
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i++) {
      out.push(await this.embedOne(texts[i]!, { allowFallback: true }));
      if (this.onItemDone) this.onItemDone(i + 1, texts.length);
    }
    return out;
  }

  /** How many inputs got a deterministic fallback vector because the model
   *  could not embed them (transparency — never silently fake a clean run). */
  private degradedCount = 0;
  embedStats(): { degraded: number } { return { degraded: this.degradedCount }; }

  private async embedBatch(texts: string[]): Promise<Float32Array[]> {
    let res: Response | null = null;
    // Retry the batch on transient 5xx/429 (model still loading / momentary OOM).
    for (let attempt = 1; attempt <= EMBED_MAX_ATTEMPTS; attempt++) {
      res = await this.fetchWithTimeout(`${this.baseUrl}/api/embed`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, input: texts }),
      });
      if (res.status === 404) throw new OllamaNotFoundError("/api/embed not available on this Ollama version");
      if (res.ok) break;
      if (RETRYABLE_STATUS.has(res.status) && attempt < EMBED_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 400 * attempt));
        continue;
      }
      // Non-retryable, or retries exhausted → isolate via singular (NOT fatal).
      throw new OllamaBatchUnhealthyError(`batch HTTP ${res.status}`);
    }
    const json = (await res!.json()) as BatchResp;
    if (!json.embeddings || !Array.isArray(json.embeddings) || json.embeddings.length !== texts.length) {
      throw new OllamaBatchUnhealthyError("batch returned missing/mismatched embeddings");
    }
    // A single NaN-poisoned vector (the bge-m3 failure mode) must not silently
    // enter the index — drop to singular so ONLY the bad input is repaired.
    if (!json.embeddings.every((v) => isFiniteVec(v))) {
      throw new OllamaBatchUnhealthyError("batch contained a NaN/non-finite embedding");
    }
    return json.embeddings.map((v) => Float32Array.from(v));
  }

  /**
   * Embed ONE input, robust to the bge-m3 "500 / NaN on a specific input" bug.
   * Retries transient 5xx, validates against NaN, then sanitizes + retries.
   * With allowFallback (indexer path) a persistently-unembeddable input yields a
   * deterministic SAME-DIMENSION vector so the run completes; without it
   * (verify path) it throws so a real outage still surfaces. Network errors
   * always propagate — those are a down server, not a bad input.
   */
  private async embedOne(text: string, opts: { allowFallback?: boolean } = {}): Promise<Float32Array> {
    const post = async (prompt: string): Promise<{ ok: boolean; status: number; vec?: number[] }> => {
      const res = await this.fetchWithTimeout(`${this.baseUrl}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: this.model, prompt }),
      });
      if (!res.ok) return { ok: false, status: res.status };
      const json = (await res.json()) as SingularResp;
      return { ok: true, status: 200, vec: json.embedding };
    };
    let lastStatus = 0;
    for (let attempt = 1; attempt <= EMBED_MAX_ATTEMPTS; attempt++) {
      const r = await post(text);
      lastStatus = r.status;
      if (r.ok && isFiniteVec(r.vec)) return Float32Array.from(r.vec!);
      // Retry on a retryable status OR a NaN/empty embedding (the bge-m3 case).
      const retryable = !r.ok ? RETRYABLE_STATUS.has(r.status) : true; // ok-but-NaN is retryable too
      if (retryable && attempt < EMBED_MAX_ATTEMPTS) { await new Promise((res) => setTimeout(res, 400 * attempt)); continue; }
      if (!r.ok && !RETRYABLE_STATUS.has(r.status)) break; // hard non-retryable HTTP error
    }
    // Last resort #1 — a sanitized retry (control chars / over-long inputs are a
    // common trigger for the model-side 500/NaN).
    const cleaned = sanitizeForEmbed(text);
    if (cleaned !== text && cleaned.length > 0) {
      const r = await post(cleaned);
      if (r.ok && isFiniteVec(r.vec)) return Float32Array.from(r.vec!);
    }
    // Last resort #2 — same-dimension deterministic substitute so the index
    // stays consistent + the run finishes. Only on the indexer path.
    if (opts.allowFallback) {
      this.degradedCount++;
      if (this.degradedCount === 1) {
        process.stderr.write(`⚠ ollama:${this.model} could not embed an input (HTTP ${lastStatus}/NaN) — substituting a deterministic vector for that chunk so indexing continues. (mneme embeddings status shows the count.)\n`);
      }
      return fallbackVector(text, this.dimensions);
    }
    throw new Error(`Ollama embed failed for an input (last HTTP ${lastStatus}; embedding was missing or NaN even after a sanitized retry).`);
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

/** v2.76.0 — "the batch endpoint responded but the result is unhealthy"
 *  (5xx after retries, length mismatch, or a NaN-poisoned vector). Signals
 *  embed() to isolate via the singular path WITHOUT disabling batch forever. */
class OllamaBatchUnhealthyError extends Error {}

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
