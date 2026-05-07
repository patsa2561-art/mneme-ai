import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MnemeStore } from "../store/sqlite.js";
import { upsertAbstract } from "../htc/storage.js";
import type { Commit } from "../types.js";
import {
  generateProbes,
  flipOneWord,
  pickWholesaleLie,
  mulberry32,
  renderProbeMarkdown,
  serializeAnswerKey,
  deserializeAnswerKey,
} from "./index.js";

let tmpDir: string;
let store: MnemeStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-adversarial-"));
  store = new MnemeStore(join(tmpDir, "mneme.db"));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function seedCommit(hash: string, subject: string, files: string[]): Commit {
  const c: Commit = {
    hash,
    shortHash: hash.slice(0, 7),
    authorName: "Alice",
    authorEmail: "alice@x.io",
    authorDate: "2024-01-01T00:00:00.000Z",
    committerDate: "2024-01-01T00:00:00.000Z",
    subject,
    body: "",
    parents: [],
    files,
  };
  store.upsertCommits([c]);
  store.upsertFileChanges(
    files.map((f) => ({
      commitHash: hash,
      path: f,
      changeKind: "M" as const,
      insertions: 1,
      deletions: 0,
    })),
  );
  return c;
}

function seedAbstract(hash: string, abstract: string): void {
  upsertAbstract(store, {
    hash,
    abstract,
    tokenCount: Math.ceil(abstract.length / 4),
    generatedAt: "2024-02-01T00:00:00.000Z",
    generator: "test",
    generationMs: 0,
  });
}

describe("adversarial/mulberry32 — deterministic PRNG", () => {
  it("produces the same sequence for the same seed", () => {
    const a = mulberry32("seed");
    const b = mulberry32("seed");
    for (let i = 0; i < 5; i++) expect(a()).toBeCloseTo(b(), 10);
  });

  it("produces different sequences for different seeds", () => {
    const a = mulberry32("alpha");
    const b = mulberry32("beta");
    let same = 0;
    for (let i = 0; i < 5; i++) if (Math.abs(a() - b()) < 1e-9) same++;
    expect(same).toBeLessThan(5);
  });
});

describe("adversarial/flipOneWord", () => {
  it("flips 'added' to 'removed' (case-preserving)", () => {
    const r = flipOneWord("Added retry handler", () => 0);
    expect(r).not.toBeNull();
    expect(r!.flipped).toBe("Removed retry handler");
  });

  it("flips 'fixed' to 'broke'", () => {
    const r = flipOneWord("fixed a regression in db.ts", () => 0);
    expect(r).not.toBeNull();
    expect(r!.flipped).toContain("broke");
  });

  it("returns null when no flip word is present", () => {
    const r = flipOneWord("the quick brown fox jumps", () => 0);
    expect(r).toBeNull();
  });

  it("preserves uppercase casing", () => {
    const r = flipOneWord("ADDED a flag", () => 0);
    expect(r).not.toBeNull();
    expect(r!.flipped).toContain("REMOVED");
  });
});

describe("adversarial/pickWholesaleLie", () => {
  it("returns a non-empty string", () => {
    const lie = pickWholesaleLie(() => 0);
    expect(typeof lie).toBe("string");
    expect(lie.length).toBeGreaterThan(10);
  });
});

describe("adversarial/generateProbes — empty store", () => {
  it("returns an empty bundle when no abstracts exist", () => {
    const b = generateProbes(store, { probes: 9 });
    expect(b.probes.length).toBe(0);
    expect(b.repo.commitsAvailable).toBe(0);
    expect(b.instructions).toContain("HTC index is empty");
  });
});

describe("adversarial/generateProbes — happy path", () => {
  beforeEach(() => {
    for (let i = 0; i < 8; i++) {
      const hash = `abc${i.toString().padStart(5, "0")}deadbeef`;
      seedCommit(hash, `feat: thing ${i}`, [`src/file${i}.ts`]);
      seedAbstract(hash, `Added feature ${i} with new flag`);
    }
  });

  it("returns the requested number of probes (rounded down to multiple of 3)", () => {
    const b = generateProbes(store, { probes: 9, seed: "test" });
    expect(b.probes.length).toBe(9);
  });

  it("rounds odd counts down — 10 → 9, 11 → 9, 12 → 12", () => {
    expect(generateProbes(store, { probes: 10, seed: "x" }).probes.length).toBe(9);
    expect(generateProbes(store, { probes: 11, seed: "x" }).probes.length).toBe(9);
    expect(generateProbes(store, { probes: 12, seed: "x" }).probes.length).toBe(12);
  });

  it("includes equal counts of each variant in the answer key", () => {
    const b = generateProbes(store, { probes: 9, seed: "balanced" });
    const counts = { truth: 0, "subtle-lie": 0, "wholesale-lie": 0 };
    for (const v of Object.values(b.answerKey)) counts[v]++;
    expect(counts.truth).toBe(3);
    expect(counts["subtle-lie"]).toBe(3);
    expect(counts["wholesale-lie"]).toBe(3);
  });

  it("is deterministic with a fixed seed", () => {
    const a = generateProbes(store, { probes: 6, seed: "fixed" });
    const b = generateProbes(store, { probes: 6, seed: "fixed" });
    expect(a.probes.map((p) => p.id)).toEqual(b.probes.map((p) => p.id));
    expect(a.probes.map((p) => p.claim)).toEqual(b.probes.map((p) => p.claim));
  });

  it("attaches commit timestamp + file sample to each probe", () => {
    const b = generateProbes(store, { probes: 6, seed: "ctx" });
    for (const p of b.probes) {
      expect(p.timestamp).toBe("2024-01-01T00:00:00.000Z");
      expect(p.filesSample.length).toBeGreaterThan(0);
      expect(p.shortHash.length).toBe(7);
    }
  });

  it("truth probes echo the original abstract verbatim", () => {
    const b = generateProbes(store, { probes: 6, seed: "truthy" });
    for (const p of b.probes) {
      if (b.answerKey[p.id] === "truth") {
        expect(p.claim).toBe(p.originalAbstract);
      }
    }
  });

  it("wholesale-lie probes do not equal the original abstract", () => {
    const b = generateProbes(store, { probes: 9, seed: "fake" });
    for (const p of b.probes) {
      if (b.answerKey[p.id] === "wholesale-lie") {
        expect(p.claim).not.toBe(p.originalAbstract);
      }
    }
  });

  it("renders to markdown with one section per probe", () => {
    const b = generateProbes(store, { probes: 6, seed: "md" });
    const md = renderProbeMarkdown(b);
    expect(md).toContain("# Mneme adversarial probes");
    for (const p of b.probes) {
      expect(md).toContain(`### ${p.id}`);
    }
    expect(md).toContain("Save the following as `responses.json`");
  });

  it("serializes + deserializes the answer key losslessly", () => {
    const b = generateProbes(store, { probes: 6, seed: "rt" });
    const json = serializeAnswerKey(b);
    const back = deserializeAnswerKey(json);
    expect(back.probes.length).toBe(b.probes.length);
    expect(back.answerKey).toEqual(b.answerKey);
  });

  it("rejects malformed answer-key JSON", () => {
    expect(() => deserializeAnswerKey("{}")).toThrow();
    expect(() => deserializeAnswerKey('{"probes":[]}')).toThrow();
  });
});
