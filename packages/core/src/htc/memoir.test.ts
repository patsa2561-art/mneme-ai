import { describe, it, expect, vi } from "vitest";
import {
  MEMOIR_SYSTEM_PROMPT,
  buildMemoirUserPrompt,
  generateMemoir,
} from "./memoir.js";
import type { ClusterSummary, HtcEnricher } from "./types.js";

function mockEnricher(text: string, name = "mock:test"): HtcEnricher {
  return {
    name,
    enrich: vi.fn().mockResolvedValue({ text }),
  };
}

const sampleClusters: Array<ClusterSummary & { fromDate?: string; toDate?: string }> = [
  {
    clusterId: "c1",
    label: "auth refactor",
    summary: "Migrated from session cookies to JWT for CDN deploys.",
    memberHashes: ["a", "b", "c"],
    tokenCount: 80,
    generationMs: 1000,
    generator: "test",
    fromDate: "2024-01-01",
    toDate: "2024-03-15",
  },
  {
    clusterId: "c2",
    label: "payment v2",
    summary: "Split monolithic payment.ts into 3 modules.",
    memberHashes: ["d", "e"],
    tokenCount: 60,
    generationMs: 900,
    generator: "test",
    fromDate: "2024-04-01",
    toDate: "2024-06-20",
  },
];

describe("buildMemoirUserPrompt", () => {
  it("renders each cluster with label, member count, and date range", () => {
    const prompt = buildMemoirUserPrompt(sampleClusters);
    expect(prompt).toContain('CLUSTER "auth refactor"');
    expect(prompt).toContain("(3 commits, dates 2024-01-01 to 2024-03-15)");
    expect(prompt).toContain('CLUSTER "payment v2"');
    expect(prompt).toContain("(2 commits, dates 2024-04-01 to 2024-06-20)");
    expect(prompt).toContain("Migrated from session cookies");
  });

  it("falls back to commit count when dates are missing", () => {
    const prompt = buildMemoirUserPrompt([
      {
        clusterId: "c1",
        label: "x",
        summary: "y",
        memberHashes: ["a", "b"],
        tokenCount: 1,
        generationMs: 1,
        generator: "t",
      },
    ]);
    expect(prompt).toContain('CLUSTER "x" (2 commits):');
    expect(prompt).not.toContain("dates");
  });
});

describe("generateMemoir", () => {
  it("calls the enricher once and returns Memoir", async () => {
    const enricher = mockEnricher(
      "This repo is a TypeScript library that compresses git history. " +
        "Auth: migrated to JWT. Payment: split for V2. " +
        "Currently shipping v0.24.",
      "groq:llama-3.3-70b",
    );
    const m = await generateMemoir(sampleClusters, 5, enricher);
    expect(m.totalCommits).toBe(5);
    expect(m.totalClusters).toBe(2);
    expect(m.narrative).toContain("TypeScript");
    expect(m.tokenCount).toBeGreaterThan(0);
    expect(m.generator).toBe("groq:llama-3.3-70b");
    expect(m.generationMs).toBeGreaterThanOrEqual(0);
    expect(enricher.enrich).toHaveBeenCalledTimes(1);

    const call = (enricher.enrich as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.system).toBe(MEMOIR_SYSTEM_PROMPT);
    expect(call.user).toContain('CLUSTER "auth refactor"');
    expect(call.maxTokens).toBe(800);
  });

  it("throws when no clusters provided", async () => {
    const enricher = mockEnricher("never called");
    await expect(generateMemoir([], 0, enricher)).rejects.toThrow(/zero clusters/);
    expect(enricher.enrich).not.toHaveBeenCalled();
  });

  it("trims wrapping whitespace from the model's narrative", async () => {
    const enricher = mockEnricher("\n\n  the narrative.  \n");
    const m = await generateMemoir(sampleClusters, 1, enricher);
    expect(m.narrative).toBe("the narrative.");
  });
});
