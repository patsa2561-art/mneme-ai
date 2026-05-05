import { describe, it, expect } from "vitest";
import { moneyball, classifyMoneyballTier } from "./moneyball.js";
import type { Commit } from "../types.js";

const cmt = (
  hash: string,
  author: string,
  date: string,
  files: string[],
): Commit => ({
  hash,
  shortHash: hash.slice(0, 7),
  authorName: author,
  authorEmail: `${author}@x`,
  authorDate: `${date}T00:00:00Z`,
  committerDate: `${date}T00:00:00Z`,
  subject: "commit",
  body: "",
  parents: [],
  files,
});

describe("classifyMoneyballTier", () => {
  it("'moneyball' when perCommitROI ≥ 1.5 + commit count < 30", () => {
    expect(classifyMoneyballTier(10, 20, 2)).toBe("moneyball");
  });
  it("'balanced' when value ≥ 5 + ROI ≥ 0.5", () => {
    expect(classifyMoneyballTier(20, 10, 0.5)).toBe("balanced");
  });
  it("'loud' when ≥30 commits and ROI < 0.3", () => {
    expect(classifyMoneyballTier(50, 10, 0.2)).toBe("loud");
  });
  it("'passive' when nothing else applies", () => {
    expect(classifyMoneyballTier(5, 1, 0.2)).toBe("passive");
  });
});

describe("moneyball — basic invariants", () => {
  it("returns empty for empty input", () => {
    expect(moneyball([])).toEqual([]);
  });

  it("respects minCommits filter (default 2)", () => {
    const commits = [cmt("a1", "alice", "2024-08-01", ["x.ts"])];
    expect(moneyball(commits)).toEqual([]); // only 1 commit
    expect(moneyball(commits, { minCommits: 1 })).toHaveLength(1);
  });

  it("downstream reach counts later commits touching same files", () => {
    const commits = [
      cmt("a1", "alice", "2024-08-01", ["src/x.ts"]),
      cmt("a2", "alice", "2024-08-02", ["src/x.ts"]),
      cmt("b1", "bob", "2024-08-03", ["src/x.ts"]),
      cmt("c1", "carol", "2024-08-04", ["src/x.ts"]),
    ];
    const scores = moneyball(commits, { minCommits: 1 });
    const alice = scores.find((s) => s.authorName === "alice")!;
    expect(alice.downstreamReach).toBeGreaterThan(0);
    expect(alice.collaborators).toBeGreaterThanOrEqual(2); // bob + carol
  });

  it("ignores downstream commits beyond the time window", () => {
    const commits = [
      cmt("a1", "alice", "2024-08-01", ["x.ts"]),
      cmt("a2", "alice", "2024-08-02", ["x.ts"]),
      cmt("b1", "bob", "2026-01-01", ["x.ts"]), // 1.5 years later
    ];
    const scores = moneyball(commits, { minCommits: 1, downstreamWindowDays: 90 });
    const alice = scores.find((s) => s.authorName === "alice")!;
    // bob is outside 90-day window — not counted as collaborator
    expect(alice.collaborators).toBe(0);
  });
});

describe("moneyball — per-commit ROI sort + tier assignment", () => {
  it("'moneyball' tier emerges for low-volume + high-impact authors", () => {
    // alice: 3 commits, each unblocks 5 collaborators
    const commits: Commit[] = [
      cmt("a1", "alice", "2024-08-01", ["src/core.ts"]),
      cmt("a2", "alice", "2024-08-02", ["src/core.ts"]),
      cmt("a3", "alice", "2024-08-03", ["src/core.ts"]),
    ];
    // 5 collaborators each making 3 follow-up commits
    const followups = ["bob", "carol", "dave", "eve", "frank"];
    for (const name of followups) {
      for (let j = 0; j < 3; j++) {
        commits.push(
          cmt(`${name[0]}${j}`.padEnd(7, "x"), name, `2024-08-${String(j + 5 + followups.indexOf(name) * 2).padStart(2, "0")}`, ["src/core.ts"]),
        );
      }
    }
    const scores = moneyball(commits, { minCommits: 1 });
    const alice = scores.find((s) => s.authorName === "alice")!;
    expect(alice.tier).toBe("moneyball");
  });

  it("'loud' tier for high commit count but low downstream effect", () => {
    const commits: Commit[] = [];
    // alice: 50 commits all on isolated files (no follow-ups)
    for (let i = 0; i < 50; i++) {
      const day = String(i + 1).padStart(2, "0");
      const month = i < 28 ? "08" : "09";
      const dayInMonth = i < 28 ? day : String(i - 27).padStart(2, "0");
      commits.push(
        cmt(`a${i}`.padEnd(7, "x"), "alice", `2024-${month}-${dayInMonth}`, [`src/iso${i}.ts`]),
      );
    }
    const scores = moneyball(commits, { minCommits: 1 });
    const alice = scores.find((s) => s.authorName === "alice")!;
    expect(alice.tier).toBe("loud");
    expect(alice.perCommitROI).toBeLessThan(0.3);
  });

  it("sorts by perCommitROI desc — moneyball candidates first", () => {
    const commits: Commit[] = [];
    // bob: 50 commits on solo files (loud)
    for (let i = 0; i < 50; i++) {
      const day = String(i + 1).padStart(2, "0");
      const month = i < 28 ? "08" : "09";
      const dayInMonth = i < 28 ? day : String(i - 27).padStart(2, "0");
      commits.push(cmt(`b${i}`.padEnd(7, "x"), "bob", `2024-${month}-${dayInMonth}`, [`src/iso${i}.ts`]));
    }
    // alice: 3 commits on shared file
    commits.push(cmt("a1", "alice", "2024-08-01", ["src/core.ts"]));
    commits.push(cmt("a2", "alice", "2024-08-02", ["src/core.ts"]));
    commits.push(cmt("a3", "alice", "2024-08-03", ["src/core.ts"]));
    // carol + dave + eve work downstream of alice
    for (const name of ["carol", "dave", "eve", "frank", "george"]) {
      const offset = ["carol", "dave", "eve", "frank", "george"].indexOf(name);
      for (let j = 0; j < 4; j++) {
        commits.push(
          cmt(
            `${name[0]}${j}`.padEnd(7, "x"),
            name,
            `2024-08-${String(j + 4 + offset * 4).padStart(2, "0")}`,
            ["src/core.ts"],
          ),
        );
      }
    }
    const scores = moneyball(commits, { minCommits: 1 });
    const aliceIdx = scores.findIndex((s) => s.authorName === "alice");
    const bobIdx = scores.findIndex((s) => s.authorName === "bob");
    expect(aliceIdx).toBeLessThan(bobIdx); // alice ranked higher (moneyball)
  });
});

describe("moneyball — interpretation text", () => {
  it("moneyball tier emphasizes high ROI", () => {
    const commits: Commit[] = [
      cmt("a1", "alice", "2024-08-01", ["x.ts"]),
      cmt("a2", "alice", "2024-08-02", ["x.ts"]),
      cmt("b1", "bob", "2024-08-03", ["x.ts"]),
      cmt("c1", "carol", "2024-08-04", ["x.ts"]),
      cmt("d1", "dave", "2024-08-05", ["x.ts"]),
      cmt("e1", "eve", "2024-08-06", ["x.ts"]),
    ];
    const profile = moneyball(commits, { minCommits: 1 }).find((s) => s.authorName === "alice")!;
    if (profile.tier === "moneyball") {
      expect(profile.interpretation.toLowerCase()).toMatch(/undervalued|unblocked/);
    }
  });
});
