import { describe, it, expect } from "vitest";
import { detectRegrets, summarizeRegrets } from "./regret.js";
import type { Commit } from "../types.js";

const cmt = (
  hash: string,
  date: string,
  subject: string,
  body = "",
  files: string[] = [],
): Commit => ({
  hash,
  shortHash: hash.slice(0, 7),
  authorName: "alice",
  authorEmail: "alice@x",
  authorDate: `${date}T12:00:00Z`,
  committerDate: `${date}T12:00:00Z`,
  subject,
  body,
  parents: [],
  files,
});

describe("detectRegrets — revert (strongest signal)", () => {
  it("detects explicit revert that names the shipped commit hash", () => {
    const commits = [
      cmt("a1b2c3d", "2024-08-01", "feat: enable HTTP/3", "", ["src/edge.ts"]),
      cmt("e4f5g6h", "2024-08-03", "Revert \"feat: enable HTTP/3\"", "Reverts a1b2c3d — broke mobile", ["src/edge.ts"]),
    ];
    const regrets = detectRegrets(commits, { windowDays: 7 });
    expect(regrets).toHaveLength(1);
    expect(regrets[0]!.kind).toBe("revert");
    expect(regrets[0]!.daysToFix).toBeCloseTo(2, 0);
  });

  it("detects revert from shared-files heuristic when subject is generic", () => {
    const commits = [
      cmt("a1", "2024-08-01", "feat: new caching", "", ["src/cache.ts"]),
      cmt("a2", "2024-08-04", "revert caching change", "", ["src/cache.ts"]),
    ];
    expect(detectRegrets(commits)[0]!.kind).toBe("revert");
  });
});

describe("detectRegrets — hotfix and fix kinds", () => {
  it("flags hotfix when follow-up has 'hotfix' marker AND shares files", () => {
    const commits = [
      cmt("a1", "2024-08-01", "refactor: simplify session middleware", "", ["src/auth.ts"]),
      cmt("a2", "2024-08-01", "hotfix: CSRF check disappeared in refactor", "", ["src/auth.ts"]),
    ];
    expect(detectRegrets(commits)[0]!.kind).toBe("hotfix");
  });

  it("flags 'fix' kind when follow-up is a generic fix touching same files", () => {
    const commits = [
      cmt("a1", "2024-08-01", "perf: cache user lookup", "", ["src/users.ts"]),
      cmt("a2", "2024-08-04", "fix: cache invalidation race", "", ["src/users.ts"]),
    ];
    expect(detectRegrets(commits)[0]!.kind).toBe("fix");
  });

  it("doesn't double-flag commits that ARE themselves fixes", () => {
    const commits = [
      cmt("a1", "2024-08-01", "fix: typo", "", ["README.md"]),
      cmt("a2", "2024-08-02", "fix: another typo", "", ["README.md"]),
    ];
    // Neither is a regret — both are fix-shaped subjects.
    expect(detectRegrets(commits)).toEqual([]);
  });
});

describe("detectRegrets — window enforcement", () => {
  it("respects the windowDays cutoff", () => {
    const commits = [
      cmt("a1", "2024-08-01", "feat: thing", "", ["x.ts"]),
      cmt("a2", "2024-08-15", "fix: thing broke", "", ["x.ts"]), // 14 days later
    ];
    expect(detectRegrets(commits, { windowDays: 7 })).toEqual([]);
    expect(detectRegrets(commits, { windowDays: 30 })).toHaveLength(1);
  });

  it("respects minDaysToFix lower bound (filter out same-day micro-fixes)", () => {
    const commits = [
      cmt("a1", "2024-08-01", "feat: thing", "", ["x.ts"]),
      cmt("a2", "2024-08-01", "fix: typo", "", ["x.ts"]),
    ];
    expect(detectRegrets(commits, { minDaysToFix: 1 })).toEqual([]);
    expect(detectRegrets(commits, { minDaysToFix: 0 })).toHaveLength(1);
  });
});

