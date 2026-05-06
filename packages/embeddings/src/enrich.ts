/**
 * Enricher — LLM access for *generating text* (commit-note synthesis,
 * incident summaries, future agentic flows).
 *
 * Sister contract to EmbeddingProvider but with a different shape:
 * embedders return vectors, enrichers return strings.
 *
 * Both Ollama and OpenAI implementations are local-first compatible:
 * - Ollama needs `ollama serve` + `ollama pull <model>`. Free.
 * - OpenAI needs OPENAI_API_KEY. ~$0.10 to enrich a 1k-bad-commit repo.
 */

export interface EnrichInput {
  /** System-style instruction (rules + persona). */
  system: string;
  /** User-style request (the actual question/task). */
  user: string;
  /** Soft cap on output tokens. */
  maxTokens?: number;
  /** Sampling temperature; 0 = deterministic, 0.7 = creative. */
  temperature?: number;
}

export interface EnrichResult {
  text: string;
  /** Provider name + model — for provenance tracking. */
  source: string;
  /** Input + output token counts when available. */
  usage?: { promptTokens?: number; completionTokens?: number };
}

export interface EnricherProvider {
  readonly name: string;
  enrich(input: EnrichInput): Promise<EnrichResult>;
}

/* ──────────────────────────  Ollama  ─────────────────────────── */

export interface OllamaEnricherOptions {
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

const OLLAMA_DEFAULT_MODEL = "llama3.2:1b";
// 127.0.0.1 (not localhost) — Node 18+/undici prefers IPv6 (::1) but Ollama
// only listens on IPv4 by default. localhost causes silent fetch failures on Windows.
const OLLAMA_DEFAULT_URL = "http://127.0.0.1:11434";

export class OllamaEnricher implements EnricherProvider {
  readonly name: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;

  constructor(opts: OllamaEnricherOptions = {}) {
    this.model = opts.model ?? OLLAMA_DEFAULT_MODEL;
    const raw = (opts.baseUrl ?? OLLAMA_DEFAULT_URL).replace(/\/$/, "");
    // Auto-rewrite localhost → 127.0.0.1 (see comment on OLLAMA_DEFAULT_URL)
    this.baseUrl = raw.replace(/^http:\/\/localhost(:|$|\/)/i, "http://127.0.0.1$1");
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.name = `ollama:${this.model}`;
  }

  async enrich(input: EnrichInput): Promise<EnrichResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
          stream: false,
          options: {
            temperature: input.temperature ?? 0.2,
            num_predict: input.maxTokens ?? 256,
          },
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new Error(`Ollama enrich failed (${res.status}): ${await res.text()}`);
      }
      const json = (await res.json()) as {
        message?: { content?: string };
        prompt_eval_count?: number;
        eval_count?: number;
      };
      return {
        text: json.message?.content?.trim() ?? "",
        source: this.name,
        usage: {
          promptTokens: json.prompt_eval_count,
          completionTokens: json.eval_count,
        },
      };
    } finally {
      clearTimeout(timer);
    }
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

/* ──────────────────────────  OpenAI  ─────────────────────────── */

export interface OpenAIEnricherOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

const OPENAI_DEFAULT_MODEL = "gpt-4o-mini";
const OPENAI_DEFAULT_URL = "https://api.openai.com/v1";

export class OpenAIEnricher implements EnricherProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(opts: OpenAIEnricherOptions) {
    this.apiKey = opts.apiKey;
    this.model = opts.model ?? OPENAI_DEFAULT_MODEL;
    this.baseUrl = (opts.baseUrl ?? OPENAI_DEFAULT_URL).replace(/\/$/, "");
    this.timeoutMs = opts.timeoutMs ?? 60_000;
    this.name = `openai:${this.model}`;
  }

  async enrich(input: EnrichInput): Promise<EnrichResult> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [
            { role: "system", content: input.system },
            { role: "user", content: input.user },
          ],
          temperature: input.temperature ?? 0.2,
          max_tokens: input.maxTokens ?? 256,
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new Error(`OpenAI enrich failed (${res.status}): ${await res.text()}`);
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      return {
        text: json.choices?.[0]?.message?.content?.trim() ?? "",
        source: this.name,
        usage: {
          promptTokens: json.usage?.prompt_tokens,
          completionTokens: json.usage?.completion_tokens,
        },
      };
    } finally {
      clearTimeout(timer);
    }
  }
}

/* ──────────────────────────  Resolver  ─────────────────────────── */

export interface ResolveEnricherOptions {
  provider?: "auto" | "ollama" | "openai";
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export async function resolveEnricher(
  opts: ResolveEnricherOptions = {},
): Promise<EnricherProvider> {
  const provider = opts.provider ?? "auto";
  if (provider === "ollama" || provider === "auto") {
    const ollama = new OllamaEnricher({ model: opts.model, baseUrl: opts.baseUrl });
    if (await ollama.ping()) return ollama;
    if (provider === "ollama") {
      throw new Error("Ollama not reachable. Start it: ollama serve");
    }
  }
  const apiKey = opts.apiKey ?? process.env["OPENAI_API_KEY"];
  if ((provider === "openai" || provider === "auto") && apiKey) {
    return new OpenAIEnricher({ apiKey, model: opts.model, baseUrl: opts.baseUrl });
  }
  throw new Error(
    "No enricher available. Install Ollama (recommended) or set OPENAI_API_KEY.",
  );
}
