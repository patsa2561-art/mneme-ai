/**
 * v2.19.12 — MNEME MODEL CHRYSALIS (Future-Model-Proof AI vendor adapter)
 *
 *   "New AI model launches Tuesday? Mneme adapts Tuesday. The chrysalis
 *    layer ships a registry of known vendor ABIs (request/response
 *    shapes) and synthesises a translator on the fly. The CLI gains a
 *    new `mneme ask --model <any-id>` surface without releasing a new
 *    Mneme version."
 *
 * Architecture:
 *   - `AbiFingerprint`: the canonical { provider, baseUrl, requestShape,
 *     responseShape, modelIdPath } description of one vendor's chat-completion
 *     ABI. We ship 5 known fingerprints at v2.19.12:
 *       anthropic-messages, openai-chat-completions, gemini-generate-content,
 *       ollama-chat, lm-studio-openai-compat.
 *   - `translateRequest`: takes Mneme's canonical {messages, model} and
 *     returns the vendor's actual JSON body.
 *   - `translateResponse`: takes the vendor's JSON reply and returns
 *     Mneme's canonical {content, model, usage?}.
 *   - `registerFingerprint`: caller-extensible — new vendors registered at
 *     runtime without a Mneme rebuild.
 *   - `probeFingerprint`: matches an arbitrary base URL against known
 *     fingerprints by URL pattern (`urlHints` strings).
 *
 * Honest scope:
 *   - We do NOT actually call the vendor — we translate the SHAPE only.
 *     The caller does the fetch. This keeps the module dependency-free
 *     and testable without network mocks.
 *   - The shipped fingerprints reflect ABIs as of 2026-05-16. Anything
 *     that drifts will need a fingerprint update (or runtime register).
 *   - probe by url-hint is a heuristic, not a guarantee.
 */

const PROTOCOL_VERSION = 1 as const;

export interface CanonicalMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CanonicalRequest {
  model: string;
  messages: CanonicalMessage[];
  maxTokens?: number;
  temperature?: number;
}

export interface CanonicalResponse {
  content: string;
  model: string;
  finishReason?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
}

export type RequestShaper = (req: CanonicalRequest) => unknown;
export type ResponseShaper = (raw: unknown) => CanonicalResponse;

export interface AbiFingerprint {
  v: typeof PROTOCOL_VERSION;
  provider: string;
  /** Default base URL — caller can override per call. */
  baseUrl: string;
  /** Substrings of the base URL that uniquely identify this fingerprint. */
  urlHints: string[];
  /** Path under baseUrl to POST the request to. */
  endpoint: string;
  /** Optional auth header NAME (caller injects value at call-time). */
  authHeader?: string;
  shapeRequest: RequestShaper;
  shapeResponse: ResponseShaper;
}

function getStr(o: unknown, path: string[]): string | undefined {
  let cur: unknown = o;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return typeof cur === "string" ? cur : undefined;
}

function getNum(o: unknown, path: string[]): number | undefined {
  let cur: unknown = o;
  for (const k of path) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[k];
  }
  return typeof cur === "number" ? cur : undefined;
}

