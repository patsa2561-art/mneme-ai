import { describe, it, expect } from "vitest";
import { buildDrift, classifyCommit } from "./drift.js";
import type { Commit } from "../types.js";

function mk(p: { hash: string; date: string; subject: string; body?: string }): Commit {
  return {
    hash: p.hash,
    shortHash: p.hash.slice(0, 7),
    authorName: "Test",
    authorEmail: "t@e.com",
    authorDate: p.date,
    committerDate: p.date,
    subject: p.subject,
    body: p.body ?? "",
    files: [],
    parents: [],
  };
}

describe("classifyCommit", () => {
  it("classifies firefight from fix/hotfix/revert keywords", () => {
    expect(classifyCommit(mk({ hash: "a", date: "2024-01-01", subject: "fix bug" }))).toBe("firefight");
    expect(classifyCommit(mk({ hash: "b", date: "2024-01-01", subject: "hotfix critical" }))).toBe("firefight");
    expect(classifyCommit(mk({ hash: "c", date: "2024-01-01", subject: "revert bad change" }))).toBe("firefight");
  });

  it("classifies refactor from rewrite/migrate keywords", () => {
    expect(classifyCommit(mk({ hash: "a", date: "2024-01-01", subject: "refactor handler" }))).toBe("refactor");
    expect(classifyCommit(mk({ hash: "b", date: "2024-01-01", subject: "rewrite parser" }))).toBe("refactor");
    expect(classifyCommit(mk({ hash: "c", date: "2024-01-01", subject: "migrate to v3" }))).toBe("refactor");
  });

  it("classifies feature from feat/add/implement keywords", () => {
    expect(classifyCommit(mk({ hash: "a", date: "2024-01-01", subject: "feat: add caching" }))).toBe("feature");
    expect(classifyCommit(mk({ hash: "b", date: "2024-01-01", subject: "add new endpoint" }))).toBe("feature");
    expect(classifyCommit(mk({ hash: "c", date: "2024-01-01", subject: "implement OAuth" }))).toBe("feature");
  });

  it("classifies polish from chore/typo/format keywords", () => {
    expect(classifyCommit(mk({ hash: "a", date: "2024-01-01", subject: "chore: reformat" }))).toBe("polish");
    expect(classifyCommit(mk({ hash: "b", date: "2024-01-01", subject: "fix typo in README" }))).toBe("firefight");
  });

  it("falls back to 'other' for ambiguous subjects", () => {
    expect(classifyCommit(mk({ hash: "a", date: "2024-01-01", subject: "merge branch" }))).toBe("other");
  });
});

describe("buildDrift", () => {
  it("returns empty report for empty input", () => {
    const r = buildDrift([]);
    expect(r.buckets).toHaveLength(0);
    expect(r.insights).toHaveLength(0);
  });

  it("groups commits into quarter buckets by default", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-15", subject: "feat: x" }),
      mk({ hash: "a2", date: "2024-04-15", subject: "feat: y" }),
      mk({ hash: "a3", date: "2024-08-15", subject: "feat: z" }),
    ];
    const r = buildDrift(commits);
    expect(r.granularity).toBe("quarter");
    expect(r.buckets.length).toBe(3);
    expect(r.buckets[0]!.label).toBe("2024-Q1");
    expect(r.buckets[1]!.label).toBe("2024-Q2");
    expect(r.buckets[2]!.label).toBe("2024-Q3");
  });

  it("supports month granularity", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-15", subject: "x" }),
      mk({ hash: "a2", date: "2024-02-15", subject: "y" }),
    ];
    const r = buildDrift(commits, { granularity: "month" });
    expect(r.granularity).toBe("month");
    expect(r.buckets[0]!.label).toBe("2024-01");
    expect(r.buckets[1]!.label).toBe("2024-02");
  });

  it("dominant kind is the highest-count category in a bucket", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01", subject: "fix bug 1" }),
      mk({ hash: "a2", date: "2024-01-02", subject: "fix bug 2" }),
      mk({ hash: "a3", date: "2024-01-03", subject: "feat: add x" }),
    ];
    const r = buildDrift(commits);
    expect(r.buckets[0]!.dominant).toBe("firefight");
  });

  it("detects burnout insight when firefight ratio jumps", () => {
    const commits: Commit[] = [];
    // Q1: 5 features
    for (let i = 0; i < 5; i++) {
      commits.push(mk({ hash: `f${i}`, date: `2024-01-${(i + 1).toString().padStart(2, "0")}`, subject: `feat: x${i}` }));
    }
    // Q2: 5 fires
    for (let i = 0; i < 5; i++) {
      commits.push(mk({ hash: `b${i}`, date: `2024-04-${(i + 1).toString().padStart(2, "0")}`, subject: `fix bug ${i}` }));
    }
    const r = buildDrift(commits);
    expect(r.insights.some((i) => i.kind === "burnout")).toBe(true);
  });

  it("detects recovery insight when firefight ratio falls", () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 5; i++) {
      commits.push(mk({ hash: `b${i}`, date: `2024-01-${(i + 1).toString().padStart(2, "0")}`, subject: `fix bug ${i}` }));
    }
    for (let i = 0; i < 5; i++) {
      commits.push(mk({ hash: `f${i}`, date: `2024-04-${(i + 1).toString().padStart(2, "0")}`, subject: `feat: nice thing ${i}` }));
    }
    const r = buildDrift(commits);
    expect(r.insights.some((i) => i.kind === "recovery")).toBe(true);
  });

  it("detects rewrite cluster across consecutive quarters", () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 4; i++) {
      commits.push(mk({ hash: `r${i}`, date: `2024-01-${(i + 1).toString().padStart(2, "0")}`, subject: `refactor module ${i}` }));
    }
    for (let i = 0; i < 4; i++) {
      commits.push(mk({ hash: `s${i}`, date: `2024-04-${(i + 1).toString().padStart(2, "0")}`, subject: `rewrite component ${i}` }));
    }
    const r = buildDrift(commits);
    expect(r.insights.some((i) => i.kind === "rewrite-cluster")).toBe(true);
  });

  it("orders buckets chronologically by fromDate", () => {
    const commits = [
      mk({ hash: "a3", date: "2025-01-15", subject: "x" }),
      mk({ hash: "a1", date: "2024-01-15", subject: "x" }),
      mk({ hash: "a2", date: "2024-04-15", subject: "x" }),
    ];
    const r = buildDrift(commits);
    for (let i = 1; i < r.buckets.length; i++) {
      expect(r.buckets[i - 1]!.fromDate.localeCompare(r.buckets[i]!.fromDate)).toBeLessThan(0);
    }
  });
});
