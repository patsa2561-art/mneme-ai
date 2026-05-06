import { describe, it, expect } from "vitest";
import { analyzeIndexQuality } from "./quality.js";
import type { Commit, CommitChunk } from "../types.js";

function mk(p: { hash: string; subject: string; body?: string; pr?: number; issueRefs?: string[] }): Commit {
  return {
    hash: p.hash,
    shortHash: p.hash.slice(0, 7),
    authorName: "A",
    authorEmail: "a@x.com",
    authorDate: "2024-01-01",
    committerDate: "2024-01-01",
    subject: p.subject,
    body: p.body ?? "",
    files: [],
    parents: [],
    prNumber: p.pr,
    issueRefs: p.issueRefs,
  };
}

function mkChunk(commitHash: string, text: string, withEmbedding = true): CommitChunk {
  return {
    id: commitHash + "_subject",
    commitHash,
    text,
    kind: "subject",
    embedding: withEmbedding ? new Float32Array([0.1, 0.2, 0.3]) : undefined,
  };
}

describe("analyzeIndexQuality", () => {
  it("returns zero report when no commits", () => {
    const r = analyzeIndexQuality([], []);
    expect(r.grade).toBe("F");
    expect(r.overallScore).toBe(0);
    expect(r.indexedCommits).toBe(0);
    expect(r.recommendations.length).toBeGreaterThan(0);
  });

  it("scores high-quality commits with bodies + PRs + issues", () => {
    const commits = Array.from({ length: 10 }, (_, i) =>
      mk({
        hash: `c${i}`,
        subject: `feat: add comprehensive caching layer for api endpoint ${i}`,
        body: "Why: production latency was 2s. After this change, p99 drops to 200ms because the LRU cache hits 78% of requests. Closes #482.",
        pr: 100 + i,
        issueRefs: ["482"],
      }),
    );
    const chunks = commits.flatMap((c) => [
      mkChunk(c.hash, c.subject),
      mkChunk(c.hash, c.body, true),
      mkChunk(c.hash, "diff hunk text here with multiple words", true),
      mkChunk(c.hash, "pr title and body explanation", true),
    ]);
    const r = analyzeIndexQuality(commits, chunks);
    expect(r.grade).toMatch(/[A-B]/);
    expect(r.metrics.embedRatio).toBe(1);
    expect(r.metrics.subjectQuality).toBe(1);
    expect(r.metrics.prRatio).toBe(1);
    expect(r.metrics.issueRatio).toBe(1);
  });

  it("flags low-signal subjects (fix, wip, etc)", () => {
    const commits = [
      mk({ hash: "a1", subject: "fix" }),
      mk({ hash: "a2", subject: "wip" }),
      mk({ hash: "a3", subject: "merge" }),
      mk({ hash: "a4", subject: "feat: a real subject with detail" }),
    ];
    const chunks = commits.map((c) => mkChunk(c.hash, c.subject));
    const r = analyzeIndexQuality(commits, chunks);
    expect(r.metrics.duplicateRatio).toBeGreaterThanOrEqual(0.5);
    expect(r.recommendations.some((rec) => rec.toLowerCase().includes("low-signal"))).toBe(true);
  });

  it("recommends mneme heal when subjects are weak", () => {
    const commits = Array.from({ length: 5 }, (_, i) =>
      mk({ hash: `c${i}`, subject: "fix" }),
    );
    const chunks = commits.map((c) => mkChunk(c.hash, c.subject));
    const r = analyzeIndexQuality(commits, chunks);
    expect(r.recommendations.some((rec) => rec.includes("mneme heal"))).toBe(true);
  });

  it("flags missing embeddings", () => {
    const commits = [mk({ hash: "a1", subject: "feat: one good subject" })];
    const chunks = [mkChunk("a1", commits[0]!.subject, false)];
    const r = analyzeIndexQuality(commits, chunks);
    expect(r.metrics.embedRatio).toBe(0);
    expect(r.recommendations.some((rec) => rec.toLowerCase().includes("embedding"))).toBe(true);
  });

  it("grade scales with overall quality", () => {
    const high = Array.from({ length: 5 }, (_, i) =>
      mk({
        hash: `h${i}`,
        subject: `feat: comprehensive ${i} with many descriptive words`,
        body: "Why: detailed explanation of motivation and outcome with sufficient context to be searchable.",
        pr: 1,
        issueRefs: ["1"],
      }),
    );
    const lowSig = Array.from({ length: 5 }, (_, i) =>
      mk({ hash: `l${i}`, subject: "fix" }),
    );
    const highChunks = high.map((c) => mkChunk(c.hash, c.subject + " " + c.body));
    const lowChunks = lowSig.map((c) => mkChunk(c.hash, c.subject));
    const highReport = analyzeIndexQuality(high, highChunks);
    const lowReport = analyzeIndexQuality(lowSig, lowChunks);
    expect(highReport.overallScore).toBeGreaterThan(lowReport.overallScore);
  });

  it("tokenizerHealth catches degraded chunks (binary, redacted)", () => {
    const commits = [mk({ hash: "a1", subject: "feat: real" })];
    const chunks = [
      mkChunk("a1", "[REDACTED:secret]"),
      mkChunk("a1", "abc"),
      mkChunk("a1", "1234"),
      mkChunk("a1", "this is a properly tokenized chunk with many words"),
    ];
    const r = analyzeIndexQuality(commits, chunks);
    expect(r.metrics.tokenizerHealth).toBeLessThan(0.5);
  });

  it("metrics are bounded 0..1", () => {
    const commits = Array.from({ length: 3 }, (_, i) =>
      mk({ hash: `c${i}`, subject: "feat: x" }),
    );
    const chunks = commits.map((c) => mkChunk(c.hash, c.subject));
    const r = analyzeIndexQuality(commits, chunks);
    for (const v of Object.values(r.metrics)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(r.overallScore).toBeGreaterThanOrEqual(0);
    expect(r.overallScore).toBeLessThanOrEqual(1);
  });
});
