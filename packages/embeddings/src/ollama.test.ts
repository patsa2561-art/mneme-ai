// v2.27.0 — Ollama embedder tags-only verify test.

import { describe, it, expect } from "vitest";
import { OllamaEmbedder } from "./ollama.js";

describe("ollama — verifyTags (closes E2 auto-detect downgrade)", () => {
  it("returns ok=false when /api/tags is unreachable", async () => {
    const o = new OllamaEmbedder({ baseUrl: "http://127.0.0.1:1", model: "x" });
    const v = await o.verifyTags();
    expect(v.ok).toBe(false);
  });
  it("verifyTags has a method signature distinct from verify", () => {
    const o = new OllamaEmbedder({});
    expect(typeof o.verifyTags).toBe("function");
    expect(typeof o.verify).toBe("function");
  });
});
