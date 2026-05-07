import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MnemeStore } from "../store/sqlite.js";
import {
  atrophy,
  atrophyForAuthor,
  atrophyForFile,
  explainKnowledge,
  knowledgeScore,
} from "./atrophy.js";
import type { Commit } from "../types.js";

let tmpDir: string;
let store: MnemeStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-atrophy-test-"));
  store = new MnemeStore(join(tmpDir, "mneme.db"));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function cmt(hash: string, author: string, isoDate: string, files: string[]): Commit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    authorName: author,
    authorEmail: `${author}@x`,
    authorDate: isoDate,
    committerDate: isoDate,
    subject: `commit by ${author}`,
    body: "",
    parents: [],
    files,
  };
}

function seed(commits: Commit[]) {
  store.upsertCommits(commits);
  for (const c of commits) {
    if (c.files.length === 0) continue;
    store.upsertFileChanges(
      c.files.map((f) => ({
        commitHash: c.hash,
        path: f,
        changeKind: "M" as const,
        insertions: 1,
        deletions: 0,
      })),
    );
  }
}

// ─── decay math ────────────────────────────────────────────────────────

describe("knowledgeScore", () => {
  it("returns 0 when half-life is non-positive", () => {
    expect(knowledgeScore(10, 5, 0)).toBe(0);
    expect(knowledgeScore(10, 5, -3)).toBe(0);
  });

  it("decays by ~half over one half-life", () => {
    // With infinite touches the familiarity factor approaches 1.
    const fresh = knowledgeScore(0, 100, 180);
    const oneHalfLife = knowledgeScore(180, 100, 180);
    expect(oneHalfLife).toBeLessThan(fresh);
    // ~0.5× the fresh score.
    expect(oneHalfLife / fresh).toBeGreaterThan(0.45);
    expect(oneHalfLife / fresh).toBeLessThan(0.55);
  });

  it("decays by ~quarter over two half-lives", () => {
    const fresh = knowledgeScore(0, 100, 180);
    const two = knowledgeScore(360, 100, 180);
    expect(two / fresh).toBeGreaterThan(0.20);
    expect(two / fresh).toBeLessThan(0.30);
  });

  it("scales with touch count (saturates near 1)", () => {
    const oneTouch = knowledgeScore(0, 1, 180);
    const tenTouch = knowledgeScore(0, 10, 180);
    expect(oneTouch).toBeLessThan(tenTouch);
    expect(tenTouch).toBeLessThanOrEqual(1);
  });

  it("clamps to [0, 1]", () => {
    const s = knowledgeScore(0, 9999, 180);
    expect(s).toBeLessThanOrEqual(1);
    expect(s).toBeGreaterThanOrEqual(0);
  });

  it("returns 0 for negative inputs", () => {
    expect(knowledgeScore(-10, 5, 180)).toBeGreaterThan(0); // negative days clamped
    expect(knowledgeScore(10, -5, 180)).toBeGreaterThanOrEqual(0); // negative touches clamped
  });
});

describe("explainKnowledge", () => {
  it("describes fresh knowledge in plain English", () => {
    expect(explainKnowledge(0.97)).toMatch(/ready|strong/i);
    expect(explainKnowledge(0.8)).toMatch(/strong/i);
    expect(explainKnowledge(0.5)).toMatch(/refresh/i);
    expect(explainKnowledge(0.4)).toMatch(/re-reading/i);
    expect(explainKnowledge(0.05)).toMatch(/ghosted|onboarding/i);
  });
});

// ─── repo-wide report ──────────────────────────────────────────────────

