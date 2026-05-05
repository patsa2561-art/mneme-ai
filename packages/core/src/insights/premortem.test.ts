import { describe, it, expect } from "vitest";
import { buildPremortem, scoreSimilarity } from "./premortem.js";
import type { Commit } from "../types.js";

function mk(p: Partial<Commit> & { hash: string; authorDate: string; subject: string; files?: string[] }): Commit {
  return {
    shortHash: p.hash.slice(0, 7),
    authorName: "Test",
    authorEmail: "t@e.com",
    committerDate: p.authorDate,
    body: p.body ?? "",
    files: p.files ?? ["src/cache.ts"],
    parents: p.parents ?? [],
    ...p,
  };
}

describe("scoreSimilarity", () => {
  it("scores 0 when no token overlap", () => {
    const c = mk({ hash: "a1", authorDate: "2024-01-01", subject: "fix typo in readme" });
    const s = scoreSimilarity("rebuild authentication layer", c);
    expect(s).toBe(0);
  });

  it("scores higher when intent terms appear in commit", () => {
    const c = mk({
      hash: "a1",
      authorDate: "2024-01-01",
      subject: "add caching layer to api responses",
    });
    const s = scoreSimilarity("add caching layer", c);
    expect(s).toBeGreaterThan(0.5);
  });

  it("ignores stopwords", () => {
    const c = mk({ hash: "a1", authorDate: "2024-01-01", subject: "the a an of to in for" });
    const s = scoreSimilarity("the a an of to", c);
    expect(s).toBe(0);
  });

  it("boosts score when intent names a file the commit touched", () => {
    const c = mk({
      hash: "a1",
      authorDate: "2024-01-01",
      subject: "minor unrelated change",
      files: ["src/auth.ts"],
    });
    const s = scoreSimilarity("rewrite src/auth.ts", c);
    expect(s).toBeGreaterThan(0);
  });
});

describe("buildPremortem", () => {
  it("returns empty when no commits at all", () => {
    const r = buildPremortem("add caching layer", []);
    expect(r.pastAttempts).toHaveLength(0);
    expect(r.regretProbability).toBe(0);
    expect(r.verdict).toBe("low");
  });

  it("flags very_high verdict when most past attempts ended in revert", () => {
    const commits: Commit[] = [];
    // 4 attempts to add caching, 3 reverted
    for (let i = 0; i < 4; i++) {
      commits.push(
        mk({
          hash: `att${i}`,
          authorDate: `2024-0${i + 1}-01`,
          subject: `add caching layer to api`,
          files: ["src/cache.ts"],
        }),
      );
      if (i < 3) {
        commits.push(
          mk({
            hash: `rev${i}`,
            authorDate: `2024-0${i + 1}-05`,
            subject: `revert "add caching layer to api"`,
            files: ["src/cache.ts"],
          }),
        );
      }
    }
    const r = buildPremortem("add caching layer", commits, { similarityFloor: 0.2 });
    expect(r.regretProbability).toBeGreaterThanOrEqual(0.7);
    expect(r.verdict).toBe("very_high");
  });

  it("flags low verdict when no past attempts had problems", () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 3; i++) {
      commits.push(
        mk({
          hash: `att${i}`,
          authorDate: `2024-0${i + 1}-01`,
          subject: `add caching layer for api`,
          files: ["src/cache.ts"],
        }),
      );
      commits.push(
        mk({
          hash: `success${i}`,
          authorDate: `2024-0${i + 1}-05`,
          subject: `extend caching to user objects`,
          files: ["src/cache.ts"],
        }),
      );
    }
    const r = buildPremortem("add caching layer", commits, { similarityFloor: 0.2 });
    expect(r.regretProbability).toBe(0);
    expect(r.verdict).toBe("low");
  });

  it("clusters risks by kind", () => {
    const commits: Commit[] = [
      mk({ hash: "a1", authorDate: "2024-01-01", subject: "add cache" }),
      mk({ hash: "a2", authorDate: "2024-01-03", subject: "revert add cache" }),
      mk({ hash: "a3", authorDate: "2024-02-01", subject: "add cache for users" }),
      mk({ hash: "a4", authorDate: "2024-02-05", subject: "hotfix cache invalidation" }),
      mk({ hash: "a5", authorDate: "2024-03-01", subject: "add cache for orders" }),
      mk({ hash: "a6", authorDate: "2024-03-04", subject: "incident: stale cache caused outage" }),
    ];
    const r = buildPremortem("add cache", commits, { similarityFloor: 0.2 });
    const kinds = new Set(r.topRisks.map((x) => x.label.split(" ")[0]));
    expect(kinds.size).toBeGreaterThan(0);
  });

  it("limits topRisks to at most 3", () => {
    const commits: Commit[] = [];
    const subjects = [
      "add cache",
      "revert add cache",
      "add cache",
      "hotfix add cache bug",
      "add cache",
      "incident outage cache",
      "add cache",
      "rewrite cache after issues",
    ];
    for (let i = 0; i < subjects.length; i++) {
      commits.push(
        mk({ hash: `c${i}`, authorDate: `2024-${(i + 1).toString().padStart(2, "0")}-01`, subject: subjects[i]! }),
      );
    }
    const r = buildPremortem("add cache", commits, { similarityFloor: 0.2 });
    expect(r.topRisks.length).toBeLessThanOrEqual(3);
  });

  it("does not count the attempt itself as its own regret", () => {
    const commits = [
      mk({ hash: "a1", authorDate: "2024-01-01", subject: "add caching layer" }),
    ];
    const r = buildPremortem("add caching layer", commits, { similarityFloor: 0.2 });
    expect(r.pastAttempts[0]!.riskKind).toBe("none");
  });

  it("computes summary string for every verdict tier", () => {
    const verdicts: Array<"low" | "medium" | "high" | "very_high"> = [
      "low",
      "medium",
      "high",
      "very_high",
    ];
    const seen = new Set<string>();
    for (const v of verdicts) {
      const commits: Commit[] = [];
      const total = 10;
      const regrets = v === "low" ? 0 : v === "medium" ? 2 : v === "high" ? 5 : 8;
      for (let i = 0; i < total; i++) {
        commits.push(
          mk({
            hash: `a${i}`,
            authorDate: `2024-${(i + 1).toString().padStart(2, "0")}-01`,
            subject: `add caching feature`,
            files: ["src/cache.ts"],
          }),
        );
        if (i < regrets) {
          commits.push(
            mk({
              hash: `r${i}`,
              authorDate: `2024-${(i + 1).toString().padStart(2, "0")}-05`,
              subject: `revert add caching feature`,
              files: ["src/cache.ts"],
            }),
          );
        }
      }
      const r = buildPremortem("add caching feature", commits, { similarityFloor: 0.2 });
      seen.add(r.verdict);
      expect(r.summary.length).toBeGreaterThan(20);
    }
    expect(seen.size).toBeGreaterThanOrEqual(2);
  });
});
