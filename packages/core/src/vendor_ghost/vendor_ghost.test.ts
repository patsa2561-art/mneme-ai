import { describe, it, expect } from "vitest";
import { distillProfile, verifyProfile, askGhost, profileDistance, formatGhostLine, type Sample } from "./index.js";

function grokSamples(): Sample[] {
  return [
    { vendor: "grok", prompt: "is null === undefined?", response: "Definitely not. They're distinct primitives. Always use ===.", ts: "2026-05-10T00:00:00Z" },
    { vendor: "grok", prompt: "should I use Promise.all?", response: "Yes, absolutely. Never serialise when you can parallelise.", ts: "2026-05-11T00:00:00Z" },
    { vendor: "grok", prompt: "how to fix this race?", response: "Use a mutex. Never roll your own.", ts: "2026-05-12T00:00:00Z" },
  ];
}
function claudeSamples(): Sample[] {
  return [
    { vendor: "claude", prompt: "is null === undefined?", response: "I think they're different in most cases — maybe try using ===.", ts: "2026-05-10T00:00:00Z" },
    { vendor: "claude", prompt: "should I use Promise.all?", response: "Perhaps. It depends on whether the operations are independent.", ts: "2026-05-11T00:00:00Z" },
    { vendor: "claude", prompt: "how to fix this race?", response: "It might help to use a mutex, though there are other approaches.", ts: "2026-05-12T00:00:00Z" },
  ];
}

describe("v2.19 · MNEME VENDOR GHOST — stylometric distillation", () => {
  it("distills a signed profile from samples", () => {
    const p = distillProfile(grokSamples());
    expect(p.vendor).toBe("grok");
    expect(p.sampleCount).toBe(3);
    expect(p.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyProfile(p)).toBe(true);
  });

  it("rejects mixed-vendor sample sets", () => {
    expect(() => distillProfile([...grokSamples(), ...claudeSamples()])).toThrow(/same vendor/);
  });

  it("rejects empty sample sets", () => {
    expect(() => distillProfile([])).toThrow(/at least 1 sample/);
  });

  it("distinguishes Grok (absolute-heavy) from Claude (hedge-heavy)", () => {
    const grok = distillProfile(grokSamples());
    const claude = distillProfile(claudeSamples());
    expect(grok.absoluteDensityPer100w).toBeGreaterThan(claude.absoluteDensityPer100w);
    expect(claude.hedgeDensityPer100w).toBeGreaterThan(grok.hedgeDensityPer100w);
  });

  it("profileDistance is > 0 between visibly different vendors", () => {
    const grok = distillProfile(grokSamples());
    const claude = distillProfile(claudeSamples());
    const d = profileDistance(grok, claude);
    expect(d).toBeGreaterThan(0);
  });

  it("profileDistance is 0 for identical profiles", () => {
    const a = distillProfile(grokSamples());
    const b = distillProfile(grokSamples());
    expect(profileDistance(a, b)).toBe(0);
  });

  it("verifyProfile detects tampering", () => {
    const p = distillProfile(grokSamples());
    expect(verifyProfile(p)).toBe(true);
    const tampered = { ...p, meanLength: 9999 };
    expect(verifyProfile(tampered)).toBe(false);
  });

  it("askGhost returns nearest historical answer for similar prompt", () => {
    const samples = grokSamples();
    const p = distillProfile(samples);
    const g = askGhost({ profile: p, samples, prompt: "is null equal to undefined?" });
    expect(g.found).toBe(true);
    expect(g.matchedFromPrompt).toContain("null");
    expect(g.similarity).toBeGreaterThan(0);
    expect(["high", "medium", "low"]).toContain(g.confidence);
  });

  it("askGhost returns no-match for an unrelated prompt", () => {
    const samples = grokSamples();
    const p = distillProfile(samples);
    const g = askGhost({ profile: p, samples, prompt: "spaceship orbital mechanics for kerbals" });
    expect(g.found).toBe(false);
    expect(g.confidence).toBe("none");
  });

  it("askGhost respects vendor isolation (won't return Claude's answer for Grok profile)", () => {
    const grokP = distillProfile(grokSamples());
    const allSamples = [...grokSamples(), ...claudeSamples()];
    const g = askGhost({ profile: grokP, samples: allSamples, prompt: "is null === undefined?" });
    expect(g.found).toBe(true);
    expect(g.response).toContain("Definitely"); // Grok-flavour, not Claude
  });

  it("works for every supported vendor", () => {
    const vendors = ["claude", "chatgpt", "gemini", "cursor", "copilot", "codex", "llama", "mistral", "qwen", "deepseek", "perplexity", "other"] as const;
    for (const v of vendors) {
      const s: Sample[] = [{ vendor: v, prompt: "x", response: "y" }];
      const p = distillProfile(s);
      expect(p.vendor).toBe(v);
      expect(verifyProfile(p)).toBe(true);
    }
  });

  it("formatGhostLine summarises", () => {
    const p = distillProfile(grokSamples());
    const g = askGhost({ profile: p, samples: grokSamples(), prompt: "is null === undefined?" });
    expect(formatGhostLine(g)).toContain("GHOST");
    expect(formatGhostLine(g)).toContain("grok");
  });
});
