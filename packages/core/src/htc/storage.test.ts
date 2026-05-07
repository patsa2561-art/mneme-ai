import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MnemeStore } from "../store/sqlite.js";
import type { Commit } from "../types.js";
import {
  upsertAbstract,
  upsertAbstracts,
  getAbstract,
  getAllAbstracts,
  deleteOldAbstracts,
  upsertClusterSummary,
  getAllClusterSummaries,
  upsertMemoir,
  getMemoir,
  getHtcStats,
} from "./storage.js";

let tmpDir: string;
let store: MnemeStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-htc-storage-"));
  store = new MnemeStore(join(tmpDir, "mneme.db"));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const seedCommit = (over: Partial<Commit> = {}): Commit => ({
  hash: "c".repeat(40),
  shortHash: "ccccccc",
  authorName: "Alice",
  authorEmail: "a@x.io",
  authorDate: "2025-01-01T00:00:00Z",
  committerDate: "2025-01-01T00:00:00Z",
  subject: "test commit",
  body: "some body text",
  parents: [],
  files: ["src/foo.ts"],
  ...over,
});

describe("HTC storage — schema migration", () => {
  it("bumps schema_version to 4", () => {
    expect(store.getMeta("schema_version")).toBe("4");
  });

  it("creates htc_abstracts, htc_clusters, htc_memoir tables", () => {
    const tables = store.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as Array<{ name: string }>;
    const names = tables.map((t) => t.name);
    expect(names).toContain("htc_abstracts");
    expect(names).toContain("htc_clusters");
    expect(names).toContain("htc_memoir");
  });

  it("migration is idempotent — re-opening doesn't error or duplicate", () => {
    store.close();
    // Re-open same DB; should succeed without throwing.
    store = new MnemeStore(join(tmpDir, "mneme.db"));
    expect(store.getMeta("schema_version")).toBe("4");
    // Re-open AGAIN to be sure.
    store.close();
    store = new MnemeStore(join(tmpDir, "mneme.db"));
    expect(store.getMeta("schema_version")).toBe("4");
  });
});

