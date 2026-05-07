/**
 * `mneme audit --certify --explain` — narrative-summary integration tests.
 *
 * We don't exercise the full --certify pipeline here (that needs a populated
 * baseline + git history). Instead we test the new explain() helper wiring
 * via the shared utils/explain.ts module — same pattern, same call site,
 * deterministic on every host.
 */

import { describe, it, expect, vi } from "vitest";
import { explain } from "../utils/explain.js";
import type { EnricherProvider } from "@mneme-ai/embeddings";

function mockEnricher(text: string): EnricherProvider {
  return {
    name: "mock",
    enrich: vi.fn(async (input) => {
      // Sanity: the audit prompt should mention "verdict" + "audit" cues.
      expect(input.system).toMatch(/audit|verdict/i);
      return { text, source: "mock" };
    }),
  };
}

describe("audit --explain — narrative summary", () => {
  it("does not call the LLM when --explain is OFF", async () => {
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
          "Audit passed cleanly. Closest call was the perf axis at -3.2%. Recommend re-running on a quiet host before merging.",
        ),
      system:
        "You are a senior reviewer briefing a release manager. " +
        "Given a JSON AI-audit certificate, write 3-4 sentences in plain English: " +
        "verdict, closest-call axis, one concrete next step.",
      user: JSON.stringify({ overallVerdict: "pass" }),
    });
    expect(result.section).not.toBeNull();
    expect(result.section?.title).toMatch(/Plain-English read/);
    expect(result.section?.title).toMatch(/LLM/);
    const text = (result.section?.lines ?? []).join("\n");
    expect(text).toMatch(/perf axis/);
    expect(text).toMatch(/Recommend/);
  });

  it("emits a HEADS UP message instead when no LLM is reachable", async () => {
    const result = await explain({
      enabled: true,
      enricherFactory: async () => null,
      system: "audit verdict prompt",
      user: "{}",
    });
    expect(result.section).toBeNull();
    expect(result.headsUp).toMatch(/HEADS UP/);
    expect(result.headsUp).toMatch(/setup-free/);
  });
});
