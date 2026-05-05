import { describe, it, expect } from "vitest";
import { detectInsiderTrading, classifyInsiderTier } from "./insider-trading.js";
import type { Commit } from "../types.js";

const cmt = (
  hash: string,
  author: string,
  date: string,
  subject: string,
  files: string[],
): Commit => ({
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

describe("classifyInsiderTier", () => {
  it("high-pattern at 5+", () => expect(classifyInsiderTier(5)).toBe("high-pattern"));
  it("elevated at 3-4", () => expect(classifyInsiderTier(3)).toBe("elevated"));
  it("watch at 2", () => expect(classifyInsiderTier(2)).toBe("watch"));
  it("low at <2", () => expect(classifyInsiderTier(1)).toBe("low"));
});

describe("detectInsiderTrading — same author + same files + fix follow-up", () => {
  it("flags a single insider pattern (alice ships then alice fixes)", () => {
    const commits = [
      cmt("a1", "alice", "2024-08-01", "feat(stripe): add webhook", ["src/stripe.ts"]),
      cmt("a2", "alice", "2024-08-03", "fix: stripe webhook crashed", ["src/stripe.ts"]),
    ];
    const profiles = detectInsiderTrading(commits, { minPatterns: 1 });
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.authorName).toBe("alice");
    expect(profiles[0]!.patternCount).toBe(1);
  });

  it("does NOT flag when author is different", () => {
    const commits = [
      cmt("a1", "alice", "2024-08-01", "feat(stripe): add webhook", ["src/stripe.ts"]),
      cmt("b1", "bob", "2024-08-03", "fix: stripe webhook crashed", ["src/stripe.ts"]),
    ];
    expect(detectInsiderTrading(commits, { minPatterns: 1 })).toEqual([]);
  });

  it("does NOT flag when files do not overlap", () => {
    const commits = [
      cmt("a1", "alice", "2024-08-01", "feat: stripe", ["src/stripe.ts"]),
      cmt("a2", "alice", "2024-08-03", "fix: orders broken", ["src/orders.ts"]),
    ];
    expect(detectInsiderTrading(commits, { minPatterns: 1 })).toEqual([]);
  });

  it("respects windowDays", () => {
    const commits = [
      cmt("a1", "alice", "2024-08-01", "feat: stripe", ["src/x.ts"]),
      cmt("a2", "alice", "2024-09-15", "fix: stripe broke", ["src/x.ts"]), // 45 days later
    ];
    expect(detectInsiderTrading(commits, { windowDays: 14, minPatterns: 1 })).toEqual([]);
    expect(detectInsiderTrading(commits, { windowDays: 60, minPatterns: 1 })).toHaveLength(1);
  });
});

describe("detectInsiderTrading — minPatterns threshold and aggregation", () => {
  it("requires ≥ minPatterns to flag (default 2)", () => {
    const commits = [
      cmt("a1", "alice", "2024-08-01", "feat: A", ["src/x.ts"]),
      cmt("a2", "alice", "2024-08-02", "fix: A", ["src/x.ts"]),
    ];
    expect(detectInsiderTrading(commits)).toEqual([]); // only 1 pattern, default min = 2
  });

  it("aggregates all patterns by author", () => {
    const commits = [
      cmt("a1", "alice", "2024-08-01", "feat: A", ["src/x.ts"]),
      cmt("a2", "alice", "2024-08-02", "fix: A", ["src/x.ts"]),
      cmt("a3", "alice", "2024-08-10", "feat: B", ["src/y.ts"]),
      cmt("a4", "alice", "2024-08-11", "fix: B", ["src/y.ts"]),
      cmt("a5", "alice", "2024-08-20", "feat: C", ["src/z.ts"]),
      cmt("a6", "alice", "2024-08-22", "fix: C broke", ["src/z.ts"]),
    ];
    const profiles = detectInsiderTrading(commits, { minPatterns: 2 });
    expect(profiles).toHaveLength(1);
    expect(profiles[0]!.patternCount).toBe(3);
    expect(profiles[0]!.affectedFiles.sort()).toEqual(["src/x.ts", "src/y.ts", "src/z.ts"]);
  });

  it("samples are capped at 3", () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 10; i++) {
      commits.push(cmt(`f${i}`, "alice", `2024-08-${String((i * 2) + 1).padStart(2, "0")}`, `feat: ${i}`, [`f${i}.ts`]));
      commits.push(cmt(`x${i}`, "alice", `2024-08-${String((i * 2) + 2).padStart(2, "0")}`, `fix: ${i}`, [`f${i}.ts`]));
    }
    const profiles = detectInsiderTrading(commits, { minPatterns: 2 });
    expect(profiles[0]!.samples).toHaveLength(3);
  });
});

describe("detectInsiderTrading — pairing suggestion", () => {
  it("suggests another author who has touched the same files", () => {
    const commits = [
      cmt("a1", "alice", "2024-08-01", "feat: A", ["src/x.ts"]),
      cmt("a2", "alice", "2024-08-02", "fix: A", ["src/x.ts"]),
      cmt("a3", "alice", "2024-08-10", "feat: B", ["src/x.ts"]),
      cmt("a4", "alice", "2024-08-11", "fix: B", ["src/x.ts"]),
      cmt("b1", "bob", "2024-09-01", "refactor", ["src/x.ts"]),
      cmt("b2", "bob", "2024-09-05", "refactor 2", ["src/x.ts"]),
    ];
    const profile = detectInsiderTrading(commits, { minPatterns: 2 })[0];
    expect(profile?.pairSuggestion).toBe("bob");
  });

  it("returns undefined pair when nobody else has touched the files", () => {
    const commits = [
      cmt("a1", "alice", "2024-08-01", "feat: A", ["src/solo.ts"]),
      cmt("a2", "alice", "2024-08-02", "fix: A", ["src/solo.ts"]),
      cmt("a3", "alice", "2024-08-10", "feat: B", ["src/solo.ts"]),
      cmt("a4", "alice", "2024-08-11", "fix: B", ["src/solo.ts"]),
    ];
    const profile = detectInsiderTrading(commits, { minPatterns: 2 })[0];
    expect(profile?.pairSuggestion).toBeUndefined();
  });
});

describe("detectInsiderTrading — sort order", () => {
  it("sorts profiles by patternCount desc", () => {
    const commits: Commit[] = [];
    // alice — 3 patterns
    for (let i = 0; i < 3; i++) {
      commits.push(cmt(`a${i}`, "alice", `2024-0${i + 1}-01`, `feat: ${i}`, [`a${i}.ts`]));
      commits.push(cmt(`af${i}`, "alice", `2024-0${i + 1}-03`, `fix: ${i}`, [`a${i}.ts`]));
    }
    // bob — 5 patterns
    for (let i = 0; i < 5; i++) {
      commits.push(cmt(`b${i}`, "bob", `2024-0${i + 1}-15`, `feat: ${i}`, [`b${i}.ts`]));
      commits.push(cmt(`bf${i}`, "bob", `2024-0${i + 1}-17`, `fix: ${i}`, [`b${i}.ts`]));
    }
    const profiles = detectInsiderTrading(commits, { minPatterns: 2 });
    expect(profiles[0]!.authorName).toBe("bob");
    expect(profiles[0]!.patternCount).toBe(5);
    expect(profiles[1]!.authorName).toBe("alice");
  });
});