describe("HTC storage — Layer 1 abstracts", () => {
  beforeEach(() => {
    store.upsertCommits([seedCommit({ hash: "a".repeat(40) })]);
  });

  it("upsertAbstract round-trips", () => {
    upsertAbstract(store, {
      hash: "a".repeat(40),
      abstract: "auth: replaced session cookies with JWT for stateless deploys",
      tokenCount: 12,
      generationMs: 350,
      generator: "ollama:qwen2.5:3b",
      generatedAt: "2025-05-01T00:00:00.000Z",
    });
    const got = getAbstract(store, "a".repeat(40));
    expect(got).not.toBeNull();
    expect(got!.abstract).toContain("JWT");
    expect(got!.tokenCount).toBe(12);
    expect(got!.generator).toBe("ollama:qwen2.5:3b");
    expect(got!.generatedAt).toBe("2025-05-01T00:00:00.000Z");
  });

  it("upsertAbstract is idempotent (re-insert overwrites)", () => {
    const base = {
      hash: "a".repeat(40),
      abstract: "first version",
      tokenCount: 2,
      generationMs: 100,
      generator: "ollama:qwen2.5:3b",
      generatedAt: "2025-05-01T00:00:00.000Z",
    };
    upsertAbstract(store, base);
    upsertAbstract(store, { ...base, abstract: "second version", tokenCount: 3 });
    const got = getAbstract(store, "a".repeat(40))!;
    expect(got.abstract).toBe("second version");
    expect(got.tokenCount).toBe(3);
    // Still only one row.
    const count = (store.db.prepare("SELECT COUNT(*) AS n FROM htc_abstracts").get() as { n: number }).n;
    expect(count).toBe(1);
  });

  it("upsertAbstracts batch round-trips", () => {
    store.upsertCommits([
      seedCommit({ hash: "b".repeat(40) }),
      seedCommit({ hash: "d".repeat(40) }),
    ]);
    upsertAbstracts(store, [
      {
        hash: "a".repeat(40),
        abstract: "alpha",
        tokenCount: 1,
        generationMs: 10,
        generator: "test",
      },
      {
        hash: "b".repeat(40),
        abstract: "bravo",
        tokenCount: 1,
        generationMs: 10,
        generator: "test",
      },
      {
        hash: "d".repeat(40),
        abstract: "delta",
        tokenCount: 1,
        generationMs: 10,
        generator: "test",
      },
    ]);
    const all = getAllAbstracts(store);
    expect(all.size).toBe(3);
    expect(all.get("b".repeat(40))!.abstract).toBe("bravo");
  });

  it("getAbstract returns null for missing commit", () => {
    expect(getAbstract(store, "f".repeat(40))).toBeNull();
  });

  it("deleteOldAbstracts removes rows older than cutoff", () => {
    upsertAbstract(store, {
      hash: "a".repeat(40),
      abstract: "old",
      tokenCount: 1,
      generationMs: 1,
      generator: "test",
      generatedAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
    });
    const removed = deleteOldAbstracts(store, 7);
    expect(removed).toBe(1);
    expect(getAbstract(store, "a".repeat(40))).toBeNull();
  });

  it("deleteOldAbstracts keeps fresh rows", () => {
    upsertAbstract(store, {
      hash: "a".repeat(40),
      abstract: "fresh",
      tokenCount: 1,
      generationMs: 1,
      generator: "test",
      generatedAt: new Date().toISOString(),
    });
    expect(deleteOldAbstracts(store, 7)).toBe(0);
  });

  it("ON DELETE CASCADE removes abstracts when commit is deleted", () => {
    upsertAbstract(store, {
      hash: "a".repeat(40),
      abstract: "x",
      tokenCount: 1,
      generationMs: 1,
      generator: "test",
    });
    store.db.prepare("DELETE FROM commits WHERE hash = ?").run("a".repeat(40));
    expect(getAbstract(store, "a".repeat(40))).toBeNull();
  });
});

describe("HTC storage — Layer 2 clusters", () => {
  it("upsertClusterSummary round-trips with JSON memberHashes", () => {
    upsertClusterSummary(store, {
      clusterId: "c1",
      label: "auth refactor",
      summary: "Group of auth-related commits…",
      memberHashes: ["aaa", "bbb", "ccc"],
      tokenCount: 50,
      generationMs: 1200,
      generator: "groq:llama-3.3-70b",
      generatedAt: "2025-05-01T00:00:00.000Z",
    });
    const all = getAllClusterSummaries(store);
    expect(all).toHaveLength(1);
    expect(all[0]!.label).toBe("auth refactor");
    expect(all[0]!.memberHashes).toEqual(["aaa", "bbb", "ccc"]);
  });

  it("upsertClusterSummary is idempotent on cluster_id", () => {
    upsertClusterSummary(store, {
      clusterId: "c1",
      label: "first",
      summary: "v1",
      memberHashes: ["a"],
      tokenCount: 1,
      generationMs: 1,
      generator: "test",
    });
    upsertClusterSummary(store, {
      clusterId: "c1",
      label: "second",
      summary: "v2",
      memberHashes: ["a", "b"],
      tokenCount: 2,
      generationMs: 1,
      generator: "test",
    });
    const all = getAllClusterSummaries(store);
    expect(all).toHaveLength(1);
    expect(all[0]!.label).toBe("second");
    expect(all[0]!.memberHashes).toEqual(["a", "b"]);
  });

  it("getAllClusterSummaries returns [] when none stored", () => {
    expect(getAllClusterSummaries(store)).toEqual([]);
  });
});

