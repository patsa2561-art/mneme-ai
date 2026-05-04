import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { indexer as indexerNs, store as storeNs, retrieve as retrieveNs } from "@mneme-ai/core";
import { HashEmbedder } from "@mneme-ai/embeddings";
import { createFixtureRepo, FixtureRepo } from "../fixtures/fixture-repo.js";

let fixture: FixtureRepo;
let dbDir: string;
let store: storeNs.MnemeStore;

beforeAll(async () => {
  fixture = createFixtureRepo();
  dbDir = mkdtempSync(join(tmpdir(), "mneme-e2e-"));
  store = new storeNs.MnemeStore(join(dbDir, "mneme.db"));
  const idx = new indexerNs.Indexer({
    cwd: fixture.path,
    store,
    embedder: new HashEmbedder(512),
  });
  await idx.run();
}, 60_000);

afterAll(() => {
  store.close();
  rmSync(dbDir, { recursive: true, force: true });
  fixture.cleanup();
});

describe("end-to-end: index a fixture repo, then query", () => {
  it("indexed every fixture commit", () => {
    expect(store.countCommits()).toBe(12);
    expect(store.countChunks()).toBeGreaterThan(0);
    expect(store.countChunksWithEmbedding()).toBe(store.countChunks());
  });

  it("retrieves the BigInt fix when asked about Stripe BigInt", async () => {
    const results = await retrieveNs.search("Stripe BigInt amount overflow", {
      store,
      embedder: new HashEmbedder(512),
      topK: 5,
    });
    expect(results.length).toBeGreaterThan(0);
    const topHashes = results.slice(0, 3).map((r) => r.commit.hash);
    expect(topHashes).toContain(fixture.hashByTag["fix-bigint"]);
  });

  it("retrieves the auth refactor when asked about compliance/legal", async () => {
    const results = await retrieveNs.search("compliance legal session token replacement", {
      store,
      embedder: new HashEmbedder(512),
      topK: 5,
    });
    expect(results.length).toBeGreaterThan(0);
    const topHashes = results.slice(0, 3).map((r) => r.commit.hash);
    expect(topHashes).toContain(fixture.hashByTag["auth-middleware"]);
  });

  it("retrieves idempotency commit for retry-related queries", async () => {
    const results = await retrieveNs.search("Stripe webhook retry idempotency dedup", {
      store,
      embedder: new HashEmbedder(512),
      topK: 5,
    });
    const topHashes = results.slice(0, 3).map((r) => r.commit.hash);
    expect(topHashes).toContain(fixture.hashByTag["idempotency"]);
  });

  it("returns an empty list (gracefully) for nonsense queries", async () => {
    const results = await retrieveNs.search("xyzzyplughblargh nothing-matches-this", {
      store,
      embedder: new HashEmbedder(512),
      topK: 5,
    });
    // Either empty, OR the top score is very low — both are acceptable
    if (results.length > 0) {
      expect(results[0]!.score).toBeLessThan(0.1);
    }
  });
});
