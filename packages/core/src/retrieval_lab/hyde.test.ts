import { describe, expect, it } from "vitest";
import { buildHyDePrompt, applyHyde } from "./hyde.js";

describe("HyDE rewrite", () => {
  it("buildHyDePrompt returns query + system prompt + maxChars", () => {
    const p = buildHyDePrompt("how does auth work?");
    expect(p.query).toBe("how does auth work?");
    expect(p.systemPrompt.length).toBeGreaterThan(40);
    expect(p.maxChars).toBeGreaterThan(100);
  });

  it("applyHyde with agent-supplied returns it (truncated to 600)", () => {
    const r = applyHyde("how?", "The implementation is straightforward, with a clear contract.");
    expect(r.source).toBe("agent-supplied");
    expect(r.rewritten.length).toBeLessThanOrEqual(600);
  });

  it("applyHyde with null falls back to deterministic expansion", () => {
    const r = applyHyde("how does auth handle expired tokens?", null);
    expect(r.source).toBe("deterministic-fallback");
    expect(r.rewritten.length).toBeGreaterThan(60);
    // Deterministic expansion should mention the question's keywords.
    expect(r.rewritten.toLowerCase()).toContain("auth");
  });

  it("applyHyde with too-short agent rewrite falls back", () => {
    const r = applyHyde("question", "tiny");
    expect(r.source).toBe("deterministic-fallback");
  });

  it("deterministic expansion handles 'why' / 'what' / 'when' / 'where'", () => {
    for (const q of ["why does X fail?", "what does Y return?", "when does Z run?", "where does W live?"]) {
      const r = applyHyde(q);
      expect(r.rewritten.length).toBeGreaterThan(60);
    }
  });
});
