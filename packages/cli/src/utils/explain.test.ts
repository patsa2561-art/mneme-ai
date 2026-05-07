/**
 * Tests for the shared `--explain` helper.
 *
 * Covers the three control-flow paths every command relies on:
 *   1. enabled=false   → returns null,null (no work done)
 *   2. enabled=true + LLM works → returns a section with the narrative
 *   3. enabled=true + no LLM → returns a HEADS UP line, never throws
 */

import { describe, it, expect, vi } from "vitest";
import { explain } from "./explain.js";
import type { EnricherProvider } from "@mneme-ai/embeddings";

function mockEnricher(text: string): EnricherProvider {
  return {
    name: "mock",
    enrich: vi.fn(async () => ({ text, source: "mock" })),
  };
}

function brokenEnricher(): EnricherProvider {
  return {
    name: "mock-broken",
    enrich: vi.fn(async () => {
      throw new Error("simulated provider failure");
    }),
  };
}

describe("explain() — shared --explain helper", () => {
  it("returns {section: null, headsUp: null} when --explain is disabled", async () => {
    const result = await explain({
      enabled: false,
      system: "irrelevant",
      user: "irrelevant",
    });
    expect(result.section).toBeNull();
    expect(result.headsUp).toBeNull();
  });

  it("returns a lede-tier section when an enricher succeeds", async () => {
    const result = await explain({
      enabled: true,
      system: "test system prompt",
      user: "test user prompt",
      enricherFactory: async () => mockEnricher("This is the LLM-generated narrative."),
    });
    expect(result.section).not.toBeNull();
    expect(result.section?.tier).toBe("lede");
    expect(result.section?.title).toContain("Plain-English read");
    expect(result.section?.title).toContain("LLM");
    // The mock text appears verbatim somewhere in the rendered lines.
    const flat = (result.section?.lines ?? []).join("\n");
    expect(flat).toContain("LLM-generated narrative");
    expect(result.headsUp).toBeNull();
  });

  it("returns a HEADS UP line (no section, no throw) when no LLM is available", async () => {
    const result = await explain({
      enabled: true,
      system: "irrelevant",
      user: "irrelevant",
      enricherFactory: async () => null,
    });
    expect(result.section).toBeNull();
    expect(result.headsUp).not.toBeNull();
    expect(result.headsUp).toMatch(/HEADS UP/);
    expect(result.headsUp).toMatch(/setup-free/);
  });

  it("returns a HEADS UP line (no throw) when the enricher itself throws", async () => {
    const result = await explain({
      enabled: true,
      system: "irrelevant",
      user: "irrelevant",
      enricherFactory: async () => brokenEnricher(),
    });
    expect(result.section).toBeNull();
    expect(result.headsUp).not.toBeNull();
    expect(result.headsUp).toMatch(/HEADS UP/);
  });

  it("returns a HEADS UP line on empty LLM answer", async () => {
    const result = await explain({
      enabled: true,
      system: "irrelevant",
      user: "irrelevant",
      enricherFactory: async () => mockEnricher("   "),
    });
    expect(result.section).toBeNull();
    expect(result.headsUp).toMatch(/HEADS UP/);
    expect(result.headsUp).toMatch(/empty/i);
  });

  it("wraps long narratives across multiple lines", async () => {
    const long = Array.from({ length: 30 }, () => "word").join(" ");
    const result = await explain({
      enabled: true,
      system: "irrelevant",
      user: "irrelevant",
      enricherFactory: async () => mockEnricher(long),
    });
    expect(result.section).not.toBeNull();
    expect((result.section?.lines.length ?? 0)).toBeGreaterThan(1);
  });
});
