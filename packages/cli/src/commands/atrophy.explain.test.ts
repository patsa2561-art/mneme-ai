/**
 * `mneme atrophy --explain` — narrative-summary integration tests.
 *
 * Validates that the --explain flag plumbs through to the shared utils/explain.ts
 * helper, that the narrative section is suppressed when --explain is off, and
 * that a missing LLM degrades to a HEADS UP line (never throws).
 */

import { describe, it, expect, vi } from "vitest";
import { explain } from "../utils/explain.js";
import type { EnricherProvider } from "@mneme-ai/embeddings";

function mockEnricher(text: string): EnricherProvider {
  return {
    name: "mock",
    enrich: vi.fn(async (input) => {
      // Sanity: the atrophy prompt should reference half-life / decay vocab.
      expect(input.system).toMatch(/atrophy|knowledge|decay|half-life/i);
      return { text, source: "mock" };
    }),
  };
}

describe("atrophy --explain — narrative summary", () => {
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
    expect(result.headsUp).toBeNull();
  });

  it("renders a 💡 narrative section when --explain is ON and LLM works", async () => {
    const result = await explain({
      enabled: true,
      enricherFactory: async () =>
        mockEnricher(
          "Knowledge is concentrated in one expert. Two files (api.ts, store.ts) are at high atrophy risk because the original author hasn't touched them in 8 months. Recommend a 30-minute pairing session on api.ts this week.",
        ),
      system:
        "You are a staff engineer briefing a team lead on knowledge-decay risk. " +
        "Given a JSON snapshot of authors and at-risk files (Ebbinghaus half-life model), " +
        "write 3-4 sentences in plain English.",
      user: JSON.stringify({ stats: { fileCount: 100 } }),
    });
    expect(result.section).not.toBeNull();
    expect(result.section?.title).toMatch(/Plain-English read/);
    const text = (result.section?.lines ?? []).join("\n");
    expect(text).toMatch(/Knowledge is concentrated/);
    expect(text).toMatch(/api\.ts/);
    expect(text).toMatch(/pairing session/);
  });

  it("emits a HEADS UP message instead when no LLM is reachable", async () => {
    const result = await explain({
      enabled: true,
      enricherFactory: async () => null,
      system: "atrophy half-life knowledge prompt",
      user: "{}",
    });
    expect(result.section).toBeNull();
    expect(result.headsUp).toMatch(/HEADS UP/);
    expect(result.headsUp).toMatch(/setup-free/);
  });
});
