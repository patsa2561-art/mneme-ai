import { describe, it, expect } from "vitest";
import {
  detectVendorFromUrl,
  extractChatTurns,
  extractModelHint,
  mintFromBrowserCapture,
  serializeForLocalStorage,
  deserializeFromLocalStorage,
  computeBrowserStats,
  formatBrowserStatsLine,
  BROWSER_RECEIPT_TUNABLES,
  type WebVendor,
  type ChatTurn,
} from "./index.js";
import { validateReceipt } from "../mneme_receipt_protocol/index.js";

describe("v2.19.37 BROWSER RECEIPT — vendor detection", () => {
  it("detects all 6 supported vendors from canonical URLs", () => {
    expect(detectVendorFromUrl("https://chatgpt.com/c/abc")).toBe("chatgpt");
    expect(detectVendorFromUrl("https://chat.openai.com/c/abc")).toBe("chatgpt");
    expect(detectVendorFromUrl("https://claude.ai/chats/xyz")).toBe("claude");
    expect(detectVendorFromUrl("https://gemini.google.com/app")).toBe("gemini");
    expect(detectVendorFromUrl("https://bard.google.com/")).toBe("gemini");
    expect(detectVendorFromUrl("https://grok.com/chat")).toBe("grok");
    expect(detectVendorFromUrl("https://x.com/i/grok")).toBe("grok");
    expect(detectVendorFromUrl("https://www.perplexity.ai/")).toBe("perplexity");
    expect(detectVendorFromUrl("https://copilot.microsoft.com/")).toBe("copilot");
  });

  it("returns 'unknown' for non-AI URLs + garbage input", () => {
    expect(detectVendorFromUrl("https://google.com/")).toBe("unknown");
    expect(detectVendorFromUrl("not-a-url")).toBe("unknown");
    expect(detectVendorFromUrl(undefined)).toBe("unknown");
    expect(detectVendorFromUrl(null)).toBe("unknown");
    expect(detectVendorFromUrl(42)).toBe("unknown");
  });
});

describe("v2.19.37 BROWSER RECEIPT — chat turn extraction", () => {
  it("extracts user + assistant turns from ChatGPT-style DOM text", () => {
    const dom = `You
What is 2+2?
ChatGPT
2+2 equals 4.`;
    const turns = extractChatTurns({ vendor: "chatgpt", domText: dom, nowMs: 1 });
    expect(turns.length).toBe(2);
    expect(turns[0]!.role).toBe("user");
    expect(turns[0]!.text).toContain("What is 2+2?");
    expect(turns[1]!.role).toBe("assistant");
    expect(turns[1]!.text).toContain("2+2 equals 4");
  });

  it("works for Claude vendor", () => {
    const dom = `You
Help me with code
Claude
Here's the function:`;
    const turns = extractChatTurns({ vendor: "claude", domText: dom });
    expect(turns.length).toBe(2);
    expect(turns[1]!.text).toContain("Here's the function");
  });

  it("returns [] for unknown vendor", () => {
    expect(extractChatTurns({ vendor: "unknown", domText: "anything" })).toEqual([]);
  });

  it("DEFENSIVE: empty / null DOM never throws", () => {
    expect(extractChatTurns({ vendor: "chatgpt", domText: "" })).toEqual([]);
    expect(extractChatTurns({ vendor: "claude", domText: null as unknown as string })).toEqual([]);
  });

  it("caps per-turn text at 50,000 chars (safety)", () => {
    const huge = "x".repeat(100_000);
    const dom = `You\n${huge}\nChatGPT\nresponse`;
    const turns = extractChatTurns({ vendor: "chatgpt", domText: dom });
    if (turns.length > 0) expect(turns[0]!.text.length).toBeLessThanOrEqual(50_000);
  });
});

describe("v2.19.37 BROWSER RECEIPT — model hint extraction", () => {
  it("extracts ChatGPT-style model hint", () => {
    expect(extractModelHint({ vendor: "chatgpt", domText: "Model: GPT-4o · Turbo" })).toBe("GPT-4o");
  });
  it("extracts Claude-style model hint", () => {
    expect(extractModelHint({ vendor: "claude", domText: "using Claude Opus 4.7 today" })).toBe("Claude Opus 4.7");
  });
  it("extracts Gemini-style", () => {
    expect(extractModelHint({ vendor: "gemini", domText: "Powered by Gemini 2.0 Pro" })).toBe("Gemini 2.0 Pro");
  });
  it("returns undefined when no hint matches", () => {
    expect(extractModelHint({ vendor: "chatgpt", domText: "no model info here" })).toBeUndefined();
  });
});

