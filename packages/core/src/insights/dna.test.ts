import { describe, it, expect } from "vitest";
import { extractDna, compareDna } from "./dna.js";
import type { Commit } from "../types.js";

function mk(p: { hash: string; date: string; subject: string; author?: string; email?: string; files?: string[]; body?: string; pr?: number }): Commit {
  return {
    hash: p.hash,
    shortHash: p.hash.slice(0, 7),
    authorName: p.author ?? "Alice",
    authorEmail: p.email ?? "alice@example.com",
    authorDate: p.date,
    committerDate: p.date,
    subject: p.subject,
    body: p.body ?? "",
    files: p.files ?? ["src/x.ts"],
    parents: [],
    prNumber: p.pr,
  };
}

describe("extractDna", () => {
  it("returns empty strand when no commits match author", () => {
    const dna = extractDna([], "alice@example.com");
    expect(dna.commitCount).toBe(0);
    expect(dna.hash).toBe("0000000");
  });

  it("extracts commitCount and date range correctly", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-15T09:00:00Z", subject: "init" }),
      mk({ hash: "a2", date: "2024-06-22T14:00:00Z", subject: "polish" }),
    ];
    const dna = extractDna(commits, "alice@example.com");
    expect(dna.commitCount).toBe(2);
    expect(dna.fromDate).toBe("2024-01-15");
    expect(dna.toDate).toBe("2024-06-22");
  });

  it("filters by author email or name", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01T09:00:00Z", subject: "alice work", author: "Alice", email: "alice@x.com" }),
      mk({ hash: "b1", date: "2024-01-02T09:00:00Z", subject: "bob work", author: "Bob", email: "bob@x.com" }),
    ];
    const aliceDna = extractDna(commits, "alice@x.com");
    expect(aliceDna.commitCount).toBe(1);
    const bobDna = extractDna(commits, "Bob");
    expect(bobDna.commitCount).toBe(1);
  });

  it("conventionalRatio detects conventional-commit prefixes", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01T09:00:00Z", subject: "feat(core): add caching" }),
      mk({ hash: "a2", date: "2024-01-02T09:00:00Z", subject: "fix: handle null body" }),
      mk({ hash: "a3", date: "2024-01-03T09:00:00Z", subject: "random subject" }),
    ];
    const dna = extractDna(commits, "alice@example.com");
    expect(dna.style.conventionalRatio).toBeCloseTo(2 / 3, 2);
  });

  it("imperativeRatio rises when subjects start with imperatives", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01T09:00:00Z", subject: "Add caching" }),
      mk({ hash: "a2", date: "2024-01-02T09:00:00Z", subject: "fix typo" }),
      mk({ hash: "a3", date: "2024-01-03T09:00:00Z", subject: "Update docs" }),
    ];
    const dna = extractDna(commits, "alice@example.com");
    expect(dna.message.imperativeRatio).toBeGreaterThan(0.6);
  });

  it("bodyRatio counts only commits with non-empty body", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01T09:00:00Z", subject: "A", body: "explains why" }),
      mk({ hash: "a2", date: "2024-01-02T09:00:00Z", subject: "B" }),
    ];
    const dna = extractDna(commits, "alice@example.com");
    expect(dna.message.bodyRatio).toBeCloseTo(0.5, 2);
  });

  it("topVerbs lists most-used leading verbs", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01T09:00:00Z", subject: "add x" }),
      mk({ hash: "a2", date: "2024-01-02T09:00:00Z", subject: "add y" }),
      mk({ hash: "a3", date: "2024-01-03T09:00:00Z", subject: "fix z" }),
    ];
    const dna = extractDna(commits, "alice@example.com");
    expect(dna.message.topVerbs[0]?.verb).toBe("add");
    expect(dna.message.topVerbs[0]?.count).toBe(2);
  });

  it("hours histogram counts each commit by UTC hour", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01T09:00:00Z", subject: "x" }),
      mk({ hash: "a2", date: "2024-01-02T09:30:00Z", subject: "x" }),
      mk({ hash: "a3", date: "2024-01-03T15:00:00Z", subject: "x" }),
    ];
    const dna = extractDna(commits, "alice@example.com");
    expect(dna.hours.byHour[9]).toBe(2);
    expect(dna.hours.byHour[15]).toBe(1);
  });

  it("weekendRatio reflects Sat/Sun commits", () => {
    // 2024-06-15 is Saturday, 2024-06-17 is Monday
    const commits = [
      mk({ hash: "a1", date: "2024-06-15T09:00:00Z", subject: "weekend work" }),
      mk({ hash: "a2", date: "2024-06-17T09:00:00Z", subject: "weekday work" }),
    ];
    const dna = extractDna(commits, "alice@example.com");
    expect(dna.hours.weekendRatio).toBe(0.5);
  });

  it("topDirs reflects most-touched root directories", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01T09:00:00Z", subject: "x", files: ["src/auth/x.ts", "src/auth/y.ts"] }),
      mk({ hash: "a2", date: "2024-01-02T09:00:00Z", subject: "x", files: ["src/payments/z.ts"] }),
    ];
    const dna = extractDna(commits, "alice@example.com");
    const topDir = dna.files.topDirs[0]?.dir;
    expect(topDir).toMatch(/^src\//);
  });

  it("hash is deterministic for the same input", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01T09:00:00Z", subject: "init" }),
    ];
    const a = extractDna(commits, "alice@example.com");
    const b = extractDna(commits, "alice@example.com");
    expect(a.hash).toBe(b.hash);
    expect(a.hash.length).toBe(7);
  });

  it("compareDna returns similarity 1.0 for two identical strands", () => {
    const commits = [
      mk({ hash: "a1", date: "2024-01-01T09:00:00Z", subject: "feat: add caching" }),
      mk({ hash: "a2", date: "2024-01-02T09:00:00Z", subject: "fix: handle null" }),
    ];
    const a = extractDna(commits, "alice@example.com");
    const b = extractDna(commits, "alice@example.com");
    const cmp = compareDna(a, b);
    expect(cmp.similarity).toBeGreaterThan(0.95);
  });

  it("compareDna returns lower similarity for divergent styles", () => {
    const aliceCommits = [
      mk({ hash: "a1", date: "2024-01-01T09:00:00Z", subject: "feat: add x", author: "Alice", email: "a@x.com", files: ["src/auth/a.ts"] }),
      mk({ hash: "a2", date: "2024-01-02T09:00:00Z", subject: "feat: add y", author: "Alice", email: "a@x.com", files: ["src/auth/b.ts"] }),
    ];
    const bobCommits = [
      mk({ hash: "b1", date: "2024-01-01T22:00:00Z", subject: "did some stuff", author: "Bob", email: "b@x.com", files: ["legacy/c.py"] }),
      mk({ hash: "b2", date: "2024-01-02T23:00:00Z", subject: "more random work", author: "Bob", email: "b@x.com", files: ["legacy/d.py"] }),
    ];
    const a = extractDna(aliceCommits, "a@x.com");
    const b = extractDna(bobCommits, "b@x.com");
    const cmp = compareDna(a, b);
    expect(cmp.similarity).toBeLessThan(0.7);
  });
});