/** Built-in fingerprints shipped at v2.19.12. */
export const BUILTIN_FINGERPRINTS: AbiFingerprint[] = [
  {
    v: PROTOCOL_VERSION,
    provider: "anthropic-messages",
    baseUrl: "https://api.anthropic.com",
    urlHints: ["api.anthropic.com", "anthropic.com"],
    endpoint: "/v1/messages",
    authHeader: "x-api-key",
    shapeRequest: (r) => {
      const sys = r.messages.find((m) => m.role === "system");
      const userMsgs = r.messages.filter((m) => m.role !== "system");
      const body: Record<string, unknown> = {
        model: r.model,
        messages: userMsgs.map((m) => ({ role: m.role, content: m.content })),
        max_tokens: r.maxTokens ?? 1024,
      };
      if (sys) body["system"] = sys.content;
      if (typeof r.temperature === "number") body["temperature"] = r.temperature;
      return body;
    },
    shapeResponse: (raw) => {
      const content = (() => {
        const arr = (raw as { content?: Array<{ type?: string; text?: string }> })?.content;
        if (!Array.isArray(arr)) return "";
        return arr.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("");
      })();
      return {
        content,
        model: getStr(raw, ["model"]) ?? "",
        finishReason: getStr(raw, ["stop_reason"]),
        usage: {
          inputTokens: getNum(raw, ["usage", "input_tokens"]),
          outputTokens: getNum(raw, ["usage", "output_tokens"]),
        },
      };
    },
  },
  {
    v: PROTOCOL_VERSION,
    provider: "openai-chat-completions",
    baseUrl: "https://api.openai.com",
    urlHints: ["api.openai.com", "openai.com"],
    endpoint: "/v1/chat/completions",
    authHeader: "authorization",
    shapeRequest: (r) => {
      const body: Record<string, unknown> = {
        model: r.model,
        messages: r.messages.map((m) => ({ role: m.role, content: m.content })),
      };
      if (typeof r.maxTokens === "number") body["max_tokens"] = r.maxTokens;
      if (typeof r.temperature === "number") body["temperature"] = r.temperature;
      return body;
    },
    shapeResponse: (raw) => {
      const choice = (raw as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> })?.choices?.[0];
      return {
        content: choice?.message?.content ?? "",
        model: getStr(raw, ["model"]) ?? "",
        finishReason: choice?.finish_reason,
        usage: {
          inputTokens: getNum(raw, ["usage", "prompt_tokens"]),
          outputTokens: getNum(raw, ["usage", "completion_tokens"]),
        },
      };
    },
  },
  {
    v: PROTOCOL_VERSION,
    provider: "gemini-generate-content",
    baseUrl: "https://generativelanguage.googleapis.com",
    urlHints: ["generativelanguage.googleapis.com", "gemini.google.com"],
    endpoint: "/v1beta/models/{model}:generateContent",
    authHeader: "x-goog-api-key",
    shapeRequest: (r) => {
      const sys = r.messages.find((m) => m.role === "system");
      const others = r.messages.filter((m) => m.role !== "system");
      const body: Record<string, unknown> = {
        contents: others.map((m) => ({
          role: m.role === "assistant" ? "model" : "user",
          parts: [{ text: m.content }],
        })),
      };
      if (sys) body["systemInstruction"] = { parts: [{ text: sys.content }] };
      if (typeof r.temperature === "number" || typeof r.maxTokens === "number") {
        const gen: Record<string, unknown> = {};
        if (typeof r.temperature === "number") gen["temperature"] = r.temperature;
        if (typeof r.maxTokens === "number") gen["maxOutputTokens"] = r.maxTokens;
        body["generationConfig"] = gen;
      }
      return body;
    },
    shapeResponse: (raw) => {
      const cand = (raw as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }> })?.candidates?.[0];
      const txt = cand?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
      return {
        content: txt,
        model: getStr(raw, ["modelVersion"]) ?? "",
        finishReason: cand?.finishReason,
        usage: {
          inputTokens: getNum(raw, ["usageMetadata", "promptTokenCount"]),
          outputTokens: getNum(raw, ["usageMetadata", "candidatesTokenCount"]),
        },
      };
    },
  },
  {
    v: PROTOCOL_VERSION,
    provider: "ollama-chat",
    baseUrl: "http://127.0.0.1:11434",
    urlHints: ["127.0.0.1:11434", "localhost:11434", "/api/chat"],
    endpoint: "/api/chat",
    shapeRequest: (r) => {
      const body: Record<string, unknown> = {
        model: r.model,
        messages: r.messages.map((m) => ({ role: m.role, content: m.content })),
        stream: false,
      };
      if (typeof r.temperature === "number" || typeof r.maxTokens === "number") {
        const opts: Record<string, unknown> = {};
        if (typeof r.temperature === "number") opts["temperature"] = r.temperature;
        if (typeof r.maxTokens === "number") opts["num_predict"] = r.maxTokens;
        body["options"] = opts;
      }
      return body;
    },
    shapeResponse: (raw) => {
      const msg = (raw as { message?: { content?: string } })?.message;
      return {
        content: msg?.content ?? "",
        model: getStr(raw, ["model"]) ?? "",
        finishReason: getStr(raw, ["done_reason"]),
        usage: {
          inputTokens: getNum(raw, ["prompt_eval_count"]),
          outputTokens: getNum(raw, ["eval_count"]),
        },
      };
    },
  },
  {
    v: PROTOCOL_VERSION,
    provider: "lm-studio-openai-compat",
    baseUrl: "http://127.0.0.1:1234",
    urlHints: ["127.0.0.1:1234", "localhost:1234", "/v1/chat/completions"],
    endpoint: "/v1/chat/completions",
    shapeRequest: (r) => {
      const body: Record<string, unknown> = {
        model: r.model,
        messages: r.messages.map((m) => ({ role: m.role, content: m.content })),
      };
      if (typeof r.maxTokens === "number") body["max_tokens"] = r.maxTokens;
      if (typeof r.temperature === "number") body["temperature"] = r.temperature;
      return body;
    },
    shapeResponse: (raw) => {
      const choice = (raw as { choices?: Array<{ message?: { content?: string }; finish_reason?: string }> })?.choices?.[0];
      return {
        content: choice?.message?.content ?? "",
        model: getStr(raw, ["model"]) ?? "",
        finishReason: choice?.finish_reason,
        usage: {
          inputTokens: getNum(raw, ["usage", "prompt_tokens"]),
          outputTokens: getNum(raw, ["usage", "completion_tokens"]),
        },
      };
    },
  },
];

