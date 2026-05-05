import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MnemeStore } from "../store/sqlite.js";
import { findHarvestCandidates, classifyHarvestRisk, summarizeHarvest } from "./tax-loss-harvest.js";
import type { Commit } from "../types.js";

let tmpDir: string;
let store: MnemeStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-tlh-"));
  store = new MnemeStore(join(tmpDir, "mneme.db"));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const cmt = (hash: string, date: string, files: string[]): Commit => ({
  hash,
  shortHash: hash.slice(0, 7),
  authorName: "alice",
  authorEmail: "a@x",
  authorDate: `${date}T00:00:00Z`,
  committerDate: `${date}T00:00:00Z`,
  subject: "x",
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

function seedIncident(affectedFiles: string[]) {
  store.db
    .prepare(
      `INSERT INTO incidents (id, source, title, occurred_at, severity, affected_files)
       VALUES (?, 'manual', 'inc', ?, 'medium', ?)`,
    )
    .run(`inc-${Math.random()}`, "2024-01-01T00:00:00Z", JSON.stringify(affectedFiles));
}

describe("classifyHarvestRisk", () => {
  it("'risky' when incidents ≥ 3", () => {
    expect(classifyHarvestRisk(3, 0, 1)).toBe("risky");
  });
  it("'moderate' when entities ≥ 10 OR incidents ≥ 1", () => {
    expect(classifyHarvestRisk(0, 12, 1)).toBe("moderate");
    expect(classifyHarvestRisk(1, 0, 1)).toBe("moderate");
  });
  it("'low-risk' when commits ≥ 4 (some history)", () => {
    expect(classifyHarvestRisk(0, 0, 4)).toBe("low-risk");
  });
  it("'safe' when nothing else applies", () => {
    expect(classifyHarvestRisk(0, 0, 1)).toBe("safe");
  });
});

describe("findHarvestCandidates — basic detection", () => {
  it("returns empty when no files are stale enough", () => {
    seed([cmt("a1", "2024-11-01", ["src/active.ts"])]);
    expect(findHarvestCandidates(store, { now: new Date("2024-12-01"), minStaleDays: 180 })).toEqual([]);
  });

  it("flags a stale solo-touched file as a candidate", () => {
    seed([cmt("a1", "2023-01-01", ["src/legacy.ts"])]);
    const candidates = findHarvestCandidates(store, { now: new Date("2024-12-01") });
    expect(candidates.find((c) => c.filePath === "src/legacy.ts")).toBeDefined();
  });

  it("respects maxCommits filter", () => {
    const commits = Array.from({ length: 10 }, (_, i) =>
      cmt(`a${i}`.padEnd(7, "x"), "2023-01-01", ["src/hot.ts"]),
    );
    seed(commits);
    expect(
      findHarvestCandidates(store, { now: new Date("2024-12-01"), maxCommits: 5 }).find(
        (c) => c.filePath === "src/hot.ts",
      ),
    ).toBeUndefined();
  });

  it("higher harvest score for older + lower-commit files", () => {
    seed([
      cmt("a1", "2020-01-01", ["src/very-old.ts"]),
      cmt("b1", "2023-06-01", ["src/recent-stale.ts"]),
    ]);
    const candidates = findHarvestCandidates(store, { now: new Date("2024-12-01"), minStaleDays: 90 });
    expect(candidates[0]!.filePath).toBe("src/very-old.ts");
  });

  it("'risky' tier when file appears in 3+ incidents", () => {
    seed([cmt("a1", "2023-01-01", ["src/payment.ts"])]);
    seedIncident(["src/payment.ts"]);
    seedIncident(["src/payment.ts"]);
    seedIncident(["src/payment.ts"]);
    const c = findHarvestCandidates(store, { now: new Date("2024-12-01") }).find(
      (x) => x.filePath === "src/payment.ts",
    )!;
    expect(c.risk).toBe("risky");
    expect(c.recommendation.toLowerCase()).toMatch(/risk|past incidents/);
  });
});

describe("summarizeHarvest", () => {
  it("returns zero metrics for empty input", () => {
    const s = summarizeHarvest([]);
    expect(s.candidateCount).toBe(0);
    expect(s.estimatedLinesSaved).toBe(0);
    expect(s.summary.toLowerCase()).toContain("no");
  });

  it("computes net-of-risk savings", () => {
    const candidates = [
      {
        filePath: "src/a.ts",
        daysSinceTouch: 500,
        commitCount: 1,
        entityCount: 0,
        incidentCount: 0,
        harvestScore: 1,
        risk: "safe" as const,
        recommendation: "",
      },
      {
        filePath: "src/b.ts",
        daysSinceTouch: 600,
        commitCount: 1,
        entityCount: 0,
        incidentCount: 4,
        harvestScore: 0.5,
        risk: "risky" as const,
        recommendation: "",
      },
    ];
    const s = summarizeHarvest(candidates);
    expect(s.candidateCount).toBe(2);
    expect(s.estimatedLinesSaved).toBe(100);
    // avg risk = (0.1 + 1) / 2 = 0.55 → net = 100 × (1 - 0.55) = 45
    expect(s.netSavings).toBe(45);
  });
});
