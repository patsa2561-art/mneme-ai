import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MnemeStore } from "../store/sqlite.js";
import { computeDelta, computeGamma, computeTheta, computeGreeks } from "./greek.js";
import type { Commit } from "../types.js";

let tmpDir: string;
let store: MnemeStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-greek-"));
  store = new MnemeStore(join(tmpDir, "mneme.db"));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const cmt = (hash: string, author: string, date: string, subject: string, files: string[]): Commit => ({
  hash,
  shortHash: hash.slice(0, 7),
  authorName: author,
  authorEmail: `${author}@x`,
  authorDate: `${date}T00:00:00Z`,
  committerDate: `${date}T00:00:00Z`,
  subject,
  body: "",
  parents: [],
  files,
});

function seed(commits: Commit[]) {
  store.upsertCommits(commits);
  for (const c of commits) {
    store.upsertFileChanges(
      c.files.map((f) => ({ commitHash: c.hash, path: f, changeKind: "M" as const, insertions: 1, deletions: 0 })),
    );
  }
}

describe("computeDelta — knowledge loss per top contributor", () => {
  it("flags author who owns ≥ 75% of a file", () => {
    seed([
      cmt("a1", "alice", "2024-08-01", "x", ["src/auth.ts"]),
      cmt("a2", "alice", "2024-08-02", "x", ["src/auth.ts"]),
      cmt("a3", "alice", "2024-08-03", "x", ["src/auth.ts"]),
      cmt("b1", "bob", "2024-08-04", "x", ["src/auth.ts"]),
    ]);
    const result = computeDelta(store);
    const alice = result.find((d) => d.name === "alice");
    expect(alice).toBeDefined();
    expect(alice!.ownedFiles).toContain("src/auth.ts");
  });

  it("does NOT flag when no author dominates ≥ 75%", () => {
    seed([
      cmt("a1", "alice", "2024-08-01", "x", ["src/x.ts"]),
      cmt("a2", "alice", "2024-08-02", "x", ["src/x.ts"]),
      cmt("b1", "bob", "2024-08-03", "x", ["src/x.ts"]),
      cmt("b2", "bob", "2024-08-04", "x", ["src/x.ts"]),
    ]);
    const result = computeDelta(store);
    expect(result.length === 0 || result.every((r) => !r.ownedFiles.includes("src/x.ts"))).toBe(true);
  });

  it("computes knowledgeLossPct as fraction of total files", () => {
    seed([
      cmt("a1", "alice", "2024-08-01", "x", ["src/a.ts"]),
      cmt("a2", "alice", "2024-08-02", "x", ["src/a.ts"]),
      cmt("a3", "alice", "2024-08-03", "x", ["src/a.ts"]),
      cmt("b1", "bob", "2024-08-04", "x", ["src/b.ts"]),
    ]);
    const result = computeDelta(store);
    const alice = result.find((d) => d.name === "alice")!;
    // alice owns 1 of 2 total files = 50%
    expect(alice.knowledgeLossPct).toBe(50);
  });

  it("respects topN cap", () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 30; i++) {
      const day = String((i % 28) + 1).padStart(2, "0");
      commits.push(cmt(`a${i}`.padEnd(7, "x"), `dev${i}`, `2024-08-${day}`, "x", [`f${i}.ts`]));
    }
    seed(commits);
    expect(computeDelta(store, { topN: 5 }).length).toBeLessThanOrEqual(5);
  });
});

describe("computeGamma — risk acceleration via linear regression", () => {
  it("returns 0 with helpful message when too few weeks", () => {
    seed([cmt("a1", "alice", "2024-08-01", "feat: x", [])]);
    const g = computeGamma(store);
    expect(g.weeks).toBeLessThanOrEqual(1);
    expect(g.interpretation.toLowerCase()).toMatch(/no commits|need|few/);
  });

  it("super-linear interpretation when slope > 0.3", () => {
    // Construct weeks where fix count grows fast with total
    const commits: Commit[] = [];
    // Week 1: 2 commits, 0 fixes
    commits.push(cmt("c1", "a", "2024-01-01", "feat: x", []));
    commits.push(cmt("c2", "a", "2024-01-02", "feat: y", []));
    // Week 2: 4 commits, 1 fix
    commits.push(cmt("c3", "a", "2024-01-08", "feat: 1", []));
    commits.push(cmt("c4", "a", "2024-01-09", "feat: 2", []));
    commits.push(cmt("c5", "a", "2024-01-10", "feat: 3", []));
    commits.push(cmt("c6", "a", "2024-01-11", "fix: 1", []));
    // Week 3: 8 commits, 4 fixes
    for (let i = 0; i < 4; i++) commits.push(cmt(`f${i}`.padEnd(7, "x"), "a", `2024-01-${15 + i}`, "feat", []));
    for (let i = 0; i < 4; i++) commits.push(cmt(`x${i}`.padEnd(7, "x"), "a", `2024-01-${15 + i}`, "fix: y", []));
    seed(commits);
    const g = computeGamma(store);
    expect(g.weeks).toBeGreaterThanOrEqual(3);
    expect(g.riskAcceleration).toBeGreaterThan(0);
  });
});

describe("computeTheta — time decay / stale files", () => {
  it("counts files untouched for ≥ 6 months", () => {
    seed([
      cmt("a1", "alice", "2024-01-01", "x", ["src/legacy.ts"]),
      cmt("a2", "alice", "2024-08-01", "x", ["src/active.ts"]),
    ]);
    const theta = computeTheta(store, { now: new Date("2024-12-01T00:00:00Z") });
    expect(theta.staleFiles).toBe(1);
    expect(theta.avgStaleDays).toBeGreaterThan(180);
  });

  it("returns zero when all files are recently touched", () => {
    seed([
      cmt("a1", "alice", "2024-11-01", "x", ["src/x.ts"]),
      cmt("a2", "alice", "2024-11-02", "x", ["src/y.ts"]),
    ]);
    const theta = computeTheta(store, { now: new Date("2024-12-01T00:00:00Z") });
    expect(theta.staleFiles).toBe(0);
    expect(theta.interpretation.toLowerCase()).toMatch(/recently|no stale/);
  });
});

describe("computeGreeks — composite report", () => {
  it("returns all three (delta, gamma, theta)", () => {
    seed([cmt("a1", "alice", "2024-08-01", "feat: x", ["src/x.ts"])]);
    const r = computeGreeks(store);
    expect(r.delta).toBeDefined();
    expect(r.gamma).toBeDefined();
    expect(r.theta).toBeDefined();
  });
});
