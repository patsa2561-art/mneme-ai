import { describe, it, expect } from "vitest";
import {
  ChrysalisRegistry,
  BUILTIN_FINGERPRINTS,
  defaultChrysalis,
  formatFingerprintLine,
  type CanonicalRequest,
  type AbiFingerprint,
} from "./index.js";

const CANONICAL: CanonicalRequest = {
  model: "test-model",
  messages: [
    { role: "system", content: "You are honest." },
    { role: "user", content: "What is 2+2?" },
  ],
  maxTokens: 256,
  temperature: 0.2,
};

describe("v2.19.12 MODEL CHRYSALIS · registry + built-ins", () => {
  it("ships 5 known fingerprints", () => {
    const r = defaultChrysalis();
    const providers = r.list().map((f) => f.provider).sort();
    expect(providers).toEqual([
      "anthropic-messages",
      "gemini-generate-content",
      "lm-studio-openai-compat",
      "ollama-chat",
      "openai-chat-completions",
    ]);
  });

  it("allows runtime registration of a new fingerprint without rebuilding", () => {
    const r = defaultChrysalis();
    const before = r.list().length;
    const fp: AbiFingerprint = {
      v: 1,
      provider: "future-vendor-2027",
      baseUrl: "https://future-ai.example.com",
      urlHints: ["future-ai.example.com"],
      endpoint: "/v2/chat",
      shapeRequest: (req) => ({ prompt: req.messages.map((m) => m.content).join("\n") }),
      shapeResponse: (raw) => ({ content: (raw as { text?: string }).text ?? "", model: "future" }),
    };
    r.register(fp);
    expect(r.list().length).toBe(before + 1);
    expect(r.get("future-vendor-2027")).toBeDefined();
  });
});

describe("v2.19.12 MODEL CHRYSALIS · probe", () => {
  it("matches anthropic URLs to the anthropic fingerprint", () => {
    const r = defaultChrysalis();
    const p = r.probe({ baseUrl: "https://api.anthropic.com/v1" });
    expect(p.matched?.provider).toBe("anthropic-messages");
  });

  it("matches local ollama URL", () => {
    const r = defaultChrysalis();
    const p = r.probe({ baseUrl: "http://127.0.0.1:11434" });
    expect(p.matched?.provider).toBe("ollama-chat");
  });

  it("returns null + helpful hint for an unknown URL", () => {
    const r = defaultChrysalis();
    const p = r.probe({ baseUrl: "https://aliens.example.com/v9/chat" });
    expect(p.matched).toBeNull();
    expect(p.reason).toContain("registerFingerprint");
  });
});

describe("v2.19.12 MODEL CHRYSALIS · translateRequest", () => {
  it("anthropic: extracts system to top-level + only user/assistant in messages + max_tokens", () => {
    const r = defaultChrysalis();
    const body = r.translateRequest({ provider: "anthropic-messages", request: CANONICAL }) as Record<string, unknown>;
    expect(body["system"]).toBe("You are honest.");
    expect((body["messages"] as Array<{ role: string }>).every((m) => m.role !== "system")).toBe(true);
    expect(body["max_tokens"]).toBe(256);
    expect(body["temperature"]).toBe(0.2);
  });

  it("openai: keeps system in messages array + uses snake_case max_tokens", () => {
    const r = defaultChrysalis();
    const body = r.translateRequest({ provider: "openai-chat-completions", request: CANONICAL }) as Record<string, unknown>;
    const msgs = body["messages"] as Array<{ role: string }>;
    expect(msgs.some((m) => m.role === "system")).toBe(true);
    expect(body["max_tokens"]).toBe(256);
  });

  it("gemini: maps assistant→model + uses systemInstruction + generationConfig.maxOutputTokens", () => {
    const r = defaultChrysalis();
    const reqWithAsst: CanonicalRequest = {
      ...CANONICAL,
      messages: [...CANONICAL.messages, { role: "assistant", content: "OK" }],
    };
    const body = r.translateRequest({ provider: "gemini-generate-content", request: reqWithAsst }) as Record<string, unknown>;
    const contents = body["contents"] as Array<{ role: string }>;
    expect(contents.some((c) => c.role === "model")).toBe(true);
    const sysInst = body["systemInstruction"] as { parts?: Array<{ text?: string }> } | undefined;
    expect(sysInst?.parts?.[0]?.text).toBe("You are honest.");
    const genConfig = body["generationConfig"] as { maxOutputTokens?: number };
    expect(genConfig.maxOutputTokens).toBe(256);
  });

  it("ollama: wraps temperature/maxTokens into options.num_predict + stream=false", () => {
    const r = defaultChrysalis();
    const body = r.translateRequest({ provider: "ollama-chat", request: CANONICAL }) as Record<string, unknown>;
    expect(body["stream"]).toBe(false);
    const opts = body["options"] as { temperature?: number; num_predict?: number };
    expect(opts.temperature).toBe(0.2);
    expect(opts.num_predict).toBe(256);
  });

  it("lm-studio: openai-compatible shape (same fields as openai)", () => {
    const r = defaultChrysalis();
    const body = r.translateRequest({ provider: "lm-studio-openai-compat", request: CANONICAL }) as Record<string, unknown>;
    expect(body["max_tokens"]).toBe(256);
    expect(body["temperature"]).toBe(0.2);
  });

  it("throws on unknown provider", () => {
    const r = defaultChrysalis();
    expect(() => r.translateRequest({ provider: "ghost", request: CANONICAL })).toThrow();
  });
});

