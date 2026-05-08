import { describe, it, expect } from "vitest";
import { phantomPathSearch, type CanonicalPattern } from "./phantom-path.js";

const PATTERNS: CanonicalPattern[] = [
  {
    id: "auth-v2",
    canonicalLocation: "services/auth/v2/",
    embedding: [1, 0, 0],
    label: "v2 auth pattern",
    upvotes: 50,
    downvotes: 2,
  },
  {
    id: "billing-v2",
    canonicalLocation: "services/billing/v2/",
    embedding: [0, 1, 0],
    label: "v2 billing",
    upvotes: 10,
    downvotes: 0,
  },
  {
    id: "legacy-bad",
    canonicalLocation: "lib/legacy/",
    embedding: [0, 0, 1],
    label: "legacy",
    upvotes: 0,
    downvotes: 30,
  },
];

describe("A2. Phantom-Path — basic suggestion", () => {
  it("suggests the most similar canonical pattern", () => {
    const r = phantomPathSearch({
      queryEmbedding: [1, 0, 0],
      canonicalPatterns: PATTERNS,
      topK: 3,
    });
    expect(r[0]!.patternId).toBe("auth-v2");
    expect(r[0]!.canonicalLocation).toContain("auth/v2");
  });

  it("federation prior boosts well-upvoted patterns", () => {
    // Two patterns equally similar, one upvoted heavily, one downvoted
    const r = phantomPathSearch({
      queryEmbedding: [1, 1, 1],
      canonicalPatterns: PATTERNS,
      topK: 3,
    });
    // legacy-bad has heavy downvotes → ranks last
    expect(r[r.length - 1]!.patternId).toBe("legacy-bad");
  });

  it("empty patterns → empty result", () => {
    const r = phantomPathSearch({ queryEmbedding: [1, 0], canonicalPatterns: [] });
    expect(r).toEqual([]);
  });

  it("respects topK", () => {
    const r = phantomPathSearch({
      queryEmbedding: [1, 0, 0],
      canonicalPatterns: PATTERNS,
      topK: 1,
    });
    expect(r).toHaveLength(1);
  });

  it("provides transparency: similarity + federationPrior separately", () => {
    const r = phantomPathSearch({
      queryEmbedding: [1, 0, 0],
      canonicalPatterns: PATTERNS,
      topK: 3,
    });
    for (const s of r) {
      expect(typeof s.similarity).toBe("number");
      expect(typeof s.federationPrior).toBe("number");
      expect(s.federationPrior).toBeGreaterThan(0);
      expect(s.federationPrior).toBeLessThan(1);
    }
  });

  it("Hebbian co-activation amplifies score for matching pattern", () => {
    const noBoost = phantomPathSearch({
      queryEmbedding: [1, 0, 0],
      canonicalPatterns: PATTERNS,
    });
    const boosted = phantomPathSearch({
      queryEmbedding: [1, 0, 0],
      canonicalPatterns: PATTERNS,
      coActivations: { "auth-v2": 50 },
    });
    expect(boosted[0]!.similarity).toBeGreaterThan(noBoost[0]!.similarity);
  });
});
