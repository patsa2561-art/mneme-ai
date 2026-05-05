import { describe, it, expect } from "vitest";
import {
  detectDrawdowns,
  summarizeDrawdowns,
  isFeatCommit,
  isFixCommit,
  classifyDrawdown,
} from "./drawdown.js";
import type { Commit } from "../types.js";

const cmt = (hash: string, date: string, subject: string): Commit => ({
  hash,
  shortHash: hash.slice(0, 7),
  authorName: "alice",
  authorEmail: "alice@x",
  authorDate: `${date}T00:00:00Z`,
  committerDate: `${date}T00:00:00Z`,
  subject,
  body: "",
  parents: [],
  files: [],
});

describe("isFeatCommit / isFixCommit — Conventional-Commit subject classifiers", () => {
  it("matches feat( and feat:", () => {
    expect(isFeatCommit(cmt("a", "2024-01-01", "feat: thing"))).toBe(true);
    expect(isFeatCommit(cmt("a", "2024-01-01", "feat(auth): thing"))).toBe(true);
    expect(isFeatCommit(cmt("a", "2024-01-01", "feat scoped without colon"))).toBe(false);
  });

  it("matches fix/hotfix/bug/revert/patch", () => {
    expect(isFixCommit(cmt("a", "2024-01-01", "fix: x"))).toBe(true);
    expect(isFixCommit(cmt("a", "2024-01-01", "hotfix: x"))).toBe(true);
    expect(isFixCommit(cmt("a", "2024-01-01", "bug: x"))).toBe(true);
    expect(isFixCommit(cmt("a", "2024-01-01", "revert: x"))).toBe(true);
    expect(isFixCommit(cmt("a", "2024-01-01", "feat: x"))).toBe(false);
  });
});

describe("classifyDrawdown — tier from length × duration", () => {
  it("critical at 15+ commits or 30+ days", () => {
    expect(classifyDrawdown(15, 5)).toBe("critical");
    expect(classifyDrawdown(5, 30)).toBe("critical");
  });
  it("severe at 8+ or 14+", () => {
    expect(classifyDrawdown(8, 5)).toBe("severe");
    expect(classifyDrawdown(5, 14)).toBe("severe");
  });
  it("moderate at 5+ or 7+", () => {
    expect(classifyDrawdown(5, 1)).toBe("moderate");
    expect(classifyDrawdown(3, 7)).toBe("moderate");
  });
  it("minor for short streaks", () => {
    expect(classifyDrawdown(3, 2)).toBe("minor");
  });
});