describe("atrophy — repo-wide report", () => {
  it("returns empty arrays on an empty repo", () => {
    const r = atrophy(store);
    expect(r.authors).toEqual([]);
    expect(r.atRiskFiles).toEqual([]);
    expect(r.stats.totalCommits).toBe(0);
    expect(r.stats.fileCount).toBe(0);
  });

  it("ranks authors by knowledge mass", () => {
    seed([
      cmt("a1aaaaaa", "alice", "2024-04-01T00:00:00Z", ["src/auth.ts", "src/api.ts"]),
      cmt("a2aaaaaa", "alice", "2024-04-15T00:00:00Z", ["src/auth.ts"]),
      cmt("a3aaaaaa", "alice", "2024-05-01T00:00:00Z", ["src/auth.ts"]),
      cmt("b1bbbbbb", "bob",   "2024-04-10T00:00:00Z", ["src/billing.ts"]),
    ]);
    const r = atrophy(store, { halfLifeDays: 180, asOf: "2024-06-01T00:00:00Z" });
    expect(r.authors[0]!.email).toBe("alice@x");
    expect(r.authors[0]!.knowledgeMass).toBeGreaterThan(r.authors[1]!.knowledgeMass);
  });

  it("flags at-risk files with no live expert", () => {
    // Old touches → all knowledge ghosted.
    seed([
      cmt("o1oooooo", "alice", "2020-01-01T00:00:00Z", ["legacy/parser.ts"]),
      cmt("o2oooooo", "bob",   "2020-02-01T00:00:00Z", ["legacy/parser.ts"]),
    ]);
    const r = atrophy(store, { halfLifeDays: 90, asOf: "2024-06-01T00:00:00Z" });
    const parser = r.atRiskFiles.find((f) => f.filePath === "legacy/parser.ts");
    expect(parser).toBeDefined();
    expect(parser!.tier).toBe("at-risk");
    expect(parser!.liveExperts.length).toBe(0);
  });

  it("classifies tiers by freshest knowledge", () => {
    // src/fresh.ts: 12 recent touches by alice — saturates familiarity → safe.
    const freshCommits: Commit[] = [];
    for (let i = 0; i < 12; i++) {
      const day = String(18 + i).padStart(2, "0");
      freshCommits.push(cmt(`f${i}ffffff`, "alice", `2024-05-${day}T00:00:00Z`, ["src/fresh.ts"]));
    }
    seed([
      ...freshCommits,
      // Warm — 6 months ago, 1 touch each.
      cmt("w1wwwwww", "bob",   "2023-12-01T00:00:00Z", ["src/warm.ts"]),
      cmt("w2wwwwww", "bob",   "2023-12-15T00:00:00Z", ["src/warm.ts"]),
      // At-risk — 3 years ago.
      cmt("r1rrrrrr", "carol", "2021-01-01T00:00:00Z", ["src/old.ts"]),
    ]);
    const r = atrophy(store, { halfLifeDays: 180, asOf: "2024-06-01T00:00:00Z" });
    const old = r.atRiskFiles.find((f) => f.filePath === "src/old.ts");
    expect(old?.tier).toBe("at-risk");
    // src/fresh.ts should NOT be in atRiskFiles (it's safe).
    expect(r.atRiskFiles.find((f) => f.filePath === "src/fresh.ts")).toBeUndefined();
  });

  it("respects custom half-life", () => {
    seed([
      cmt("h1hhhhhh", "alice", "2024-01-01T00:00:00Z", ["src/a.ts"]),
      cmt("h2hhhhhh", "alice", "2024-01-15T00:00:00Z", ["src/a.ts"]),
    ]);
    const slow = atrophy(store, { halfLifeDays: 365, asOf: "2024-06-01T00:00:00Z" });
    const fast = atrophy(store, { halfLifeDays: 30, asOf: "2024-06-01T00:00:00Z" });
    expect(slow.authors[0]!.knowledgeMass).toBeGreaterThan(
      fast.authors[0]!.knowledgeMass,
    );
  });

  it("excludes lockfiles by default", () => {
    seed([
      cmt("l1llllll", "alice", "2024-05-01T00:00:00Z", ["package-lock.json"]),
      cmt("l2llllll", "bob",   "2024-05-02T00:00:00Z", ["src/auth.ts"]),
    ]);
    const r = atrophy(store, { asOf: "2024-06-01T00:00:00Z" });
    expect(r.atRiskFiles.find((f) => f.filePath === "package-lock.json")).toBeUndefined();
    // src/auth.ts may or may not be in atRiskFiles depending on tier.
    const allFiles = [...r.atRiskFiles.map((f) => f.filePath)];
    expect(allFiles).not.toContain("package-lock.json");
  });

  it("populates stats fields", () => {
    seed([
      cmt("p1pppppp", "alice", "2024-05-01T00:00:00Z", ["src/a.ts"]),
      cmt("p2pppppp", "bob",   "2024-05-02T00:00:00Z", ["src/b.ts"]),
    ]);
    const r = atrophy(store, { halfLifeDays: 180, asOf: "2024-06-01T00:00:00Z" });
    expect(r.stats.totalCommits).toBe(2);
    expect(r.stats.fileCount).toBe(2);
    expect(r.stats.authorCount).toBe(2);
    expect(r.stats.halfLifeDays).toBe(180);
    expect(typeof r.stats.asOf).toBe("string");
    expect(r.stats.filesWithLiveExpert + r.stats.ghostedFiles).toBe(2);
    expect(r.stats.ghostedDeepFiles + r.stats.shallowFiles).toBe(r.stats.ghostedFiles);
  });

  it("distinguishes ghosted-deep (≥2 touches lost) from shallow (1 touch only)", () => {
    seed([
      // Deep, then ghosted: 3 touches in 2020.
      cmt("d1dddddd", "alice", "2020-01-01T00:00:00Z", ["legacy/parser.ts"]),
      cmt("d2dddddd", "alice", "2020-02-01T00:00:00Z", ["legacy/parser.ts"]),
      cmt("d3dddddd", "alice", "2020-03-01T00:00:00Z", ["legacy/parser.ts"]),
      // Shallow: 1 touch, recent — knowledge_score is low (only 0.18) but it's "shallow", not "ghost".
      cmt("s1ssssss", "bob",   "2024-05-30T00:00:00Z", ["src/single.ts"]),
    ]);
    const r = atrophy(store, { halfLifeDays: 90, asOf: "2024-06-01T00:00:00Z" });
    expect(r.stats.ghostedDeepFiles).toBe(1); // legacy/parser.ts
    // src/single.ts: 1 touch, 0.18 score -> at-risk + shallow.
    expect(r.stats.shallowFiles).toBe(1);
  });
});

