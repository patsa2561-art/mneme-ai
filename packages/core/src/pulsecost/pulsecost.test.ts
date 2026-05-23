// v2.33.0 — PULSECOST discrete root tests.

import { describe, it, expect } from "vitest";
import { SPEC, estimateTokens, trimToBudget, readRequestBudget } from "./index.js";

describe("PULSECOST spec", () => {
  it("emits the 3 header names per the proposed extension", () => {
    expect(SPEC.headers.requestAvailable).toBe("X-Context-Available-Tokens");
    expect(SPEC.headers.responseUsed).toBe("X-Context-Used-Tokens");
    expect(SPEC.headers.responseTrimmed).toBe("X-Context-Trimmed");
  });
  it("spec body mentions MCP + protocol", () => {
    expect(SPEC.body).toMatch(/MCP/);
    expect(SPEC.body).toMatch(/Context-Available-Tokens/);
  });
});

describe("estimateTokens", () => {
  it("0 for empty string", () => { expect(estimateTokens("")).toBe(0); });
  it("ceil(words/0.75) for words", () => {
    // 3 words → ceil(3/0.75) = 4 tokens
    expect(estimateTokens("one two three")).toBe(4);
  });
});

describe("trimToBudget", () => {
  it("returns text unchanged when within budget", () => {
    const r = trimToBudget("Hello world.", { availableTokens: 1000, defaultBudget: 1000, wordsPerToken: 0.75 });
    expect(r.trimmed).toBe(false);
    expect(r.output).toBe("Hello world.");
    expect(r.headers["X-Context-Trimmed"]).toBe("false");
  });

  it("sentence-aware trim keeps first N sentences", () => {
    const text = "First sentence here. Second sentence here. Third sentence here. Fourth sentence here. Fifth sentence here. Sixth sentence here. Seventh sentence here. Eighth sentence here.";
    // 8 sentences × 3 words = 24 words = 32 tokens. Budget 12 should fit ~2-3 sentences.
    const r = trimToBudget(text, { availableTokens: 12, defaultBudget: 100, wordsPerToken: 0.75 });
    expect(r.trimmed).toBe(true);
    expect(r.output.length).toBeLessThan(text.length);
    expect(r.output).toMatch(/^First sentence here\./);
    expect(r.headers["X-Context-Trimmed"]).toBe("true");
    expect(parseInt(r.headers["X-Context-Used-Tokens"]!, 10)).toBeLessThanOrEqual(12);
  });

  it("falls back to char-truncation when single sentence already too large", () => {
    const longSentence = "word ".repeat(500); // 500 words
    const r = trimToBudget(longSentence, { availableTokens: 5, defaultBudget: 100, wordsPerToken: 0.75 });
    expect(r.trimmed).toBe(true);
    expect(r.output.endsWith("…")).toBe(true);
  });
});

describe("readRequestBudget", () => {
  it("uses default when header missing", () => {
    const r = readRequestBudget({});
    expect(r.availableTokens).toBe(8192);
  });
  it("parses integer header value", () => {
    const r = readRequestBudget({ "X-Context-Available-Tokens": "2048" });
    expect(r.availableTokens).toBe(2048);
  });
  it("case-insensitive fallback", () => {
    const r = readRequestBudget({ "x-context-available-tokens": "1024" });
    expect(r.availableTokens).toBe(1024);
  });
  it("invalid header falls back to default", () => {
    const r = readRequestBudget({ "X-Context-Available-Tokens": "garbage" });
    expect(r.availableTokens).toBe(8192);
  });
});