describe("detectDrawdowns — simple cases", () => {
  it("returns empty when no fix commits", () => {
    const commits = [
      cmt("a1", "2024-01-01", "feat: A"),
      cmt("a2", "2024-01-02", "feat: B"),
      cmt("a3", "2024-01-03", "feat: C"),
    ];
    expect(detectDrawdowns(commits)).toEqual([]);
  });

  it("returns empty when streak shorter than minLength", () => {
    const commits = [
      cmt("a1", "2024-01-01", "feat: A"),
      cmt("a2", "2024-01-02", "fix: x"),
      cmt("a3", "2024-01-03", "fix: y"),
      cmt("a4", "2024-01-04", "feat: B"),
    ];
    expect(detectDrawdowns(commits, { minLength: 3 })).toEqual([]);
  });

  it("detects a single drawdown of 5 fixes between two feats", () => {
    const commits = [
      cmt("a1", "2024-01-01", "feat: A"),
      cmt("a2", "2024-01-02", "fix: 1"),
      cmt("a3", "2024-01-03", "fix: 2"),
      cmt("a4", "2024-01-04", "fix: 3"),
      cmt("a5", "2024-01-05", "fix: 4"),
      cmt("a6", "2024-01-06", "fix: 5"),
      cmt("a7", "2024-01-07", "feat: B"),
    ];
    const drawdowns = detectDrawdowns(commits, { minLength: 3 });
    expect(drawdowns).toHaveLength(1);
    expect(drawdowns[0]!.length).toBe(5);
    expect(drawdowns[0]!.tier).toBe("moderate");
    expect(drawdowns[0]!.sampleFixes).toHaveLength(3);
  });

  it("detects multiple separate drawdowns", () => {
    const commits = [
      cmt("a1", "2024-01-01", "feat: A"),
      cmt("a2", "2024-01-02", "fix: 1"),
      cmt("a3", "2024-01-03", "fix: 2"),
      cmt("a4", "2024-01-04", "fix: 3"),
      cmt("a5", "2024-01-05", "feat: B"),
      cmt("a6", "2024-01-06", "fix: 4"),
      cmt("a7", "2024-01-07", "fix: 5"),
      cmt("a8", "2024-01-08", "fix: 6"),
      cmt("a9", "2024-01-09", "fix: 7"),
      cmt("a10", "2024-01-10", "feat: C"),
    ];
    const drawdowns = detectDrawdowns(commits, { minLength: 3 });
    expect(drawdowns).toHaveLength(2);
  });

  it("respects fixRatio threshold (mixed chore/fix streaks)", () => {
    const commits = [
      cmt("a1", "2024-01-01", "feat: A"),
      cmt("a2", "2024-01-02", "fix: 1"),
      cmt("a3", "2024-01-03", "chore: bump deps"),
      cmt("a4", "2024-01-04", "chore: lint config"),
      cmt("a5", "2024-01-05", "feat: B"),
    ];
    // 1/3 fix ratio — below default 0.5
    expect(detectDrawdowns(commits, { minLength: 3, fixRatio: 0.5 })).toEqual([]);
    expect(detectDrawdowns(commits, { minLength: 3, fixRatio: 0.3 })).toHaveLength(1);
  });

  it("sorts drawdowns by severity descending", () => {
    const commits = [
      // Drawdown 1: 4 fixes
      cmt("a1", "2024-01-01", "feat: A"),
      cmt("a2", "2024-01-02", "fix: 1"),
      cmt("a3", "2024-01-03", "fix: 2"),
      cmt("a4", "2024-01-04", "fix: 3"),
      cmt("a5", "2024-01-05", "fix: 4"),
      cmt("a6", "2024-01-06", "feat: B"),
      // Drawdown 2: 8 fixes (more severe)
      cmt("b1", "2024-02-01", "fix: 1"),
      cmt("b2", "2024-02-02", "fix: 2"),
      cmt("b3", "2024-02-03", "fix: 3"),
      cmt("b4", "2024-02-04", "fix: 4"),
      cmt("b5", "2024-02-05", "fix: 5"),
      cmt("b6", "2024-02-06", "fix: 6"),
      cmt("b7", "2024-02-07", "fix: 7"),
      cmt("b8", "2024-02-08", "fix: 8"),
      cmt("b9", "2024-02-09", "feat: C"),
    ];
    const drawdowns = detectDrawdowns(commits, { minLength: 3 });
    expect(drawdowns[0]!.length).toBe(8);
    expect(drawdowns[1]!.length).toBe(4);
  });

  it("respects topN cap", () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 30; i++) {
      const day = String(i + 1).padStart(2, "0");
      commits.push(cmt(`f${i}`, `2024-01-${day}`, "feat: x"));
      commits.push(cmt(`x${i}`, `2024-01-${day}`, "fix: 1"));
      commits.push(cmt(`y${i}`, `2024-01-${day}`, "fix: 2"));
      commits.push(cmt(`z${i}`, `2024-01-${day}`, "fix: 3"));
    }
    expect(detectDrawdowns(commits, { minLength: 3, topN: 5 }).length).toBeLessThanOrEqual(5);
  });
});

describe("summarizeDrawdowns — repo-level metrics", () => {
  it("computes drawdown fraction over repo lifespan", () => {
    const commits = [
      cmt("a1", "2024-01-01", "feat: A"),
      cmt("a2", "2024-01-08", "fix: 1"), // 7 days into lifespan
      cmt("a3", "2024-01-15", "fix: 2"),
      cmt("a4", "2024-01-22", "fix: 3"),
      cmt("a5", "2024-02-01", "feat: B"), // 31 days total
    ];
    const drawdowns = detectDrawdowns(commits, { minLength: 3 });
    const summary = summarizeDrawdowns(commits, drawdowns);
    expect(summary.total).toBe(1);
    expect(summary.longestStreak).toBe(3);
    expect(summary.drawdownFraction).toBeGreaterThan(0);
    expect(summary.drawdownFraction).toBeLessThan(1);
  });

  it("returns zero metrics for empty commits", () => {
    const summary = summarizeDrawdowns([], []);
    expect(summary.total).toBe(0);
    expect(summary.drawdownFraction).toBe(0);
  });
});