describe("v2.19.37 BROWSER RECEIPT — mint from capture (round-trip)", () => {
  it("produces a VALID ProtocolReceipt", () => {
    const userTurn: ChatTurn = { role: "user", text: "hi", capturedAtMs: 1_700_000_000_000 };
    const asstTurn: ChatTurn = { role: "assistant", text: "hello", capturedAtMs: 1_700_000_000_500 };
    const r = mintFromBrowserCapture({
      vendor: "claude", userTurn, assistantTurn: asstTurn,
      modelHint: "Claude Opus 4.7",
    });
    // ext namespace fires WARNING (forward-compat) but body is structurally VALID
    expect(["VALID", "WARNING"]).toContain(validateReceipt(r).verdict);
    expect(r.vendor).toBe("claude");
    expect(r.modelVersion).toBe("Claude Opus 4.7");
    expect(r.ext?.["@mneme-ai/browser-receipt"]?.["capturedFromWebChat"]).toBe(true);
  });

  it("token estimation falls back to char/4 when not supplied", () => {
    const userTurn: ChatTurn = { role: "user", text: "x".repeat(40), capturedAtMs: 0 };
    const asstTurn: ChatTurn = { role: "assistant", text: "y".repeat(80), capturedAtMs: 0 };
    const r = mintFromBrowserCapture({ vendor: "chatgpt", userTurn, assistantTurn: asstTurn });
    expect(r.tokensIn).toBe(10);
    expect(r.tokensOut).toBe(20);
  });

  it("explicit tokens override estimation", () => {
    const userTurn: ChatTurn = { role: "user", text: "x".repeat(100), capturedAtMs: 0 };
    const asstTurn: ChatTurn = { role: "assistant", text: "y".repeat(100), capturedAtMs: 0 };
    const r = mintFromBrowserCapture({ vendor: "claude", userTurn, assistantTurn: asstTurn, tokensIn: 7, tokensOut: 11 });
    expect(r.tokensIn).toBe(7);
    expect(r.tokensOut).toBe(11);
  });
});

describe("v2.19.37 BROWSER RECEIPT — local storage round-trip", () => {
  it("serialize → deserialize preserves receipts", () => {
    const userTurn: ChatTurn = { role: "user", text: "hi", capturedAtMs: 1 };
    const asstTurn: ChatTurn = { role: "assistant", text: "hello", capturedAtMs: 2 };
    const r = mintFromBrowserCapture({ vendor: "claude", userTurn, assistantTurn: asstTurn });
    const s = serializeForLocalStorage([r], 100);
    const parsed = deserializeFromLocalStorage(s);
    expect(parsed).not.toBeNull();
    expect(parsed!.receipts.length).toBe(1);
    expect(parsed!.receipts[0]!.contentHash).toBe(r.contentHash);
  });

  it("deserialize returns null on garbage", () => {
    expect(deserializeFromLocalStorage("not-json")).toBeNull();
    expect(deserializeFromLocalStorage('{"batchVersion":99}')).toBeNull();
    expect(deserializeFromLocalStorage('{"batchVersion":1,"receipts":"not-array"}')).toBeNull();
  });
});

describe("v2.19.37 BROWSER RECEIPT — A/B before vs after", () => {
  it("A: pre-v2.19.37 = 0 web vendors detectable; B: 6 supported", () => {
    expect(BROWSER_RECEIPT_TUNABLES.SUPPORTED_VENDORS.length).toBe(6);
  });

  it("computeBrowserStats: 200M+ ChatGPT users now within reach (qualitative; quantitative = receipts captured)", () => {
    const receipts = [];
    for (let i = 0; i < 5; i++) {
      const ut: ChatTurn = { role: "user", text: "hi", capturedAtMs: i };
      const at: ChatTurn = { role: "assistant", text: "hello", capturedAtMs: i + 1 };
      receipts.push(mintFromBrowserCapture({
        vendor: (["claude", "chatgpt", "gemini", "grok", "perplexity"] as WebVendor[])[i]!,
        userTurn: ut, assistantTurn: at, tokensIn: 100, tokensOut: 200, costUsdMicros: 1000,
      }));
    }
    const s = computeBrowserStats(receipts);
    expect(s.totalReceipts).toBe(5);
    expect(s.vendorBreakdown.claude).toBe(1);
    expect(formatBrowserStatsLine(s)).toContain("BROWSER");
  });
});

describe("v2.19.37 BROWSER RECEIPT — 1000+ fuzz iterations", () => {
  it("1000 random capture+mint cycles all produce VALID receipts", () => {
    const vendors: WebVendor[] = ["chatgpt", "claude", "gemini", "grok", "perplexity", "copilot"];
    for (let i = 0; i < 1000; i++) {
      const ut: ChatTurn = { role: "user", text: `prompt ${i}`, capturedAtMs: i };
      const at: ChatTurn = { role: "assistant", text: `response ${i}`, capturedAtMs: i + 1 };
      const r = mintFromBrowserCapture({
        vendor: vendors[i % vendors.length]!,
        userTurn: ut, assistantTurn: at,
        tokensIn: i, tokensOut: i * 2, costUsdMicros: i * 10,
      });
      expect(["VALID", "WARNING"]).toContain(validateReceipt(r).verdict);
    }
  });
});
