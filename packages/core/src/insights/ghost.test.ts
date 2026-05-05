import { describe, it, expect } from "vitest";
import { buildGhostReport } from "./ghost.js";
import type { Commit, FileChange } from "../types.js";

const NOW = new Date("2026-05-05").getTime();

function mk(p: { hash: string; date: string; subject: string; files?: string[]; body?: string }): Commit {
  return {
    hash: p.hash,
    shortHash: p.hash.slice(0, 7),
    authorName: "Test",
    authorEmail: "t@e.com",
    authorDate: p.date,
    committerDate: p.date,
    subject: p.subject,
    body: p.body ?? "",
    files: p.files ?? [],
    parents: [],
  };
}

function mkChange(commitHash: string, path: string): FileChange {
  return { commitHash, path, changeKind: "M", insertions: 5, deletions: 0 };
}

describe("buildGhostReport", () => {
  it("returns empty when no commits or changes", () => {
    const r = buildGhostReport([], [], { nowMs: NOW });
    expect(r.ghostFiles).toHaveLength(0);
    expect(r.staleTodos).toHaveLength(0);
    expect(r.totalFiles).toBe(0);
  });

  it("identifies a long-untouched file as a ghost", () => {
    const c = mk({ hash: "a1", date: "2024-01-01", subject: "add legacy thing" });
    const ch = [mkChange("a1", "src/legacy.ts")];
    const r = buildGhostReport([c], ch, { nowMs: NOW, staleDays: 180, minGhostliness: 0.4 });
    const ghost = r.ghostFiles.find((g) => g.path === "src/legacy.ts");
    expect(ghost).toBeDefined();
    expect(ghost!.daysSinceLastTouch).toBeGreaterThan(180);
  });

  it("does not flag actively-edited files as ghosts", () => {
    const commits = Array.from({ length: 12 }, (_, i) =>
      mk({
        hash: `c${i}`,
        date: `2026-04-${(i + 1).toString().padStart(2, "0")}`,
        subject: `evolve module`,
        files: ["src/active.ts"],
      }),
    );
    const changes = commits.map((c) => mkChange(c.hash, "src/active.ts"));
    const r = buildGhostReport(commits, changes, { nowMs: NOW, minGhostliness: 0.4 });
    const ghost = r.ghostFiles.find((g) => g.path === "src/active.ts");
    expect(ghost).toBeUndefined();
  });

  it("boosts ghostliness via TODO density", () => {
    const c1 = mk({ hash: "a1", date: "2024-01-01", subject: "scaffold" });
    const c2 = mk({ hash: "a2", date: "2024-01-15", subject: "TODO: finish error handling" });
    const ch = [mkChange("a1", "src/half.ts"), mkChange("a2", "src/half.ts")];
    const r = buildGhostReport([c1, c2], ch, {
      nowMs: NOW,
      staleDays: 180,
      todoCounts: new Map([["src/half.ts", 5]]),
      minGhostliness: 0.4,
    });
    const ghost = r.ghostFiles.find((g) => g.path === "src/half.ts");
    expect(ghost).toBeDefined();
    expect(ghost!.todoCount).toBe(5);
  });

  it("detects stale TODOs from commit history", () => {
    const c1 = mk({ hash: "a1", date: "2024-01-01", subject: "TODO: add validation" });
    const c2 = mk({ hash: "a2", date: "2024-06-01", subject: "minor formatting" });
    const c3 = mk({ hash: "a3", date: "2024-12-01", subject: "another tweak" });
    const ch = [
      mkChange("a1", "src/feat.ts"),
      mkChange("a2", "src/feat.ts"),
      mkChange("a3", "src/feat.ts"),
    ];
    const r = buildGhostReport([c1, c2, c3], ch, {
      nowMs: NOW,
      todoStaleDays: 90,
    });
    expect(r.staleTodos.length).toBeGreaterThanOrEqual(1);
    expect(r.staleTodos[0]!.ignoredCount).toBeGreaterThanOrEqual(1);
  });

  it("ghostliness is bounded to 0..1", () => {
    const commits = [
      mk({ hash: "a1", date: "2020-01-01", subject: "ancient" }),
    ];
    const ch = [mkChange("a1", "src/dust.ts")];
    const r = buildGhostReport(commits, ch, {
      nowMs: NOW,
      todoCounts: new Map([["src/dust.ts", 100]]),
      minGhostliness: 0,
    });
    for (const g of r.ghostFiles) {
      expect(g.ghostliness).toBeGreaterThanOrEqual(0);
      expect(g.ghostliness).toBeLessThanOrEqual(1);
    }
  });

  it("orders ghostFiles by ghostliness descending", () => {
    const commits = [
      mk({ hash: "old", date: "2020-01-01", subject: "very old" }),
      mk({ hash: "med", date: "2024-08-01", subject: "medium age" }),
      mk({ hash: "fresh", date: "2026-04-01", subject: "fresh" }),
    ];
    const ch = [
      mkChange("old", "src/old.ts"),
      mkChange("med", "src/med.ts"),
      mkChange("fresh", "src/fresh.ts"),
    ];
    const r = buildGhostReport(commits, ch, {
      nowMs: NOW,
      staleDays: 180,
      minGhostliness: 0,
    });
    for (let i = 1; i < r.ghostFiles.length; i++) {
      expect(r.ghostFiles[i - 1]!.ghostliness).toBeGreaterThanOrEqual(
        r.ghostFiles[i]!.ghostliness,
      );
    }
  });

  it("reports averageGhostliness across all files", () => {
    const commits = [
      mk({ hash: "a1", date: "2020-01-01", subject: "ancient" }),
      mk({ hash: "a2", date: "2026-04-01", subject: "fresh" }),
    ];
    const ch = [mkChange("a1", "src/a.ts"), mkChange("a2", "src/b.ts")];
    const r = buildGhostReport(commits, ch, { nowMs: NOW, minGhostliness: 0 });
    expect(r.averageGhostliness).toBeGreaterThan(0);
    expect(r.averageGhostliness).toBeLessThanOrEqual(1);
  });

  it("produces a non-empty reason for every ghost", () => {
    const commits = [
      mk({ hash: "a1", date: "2020-01-01", subject: "ancient" }),
    ];
    const ch = [mkChange("a1", "src/dusty.ts")];
    const r = buildGhostReport(commits, ch, { nowMs: NOW, minGhostliness: 0 });
    for (const g of r.ghostFiles) {
      expect(g.reason.length).toBeGreaterThan(0);
    }
  });

  it("does not flag stale TODO unless ignored at least once", () => {
    const c1 = mk({ hash: "a1", date: "2020-01-01", subject: "TODO: clean this up" });
    const ch = [mkChange("a1", "src/only.ts")];
    const r = buildGhostReport([c1], ch, { nowMs: NOW, todoStaleDays: 90 });
    // The TODO commit is the only touch — ignoredCount = 0, should not appear
    expect(r.staleTodos.find((t) => t.filePath === "src/only.ts")).toBeUndefined();
  });
});