describe("detectRegrets — only one regret per shipped commit", () => {
  it("returns the first follow-up only (avoids double-counting)", () => {
    const commits = [
      cmt("a1", "2024-08-01", "feat: thing", "", ["x.ts"]),
      cmt("a2", "2024-08-02", "fix: first attempt at fix", "", ["x.ts"]),
      cmt("a3", "2024-08-04", "fix: second attempt", "", ["x.ts"]),
    ];
    const regrets = detectRegrets(commits);
    expect(regrets).toHaveLength(1);
    expect(regrets[0]!.followup.shortHash).toBe("a2");
  });
});

describe("detectRegrets — output ordering and content", () => {
  it("sorts results by ship date descending (newest regret first)", () => {
    const commits = [
      cmt("old1", "2024-01-01", "feat: a", "", ["x.ts"]),
      cmt("old2", "2024-01-02", "fix: a broke", "", ["x.ts"]),
      cmt("new1", "2024-08-01", "feat: b", "", ["y.ts"]),
      cmt("new2", "2024-08-03", "fix: b broke", "", ["y.ts"]),
    ];
    const regrets = detectRegrets(commits);
    expect(regrets).toHaveLength(2);
    expect(regrets[0]!.shipped.shortHash).toBe("new1");
    expect(regrets[1]!.shipped.shortHash).toBe("old1");
  });

  it("attaches a lesson string when the follow-up body has explanatory text", () => {
    const commits = [
      cmt("a1", "2024-08-01", "feat: thing", "", ["x.ts"]),
      cmt(
        "a2",
        "2024-08-02",
        "fix: thing crashed",
        "the cache invalidation was racing with the eviction sweep",
        ["x.ts"],
      ),
    ];
    const r = detectRegrets(commits)[0]!;
    expect(r.lesson).toContain("cache invalidation");
  });
});

describe("summarizeRegrets — repo-level metrics", () => {
  it("computes regretRate over non-fix shipped commits", () => {
    const commits = [
      cmt("a1", "2024-08-01", "feat: A", "", ["x.ts"]),
      cmt("a2", "2024-08-02", "fix: A broke", "", ["x.ts"]),
      cmt("a3", "2024-08-03", "feat: B", "", ["y.ts"]),
      cmt("a4", "2024-08-04", "feat: C", "", ["z.ts"]),
    ];
    const regrets = detectRegrets(commits);
    const summary = summarizeRegrets(commits, regrets);
    // Non-fix shipped: a1, a3, a4 → 3 candidates. 1 regret. → 1/3 ≈ 0.33
    expect(summary.totalShipped).toBe(3);
    expect(summary.totalRegrets).toBe(1);
    expect(summary.regretRate).toBeCloseTo(1 / 3, 2);
  });

  it("counts byKind correctly", () => {
    const commits = [
      cmt("a1", "2024-08-01", "feat: A", "", ["x.ts"]),
      cmt("a2", "2024-08-02", "Revert \"feat: A\"", "", ["x.ts"]),
      cmt("a3", "2024-08-03", "feat: B", "", ["y.ts"]),
      cmt("a4", "2024-08-04", "hotfix: B explosion", "", ["y.ts"]),
    ];
    const regrets = detectRegrets(commits);
    const summary = summarizeRegrets(commits, regrets);
    expect(summary.byKind.revert).toBe(1);
    expect(summary.byKind.hotfix).toBe(1);
  });

  it("reports averageDaysToFix", () => {
    const commits = [
      cmt("a1", "2024-08-01", "feat: A", "", ["x.ts"]),
      cmt("a2", "2024-08-03", "fix: A", "", ["x.ts"]), // 2 days
      cmt("a3", "2024-08-10", "feat: B", "", ["y.ts"]),
      cmt("a4", "2024-08-14", "fix: B", "", ["y.ts"]), // 4 days
    ];
    const summary = summarizeRegrets(commits, detectRegrets(commits));
    expect(summary.averageDaysToFix).toBeCloseTo(3, 1);
  });

  it("returns 0 metrics when there are no regrets", () => {
    const summary = summarizeRegrets([cmt("a", "2024-08-01", "feat: stable", "", ["x"])], []);
    expect(summary.regretRate).toBe(0);
    expect(summary.averageDaysToFix).toBe(0);
  });
});