// ─── per-author drill-down ────────────────────────────────────────────

describe("atrophyForAuthor", () => {
  it("returns null for an author with no commits", () => {
    seed([cmt("n1nnnnnn", "alice", "2024-05-01T00:00:00Z", ["src/a.ts"])]);
    expect(atrophyForAuthor(store, "ghost@x")).toBeNull();
  });

  it("returns top-N files for the author, knowledge desc", () => {
    seed([
      cmt("a1aaaaaa", "alice", "2024-05-30T00:00:00Z", ["src/fresh.ts"]),
      cmt("a2aaaaaa", "alice", "2024-05-30T00:00:00Z", ["src/fresh.ts"]),
      cmt("a3aaaaaa", "alice", "2023-01-01T00:00:00Z", ["src/old.ts"]),
    ]);
    const r = atrophyForAuthor(store, "alice@x", {
      halfLifeDays: 180,
      asOf: "2024-06-01T00:00:00Z",
    });
    expect(r).not.toBeNull();
    expect(r!.topFiles.length).toBe(2);
    expect(r!.topFiles[0]!.filePath).toBe("src/fresh.ts");
    expect(r!.topFiles[0]!.knowledge).toBeGreaterThanOrEqual(r!.topFiles[1]!.knowledge);
  });

  it("classifies bands (fresh / warm / fading / ghosted)", () => {
    const freshCommits: Commit[] = [];
    for (let i = 0; i < 12; i++) {
      freshCommits.push(
        cmt(
          `b${i.toString(16)}bbbbbb`,
          "alice",
          `2024-05-${String(18 + i).padStart(2, "0")}T00:00:00Z`,
          ["src/fresh.ts"],
        ),
      );
    }
    seed([
      ...freshCommits,
      cmt("c1cccccc", "alice", "2020-01-01T00:00:00Z", ["src/ghost.ts"]),
    ]);
    const r = atrophyForAuthor(store, "alice@x", {
      halfLifeDays: 180,
      asOf: "2024-06-01T00:00:00Z",
    });
    const fresh = r!.topFiles.find((f) => f.filePath === "src/fresh.ts");
    const ghost = r!.topFiles.find((f) => f.filePath === "src/ghost.ts");
    expect(fresh?.band).toBe("fresh");
    expect(ghost?.band).toBe("ghosted");
  });
});

