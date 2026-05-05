import { describe, it, expect } from "vitest";
import { buildChronicle, renderChronicle } from "./chronicle.js";
import type { Commit } from "../types.js";

function mk(p: { hash: string; date: string; subject: string; author?: string; body?: string }): Commit {
  return {
    hash: p.hash,
    shortHash: p.hash.slice(0, 7),
    authorName: p.author ?? "Alice",
    authorEmail: (p.author ?? "alice").toLowerCase() + "@example.com",
    authorDate: p.date,
    committerDate: p.date,
    subject: p.subject,
    body: p.body ?? "",
    files: [],
    parents: [],
  };
}

describe("buildChronicle", () => {
  it("returns empty chronicle when no commits", () => {
    const c = buildChronicle([]);
    expect(c.totalCommits).toBe(0);
    expect(c.chapters).toHaveLength(0);
  });

  it("creates a single chapter from contiguous commits", () => {
    const commits = Array.from({ length: 8 }, (_, i) =>
      mk({ hash: `c${i}`, date: `2024-01-${(i + 1).toString().padStart(2, "0")}`, subject: `feat: x${i}` }),
    );
    const c = buildChronicle(commits, { gapDays: 30 });
    expect(c.chapters.length).toBe(1);
    expect(c.chapters[0]!.commits.length).toBe(8);
  });

  it("splits chapters at long gaps (>= gapDays)", () => {
    const commits = [
      ...Array.from({ length: 6 }, (_, i) =>
        mk({ hash: `a${i}`, date: `2024-01-${(i + 1).toString().padStart(2, "0")}`, subject: `feat: x${i}` }),
      ),
      ...Array.from({ length: 6 }, (_, i) =>
        mk({ hash: `b${i}`, date: `2024-08-${(i + 1).toString().padStart(2, "0")}`, subject: `refactor: y${i}` }),
      ),
    ];
    const c = buildChronicle(commits, { gapDays: 30, minChapterCommits: 3 });
    expect(c.chapters.length).toBeGreaterThanOrEqual(2);
  });

  it("first chapter is always titled 'The Founding'", () => {
    const commits = Array.from({ length: 5 }, (_, i) =>
      mk({ hash: `c${i}`, date: `2024-01-${(i + 1).toString().padStart(2, "0")}`, subject: `init x${i}` }),
    );
    const c = buildChronicle(commits);
    expect(c.chapters[0]!.title).toBe("The Founding");
  });

  it("titles a refactor-heavy chapter as 'The Great Refactor'", () => {
    const commits = [
      ...Array.from({ length: 5 }, (_, i) =>
        mk({ hash: `a${i}`, date: `2024-01-${(i + 1).toString().padStart(2, "0")}`, subject: `feat: x${i}` }),
      ),
      ...Array.from({ length: 5 }, (_, i) =>
        mk({ hash: `b${i}`, date: `2024-06-${(i + 1).toString().padStart(2, "0")}`, subject: `rewrite parser ${i}` }),
      ),
    ];
    const c = buildChronicle(commits, { gapDays: 30, minChapterCommits: 3 });
    const refactorChapter = c.chapters.find((ch) => ch.title === "The Great Refactor");
    expect(refactorChapter).toBeDefined();
  });

  it("protagonist is the most-frequent author of the chapter", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01", subject: "x", author: "Alice" }),
      mk({ hash: "a2", date: "2024-01-02", subject: "x", author: "Alice" }),
      mk({ hash: "b1", date: "2024-01-03", subject: "x", author: "Bob" }),
    ];
    const c = buildChronicle(commits);
    expect(c.chapters[0]!.protagonist).toBe("Alice");
  });

  it("opening references the first commit's subject", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01", subject: "Initial scaffold of payment service" }),
      mk({ hash: "a2", date: "2024-01-02", subject: "x" }),
    ];
    const c = buildChronicle(commits);
    expect(c.chapters[0]!.opening).toContain("Initial scaffold of payment service");
  });

  it("renderChronicle produces valid markdown with chapter headings", () => {
    const commits = Array.from({ length: 5 }, (_, i) =>
      mk({ hash: `c${i}`, date: `2024-01-${(i + 1).toString().padStart(2, "0")}`, subject: `feat: x${i}` }),
    );
    const c = buildChronicle(commits);
    const md = renderChronicle(c);
    expect(md).toContain("# Chronicles of Your Codebase");
    expect(md).toMatch(/## Chapter 1 ·/);
    expect(md).toContain("**2024-01-01");
  });

  it("renderChronicle handles empty chronicle gracefully", () => {
    const md = renderChronicle({ totalCommits: 0, totalDays: 0, chapters: [] });
    expect(md).toContain("No commits to chronicle yet");
  });

  it("chapter dates are in chronological order", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01", subject: "x" }),
      mk({ hash: "a2", date: "2024-02-01", subject: "x" }),
      mk({ hash: "a3", date: "2024-03-01", subject: "x" }),
    ];
    const c = buildChronicle(commits, { gapDays: 1, minChapterCommits: 1 });
    for (let i = 1; i < c.chapters.length; i++) {
      expect(c.chapters[i - 1]!.fromDate.localeCompare(c.chapters[i]!.fromDate)).toBeLessThanOrEqual(0);
    }
  });
});
