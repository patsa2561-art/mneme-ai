import { describe, it, expect } from "vitest";
import { buildOracle } from "./oracle.js";
import type { Commit } from "../types.js";

const NOW = new Date("2026-05-05").getTime();

function mk(p: { hash: string; date: string; subject: string; author: string; files?: string[] }): Commit {
  return {
    hash: p.hash,
    shortHash: p.hash.slice(0, 7),
    authorName: p.author,
    authorEmail: p.author.toLowerCase() + "@example.com",
    authorDate: p.date,
    committerDate: p.date,
    subject: p.subject,
    body: "",
    files: p.files ?? ["src/x.ts"],
    parents: [],
  };
}

describe("buildOracle", () => {
  it("returns empty report for empty commits", () => {
    const r = buildOracle([], { nowMs: NOW });
    expect(r.windowCommits).toBe(0);
    expect(r.predictions).toHaveLength(0);
    expect(r.collisions).toHaveLength(0);
  });

  it("filters commits to within window", () => {
    const commits = [
      mk({ hash: "old", date: "2024-01-01", subject: "x", author: "Alice" }),
      mk({ hash: "new", date: "2026-04-01", subject: "x", author: "Alice" }),
    ];
    const r = buildOracle(commits, { nowMs: NOW, windowDays: 90 });
    expect(r.windowCommits).toBe(1);
  });

  it("predicts top candidates per file ordered by recency-weighted score", () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 10; i++) {
      commits.push(
        mk({
          hash: `a${i}`,
          date: `2026-04-${(i + 1).toString().padStart(2, "0")}`,
          subject: "x",
          author: "Alice",
          files: ["src/auth.ts"],
        }),
      );
    }
    for (let i = 0; i < 3; i++) {
      commits.push(
        mk({
          hash: `b${i}`,
          date: `2026-03-${(i + 1).toString().padStart(2, "0")}`,
          subject: "x",
          author: "Bob",
          files: ["src/auth.ts"],
        }),
      );
    }
    const r = buildOracle(commits, { nowMs: NOW });
    const auth = r.predictions.find((p) => p.filePath === "src/auth.ts");
    expect(auth).toBeDefined();
    expect(auth!.candidates[0]!.author).toBe("Alice");
    expect(auth!.candidates[0]!.probability).toBeGreaterThan(auth!.candidates[1]!.probability);
  });

  it("detects collision when 2 authors both have high probability for same file", () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 6; i++) {
      commits.push(
        mk({
          hash: `a${i}`,
          date: `2026-04-${(i + 1).toString().padStart(2, "0")}`,
          subject: "x",
          author: "Alice",
          files: ["src/payment.ts"],
        }),
      );
      commits.push(
        mk({
          hash: `b${i}`,
          date: `2026-04-${(i + 1).toString().padStart(2, "0")}`,
          subject: "x",
          author: "Bob",
          files: ["src/payment.ts"],
        }),
      );
    }
    const r = buildOracle(commits, { nowMs: NOW });
    const collision = r.collisions.find((c) => c.filePath === "src/payment.ts");
    expect(collision).toBeDefined();
    expect(new Set([collision!.authorA, collision!.authorB])).toEqual(new Set(["Alice", "Bob"]));
  });

  it("does NOT predict collision when one author dominates", () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 20; i++) {
      commits.push(
        mk({
          hash: `a${i}`,
          date: `2026-04-${(i + 1).toString().padStart(2, "0")}`,
          subject: "x",
          author: "Alice",
          files: ["src/solo.ts"],
        }),
      );
    }
    commits.push(
      mk({ hash: "b1", date: "2026-04-01", subject: "x", author: "Bob", files: ["src/solo.ts"] }),
    );
    const r = buildOracle(commits, { nowMs: NOW, collisionFloor: 0.3 });
    expect(r.collisions.find((c) => c.filePath === "src/solo.ts")).toBeUndefined();
  });

  it("excludes files below minTouches threshold", () => {
    const commits = [
      mk({ hash: "a1", date: "2026-04-01", subject: "x", author: "Alice", files: ["src/rare.ts"] }),
    ];
    const r = buildOracle(commits, { nowMs: NOW, minTouchesForFile: 2 });
    expect(r.predictions.find((p) => p.filePath === "src/rare.ts")).toBeUndefined();
  });

  it("orders collisions by jointProbability desc", () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 6; i++) {
      commits.push(mk({ hash: `a${i}`, date: `2026-04-${(i + 1).toString().padStart(2, "0")}`, subject: "x", author: "Alice", files: ["src/hot.ts"] }));
      commits.push(mk({ hash: `b${i}`, date: `2026-04-${(i + 1).toString().padStart(2, "0")}`, subject: "x", author: "Bob", files: ["src/hot.ts"] }));
    }
    for (let i = 0; i < 3; i++) {
      commits.push(mk({ hash: `c${i}`, date: `2026-04-${(i + 10).toString().padStart(2, "0")}`, subject: "x", author: "Carol", files: ["src/cool.ts"] }));
      commits.push(mk({ hash: `d${i}`, date: `2026-04-${(i + 10).toString().padStart(2, "0")}`, subject: "x", author: "Dave", files: ["src/cool.ts"] }));
    }
    const r = buildOracle(commits, { nowMs: NOW });
    for (let i = 1; i < r.collisions.length; i++) {
      expect(r.collisions[i - 1]!.jointProbability).toBeGreaterThanOrEqual(r.collisions[i]!.jointProbability);
    }
  });

  it("daysSinceLastJointTouch is reasonable when both authors touched recently", () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 4; i++) {
      commits.push(mk({ hash: `a${i}`, date: `2026-04-${(20 + i).toString().padStart(2, "0")}`, subject: "x", author: "Alice", files: ["src/joint.ts"] }));
      commits.push(mk({ hash: `b${i}`, date: `2026-04-${(20 + i).toString().padStart(2, "0")}`, subject: "x", author: "Bob", files: ["src/joint.ts"] }));
    }
    const r = buildOracle(commits, { nowMs: NOW });
    const c = r.collisions[0];
    if (c) {
      expect(c.daysSinceLastJointTouch).toBeGreaterThan(-1);
      expect(c.daysSinceLastJointTouch).toBeLessThan(60);
    }
  });
});
