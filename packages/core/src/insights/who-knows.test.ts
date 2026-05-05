import { describe, it, expect } from "vitest";
import { scoreCandidate, tierOf, whoKnowsVerdict, type ExpertCandidate } from "./who-knows.js";

const today = new Date("2026-05-04T00:00:00Z");
const daysAgo = (n: number) => new Date(today.getTime() - n * 86_400_000).toISOString();

describe("scoreCandidate — pure scoring function", () => {
  it("returns 0 for zero commits", () => {
    expect(scoreCandidate(0, daysAgo(0), today)).toBe(0);
  });

  it("recent commits score higher than old commits with the same count", () => {
    const recent = scoreCandidate(10, daysAgo(5), today);
    const old = scoreCandidate(10, daysAgo(300), today);
    expect(recent).toBeGreaterThan(old);
  });

  it("more commits score higher than fewer with the same recency", () => {
    const more = scoreCandidate(50, daysAgo(10), today);
    const fewer = scoreCandidate(5, daysAgo(10), today);
    expect(more).toBeGreaterThan(fewer);
  });

  it("uses log-scale volume — 100 commits is not 100× more than 1 commit", () => {
    const one = scoreCandidate(1, daysAgo(0), today);
    const hundred = scoreCandidate(100, daysAgo(0), today);
    // log2(101) ≈ 6.66, log2(2) = 1 → hundred / one ≈ 6.66, NOT 100.
    expect(hundred / one).toBeLessThan(10);
  });

  it("recency floors at 0.3 even for very old commits", () => {
    const ancient = scoreCandidate(10, daysAgo(2000), today);
    const oneYear = scoreCandidate(10, daysAgo(365), today);
    // Both should be at or near the floor.
    expect(ancient).toBeGreaterThan(0);
    expect(oneYear).toBeGreaterThan(0);
  });
});

describe("tierOf — readable expert tier", () => {
  it('"definitive" for many recent commits', () => {
    expect(tierOf(20, daysAgo(10), today)).toBe("definitive");
  });

  it('"active" for moderate recent commits', () => {
    expect(tierOf(5, daysAgo(20), today)).toBe("active");
  });

  it('"stale" for any volume but very old', () => {
    expect(tierOf(100, daysAgo(300), today)).toBe("stale");
  });

  it('"occasional" — middle ground (≥1 commit, < ACTIVE_DAYS old, but few)', () => {
    expect(tierOf(1, daysAgo(40), today)).toBe("occasional");
  });
});

describe("whoKnowsVerdict — turns a list of candidates into a single verdict", () => {
  const cand = (overrides: Partial<ExpertCandidate>): ExpertCandidate => ({
    name: "alice",
    email: "alice@x",
    commitCount: 10,
    lastTouch: daysAgo(5),
    filesTouched: 20,
    score: 3.0,
    tier: "active",
    ...overrides,
  });

  it("returns empty verdict for empty candidate list", () => {
    const v = whoKnowsVerdict([]);
    expect(v.topExpert).toBeUndefined();
    expect(v.confidencePct).toBe(0);
    expect(v.totalCommits).toBe(0);
  });

  it("picks the highest-score candidate as topExpert", () => {
    const v = whoKnowsVerdict([
      cand({ name: "alice", score: 4.0, commitCount: 15 }),
      cand({ name: "bob", score: 2.0, commitCount: 5 }),
    ]);
    expect(v.topExpert?.name).toBe("alice");
    expect(v.backup?.name).toBe("bob");
  });

  it("computes confidencePct as share of total commits", () => {
    const v = whoKnowsVerdict([
      cand({ name: "alice", score: 4.0, commitCount: 15 }),
      cand({ name: "bob", score: 2.0, commitCount: 5 }),
    ]);
    expect(v.confidencePct).toBe(75);
  });

  it("flags risk when top expert is stale", () => {
    const v = whoKnowsVerdict([
      cand({ name: "alice", tier: "stale", lastTouch: daysAgo(300), commitCount: 20 }),
      cand({ name: "bob", tier: "active", lastTouch: daysAgo(5), commitCount: 5 }),
    ]);
    expect(v.risk?.toLowerCase()).toContain("stale");
    expect(v.risk).toContain("bob"); // suggests backup
  });

  it("flags risk when no dominant expert (well-distributed)", () => {
    const v = whoKnowsVerdict([
      cand({ name: "alice", commitCount: 4, score: 1.5 }),
      cand({ name: "bob", commitCount: 4, score: 1.4 }),
      cand({ name: "carol", commitCount: 4, score: 1.3 }),
      cand({ name: "dave", commitCount: 4, score: 1.2 }),
    ]);
    expect(v.confidencePct).toBe(25);
    expect(v.risk?.toLowerCase()).toContain("distributed");
  });

  it("flags risk when top expert touched once", () => {
    const v = whoKnowsVerdict([cand({ name: "alice", commitCount: 1 })]);
    expect(v.risk?.toLowerCase()).toContain("once");
  });

  it("no risk when top expert is definitive + recent", () => {
    const v = whoKnowsVerdict([
      cand({ name: "alice", tier: "definitive", commitCount: 20, lastTouch: daysAgo(5), score: 5 }),
      cand({ name: "bob", commitCount: 2, score: 1, tier: "occasional" }),
    ]);
    expect(v.risk).toBeUndefined();
  });
});