describe("HTC storage — Layer 3 memoir", () => {
  it("upsertMemoir round-trips on singleton id=1", () => {
    upsertMemoir(store, {
      narrative: "This repo is a TypeScript library that…",
      totalCommits: 1234,
      totalClusters: 27,
      tokenCount: 500,
      generationMs: 4200,
      generator: "groq:llama-3.3-70b",
      generatedAt: "2025-05-07T00:00:00.000Z",
    });
    const m = getMemoir(store);
    expect(m).not.toBeNull();
    expect(m!.totalCommits).toBe(1234);
    expect(m!.totalClusters).toBe(27);
    expect(m!.narrative).toContain("TypeScript");
  });

  it("upsertMemoir replaces previous memoir (single row)", () => {
    upsertMemoir(store, {
      narrative: "v1",
      totalCommits: 10,
      totalClusters: 2,
      tokenCount: 1,
      generationMs: 1,
      generator: "test",
    });
    upsertMemoir(store, {
      narrative: "v2",
      totalCommits: 20,
      totalClusters: 4,
      tokenCount: 1,
      generationMs: 1,
      generator: "test",
    });
    const count = (store.db.prepare("SELECT COUNT(*) AS n FROM htc_memoir").get() as { n: number }).n;
    expect(count).toBe(1);
    expect(getMemoir(store)!.narrative).toBe("v2");
  });

  it("getMemoir returns null when none stored", () => {
    expect(getMemoir(store)).toBeNull();
  });
});

describe("HTC storage — getHtcStats", () => {
  it("returns zeros for empty store", () => {
    const s = getHtcStats(store);
    expect(s.totalCommits).toBe(0);
    expect(s.abstractsGenerated).toBe(0);
    expect(s.abstractsCoverage).toBe(0);
    expect(s.clustersGenerated).toBe(0);
    expect(s.memoirGenerated).toBe(false);
    expect(s.totalCachedTokens).toBe(0);
    expect(s.compressionRatio).toBe(0);
  });

  it("computes coverage = abstracts / commits", () => {
    store.upsertCommits([
      seedCommit({ hash: "a".repeat(40), subject: "one" }),
      seedCommit({ hash: "b".repeat(40), subject: "two" }),
      seedCommit({ hash: "d".repeat(40), subject: "three" }),
      seedCommit({ hash: "e".repeat(40), subject: "four" }),
    ]);
    upsertAbstract(store, {
      hash: "a".repeat(40),
      abstract: "abstract one",
      tokenCount: 30,
      generationMs: 1,
      generator: "test",
    });
    upsertAbstract(store, {
      hash: "b".repeat(40),
      abstract: "abstract two",
      tokenCount: 30,
      generationMs: 1,
      generator: "test",
    });
    const s = getHtcStats(store);
    expect(s.totalCommits).toBe(4);
    expect(s.abstractsGenerated).toBe(2);
    expect(s.abstractsCoverage).toBeCloseTo(0.5, 4);
    expect(s.totalCachedTokens).toBe(60);
  });

  it("sums tokens across all three layers + compression ratio is raw/cached", () => {
    store.upsertCommits([
      seedCommit({ hash: "a".repeat(40), subject: "x".repeat(100), body: "y".repeat(300) }),
    ]);
    upsertAbstract(store, {
      hash: "a".repeat(40),
      abstract: "tiny abstract",
      tokenCount: 30,
      generationMs: 1,
      generator: "test",
    });
    upsertClusterSummary(store, {
      clusterId: "c1",
      label: "x",
      summary: "y",
      memberHashes: ["a".repeat(40)],
      tokenCount: 100,
      generationMs: 1,
      generator: "test",
    });
    upsertMemoir(store, {
      narrative: "memoir",
      totalCommits: 1,
      totalClusters: 1,
      tokenCount: 500,
      generationMs: 1,
      generator: "test",
    });
    const s = getHtcStats(store);
    expect(s.totalCachedTokens).toBe(630);
    // Raw = 400 chars / 4 = 100 tokens. Cached = 630. Ratio raw/cached < 1
    // (i.e. the cache here is bigger than the raw — synthetic test). Just
    // assert the formula is applied.
    expect(s.compressionRatio).toBeCloseTo(100 / 630, 2);
    expect(s.memoirGenerated).toBe(true);
    expect(s.memoirAgeDays).toBeDefined();
    expect(s.memoirAgeDays!).toBeGreaterThanOrEqual(0);
  });
});
