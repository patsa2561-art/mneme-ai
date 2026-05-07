import { describe, it, expect, vi } from "vitest";
import {
  CLUSTER_SYSTEM_PROMPT,
  buildClusterUserPrompt,
  extractLabel,
  generateClusterSummary,
  generateClusterSummaries,
} from "./clusters.js";
import type { HtcEnricher } from "./types.js";

function mockEnricher(text: string, name = "mock:test"): HtcEnricher {
  return {
    name,
    enrich: vi.fn().mockResolvedValue({ text }),
  };
}

describe("buildClusterUserPrompt", () => {
  it("formats abstracts as a bulleted list", () => {
    const prompt = buildClusterUserPrompt([
      "auth: replaced session cookies with JWT",
      "auth: rotated JWT signing keys quarterly",
    ]);
    expect(prompt).toContain("Commit abstracts (one per line):");
    expect(prompt).toContain("  - auth: replaced session cookies with JWT");
    expect(prompt).toContain("  - auth: rotated JWT signing keys");
  });

  it("skips blank entries", () => {
    const prompt = buildClusterUserPrompt(["real one", "  ", "", "another"]);
    const bullets = prompt.split("\n").filter((l) => l.startsWith("  - "));
    expect(bullets).toHaveLength(2);
  });
});

describe("extractLabel", () => {
  it("uses the colon-prefixed topic when present", () => {
    expect(extractLabel("auth: switched to JWT for stateless deploys", "fb")).toBe("auth");
    expect(extractLabel("payment refactor: split into V2", "fb")).toBe("payment refactor");
  });

  it("falls back to first 4 words when no colon", () => {
    expect(extractLabel("Payment module evolved over many quarters.", "fb")).toBe(
      "payment module evolved over",
    );
  });

  it("uses fallback on empty input", () => {
    expect(extractLabel("", "cluster 7")).toBe("cluster 7");
    expect(extractLabel("   ", "cluster 7")).toBe("cluster 7");
  });

  it("caps label length at 40 chars", () => {
    const long = "this is a very long opening sentence with no colon punctuation here";
    const label = extractLabel(long, "fb");
    expect(label.length).toBeLessThanOrEqual(40);
  });
});

describe("generateClusterSummary", () => {
  it("calls enricher with cluster prompt + builds summary", async () => {
    const enricher = mockEnricher(
      "auth refactor: started with cookie sessions, evolved to JWT for CDN-friendly deploys.",
      "groq:llama-3.3-70b",
    );
    const abstracts = new Map([
      ["aaa", "auth: cookie session"],
      ["bbb", "auth: switched to JWT"],
    ]);
    const r = await generateClusterSummary(
      { id: "c1", memberHashes: ["aaa", "bbb"] },
      abstracts,
      enricher,
    );
    expect(r.clusterId).toBe("c1");
    expect(r.label).toBe("auth refactor");
    expect(r.summary).toContain("JWT");
    expect(r.memberHashes).toEqual(["aaa", "bbb"]);
    expect(r.tokenCount).toBeGreaterThan(0);
    expect(r.generator).toBe("groq:llama-3.3-70b");

    const call = (enricher.enrich as ReturnType<typeof vi.fn>).mock.calls[0]![0];
    expect(call.system).toBe(CLUSTER_SYSTEM_PROMPT);
    expect(call.user).toContain("auth: cookie session");
    expect(call.user).toContain("auth: switched to JWT");
  });

  it("throws when no Layer-1 abstracts exist for the cluster", async () => {
    const enricher = mockEnricher("never called");
    await expect(
      generateClusterSummary(
        { id: "c2", memberHashes: ["missing1", "missing2"] },
        new Map(),
        enricher,
      ),
    ).rejects.toThrow(/no Layer-1 abstracts/);
    expect(enricher.enrich).not.toHaveBeenCalled();
  });

  it("uses fallback label when summary has no clear topic", async () => {
    const enricher = mockEnricher("");
    await expect(
      generateClusterSummary(
        { id: "c3", memberHashes: ["aaa"] },
        new Map([["aaa", "anything"]]),
        enricher,
      ),
    ).resolves.toMatchObject({ label: "cluster c3" });
  });
});

describe("generateClusterSummaries", () => {
  it("processes all clusters and returns ClusterSummary[]", async () => {
    const enricher = mockEnricher("topic: brief summary");
    const abstracts = new Map([
      ["a", "abstract a"],
      ["b", "abstract b"],
      ["c", "abstract c"],
      ["d", "abstract d"],
    ]);
    const clusters = [
      { id: "c1", memberHashes: ["a", "b"] },
      { id: "c2", memberHashes: ["c", "d"] },
    ];
    const out = await generateClusterSummaries(abstracts, clusters, enricher, {
      concurrency: 2,
    });
    expect(out).toHaveLength(2);
    expect(enricher.enrich).toHaveBeenCalledTimes(2);
  });

  it("records errors via onError without aborting", async () => {
    const enricher: HtcEnricher = {
      name: "mock:flaky",
      enrich: vi.fn().mockImplementation((input: { user: string }) => {
        if (input.user.includes("BAD")) return Promise.reject(new Error("server 503"));
        return Promise.resolve({ text: "ok: clean summary" });
      }),
    };
    const abstracts = new Map([
      ["a", "good one"],
      ["b", "BAD one"],
      ["c", "good two"],
    ]);
    const onError = vi.fn();
    const out = await generateClusterSummaries(
      abstracts,
      [
        { id: "c1", memberHashes: ["a"] },
        { id: "c2", memberHashes: ["b"] },
        { id: "c3", memberHashes: ["c"] },
      ],
      enricher,
      { concurrency: 1, onError },
    );
    expect(out).toHaveLength(2);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBe("c2");
  });

  it("invokes onProgress with monotonically increasing done count", async () => {
    const enricher = mockEnricher("topic: x");
    const abstracts = new Map([["a", "x"]]);
    const onProgress = vi.fn();
    await generateClusterSummaries(
      abstracts,
      [
        { id: "c1", memberHashes: ["a"] },
        { id: "c2", memberHashes: ["a"] },
      ],
      enricher,
      { onProgress },
    );
    expect(onProgress).toHaveBeenCalledTimes(2);
    const last = onProgress.mock.calls[onProgress.mock.calls.length - 1]!;
    expect(last).toEqual([2, 2]);
  });
});
