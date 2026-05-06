import { describe, it, expect } from "vitest";
import { recommendEmbedder, type OllamaProbe, type OpenAIProbe, type HardwareProbe } from "./probe.js";

const goodHw: HardwareProbe = { platform: "linux", arch: "x64", ramGB: 16, cpuCount: 8, tier: "good" };
const weakHw: HardwareProbe = { platform: "linux", arch: "x64", ramGB: 2, cpuCount: 2, tier: "weak" };

describe("recommendEmbedder — picks the best path for THIS user", () => {
  it('picks "ollama" when Ollama is up and embedding model is pulled', () => {
    const r = recommendEmbedder(
      { reachable: true, baseUrl: "x", hasEmbedModel: true, models: ["nomic-embed-text"] },
      { hasKey: false },
      goodHw,
    );
    expect(r.pick).toBe("ollama");
    expect(r.action).toBeUndefined();
    expect(r.qualityStars).toBe(4);
  });

  it("recommends pulling the model when Ollama is up but model is not", () => {
    const r = recommendEmbedder(
      { reachable: true, baseUrl: "x", hasEmbedModel: false, models: ["llama3.2:1b"] },
      { hasKey: false },
      goodHw,
    );
    expect(r.pick).toBe("ollama");
    expect(r.action).toContain("ollama pull");
  });

  it("falls through to OpenAI when Ollama is unreachable but key exists", () => {
    const r = recommendEmbedder(
      { reachable: false, baseUrl: "x", error: "connection refused" },
      { hasKey: true, keyTail: "abcd" },
      goodHw,
    );
    expect(r.pick).toBe("openai");
    expect(r.reason).toContain("abcd");
    expect(r.qualityStars).toBe(5);
  });

  it("recommends bundled WASM on capable hardware with no embedder available (zero-install path)", () => {
    const r = recommendEmbedder(
      { reachable: false, baseUrl: "x" },
      { hasKey: false },
      goodHw,
    );
    expect(r.pick).toBe("bundled");
    expect(r.qualityStars).toBe(3);
    expect(r.reason.toLowerCase()).toContain("no setup");
  });

  it("still picks bundled on weak hardware (works anywhere) — user can opt into hash explicitly", () => {
    const r = recommendEmbedder(
      { reachable: false, baseUrl: "x" },
      { hasKey: false },
      weakHw,
    );
    expect(r.pick).toBe("bundled");
    expect(r.reason.toLowerCase()).toContain("hash");
  });

  it("OpenAI key trumps ollama-not-running on weak hardware", () => {
    const r = recommendEmbedder(
      { reachable: false, baseUrl: "x" },
      { hasKey: true, keyTail: "1234" },
      weakHw,
    );
    expect(r.pick).toBe("openai");
  });

  it("Ollama trumps OpenAI when both are available (privacy default)", () => {
    const r = recommendEmbedder(
      { reachable: true, baseUrl: "x", hasEmbedModel: true, models: ["nomic-embed-text"] },
      { hasKey: true, keyTail: "1234" },
      goodHw,
    );
    expect(r.pick).toBe("ollama");
  });

  it("every recommendation includes a human-readable reason", () => {
    const cases: Array<[OllamaProbe, OpenAIProbe, HardwareProbe]> = [
      [{ reachable: true, baseUrl: "x", hasEmbedModel: true, models: [] }, { hasKey: false }, goodHw],
      [{ reachable: true, baseUrl: "x", hasEmbedModel: false, models: [] }, { hasKey: false }, goodHw],
      [{ reachable: false, baseUrl: "x" }, { hasKey: true, keyTail: "abcd" }, goodHw],
      [{ reachable: false, baseUrl: "x" }, { hasKey: false }, goodHw],
      [{ reachable: false, baseUrl: "x" }, { hasKey: false }, weakHw],
    ];
    for (const [a, b, c] of cases) {
      const r = recommendEmbedder(a, b, c);
      expect(r.reason.length).toBeGreaterThan(10);
      expect([2, 3, 4, 5]).toContain(r.qualityStars);
    }
  });
});
