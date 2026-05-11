/**
 * v1.57.0 -- SOVEREIGNTY KERNEL: minimal Ollama client.
 *
 * The standalone-AI surface for Mneme. Talks to a local Ollama instance
 * (default http://127.0.0.1:11434) to generate answers + embeddings.
 *
 * Why local-only: free-first mandate. Mneme should answer questions
 * about your repo without sending source code to anyone's cloud.
 * Ollama runs on your laptop; the model + the wisdom layer never leave.
 *
 * NO external dependencies -- just node:http. The Ollama HTTP API is
 * stable + well-documented, no SDK needed.
 */

import { request as httpRequest } from "node:http";

export interface OllamaGenerateOptions {
  /** Model name (e.g. "llama3.2", "qwen2.5", "mistral"). Defaults to
   *  MNEME_OLLAMA_MODEL env var or "llama3.2". */
  model?: string;
  /** Total response timeout in ms. Default 60_000. */
  timeoutMs?: number;
  /** Base URL. Defaults to MNEME_OLLAMA_URL or http://127.0.0.1:11434. */
  baseUrl?: string;
  /** Inject a custom fetch impl for tests; falls back to node:http. */
  fetchImpl?: (url: string, init?: { method?: string; body?: string; timeoutMs?: number }) => Promise<{ status: number; body: string }>;
}

export interface OllamaResponse {
  /** Raw text reply. */
  text: string;
  /** Was the request successful? */
  ok: boolean;
  /** Status code / error message. */
  status: number;
  reason?: string;
  /** Token counts -- best-effort from Ollama metadata. */
  promptTokens?: number;
  responseTokens?: number;
  /** End-to-end latency in ms. */
  latencyMs: number;
}

const DEFAULT_BASE = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "llama3.2";

function modelName(opt?: OllamaGenerateOptions): string {
  return opt?.model ?? process.env["MNEME_OLLAMA_MODEL"] ?? DEFAULT_MODEL;
}

function baseUrl(opt?: OllamaGenerateOptions): string {
  return opt?.baseUrl ?? process.env["MNEME_OLLAMA_URL"] ?? DEFAULT_BASE;
}

function nodeHttp(url: string, init: { method: string; body: string; timeoutMs: number }): Promise<{ status: number; body: string }> {
  return new Promise((resolve) => {
    try {
      const parsed = new URL(url);
      const req = httpRequest({
        host: parsed.hostname,
        port: parsed.port,
        path: parsed.pathname + parsed.search,
        method: init.method,
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(init.body).toString() },
        timeout: init.timeoutMs,
      }, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }));
      });
      req.on("error", (err) => resolve({ status: 0, body: String(err.message ?? err) }));
      req.on("timeout", () => { req.destroy(); resolve({ status: 0, body: "timeout" }); });
      req.write(init.body);
      req.end();
    } catch (e) {
      resolve({ status: 0, body: String((e as Error).message ?? e) });
    }
  });
}

/** Single-shot generation. */
export async function ollamaGenerate(prompt: string, opt?: OllamaGenerateOptions): Promise<OllamaResponse> {
  const t0 = Date.now();
  const url = `${baseUrl(opt).replace(/\/$/, "")}/api/generate`;
  const body = JSON.stringify({ model: modelName(opt), prompt, stream: false });
  const fetcher = opt?.fetchImpl ?? ((u, init) => nodeHttp(u, {
    method: init?.method ?? "POST",
    body: init?.body ?? "",
    timeoutMs: init?.timeoutMs ?? (opt?.timeoutMs ?? 60_000),
  }));
  const res = await fetcher(url, { method: "POST", body, timeoutMs: opt?.timeoutMs ?? 60_000 });
  const latencyMs = Date.now() - t0;
  if (res.status !== 200) {
    return {
      text: "",
      ok: false,
      status: res.status,
      reason: res.body.slice(0, 200) || `http ${res.status}`,
      latencyMs,
    };
  }
  try {
    const parsed = JSON.parse(res.body) as { response?: string; prompt_eval_count?: number; eval_count?: number };
    return {
      text: parsed.response ?? "",
      ok: true,
      status: 200,
      promptTokens: parsed.prompt_eval_count,
      responseTokens: parsed.eval_count,
      latencyMs,
    };
  } catch (e) {
    return { text: "", ok: false, status: 0, reason: `parse error: ${(e as Error).message}`, latencyMs };
  }
}

/** Health check -- is Ollama reachable + responsive? */
export async function ollamaHealth(opt?: OllamaGenerateOptions): Promise<{ ok: boolean; reason: string; latencyMs: number }> {
  const t0 = Date.now();
  try {
    const url = `${baseUrl(opt).replace(/\/$/, "")}/api/tags`;
    const fetcher = opt?.fetchImpl ?? ((u) => nodeHttp(u, { method: "GET", body: "", timeoutMs: 3000 }));
    const res = await fetcher(url, { method: "GET", timeoutMs: 3000 });
    const latencyMs = Date.now() - t0;
    if (res.status === 200) {
      return { ok: true, reason: "ollama reachable", latencyMs };
    }
    return { ok: false, reason: `http ${res.status}`, latencyMs };
  } catch (e) {
    return { ok: false, reason: (e as Error).message, latencyMs: Date.now() - t0 };
  }
}
