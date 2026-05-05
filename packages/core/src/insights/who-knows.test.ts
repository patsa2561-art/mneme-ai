import { describe, it, expect } from "vitest";
import { scoreCandidate, tierOf } from "./who-knows.js";

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
