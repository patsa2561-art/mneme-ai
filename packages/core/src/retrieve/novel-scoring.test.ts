import { describe, it, expect } from "vitest";
import {
  timeDecayWeight,
  applyTdwe,
  regretBoost,
  applyRacb,
  applyAds,
  buildCausalGraph,
  applyCgar,
  applyNovelScoring,
  type RegretSignal,
} from "./novel-scoring.js";
import type { Commit, SearchResult } from "../types.js";

const NOW = new Date("2026-05-06").getTime();

function mkCommit(p: { hash: string; date: string; subject?: string; body?: string; author?: string; pr?: number }): Commit {
  return {
    hash: p.hash,
    shortHash: p.hash.slice(0, 7),
    authorName: p.author ?? "Alice",
    authorEmail: (p.author ?? "alice").toLowerCase() + "@x.com",
    authorDate: p.date,
    committerDate: p.date,
    subject: p.subject ?? "x",
    body: p.body ?? "",
    files: [],
    parents: [],
    prNumber: p.pr,
  };
}

function mkResult(c: Commit, score: number): SearchResult {
  return { commit: c, score, matchedChunks: [] };
}

// ─── TDWE ──────────────────────────────────────────────────────────────

describe("timeDecayWeight", () => {
  it("returns ≈ 1 for today's commit", () => {
    const w = timeDecayWeight(new Date(NOW).toISOString(), { nowMs: NOW });
    expect(w).toBeGreaterThan(0.99);
  });

  it("returns ≈ 0.5 at half-life age", () => {
    const halfLifeAgo = new Date(NOW - 365 * 86_400_000).toISOString();
    const w = timeDecayWeight(halfLifeAgo, { nowMs: NOW, halfLifeDays: 365 });
    expect(w).toBeCloseTo(0.5, 1);
  });

  it("returns ≈ 0.25 at 2× half-life age", () => {
    const twiceHalfLife = new Date(NOW - 730 * 86_400_000).toISOString();
    const w = timeDecayWeight(twiceHalfLife, { nowMs: NOW, halfLifeDays: 365 });
    expect(w).toBeCloseTo(0.25, 1);
  });

  it("clamps negative ages to 0 (future commits = weight 1)", () => {
    const future = new Date(NOW + 86_400_000).toISOString();
    const w = timeDecayWeight(future, { nowMs: NOW });
    expect(w).toBe(1);
  });
});

describe("applyTdwe", () => {
  it("boosts recent commits over old ones with same base score", () => {
    const recent = mkCommit({ hash: "r1", date: "2026-04-01" });
    const old = mkCommit({ hash: "o1", date: "2024-04-01" });
    const results = [mkResult(old, 0.5), mkResult(recent, 0.5)];
    const out = applyTdwe(results, { nowMs: NOW });
    expect(out[0]!.commit.hash).toBe("r1");
  });

  it("preserves score ordering when ages are equal", () => {
    const c1 = mkCommit({ hash: "a", date: "2026-04-01" });
    const c2 = mkCommit({ hash: "b", date: "2026-04-01" });
    const out = applyTdwe([mkResult(c1, 0.3), mkResult(c2, 0.5)], { nowMs: NOW });
    expect(out[0]!.commit.hash).toBe("b");
  });
});

// ─── RACB ──────────────────────────────────────────────────────────────

describe("regretBoost", () => {
  it("returns 1 when severity = 0 (no regret)", () => {
    const b = regretBoost({ commitHash: "x", kind: "none", daysToFollowup: 5 });
    expect(b).toBe(1);
  });

  it("scales boost with daysToFollowup logarithmically", () => {
    const day1 = regretBoost({ commitHash: "x", kind: "fix", daysToFollowup: 1 });
    const day7 = regretBoost({ commitHash: "x", kind: "fix", daysToFollowup: 7 });
    expect(day7).toBeGreaterThan(day1);
    expect(day7).toBeLessThan(day1 * 7); // sub-linear
  });

  it("revert > hotfix > fix for same days (using small enough days to avoid cap)", () => {
    // Use days=0.5 so all three stay below the maxBoost cap
    const r = regretBoost({ commitHash: "x", kind: "revert", daysToFollowup: 0.5 });
    const h = regretBoost({ commitHash: "x", kind: "hotfix", daysToFollowup: 0.5 });
    const f = regretBoost({ commitHash: "x", kind: "fix", daysToFollowup: 0.5 });
    expect(r).toBeGreaterThan(h);
    expect(h).toBeGreaterThan(f);
  });

  it("respects maxBoost cap", () => {
    const b = regretBoost(
      { commitHash: "x", kind: "revert", daysToFollowup: 1000 },
      { maxBoost: 1.5 },
    );
    expect(b).toBeLessThanOrEqual(1.5);
  });
});

describe("applyRacb", () => {
  it("boosts commits with regret signals", () => {
    const commits = [
      mkCommit({ hash: "regretted", date: "2024-01-01" }),
      mkCommit({ hash: "clean", date: "2024-01-01" }),
    ];
    const results = [mkResult(commits[1]!, 0.6), mkResult(commits[0]!, 0.5)];
    const signals: RegretSignal[] = [
      { commitHash: "regretted", kind: "revert", daysToFollowup: 2 },
    ];
    const out = applyRacb(results, signals);
    // The regretted commit should now beat the clean one despite lower base score
    expect(out[0]!.commit.hash).toBe("regretted");
  });
});

// ─── ADS ──────────────────────────────────────────────────────────────