export class ChrysalisRegistry {
  private fingerprints: Map<string, AbiFingerprint> = new Map();
  constructor(initial?: AbiFingerprint[]) {
    const seed = initial ?? BUILTIN_FINGERPRINTS;
    for (const f of seed) this.fingerprints.set(f.provider, f);
  }
  register(fp: AbiFingerprint): void {
    this.fingerprints.set(fp.provider, fp);
  }
  get(provider: string): AbiFingerprint | undefined {
    return this.fingerprints.get(provider);
  }
  list(): AbiFingerprint[] {
    return Array.from(this.fingerprints.values());
  }
  /** Heuristic: match a URL substring against known urlHints. Returns FIRST match. */
  probe(opts: { baseUrl: string }): { matched: AbiFingerprint | null; reason: string } {
    const url = opts.baseUrl.toLowerCase();
    for (const fp of this.fingerprints.values()) {
      for (const hint of fp.urlHints) {
        if (url.includes(hint.toLowerCase())) {
          return { matched: fp, reason: `urlHint '${hint}' matched provider '${fp.provider}'` };
        }
      }
    }
    return { matched: null, reason: `no built-in fingerprint matches '${opts.baseUrl}' — call registerFingerprint to add one` };
  }
  translateRequest(opts: { provider: string; request: CanonicalRequest }): unknown {
    const fp = this.fingerprints.get(opts.provider);
    if (!fp) throw new Error(`chrysalis: no fingerprint for '${opts.provider}'`);
    return fp.shapeRequest(opts.request);
  }
  translateResponse(opts: { provider: string; raw: unknown }): CanonicalResponse {
    const fp = this.fingerprints.get(opts.provider);
    if (!fp) throw new Error(`chrysalis: no fingerprint for '${opts.provider}'`);
    return fp.shapeResponse(opts.raw);
  }
}

export function defaultChrysalis(): ChrysalisRegistry {
  return new ChrysalisRegistry();
}

export function formatFingerprintLine(fp: AbiFingerprint): string {
  return `🦋 ${fp.provider} · base=${fp.baseUrl} · endpoint=${fp.endpoint}`;
}