// ─── per-file drill-down ──────────────────────────────────────────────

describe("atrophyForFile", () => {
  it("returns null for an unknown file", () => {
    seed([cmt("n1nnnnnn", "alice", "2024-05-01T00:00:00Z", ["src/a.ts"])]);
    expect(atrophyForFile(store, "src/missing.ts")).toBeNull();
  });

  it("lists experts sorted by current knowledge desc", () => {
    seed([
      cmt("a1aaaaaa", "alice", "2024-05-30T00:00:00Z", ["src/auth.ts"]),
      cmt("b1bbbbbb", "bob",   "2024-01-01T00:00:00Z", ["src/auth.ts"]),
    ]);
    const r = atrophyForFile(store, "src/auth.ts", {
      halfLifeDays: 180,
      asOf: "2024-06-01T00:00:00Z",
    });
    expect(r).not.toBeNull();
    expect(r!.allKnowers[0]!.email).toBe("alice@x"); // fresher
    expect(r!.allKnowers[0]!.knowledge).toBeGreaterThanOrEqual(r!.allKnowers[1]!.knowledge);
  });

  it("classifies tier from freshest knowledge", () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 12; i++) {
      commits.push(
        cmt(
          `f${i.toString(16)}ffffff`,
          "alice",
          `2024-05-${String(18 + i).padStart(2, "0")}T00:00:00Z`,
          ["src/x.ts"],
        ),
      );
    }
    seed(commits);
    const r = atrophyForFile(store, "src/x.ts", {
      halfLifeDays: 180,
      asOf: "2024-06-01T00:00:00Z",
    });
    expect(r!.tier).toBe("safe");
  });
});

// ─── JSON shape ───────────────────────────────────────────────────────

describe("atrophy — JSON shape stability", () => {
  it("report shape is stable for json mode consumers", () => {
    seed([
      cmt("j1jjjjjj", "alice", "2024-05-01T00:00:00Z", ["src/a.ts"]),
      cmt("j2jjjjjj", "bob",   "2024-05-02T00:00:00Z", ["src/b.ts"]),
    ]);
    const r = atrophy(store, { halfLifeDays: 180, asOf: "2024-06-01T00:00:00Z" });
    expect(r).toHaveProperty("authors");
    expect(r).toHaveProperty("atRiskFiles");
    expect(r).toHaveProperty("stats.halfLifeDays");
    expect(r).toHaveProperty("stats.asOf");
    expect(r).toHaveProperty("stats.authorCount");
    expect(r).toHaveProperty("stats.fileCount");
    expect(r).toHaveProperty("stats.totalCommits");
    expect(r).toHaveProperty("stats.filesWithLiveExpert");
    expect(r).toHaveProperty("stats.ghostedFiles");
    if (r.authors.length > 0) {
      const a = r.authors[0]!;
      expect(a).toHaveProperty("name");
      expect(a).toHaveProperty("email");
      expect(a).toHaveProperty("knowledgeMass");
      expect(a).toHaveProperty("filesKnown");
      expect(a).toHaveProperty("filesStillFresh");
      expect(a).toHaveProperty("lastActiveAt");
    }
  });
});
