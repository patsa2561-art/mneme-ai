import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MnemeStore } from "./sqlite.js";
import type { Commit, CommitChunk, Incident } from "../types.js";

let tmpDir: string;
let store: MnemeStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-test-"));
  store = new MnemeStore(join(tmpDir, "mneme.db"));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const sampleCommit = (over: Partial<Commit> = {}): Commit => ({
  hash: "a".repeat(40),
  shortHash: "aaaaaaa",
  authorName: "Alice",
  authorEmail: "a@x.io",
  authorDate: "2025-01-01T00:00:00Z",
  committerDate: "2025-01-01T00:00:00Z",
  subject: "first commit",
  body: "the body",
  parents: [],
  files: ["src/foo.ts"],
  prNumber: 42,
  prTitle: "Add foo",
  prBody: "fixes the foo bug",
  issueRefs: ["GH-1"],
  ...over,
});

describe("MnemeStore — schema + roundtrip", () => {
  it("initializes with schema_version meta key", () => {
    expect(store.getMeta("schema_version")).toBe("4");
  });

  it("upserts and retrieves a commit losslessly", () => {
    const c = sampleCommit();
    store.upsertCommits([c]);
    store.upsertFileChanges([
      { commitHash: c.hash, path: "src/foo.ts", changeKind: "M", insertions: 5, deletions: 2 },
    ]);
    const got = store.getCommit(c.hash);
    expect(got).toBeDefined();
    expect(got!.subject).toBe(c.subject);
    expect(got!.prNumber).toBe(42);
    expect(got!.issueRefs).toEqual(["GH-1"]);
    expect(got!.files).toEqual(["src/foo.ts"]);
  });

  it("upsert is idempotent", () => {
    const c = sampleCommit();
    store.upsertCommits([c, c, c]);
    expect(store.countCommits()).toBe(1);
  });

  it("counts chunks correctly", () => {
    const c = sampleCommit();
    store.upsertCommits([c]);
    const chunks: CommitChunk[] = [
      { id: "1", commitHash: c.hash, kind: "subject", text: "alpha bravo" },
      { id: "2", commitHash: c.hash, kind: "body", text: "charlie delta" },
    ];
    store.upsertChunks(chunks);
    expect(store.countChunks()).toBe(2);
    expect(store.countChunksWithEmbedding()).toBe(0);
  });

  it("roundtrips Float32 embeddings", () => {
    const c = sampleCommit();
    store.upsertCommits([c]);
    const vec = Float32Array.from([0.1, -0.2, 0.3, 0.4]);
    store.upsertChunks(
      [{ id: "1", commitHash: c.hash, kind: "subject", text: "hi", embedding: vec }],
      "test-model",
    );
    expect(store.countChunksWithEmbedding()).toBe(1);
    const all = Array.from(store.iterEmbeddedChunks());
    expect(all).toHaveLength(1);
    expect(Array.from(all[0]!.vec)).toEqual(Array.from(vec));
  });

  it("FTS search returns chunks containing query terms", () => {
    const c = sampleCommit();
    store.upsertCommits([c]);
    store.upsertChunks([
      { id: "1", commitHash: c.hash, kind: "subject", text: "fix stripe webhook crash" },
      { id: "2", commitHash: c.hash, kind: "body", text: "totally unrelated topic" },
    ]);
    const hits = store.ftsSearch("stripe webhook", 10);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.id).toBe("1");
  });

  it("FTS sanitizes user input (no SQL syntax injection)", () => {
    const c = sampleCommit();
    store.upsertCommits([c]);
    store.upsertChunks([
      { id: "1", commitHash: c.hash, kind: "subject", text: "alpha" },
    ]);
    expect(() => store.ftsSearch('"; DROP TABLE chunks; --', 10)).not.toThrow();
  });

  it("stores and retrieves incidents", () => {
    const inc: Incident = {
      id: "INC-1",
      source: "manual",
      title: "Stripe webhook 500",
      occurredAt: "2025-01-15T10:00:00Z",
      severity: "error",
      affectedFiles: ["src/foo.ts"],
    };
    store.upsertIncidents([inc]);
    const row = store.db.prepare("SELECT * FROM incidents WHERE id = ?").get("INC-1") as
      | Record<string, unknown>
      | undefined;
    expect(row).toBeDefined();
    expect(row!.title).toBe("Stripe webhook 500");
    expect(JSON.parse(row!.affected_files as string)).toEqual(["src/foo.ts"]);
  });

  it("stores correlations with weight + reason", () => {
    store.upsertCorrelations([
      {
        id: "C1",
        fromKind: "commit",
        fromId: "abc",
        toKind: "incident",
        toId: "INC-1",
        weight: 0.82,
        reason: "file overlap + temporal",
        evidence: ["abc", "INC-1"],
      },
    ]);
    const row = store.db.prepare("SELECT * FROM correlations WHERE id = ?").get("C1") as
      | Record<string, unknown>
      | undefined;
    expect(row!.weight).toBeCloseTo(0.82, 6);
    expect(JSON.parse(row!.evidence as string)).toEqual(["abc", "INC-1"]);
  });
});
