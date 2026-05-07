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
  provider?: "auto" | "ollama" | "openai" | "groq" | "together" | "openrouter";
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Provider catalog — every entry uses an OpenAI-compatible /chat/completions
 * endpoint, so they all share `OpenAIEnricher`. New providers = one row here.
 *
 * Ordered by free-tier-friendliness:
 *   ollama (local, totally free)
 *   groq         — generous free tier, fast (500 tok/s), signup required
 *   together     — modest free tier
 *   openrouter   — pay-per-token but exposes free models too
 *   openai       — paid, premium quality
 */
export interface ProviderEntry {
  id: "groq" | "together" | "openrouter" | "openai";
  envKey: string;
  baseUrl: string;
  defaultModel: string;
  /** Other free models the user can opt into (Qwen / Gemma / Llama family). */
  freeModels: string[];
  freeTier: boolean;
  signupUrl: string;
}

const PROVIDERS: ProviderEntry[] = [
  {
    id: "groq",
    envKey: "GROQ_API_KEY",
    baseUrl: "https://api.groq.com/openai/v1",
    defaultModel: "llama-3.3-70b-versatile",
    freeModels: [
      "llama-3.3-70b-versatile",
      "qwen-qwq-32b",
      "gemma2-9b-it",
      "llama-3.1-8b-instant",
    ],
    freeTier: true,
    signupUrl: "https://console.groq.com/keys",
  },
  {
    id: "together",
    envKey: "TOGETHER_API_KEY",
    baseUrl: "https://api.together.xyz/v1",
    defaultModel: "meta-llama/Llama-3.3-70B-Instruct-Turbo",
    freeModels: [
      "meta-llama/Llama-3.3-70B-Instruct-Turbo",
      "Qwen/Qwen2.5-72B-Instruct-Turbo",
      "google/gemma-2-9b-it",
    ],
    freeTier: true,
    signupUrl: "https://api.together.xyz/settings/api-keys",
  },
  {
    id: "openrouter",
    envKey: "OPENROUTER_API_KEY",
    baseUrl: "https://openrouter.ai/api/v1",
    defaultModel: "meta-llama/llama-3.3-70b-instruct:free",
    freeModels: [
      "meta-llama/llama-3.3-70b-instruct:free",
      "qwen/qwen-2.5-72b-instruct:free",
      "google/gemma-2-9b-it:free",
      "qwen/qwq-32b:free",
    ],
    freeTier: true,
    signupUrl: "https://openrouter.ai/keys",
  },
  {
    id: "openai",
    envKey: "OPENAI_API_KEY",
    baseUrl: "https://api.openai.com/v1",
    defaultModel: "gpt-4o-mini",
    freeModels: [], // no free models on OpenAI
    freeTier: false,
    signupUrl: "https://platform.openai.com/api-keys",
  },
];

/**
 * Recommended local Ollama models for the chat path. Order: balance of
 * size / quality / speed. User picks one in the setup wizard or just runs
 * `ollama pull <name>` manually.
 */
export const OLLAMA_FREE_CHAT_MODELS: Array<{ name: string; size: string; note: string }> = [
  { name: "qwen2.5:3b", size: "1.9GB", note: "best small/quality balance — recommended default" },
  { name: "gemma2:2b",  size: "1.6GB", note: "Google Gemma 2 — fastest tiny" },
  { name: "llama3.2:1b", size: "1.3GB", note: "smallest, decent for short answers" },
  { name: "qwen2.5:7b",  size: "4.7GB", note: "much smarter — needs ~6GB free RAM" },
  { name: "gemma2:9b",   size: "5.4GB", note: "Gemma 2 mid — strong reasoning" },
];

export async function resolveEnricher(
  opts: ResolveEnricherOptions = {},
): Promise<EnricherProvider> {
  const provider = opts.provider ?? "auto";

  // Explicit picks
  if (provider === "ollama") {
    const ollama = new OllamaEnricher({ model: opts.model, baseUrl: opts.baseUrl });
    if (await ollama.ping()) return ollama;
    throw new Error(
      "Ollama not reachable at " +
        (opts.baseUrl ?? "http://127.0.0.1:11434") +
        ". Start it:  ollama serve\nThen pull a chat model:  ollama pull llama3.2:1b",
    );
  }
  if (provider === "openai" || provider === "groq" || provider === "together" || provider === "openrouter") {
    const cfg = PROVIDERS.find((p) => p.id === provider)!;
    const key = opts.apiKey ?? process.env[cfg.envKey];
    if (!key) {
      throw new Error(
        `No ${provider} key found. Set ${cfg.envKey} or pass --api-key.\n` +
          `Sign up (free tier): ${cfg.signupUrl}`,
      );
    }
    return new OpenAIEnricher({
      apiKey: key,
      model: opts.model ?? cfg.defaultModel,
      baseUrl: opts.baseUrl ?? cfg.baseUrl,
    });
  }

  // auto: privacy-first ladder. Ollama local first (free + private), then any
  // free-tier cloud provider whose key is in the env, then OpenAI as last resort.
  const ollama = new OllamaEnricher({ model: opts.model, baseUrl: opts.baseUrl });
  if (await ollama.ping()) return ollama;

  // Try env-var providers in order
  for (const cfg of PROVIDERS) {
    const key = process.env[cfg.envKey];
    if (key) {
      return new OpenAIEnricher({
        apiKey: key,
        model: opts.model ?? cfg.defaultModel,
        baseUrl: opts.baseUrl ?? cfg.baseUrl,
      });
    }
  }

  throw new NoEnricherAvailableError();
}

/**
 * Sentinel error for the "no LLM available" case. The CLI catches this
 * specifically and switches `ask` to retrieval-only mode instead of
 * showing a hard error.
 */
export class NoEnricherAvailableError extends Error {
  constructor() {
    super(
      "No LLM available — set up the free path:\n" +
        "  Local + private (recommended):  ollama pull llama3.2:1b\n" +
        "  Free cloud (fastest):           Get a free Groq key at https://console.groq.com/keys, then export GROQ_API_KEY=...\n" +
        "  Or run 'mneme setup-free' for a guided 30-second setup.",
    );
    this.name = "NoEnricherAvailableError";
  }
}

/** Catalog exposed for `mneme setup-free` and CLI hints. */
export function listProviders(): typeof PROVIDERS {
  return PROVIDERS;
}
