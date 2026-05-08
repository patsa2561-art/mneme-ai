import { describe, it, expect } from "vitest";
import { applyTribalVoting, type VotedCandidate, type FederationVotes } from "./tribal-voting.js";

const CANDIDATES: VotedCandidate[] = [
  { id: "a", localScore: 0.8, patternSignature: "sig-popular" },
  { id: "b", localScore: 0.8, patternSignature: "sig-controversial" },
  { id: "c", localScore: 0.8, patternSignature: "sig-rejected" },
  { id: "d", localScore: 0.8, patternSignature: "sig-no-data" },
];

const VOTES: FederationVotes = {
  "sig-popular": { upvotes: 100, downvotes: 5 },
  "sig-controversial": { upvotes: 50, downvotes: 50 },
  "sig-rejected": { upvotes: 2, downvotes: 100 },
};

describe("A7. Tribal Voting", () => {
  it("upvoted patterns rank higher", () => {
    const r = applyTribalVoting({ candidates: CANDIDATES, federationVotes: VOTES });
    expect(r[0]!.id).toBe("a"); // popular
  });

  it("rejected patterns rank lower than no-data", () => {
    const r = applyTribalVoting({ candidates: CANDIDATES, federationVotes: VOTES });
    const ids = r.map((x) => x.id);
    expect(ids.indexOf("c")).toBeGreaterThan(ids.indexOf("d"));
  });

  it("below-quorum patterns get neutral 0.5 prior", () => {
    const r = applyTribalVoting({
      candidates: CANDIDATES,
      federationVotes: VOTES,
      quorumThreshold: 200,
    });
    for (const x of r) {
      expect(x.federationPrior).toBeCloseTo(0.5);
      expect(x.quorumMet).toBe(false);
    }
  });

  it("federationPrior reported between 0 and 1", () => {
    const r = applyTribalVoting({ candidates: CANDIDATES, federationVotes: VOTES });
    for (const x of r) {
      expect(x.federationPrior).toBeGreaterThan(0);
      expect(x.federationPrior).toBeLessThan(1);
    }
  });

  it("preserves meta passthrough", () => {
    const r = applyTribalVoting({
      candidates: [{ id: "x", localScore: 0.5, patternSignature: "sig-popular", meta: { path: "src/x.ts" } }],
      federationVotes: VOTES,
    });
    expect(r[0]!.meta).toEqual({ path: "src/x.ts" });
  });

  it("quorumMet flag is accurate", () => {
    const r = applyTribalVoting({
      candidates: CANDIDATES,
      federationVotes: VOTES,
      quorumThreshold: 50,
    });
    const popular = r.find((x) => x.id === "a")!;
    const noData = r.find((x) => x.id === "d")!;
    expect(popular.quorumMet).toBe(true);
    expect(noData.quorumMet).toBe(false);
  });

  it("deterministic across runs", () => {
    const r1 = applyTribalVoting({ candidates: CANDIDATES, federationVotes: VOTES });
    const r2 = applyTribalVoting({ candidates: CANDIDATES, federationVotes: VOTES });
    expect(r1).toEqual(r2);
  });

  it("empty candidates → empty result", () => {
    expect(applyTribalVoting({ candidates: [], federationVotes: {} })).toEqual([]);
  });
});
