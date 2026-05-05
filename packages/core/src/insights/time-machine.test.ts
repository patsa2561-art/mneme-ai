import { describe, it, expect } from "vitest";
import { buildTimeMachine } from "./time-machine.js";
import type { Commit, FileChange } from "../types.js";

function mkCommit(p: Partial<Commit> & { hash: string; authorDate: string; subject: string }): Commit {
  return {
    shortHash: p.hash.slice(0, 7),
    authorName: "Test",
    authorEmail: "t@e.com",
    committerDate: p.authorDate,
    body: p.body ?? "",
    files: ["src/x.ts"],
    parents: p.parents ?? [],
    ...p,
  };
}

function mkChange(commitHash: string, ins: number, del: number): FileChange {
  return {
    commitHash,
    path: "src/x.ts",
    changeKind: "M",
    insertions: ins,
    deletions: del,
  };
}

function chmap(...changes: FileChange[]): Map<string, FileChange> {
  const m = new Map<string, FileChange>();
  for (const c of changes) m.set(c.commitHash, c);
  return m;
}

describe("buildTimeMachine", () => {
  it("returns empty result when there are no commits", () => {
    const result = buildTimeMachine("src/x.ts", [], new Map());
    expect(result.epochs).toHaveLength(0);
    expect(result.totalCommits).toBe(0);
  });

  it("first commit is always a 'birth' epoch", () => {
    const commits = [mkCommit({ hash: "a1", authorDate: "2024-01-01", subject: "initial" })];
    const result = buildTimeMachine("src/x.ts", commits, chmap(mkChange("a1", 50, 0)));
    expect(result.epochs).toHaveLength(1);
    expect(result.epochs[0]!.kind).toBe("birth");
    expect(result.epochs[0]!.label).toContain("born");
  });

  it("detects rewrite epoch from large churn", () => {
    const commits = [
      mkCommit({ hash: "a1", authorDate: "2024-01-01", subject: "initial" }),
      mkCommit({ hash: "a2", authorDate: "2024-01-05", subject: "rewrite to use streams" }),
    ];
    const changes = chmap(mkChange("a1", 50, 0), mkChange("a2", 200, 180));
    const result = buildTimeMachine("src/x.ts", commits, changes);
    const rewriteEpoch = result.epochs.find((e) => e.kind === "rewrite");
    expect(rewriteEpoch).toBeDefined();
    expect(rewriteEpoch!.insertions + rewriteEpoch!.deletions).toBeGreaterThan(100);
  });

  it("detects firefight epoch from fix/hotfix keywords", () => {
    const commits = [
      mkCommit({ hash: "a1", authorDate: "2024-01-01", subject: "initial" }),
      mkCommit({ hash: "a2", authorDate: "2024-01-02", subject: "evolve feature" }),
      mkCommit({ hash: "a3", authorDate: "2024-01-03", subject: "hotfix critical bug" }),
      mkCommit({ hash: "a4", authorDate: "2024-01-04", subject: "fix regression" }),
    ];
    const changes = chmap(
      mkChange("a1", 50, 0),
      mkChange("a2", 20, 10),
      mkChange("a3", 5, 2),
      mkChange("a4", 8, 4),
    );
    const result = buildTimeMachine("src/x.ts", commits, changes);
    const firefight = result.epochs.find((e) => e.kind === "firefight");
    expect(firefight).toBeDefined();
    expect(firefight!.commits.length).toBeGreaterThanOrEqual(2);
  });

  it("detects polish epoch from small surgical changes", () => {
    const commits = [
      mkCommit({ hash: "a1", authorDate: "2024-01-01", subject: "initial" }),
      mkCommit({ hash: "a2", authorDate: "2024-01-02", subject: "fix typo" }),
      mkCommit({ hash: "a3", authorDate: "2024-01-03", subject: "format with prettier" }),
    ];
    const changes = chmap(mkChange("a1", 50, 0), mkChange("a2", 1, 1), mkChange("a3", 3, 3));
    const result = buildTimeMachine("src/x.ts", commits, changes);
    const polish = result.epochs.find((e) => e.kind === "polish");
    expect(polish).toBeDefined();
  });

  it("inserts a plateau epoch when there is a long quiet gap", () => {
    const commits = [
      mkCommit({ hash: "a1", authorDate: "2024-01-01", subject: "initial" }),
      mkCommit({ hash: "a2", authorDate: "2024-06-01", subject: "minor tweak" }),
    ];
    const changes = chmap(mkChange("a1", 50, 0), mkChange("a2", 5, 2));
    const result = buildTimeMachine("src/x.ts", commits, changes, { plateauDays: 30 });
    const plateau = result.epochs.find((e) => e.kind === "plateau" || e.kind === "twilight");
    expect(plateau).toBeDefined();
    expect(plateau!.spanDays).toBeGreaterThanOrEqual(30);
  });

  it("computes health ratios summing to ≤ 1", () => {
    const commits = Array.from({ length: 6 }, (_, i) =>
      mkCommit({
        hash: `c${i}`,
        authorDate: `2024-01-${(i + 1).toString().padStart(2, "0")}`,
        subject: i === 0 ? "init" : i % 2 === 0 ? "fix bug" : "refactor module",
      }),
    );
    const changes = chmap(...commits.map((c, i) => mkChange(c.hash, i % 2 === 1 ? 200 : 5, i % 2 === 1 ? 100 : 5)));
    const result = buildTimeMachine("src/x.ts", commits, changes);
    const sum = result.health.rewriteRatio + result.health.firefightRatio + result.health.polishRatio;
    expect(sum).toBeGreaterThanOrEqual(0);
    expect(sum).toBeLessThanOrEqual(1);
  });

  it("picks defining commit by descriptiveness within an epoch", () => {
    const commits = [
      mkCommit({ hash: "a1", authorDate: "2024-01-01", subject: "init" }),
      mkCommit({ hash: "a2", authorDate: "2024-01-02", subject: "x" }),
      mkCommit({
        hash: "a3",
        authorDate: "2024-01-03",
        subject: "evolve handler with comprehensive validation logic",
      }),
    ];
    const changes = chmap(mkChange("a1", 30, 0), mkChange("a2", 5, 2), mkChange("a3", 20, 8));
    const result = buildTimeMachine("src/x.ts", commits, changes);
    // The evolution epoch should pick the longer subject
    const evo = result.epochs.find((e) => e.kind === "evolution");
    if (evo) {
      expect(evo.defining.subject.length).toBeGreaterThanOrEqual(20);
    }
  });

  it("produces non-empty labels for every epoch", () => {
    const commits = [
      mkCommit({ hash: "a1", authorDate: "2024-01-01", subject: "first" }),
      mkCommit({ hash: "a2", authorDate: "2024-01-10", subject: "rewrite the parsing pipeline entirely" }),
    ];
    const result = buildTimeMachine(
      "src/x.ts",
      commits,
      chmap(mkChange("a1", 50, 0), mkChange("a2", 300, 250)),
    );
    for (const e of result.epochs) {
      expect(e.label.length).toBeGreaterThan(0);
    }
  });

  it("orders epochs chronologically by index", () => {
    const commits = [
      mkCommit({ hash: "a1", authorDate: "2024-01-01", subject: "init" }),
      mkCommit({ hash: "a2", authorDate: "2024-01-02", subject: "fix bug" }),
      mkCommit({ hash: "a3", authorDate: "2024-01-03", subject: "refactor heavily" }),
    ];
    const result = buildTimeMachine(
      "src/x.ts",
      commits,
      chmap(mkChange("a1", 30, 0), mkChange("a2", 5, 2), mkChange("a3", 200, 100)),
    );
    for (let i = 0; i < result.epochs.length; i++) {
      expect(result.epochs[i]!.index).toBe(i + 1);
    }
  });
});
