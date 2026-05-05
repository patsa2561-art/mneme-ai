import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MnemeStore } from "../store/sqlite.js";
import { findBlackSwans, classifyBlackSwanTier } from "./black-swan.js";
import type { Commit } from "../types.js";

let tmpDir: string;
let store: MnemeStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-bs-"));
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
  subject: "commit",
  body: "",
  parents: [],
  files,
});

function seedCommits(commits: Commit[]) {
  store.upsertCommits(commits);
  for (const c of commits) {
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

function seedIncident(severity: string, affectedFiles: string[]) {
  store.db
    .prepare(
      `INSERT INTO incidents (id, source, title, occurred_at, severity, affected_files)
       VALUES (?, 'manual', ?, ?, ?, ?)`,
    )
    .run(`inc-${Math.random()}`, "test", "2024-12-01T00:00:00Z", severity, JSON.stringify(affectedFiles));
}

describe("classifyBlackSwanTier", () => {
  it('"deceptive-calm" for high tail risk + few touches + critical severity', () => {
    expect(classifyBlackSwanTier(1.5, 2, 4.5)).toBe("deceptive-calm");
  });

  it('"elevated" for moderate tail risk + medium severity', () => {
    expect(classifyBlackSwanTier(0.6, 5, 3.0)).toBe("elevated");
  });

  it('"watch" for low tail risk', () => {
    expect(classifyBlackSwanTier(0.3, 10, 2.0)).toBe("watch");
  });

  it('"background" for tiny tail risk', () => {
    expect(classifyBlackSwanTier(0.05, 30, 1.5)).toBe("background");
  });
});

describe("findBlackSwans — basic detection", () => {
  it("returns empty array when no incidents are linked to files", () => {
    seedCommits([cmt("a1", "2024-01-01", ["src/x.ts"])]);
    expect(findBlackSwans(store)).toEqual([]);
  });

  it("flags a low-touch + high-severity file as deceptive-calm", () => {
    seedCommits([
      cmt("a1", "2024-01-01", ["src/refund.ts"]),
      cmt("a2", "2024-06-01", ["src/refund.ts"]),
    ]);
    seedIncident("critical", ["src/refund.ts"]);
    seedIncident("critical", ["src/refund.ts"]);

    const candidates = findBlackSwans(store, { now: new Date("2024-12-01T00:00:00Z") });
    const refund = candidates.find((c) => c.filePath === "src/refund.ts");
    expect(refund).toBeDefined();
    expect(refund!.incidentCount).toBe(2);
    expect(refund!.avgSeverity).toBe(5);
    expect(refund!.tier).toBe("deceptive-calm");
  });

  it("respects maxTouches filter — high-traffic files are NOT black swans", () => {
    const commits = Array.from({ length: 100 }, (_, i) =>
      cmt(`a${i}`.padEnd(7, "x"), `2024-${String(((i % 12) + 1)).padStart(2, "0")}-01`, ["src/hot.ts"]),
    );
    seedCommits(commits);
    seedIncident("critical", ["src/hot.ts"]);
    expect(findBlackSwans(store, { maxTouches: 30 }).find((c) => c.filePath === "src/hot.ts")).toBeUndefined();
  });

  it("respects minIncidents filter (default 1)", () => {
    seedCommits([cmt("a1", "2024-01-01", ["src/never-broke.ts"])]);
    // No incident seeded — should be excluded
    expect(findBlackSwans(store).find((c) => c.filePath === "src/never-broke.ts")).toBeUndefined();
  });

  it("sorts by tailRisk descending", () => {
    seedCommits([
      cmt("a1", "2024-01-01", ["src/calm.ts"]),
      cmt("a2", "2024-02-01", ["src/calm.ts"]),
      cmt("b1", "2024-01-01", ["src/medium.ts"]),
      cmt("b2", "2024-02-01", ["src/medium.ts"]),
      cmt("b3", "2024-03-01", ["src/medium.ts"]),
      cmt("b4", "2024-04-01", ["src/medium.ts"]),
      cmt("b5", "2024-05-01", ["src/medium.ts"]),
    ]);
    seedIncident("critical", ["src/calm.ts"]); // severity 5, 2 touches → high tail
    seedIncident("medium", ["src/medium.ts"]); // severity 3, 5 touches → low tail

    const candidates = findBlackSwans(store);
    expect(candidates[0]!.filePath).toBe("src/calm.ts");
  });

  it("respects topN cap", () => {
    for (let i = 0; i < 30; i++) {
      seedCommits([cmt(`x${i}`.padEnd(7, "x"), "2024-01-01", [`src/f${i}.ts`])]);
      seedIncident("critical", [`src/f${i}.ts`]);
    }
    expect(findBlackSwans(store, { topN: 5 }).length).toBeLessThanOrEqual(5);
  });
});

describe("findBlackSwans — recommendation text", () => {
  it("recommends pair-program + canary for low-touch + critical files", () => {
    seedCommits([cmt("a1", "2024-01-01", ["src/refund.ts"])]);
    seedIncident("critical", ["src/refund.ts"]);
    const c = findBlackSwans(store)[0]!;
    expect(c.recommendation.toLowerCase()).toMatch(/pair-program|canary/);
  });

  it("recommends review session for files untouched > 1 year", () => {
    seedCommits([
      cmt("a1", "2022-01-01", ["src/legacy.ts"]),
      cmt("a2", "2022-02-01", ["src/legacy.ts"]),
    ]);
    seedIncident("medium", ["src/legacy.ts"]);
    const c = findBlackSwans(store, { now: new Date("2024-12-01T00:00:00Z") }).find(
      (x) => x.filePath === "src/legacy.ts",
    )!;
    expect(c.recommendation.toLowerCase()).toMatch(/review|untouched/);
  });
});
