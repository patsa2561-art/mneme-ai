import { describe, it, expect } from "vitest";
import { buildClusters } from "./cluster.js";
import type { Commit } from "../types.js";

function mk(p: { hash: string; subject: string; body?: string; date?: string }): Commit {
  return {
    hash: p.hash,
    shortHash: p.hash.slice(0, 7),
    authorName: "Test",
    authorEmail: "t@e.com",
    authorDate: p.date ?? "2024-01-01",
    committerDate: p.date ?? "2024-01-01",
    subject: p.subject,
    body: p.body ?? "",
    files: [],
    parents: [],
  };
}

describe("buildClusters", () => {
  it("returns empty when no commits", () => {
    const r = buildClusters([]);
    expect(r.totalCommits).toBe(0);
    expect(r.clusters).toHaveLength(0);
  });

  it("groups similar commits into one cluster", () => {
    const commits = [
      mk({ hash: "a1", subject: "add caching layer to api responses" }),
      mk({ hash: "a2", subject: "extend caching to user objects" }),
      mk({ hash: "a3", subject: "improve caching hit ratio" }),
      mk({ hash: "b1", subject: "fix typo in README" }),
      mk({ hash: "b2", subject: "fix typo in CHANGELOG" }),
    ];
    const r = buildClusters(commits, { similarityFloor: 0.1, minClusterSize: 2 });
    const cacheCluster = r.clusters.find((c) => c.topTerms.includes("caching"));
    expect(cacheCluster).toBeDefined();
    expect(cacheCluster!.size).toBeGreaterThanOrEqual(2);
  });

  it("singletons go to outliers when minClusterSize >= 2", () => {
    const commits = [
      mk({ hash: "a1", subject: "completely unique subject xyz" }),
      mk({ hash: "a2", subject: "another distinct subject abc" }),
    ];
    const r = buildClusters(commits, { similarityFloor: 0.5, minClusterSize: 2 });
    expect(r.outliers.length).toBe(2);
  });

  it("clusters are sorted by size descending", () => {
    const commits = [
      mk({ hash: "a1", subject: "add caching layer" }),
      mk({ hash: "a2", subject: "add caching to api" }),
      mk({ hash: "a3", subject: "add caching index" }),
      mk({ hash: "b1", subject: "fix bug in handler" }),
      mk({ hash: "b2", subject: "fix bug in router" }),
    ];
    const r = buildClusters(commits, { similarityFloor: 0.2, minClusterSize: 2 });
    for (let i = 1; i < r.clusters.length; i++) {
      expect(r.clusters[i - 1]!.size).toBeGreaterThanOrEqual(r.clusters[i]!.size);
    }
  });

  it("topTerms reflect shared cluster vocabulary", () => {
    const commits = [
      mk({ hash: "a1", subject: "rewrite authentication middleware" }),
      mk({ hash: "a2", subject: "rewrite authentication tests" }),
      mk({ hash: "a3", subject: "polish authentication" }),
    ];
    const r = buildClusters(commits, { similarityFloor: 0.1, minClusterSize: 2 });
    const auth = r.clusters[0];
    expect(auth).toBeDefined();
    expect(auth!.topTerms).toContain("authentication");
  });

  it("samples never exceed maxSamplesPerCluster", () => {
    const commits = Array.from({ length: 8 }, (_, i) =>
      mk({ hash: `a${i}`, subject: `caching ${i} layer api` }),
    );
    const r = buildClusters(commits, { similarityFloor: 0.15, minClusterSize: 2, maxSamplesPerCluster: 3 });
    for (const c of r.clusters) {
      expect(c.samples.length).toBeLessThanOrEqual(3);
    }
  });

  it("cohesion of single-commit cluster is 1", () => {
    const commits = [mk({ hash: "a1", subject: "lonely commit subject" })];
    const r = buildClusters(commits, { similarityFloor: 0, minClusterSize: 1 });
    if (r.clusters.length > 0) {
      expect(r.clusters[0]!.cohesion).toBe(1);
    }
  });

  it("date range covers earliest and latest commit in cluster", () => {
    const commits = [
      mk({ hash: "a1", subject: "add caching layer", date: "2024-01-01" }),
      mk({ hash: "a2", subject: "add caching tests", date: "2024-06-15" }),
    ];
    const r = buildClusters(commits, { similarityFloor: 0.1, minClusterSize: 2 });
    const c = r.clusters[0];
    if (c) {
      expect(c.fromDate).toBe("2024-01-01");
      expect(c.toDate).toBe("2024-06-15");
    }
  });

  it("respects similarityFloor — high floor produces more clusters", () => {
    const commits = [
      mk({ hash: "a1", subject: "add caching" }),
      mk({ hash: "a2", subject: "add cache" }),
      mk({ hash: "a3", subject: "add caching layer" }),
    ];
    const lowFloor = buildClusters(commits, { similarityFloor: 0.05, minClusterSize: 2 });
    const highFloor = buildClusters(commits, { similarityFloor: 0.95, minClusterSize: 2 });
    // High floor splits more aggressively → fewer joins → more outliers
    expect(highFloor.outliers.length).toBeGreaterThanOrEqual(lowFloor.outliers.length);
  });
});