describe("applyAds", () => {
  it("penalizes results from the same author appearing repeatedly", () => {
    const commits = [
      mkCommit({ hash: "a1", date: "2024-01-01", author: "Alice" }),
      mkCommit({ hash: "a2", date: "2024-01-02", author: "Alice" }),
      mkCommit({ hash: "a3", date: "2024-01-03", author: "Alice" }),
      mkCommit({ hash: "b1", date: "2024-01-04", author: "Bob" }),
    ];
    // Alice dominates with high scores; Bob has a lower score
    const results = [
      mkResult(commits[0]!, 0.50),
      mkResult(commits[1]!, 0.49),
      mkResult(commits[2]!, 0.48),
      mkResult(commits[3]!, 0.40),
    ];
    const out = applyAds(results, { alpha: 0.4 });
    // Bob should rise above some Alice entries despite lower base score
    const bobIdx = out.findIndex((r) => r.commit.authorEmail === "bob@x.com");
    expect(bobIdx).toBeLessThanOrEqual(2);
  });

  it("preserves order when all results are different authors", () => {
    const commits = [
      mkCommit({ hash: "a", date: "2024-01-01", author: "Alice" }),
      mkCommit({ hash: "b", date: "2024-01-01", author: "Bob" }),
      mkCommit({ hash: "c", date: "2024-01-01", author: "Carol" }),
    ];
    const out = applyAds([
      mkResult(commits[0]!, 0.5),
      mkResult(commits[1]!, 0.4),
      mkResult(commits[2]!, 0.3),
    ]);
    expect(out.map((r) => r.commit.hash)).toEqual(["a", "b", "c"]);
  });
});

// ─── CGAR ──────────────────────────────────────────────────────────────

describe("buildCausalGraph", () => {
  it("links commits via PR number references", () => {
    const commits = [
      mkCommit({ hash: "old", date: "2024-01-01", pr: 482 }),
      mkCommit({ hash: "new", date: "2024-02-01", subject: "follow-up to PR #482" }),
    ];
    const g = buildCausalGraph(commits);
    expect(g.get("new")?.has("old")).toBe(true);
  });

  it("links commits via direct hash references", () => {
    const commits = [
      mkCommit({ hash: "abc1234defabcdef", date: "2024-01-01" }),
      mkCommit({ hash: "new", date: "2024-02-01", subject: "fix regression in abc1234" }),
    ];
    const g = buildCausalGraph(commits);
    expect(g.get("new")?.has("abc1234defabcdef")).toBe(true);
  });

  it("links revert commits to their target", () => {
    const commits = [
      mkCommit({ hash: "abc1234defabcdef", date: "2024-01-01", subject: "add caching" }),
      mkCommit({ hash: "rev1", date: "2024-02-01", subject: "Revert \"add caching\"", body: "Reverts commit abc1234" }),
    ];
    const g = buildCausalGraph(commits);
    expect(g.get("rev1")?.has("abc1234defabcdef")).toBe(true);
  });
});

describe("applyCgar", () => {
  it("boosts results that are causally linked to other results", () => {
    const commits = [
      mkCommit({ hash: "abcd1234efghij5678", date: "2024-01-01", subject: "feat: caching" }),
      mkCommit({ hash: "linked", date: "2024-02-01", subject: "follow-up to abcd1234" }),
      mkCommit({ hash: "unrelated", date: "2024-02-15", subject: "docs: typo" }),
    ];
    const results = [
      mkResult(commits[0]!, 0.7),
      mkResult(commits[1]!, 0.4),
      mkResult(commits[2]!, 0.4),
    ];
    const out = applyCgar(results, commits);
    // "linked" should rise above "unrelated" because it's causally connected
    const linkedIdx = out.findIndex((r) => r.commit.hash === "linked");
    const unrelatedIdx = out.findIndex((r) => r.commit.hash === "unrelated");
    expect(linkedIdx).toBeLessThan(unrelatedIdx);
  });

  it("respects maxHops bound", () => {
    const commits = [
      mkCommit({ hash: "a", date: "2024-01-01" }),
      mkCommit({ hash: "b", date: "2024-02-01", subject: "ref a" }),
      mkCommit({ hash: "c", date: "2024-03-01", subject: "ref b" }),
    ];
    // With maxHops=1, c shouldn't get a boost (it's 2 hops from a)
    const out1 = applyCgar(
      [mkResult(commits[0]!, 0.5), mkResult(commits[2]!, 0.3)],
      commits,
      { maxHops: 1 },
    );
    expect(out1[0]!.commit.hash).toBe("a");
  });
});

// ─── ENSEMBLE ──────────────────────────────────────────────────────────

describe("applyNovelScoring (ensemble)", () => {
  it("composes all four algorithms without errors", () => {
    const commits = [
      mkCommit({ hash: "a1", date: "2026-04-01", author: "Alice", pr: 1 }),
      mkCommit({ hash: "a2", date: "2024-04-01", author: "Alice", subject: "ref PR #1" }),
      mkCommit({ hash: "b1", date: "2025-04-01", author: "Bob" }),
    ];
    const results = [
      mkResult(commits[0]!, 0.5),
      mkResult(commits[1]!, 0.4),
      mkResult(commits[2]!, 0.45),
    ];
    const out = applyNovelScoring(results, {
      tdwe: { nowMs: new Date("2026-05-06").getTime() },
      racb: {
        signals: [{ commitHash: "a2", kind: "fix", daysToFollowup: 3 }],
      },
      ads: { alpha: 0.3 },
      cgar: { commits },
    });
    expect(out.length).toBe(3);
    // Every output should still have a valid score
    for (const r of out) expect(r.score).toBeGreaterThan(0);
  });

  it("returns empty array when input is empty", () => {
    const out = applyNovelScoring([], {});
    expect(out).toEqual([]);
  });
});
