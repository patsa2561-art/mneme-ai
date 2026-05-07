import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MnemeStore } from "../store/sqlite.js";
import { upsertAbstract } from "../htc/storage.js";
import type { Commit } from "../types.js";
import { generateProbes, gradeResponses } from "./index.js";

let tmpDir: string;
let store: MnemeStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-adversarial-grade-"));
  store = new MnemeStore(join(tmpDir, "mneme.db"));
  for (let i = 0; i < 6; i++) {
    const hash = `feed${i.toString().padStart(4, "0")}cafebabe1234`;
    const c: Commit = {
      hash,
      shortHash: hash.slice(0, 7),
      authorName: "Alice",
      authorEmail: "alice@x.io",
      authorDate: "2024-01-01T00:00:00.000Z",
      committerDate: "2024-01-01T00:00:00.000Z",
      subject: `feat: thing ${i}`,
      body: "",
      parents: [],
      files: [`src/f${i}.ts`],
    };
    store.upsertCommits([c]);
    store.upsertFileChanges([
      { commitHash: hash, path: `src/f${i}.ts`, changeKind: "M", insertions: 1, deletions: 0 },
    ]);
    upsertAbstract(store, {
      hash,
      abstract: `Added the ${i}th feature with new caching`,
      tokenCount: 10,
      generatedAt: "2024-02-01T00:00:00.000Z",
      generator: "test",
      generationMs: 0,
    });
  }
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

describe("adversarial/gradeResponses", () => {
  it("scores 100% when every response is correct", () => {
    const b = generateProbes(store, { probes: 6, seed: "grade-ok" });
    const responses = b.probes.map((p) => ({
      id: p.id,
      verdict: (b.answerKey[p.id] === "truth" ? "true" : "false") as "true" | "false",
    }));
    const r = gradeResponses(b, { responses });
    expect(r.trustScore).toBe(100);
    expect(r.correctProbes).toBe(6);
    expect(r.missed).toEqual([]);
  });

  it("scores 0% when every response is wrong", () => {
    const b = generateProbes(store, { probes: 6, seed: "grade-bad" });
    const responses = b.probes.map((p) => ({
      id: p.id,
      verdict: (b.answerKey[p.id] === "truth" ? "false" : "true") as "true" | "false",
    }));
    const r = gradeResponses(b, { responses });
    expect(r.trustScore).toBe(0);
    expect(r.correctProbes).toBe(0);
    expect(r.missed.length).toBe(6);
  });

  it("counts 'uncertain' on a lie as a miss", () => {
    const b = generateProbes(store, { probes: 6, seed: "grade-uncertain" });
    const responses = b.probes.map((p) => ({
      id: p.id,
      // Truth → "true" (correct). Lies → "uncertain" (must be marked false; counts as miss).
      verdict:
        b.answerKey[p.id] === "truth"
          ? ("true" as const)
          : ("uncertain" as const),
    }));
    const r = gradeResponses(b, { responses });
    // Only the 2 truth probes scored; 4 lies missed.
    expect(r.correctProbes).toBe(2);
    expect(r.missed.length).toBe(4);
    expect(r.trustScore).toBe(Math.round((2 / 6) * 100));
  });

  it("treats a missing response as 'uncertain'", () => {
    const b = generateProbes(store, { probes: 6, seed: "grade-missing" });
    const r = gradeResponses(b, { responses: [] });
    // Truth probes need "true"; absent → "uncertain" → all missed.
    expect(r.correctProbes).toBe(0);
    expect(r.missed.length).toBe(6);
  });

  it("rolls per-variant subtotals", () => {
    const b = generateProbes(store, { probes: 6, seed: "grade-variants" });
    const responses = b.probes.map((p) => ({
      id: p.id,
      verdict: (b.answerKey[p.id] === "truth" ? "true" : "false") as "true" | "false",
    }));
    const r = gradeResponses(b, { responses });
    expect(r.perVariant.truth.total).toBe(2);
    expect(r.perVariant["subtle-lie"].total).toBe(2);
    expect(r.perVariant["wholesale-lie"].total).toBe(2);
    expect(r.perVariant.truth.correct).toBe(2);
  });

  it("includes plain-English summary text", () => {
    const b = generateProbes(store, { probes: 6, seed: "grade-summary" });
    const responses = b.probes.map((p) => ({
      id: p.id,
      verdict: (b.answerKey[p.id] === "truth" ? "true" : "false") as "true" | "false",
    }));
    const r = gradeResponses(b, { responses });
    expect(r.summary).toContain("100%");
    expect(r.summary).toContain("trustworthy");
  });

  it("returns 0% trust on an empty bundle", () => {
    const empty = {
      generatedAt: "2024-01-01T00:00:00.000Z",
      repo: { commitsAvailable: 0 },
      probes: [],
      answerKey: {},
      instructions: "",
    };
    const r = gradeResponses(empty, { responses: [] });
    expect(r.trustScore).toBe(0);
    expect(r.totalProbes).toBe(0);
    expect(r.summary).toContain("empty");
  });

  it("ignores duplicate responses (last wins)", () => {
    const b = generateProbes(store, { probes: 3, seed: "grade-dup" });
    const probe = b.probes[0]!;
    const responses = [
      { id: probe.id, verdict: "false" as const },
      // Last one wins:
      { id: probe.id, verdict: (b.answerKey[probe.id] === "truth" ? "true" : "false") as "true" | "false" },
    ];
    const r = gradeResponses(b, { responses });
    // probe correctly graded; remaining 2 default to "uncertain" → both missed.
    expect(r.correctProbes).toBe(b.answerKey[probe.id] === "truth" ? 1 : 1);
  });
});
