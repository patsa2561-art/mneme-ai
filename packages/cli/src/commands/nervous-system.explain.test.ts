/**
 * `mneme nervous-system --explain` — narrative-summary integration tests.
 *
 * Same shape as audit.explain.test.ts and atrophy.explain.test.ts; verifies
 * the OFF / ON-with-LLM / ON-without-LLM control flow ships unchanged
 * across all three flagship commands.
 */

import { describe, it, expect, vi } from "vitest";
import { explain } from "../utils/explain.js";
import type { EnricherProvider } from "@mneme-ai/embeddings";

function mockEnricher(text: string): EnricherProvider {
  return {
    name: "mock",
    enrich: vi.fn(async (input) => {
      // Sanity: the nervous-system prompt should mention alphas / atrophy cues.
      expect(input.system).toMatch(/alpha|atrophy|nervous|neural/i);
      return { text, source: "mock" };
    }),
  };
}

describe("nervous-system --explain — narrative summary", () => {
  it("returns no section when --explain is OFF (default)", async () => {
    const enrich = vi.fn();
    const result = await explain({
      enabled: false,
      system: "x",
      user: "x",
      enricherFactory: async () => ({ name: "mock", enrich }),
    });
    expect(enrich).not.toHaveBeenCalled();
    expect(result.section).toBeNull();
  });

  it("renders a 💡 narrative section when --explain is ON and LLM works", async () => {
    const result = await explain({
      enabled: true,
      enricherFactory: async () =>
        mockEnricher(
          "Alice is the cultural alpha — her commits set the patterns the rest of the team copies. Atrophy is concentrated in the data-layer lobe (3 of the top-5 ghosted files). The most surprising finding: Bob and Carol form a latent pair despite zero co-authored commits.",
        ),
      system:
        "You are a CTO briefing the founders on the engineering org's neural map. " +
        "Given a JSON snapshot of cultural alphas, latent pairs, atrophy, and brain lobes, " +
        "write 3-4 sentences in plain English.",
      user: JSON.stringify({ totalCommits: 500 }),
    });
    expect(result.section).not.toBeNull();
    expect(result.section?.title).toMatch(/Plain-English read/);
    const text = (result.section?.lines ?? []).join("\n");
    expect(text).toMatch(/Alice/);
    expect(text).toMatch(/cultural alpha/);
    // line-wrap may split "latent pair" across lines; flatten before matching.
    expect(text.replace(/\s+/g, " ")).toMatch(/latent pair/);
  });

  it("emits a HEADS UP message instead when no LLM is reachable", async () => {
    const result = await explain({
      enabled: true,
      enricherFactory: async () => null,
      system: "nervous-system alpha atrophy neural prompt",
      user: "{}",
    });
    expect(result.section).toBeNull();
    expect(result.headsUp).toMatch(/HEADS UP/);
    expect(result.headsUp).toMatch(/setup-free/);
  });
});
