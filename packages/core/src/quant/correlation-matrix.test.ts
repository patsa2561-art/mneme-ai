import { describe, it, expect } from "vitest";
import { correlationMatrix, classifyCouplingTier } from "./correlation-matrix.js";
import type { Commit } from "../types.js";

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

describe("classifyCouplingTier", () => {
  it("'tight' when both jaccard ≥ 0.6 + lift ≥ 5", () => {
    expect(classifyCouplingTier(0.7, 6)).toBe("tight");
  });
  it("'strong' when one of jaccard ≥ 0.4 or lift ≥ 3", () => {
    expect(classifyCouplingTier(0.5, 1)).toBe("strong");
    expect(classifyCouplingTier(0.1, 4)).toBe("strong");
  });
  it("'moderate' for middling values", () => {
    expect(classifyCouplingTier(0.25, 2)).toBe("moderate");
  });
  it("'weak' otherwise", () => {
    expect(classifyCouplingTier(0.05, 1.2)).toBe("weak");
  });
});

describe("correlationMatrix — basic detection", () => {
  it("returns empty when there are no co-occurring file pairs", () => {
    const commits = [
      cmt("a1", "2024-01-01", ["src/a.ts"]),
      cmt("a2", "2024-01-02", ["src/b.ts"]),
      cmt("a3", "2024-01-03", ["src/c.ts"]),
    ];
    expect(correlationMatrix(commits)).toEqual([]);
  });

  it("detects a tightly-coupled pair when both files always change together", () => {
    // 10 co-touched commits + 20 background commits on unrelated files.
    // Background commits lower the baseline rate of x and y so that
    // co-occurrence has lift > 1.5 (otherwise lift = 1 and is filtered out).
    const co = Array.from({ length: 10 }, (_, i) =>
      cmt(`c${i}`.padEnd(7, "x"), `2024-01-${String(i + 1).padStart(2, "0")}`, ["src/x.ts", "src/y.ts"]),
    );
    const bg = Array.from({ length: 20 }, (_, i) =>
      cmt(`bg${i}`.padEnd(7, "x"), `2024-02-${String((i % 28) + 1).padStart(2, "0")}`, [`src/other${i}.ts`]),
    );
    const pairs = correlationMatrix([...co, ...bg], { minFileTouches: 3, minCoOccurrences: 2 });
    const xy = pairs.find(
      (p) =>
        (p.fileA === "src/x.ts" && p.fileB === "src/y.ts") ||
        (p.fileA === "src/y.ts" && p.fileB === "src/x.ts"),
    );
    expect(xy).toBeDefined();
    expect(xy!.jaccard).toBeCloseTo(1, 3);
    expect(xy!.tier).toBe("tight");
  });

  it("respects minFileTouches threshold", () => {
    const commits = [
      cmt("a1", "2024-01-01", ["src/x.ts", "src/y.ts"]),
      cmt("a2", "2024-01-02", ["src/x.ts", "src/y.ts"]),
    ];
    expect(correlationMatrix(commits, { minFileTouches: 5 })).toEqual([]);
    expect(correlationMatrix(commits, { minFileTouches: 1, minCoOccurrences: 1, minLift: 0 })).toHaveLength(1);
  });

  it("respects minCoOccurrences threshold", () => {
    const commits = [
      cmt("a1", "2024-01-01", ["src/x.ts", "src/y.ts"]),
      cmt("a2", "2024-01-02", ["src/x.ts"]),
      cmt("a3", "2024-01-03", ["src/y.ts"]),
      cmt("a4", "2024-01-04", ["src/x.ts"]),
    ];
    expect(correlationMatrix(commits, { minFileTouches: 1, minCoOccurrences: 3 })).toEqual([]);
  });

  it("respects minLift threshold (filters weak pairs)", () => {
    // Build a noisy history where x and y co-occur but at random level
    const commits: Commit[] = [];
    for (let i = 0; i < 20; i++) commits.push(cmt(`x${i}`.padEnd(7, "y"), `2024-01-${String(i + 1).padStart(2, "0")}`, ["src/x.ts"]));
    for (let i = 0; i < 20; i++) commits.push(cmt(`y${i}`.padEnd(7, "x"), `2024-02-${String(i + 1).padStart(2, "0")}`, ["src/y.ts"]));
    commits.push(cmt("co1", "2024-03-01", ["src/x.ts", "src/y.ts"]));
    commits.push(cmt("co2", "2024-03-02", ["src/x.ts", "src/y.ts"]));
    // 2 co-occurrences but x has 22 total, y has 22 total, so jaccard tiny + lift low
    expect(correlationMatrix(commits, { minLift: 5 })).toEqual([]);
  });
});

describe("correlationMatrix — sort + tiers", () => {
  it("sorts by lift desc", () => {
    const commits = [
      // Pair 1: TIGHT (5 co-occurrences, files appear in nothing else).
      cmt("a1", "2024-01-01", ["src/tight-a.ts", "src/tight-b.ts"]),
      cmt("a2", "2024-01-02", ["src/tight-a.ts", "src/tight-b.ts"]),
      cmt("a3", "2024-01-03", ["src/tight-a.ts", "src/tight-b.ts"]),
      cmt("a4", "2024-01-04", ["src/tight-a.ts", "src/tight-b.ts"]),
      cmt("a5", "2024-01-05", ["src/tight-a.ts", "src/tight-b.ts"]),
      // Pair 2: LOOSER (3 co, but both files also touched alone — diluted lift).
      cmt("b1", "2024-02-01", ["src/loose-a.ts", "src/loose-b.ts"]),
      cmt("b2", "2024-02-02", ["src/loose-a.ts", "src/loose-b.ts"]),
      cmt("b3", "2024-02-03", ["src/loose-a.ts", "src/loose-b.ts"]),
      cmt("b4", "2024-02-04", ["src/loose-a.ts"]),
      cmt("b5", "2024-02-05", ["src/loose-a.ts"]),
      cmt("b6", "2024-02-06", ["src/loose-b.ts"]),
      cmt("b7", "2024-02-07", ["src/loose-b.ts"]),
      // Background — 15 commits on unrelated files lower the global baseline,
      // so even the tight pair has lift > 1.5 (otherwise lift = 1 and filtered).
      ...Array.from({ length: 15 }, (_, i) =>
        cmt(`bg${i}`.padEnd(7, "x"), `2024-03-${String(i + 1).padStart(2, "0")}`, [`src/other${i}.ts`]),
      ),
    ];
    const pairs = correlationMatrix(commits, { minFileTouches: 3, minCoOccurrences: 2 });
    expect(pairs[0]!.fileA).toMatch(/tight-/);
    expect(pairs[0]!.lift).toBeGreaterThan(pairs[pairs.length - 1]!.lift);
  });

  it("respects topN", () => {
    const commits: Commit[] = [];
    // 10 file pairs, each with 4 co-occurrences
    for (let p = 0; p < 10; p++) {
      for (let i = 0; i < 4; i++) {
        commits.push(
          cmt(`p${p}c${i}`.padEnd(7, "x"), `2024-${String(p + 1).padStart(2, "0")}-0${i + 1}`, [`src/p${p}-a.ts`, `src/p${p}-b.ts`]),
        );
      }
    }
    expect(correlationMatrix(commits, { minFileTouches: 1, minCoOccurrences: 2, topN: 5, minLift: 0 }).length).toBeLessThanOrEqual(5);
  });
});
