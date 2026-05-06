/**
 * Tests for the resolveEmbedder() fallback ladder.
 *
 * Strategy: stub network-touching methods (Ollama.ping, Ollama.verify) so
 * tests run offline + deterministically. We're NOT validating real Ollama
 * or model downloads here — the ladder logic is what matters.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { resolveEmbedder } from "./resolve.js";
import { OllamaEmbedder } from "./ollama.js";

describe("resolveEmbedder — auto fallback ladder (never blocks user)", () => {
  const origKey = process.env["OPENAI_API_KEY"];

  beforeEach(() => {
    delete process.env["OPENAI_API_KEY"];
    vi.spyOn(OllamaEmbedder.prototype, "ping").mockResolvedValue(false);
  });

  afterEach(() => {
    if (origKey !== undefined) process.env["OPENAI_API_KEY"] = origKey;
    else delete process.env["OPENAI_API_KEY"];
    vi.restoreAllMocks();
  });

  it("auto picks OpenAI when OPENAI_API_KEY is set", async () => {
    process.env["OPENAI_API_KEY"] = "sk-test-key";
    const e = await resolveEmbedder({ provider: "auto" });
    expect(e.name.startsWith("openai:")).toBe(true);
  });

  it("auto picks Ollama when ping AND verify both succeed", async () => {
    vi.spyOn(OllamaEmbedder.prototype, "ping").mockResolvedValue(true);
    vi.spyOn(OllamaEmbedder.prototype, "verify").mockResolvedValue({ ok: true });
    const e = await resolveEmbedder({ provider: "auto" });
    expect(e.name.startsWith("ollama:")).toBe(true);
  });

  it("auto SKIPS Ollama when ping succeeds but verify fails (the v0.19 fix)", async () => {
    vi.spyOn(OllamaEmbedder.prototype, "ping").mockResolvedValue(true);
    vi.spyOn(OllamaEmbedder.prototype, "verify").mockResolvedValue({
      ok: false,
      reason: "embed timed out",
      remedy: "warm up model",
    });
    const e = await resolveEmbedder({ provider: "auto" });
    // Falls through to bundled — the user's pre-v0.19 hang is GONE.
    expect(e.name.startsWith("bundled:")).toBe(true);
  });

  it("auto picks bundled WASM when nothing else is available", async () => {
    // ping defaults to false in beforeEach; no OPENAI_API_KEY.
    const e = await resolveEmbedder({ provider: "auto" });
    expect(e.name.startsWith("bundled:")).toBe(true);
    expect(e.dimensions).toBe(384);
  });

  it("explicit provider:hash bypasses the ladder and returns hash", async () => {
    const e = await resolveEmbedder({ provider: "hash" });
    expect(e.name.startsWith("hash:")).toBe(true);
  });

  it("explicit provider:bundled returns bundled with the requested model", async () => {
    const e = await resolveEmbedder({
      provider: "bundled",
      model: "Xenova/bge-small-en",
    });
    expect(e.name).toBe("bundled:Xenova/bge-small-en");
  });

  it("explicit provider:ollama throws when Ollama isn't reachable (helpful error)", async () => {
    await expect(resolveEmbedder({ provider: "ollama" })).rejects.toThrow(/Ollama not reachable/);
  });

  it("explicit provider:openai without a key throws a clear error", async () => {
    await expect(resolveEmbedder({ provider: "openai" })).rejects.toThrow(/OpenAI API key/);
  });
});