describe("v2.19.12 MODEL CHRYSALIS · translateResponse", () => {
  it("anthropic response: extracts text from content blocks + usage tokens", () => {
    const r = defaultChrysalis();
    const raw = {
      content: [{ type: "text", text: "Four." }, { type: "text", text: " That's it." }],
      model: "claude-test",
      stop_reason: "end_turn",
      usage: { input_tokens: 12, output_tokens: 3 },
    };
    const out = r.translateResponse({ provider: "anthropic-messages", raw });
    expect(out.content).toBe("Four. That's it.");
    expect(out.model).toBe("claude-test");
    expect(out.finishReason).toBe("end_turn");
    expect(out.usage?.inputTokens).toBe(12);
    expect(out.usage?.outputTokens).toBe(3);
  });

  it("openai response: extracts choices[0].message.content + maps prompt/completion tokens", () => {
    const r = defaultChrysalis();
    const raw = {
      choices: [{ message: { content: "Four." }, finish_reason: "stop" }],
      model: "gpt-test",
      usage: { prompt_tokens: 10, completion_tokens: 2 },
    };
    const out = r.translateResponse({ provider: "openai-chat-completions", raw });
    expect(out.content).toBe("Four.");
    expect(out.usage?.inputTokens).toBe(10);
    expect(out.usage?.outputTokens).toBe(2);
  });

  it("gemini response: concatenates candidate parts + reads usageMetadata", () => {
    const r = defaultChrysalis();
    const raw = {
      candidates: [{ content: { parts: [{ text: "Four." }, { text: " Done." }] }, finishReason: "STOP" }],
      modelVersion: "gemini-test",
      usageMetadata: { promptTokenCount: 9, candidatesTokenCount: 2 },
    };
    const out = r.translateResponse({ provider: "gemini-generate-content", raw });
    expect(out.content).toBe("Four. Done.");
    expect(out.finishReason).toBe("STOP");
    expect(out.usage?.inputTokens).toBe(9);
  });

  it("ollama response: extracts message.content + maps eval_count tokens", () => {
    const r = defaultChrysalis();
    const raw = { message: { content: "Four." }, model: "llama-test", done_reason: "stop", prompt_eval_count: 8, eval_count: 1 };
    const out = r.translateResponse({ provider: "ollama-chat", raw });
    expect(out.content).toBe("Four.");
    expect(out.usage?.inputTokens).toBe(8);
    expect(out.usage?.outputTokens).toBe(1);
  });

  it("handles missing fields gracefully (returns empty strings/undefined, never throws)", () => {
    const r = defaultChrysalis();
    const out = r.translateResponse({ provider: "openai-chat-completions", raw: {} });
    expect(out.content).toBe("");
    expect(out.model).toBe("");
    expect(out.finishReason).toBeUndefined();
  });
});

describe("v2.19.12 MODEL CHRYSALIS · formatter", () => {
  it("formatter shows provider + base + endpoint with 🦋", () => {
    const fp = BUILTIN_FINGERPRINTS[0]!;
    const line = formatFingerprintLine(fp);
    expect(line).toContain("🦋");
    expect(line).toContain(fp.provider);
    expect(line).toContain(fp.endpoint);
  });
});
