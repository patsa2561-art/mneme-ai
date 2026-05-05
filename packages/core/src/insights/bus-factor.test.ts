import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MnemeStore } from "../store/sqlite.js";
import { busFactor } from "./bus-factor.js";
import type { Commit } from "../types.js";

let tmpDir: string;
let store: MnemeStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-busfactor-test-"));
  store = new MnemeStore(join(tmpDir, "mneme.db"));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const cmt = (hash: string, author: string, date: string, files: string[]): Commit => ({
  hash,
  shortHash: hash.slice(0, 7),
  authorName: author,
  authorEmail: `${author}@x`,
  authorDate: `${date}T00:00:00Z`,
  committerDate: `${date}T00:00:00Z`,
  subject: `commit by ${author}`,
  body: "",
  parents: [],
  files,
});

function seed(commits: Commit[]) {
  store.upsertCommits(commits);
  for (const c of commits) {
    const changes = c.files.map((f) => ({
      commitHash: c.hash,
      path: f,
      changeKind: "M" as const,
      insertions: 1,
      deletions: 0,
    }));
    store.upsertFileChanges(changes);
  }
}

describe("busFactor — risk tier classification", () => {
  it("flags CRITICAL when one author owns ≥85% AND ≥10 touches", () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 9; i++) commits.push(cmt(`a${i}1234567`, "alice", `2024-08-0${(i % 9) + 1}`, ["src/payment.ts"]));
    commits.push(cmt("b0123456", "bob", "2024-09-01", ["src/payment.ts"]));
    seed(commits);

    const risks = busFactor(store, { minTouches: 1 });
    const payment = risks.find((r) => r.filePath === "src/payment.ts")!;
    expect(payment.tier).toBe("critical");
    expect(payment.topOwner.name).toBe("alice");
    expect(payment.topOwner.sharePct).toBe(90);
    expect(payment.recommendation.toLowerCase()).toContain("bob");
  });

  it("flags HIGH when one author owns 75-85% with 5+ touches", () => {
    const commits: Commit[] = [
      cmt("a1", "alice", "2024-08-01", ["src/auth.ts"]),
      cmt("a2", "alice", "2024-08-02", ["src/auth.ts"]),
      cmt("a3", "alice", "2024-08-03", ["src/auth.ts"]),
      cmt("a4", "alice", "2024-08-04", ["src/auth.ts"]),
      cmt("a5", "alice", "2024-08-05", ["src/auth.ts"]),
      cmt("a6", "alice", "2024-08-06", ["src/auth.ts"]),
      cmt("b1", "bob", "2024-08-07", ["src/auth.ts"]),
      cmt("b2", "bob", "2024-08-08", ["src/auth.ts"]),
    ];
    seed(commits);
    const risks = busFactor(store, { minTouches: 1 });
    const auth = risks.find((r) => r.filePath === "src/auth.ts")!;
    expect(auth.tier).toBe("high");
    expect(auth.topOwner.sharePct).toBe(75);
  });

  it("flags MEDIUM when share is 60-75%", () => {
    const commits: Commit[] = [
      cmt("a1", "alice", "2024-08-01", ["src/x.ts"]),
      cmt("a2", "alice", "2024-08-02", ["src/x.ts"]),
      cmt("a3", "alice", "2024-08-03", ["src/x.ts"]),
      cmt("b1", "bob", "2024-08-04", ["src/x.ts"]),
      cmt("b2", "bob", "2024-08-05", ["src/x.ts"]),
    ];
    seed(commits);
    const risks = busFactor(store, { minTouches: 1 });
    const x = risks.find((r) => r.filePath === "src/x.ts")!;
    expect(x.tier).toBe("medium");
    expect(x.topOwner.sharePct).toBe(60);
  });
});

describe("busFactor — backup recommendation", () => {
  it("includes the second-place author as the backup", () => {
    const commits: Commit[] = [
      ...Array.from({ length: 9 }, (_, i) => cmt(`a${i}`, "alice", `2024-08-0${(i % 9) + 1}`, ["x.ts"])),
      cmt("b1", "bob", "2024-09-01", ["x.ts"]),
      cmt("c1", "carol", "2024-09-02", ["x.ts"]),
    ];
    seed(commits);
    const risks = busFactor(store, { minTouches: 1 });
    const x = risks.find((r) => r.filePath === "x.ts")!;
    expect(x.backup?.name).toBeDefined();
    expect(["bob", "carol"]).toContain(x.backup?.name);
  });

  it("backup undefined when only one author has ever touched the file", () => {
    const commits: Commit[] = Array.from({ length: 5 }, (_, i) =>
      cmt(`a${i}`, "alice", `2024-08-0${i + 1}`, ["solo.ts"]),
    );
    seed(commits);
    const risks = busFactor(store, { minTouches: 1 });
    const solo = risks.find((r) => r.filePath === "solo.ts")!;
    expect(solo.backup).toBeUndefined();
    expect(solo.recommendation.toLowerCase()).toMatch(/no backup|spread/);
  });
});

describe("busFactor — filtering and sorting", () => {
  it("excludes lockfiles + generated dirs by default", () => {
    const commits: Commit[] = [
      cmt("a1", "alice", "2024-08-01", ["package-lock.json", "src/x.ts"]),
      cmt("a2", "alice", "2024-08-02", ["package-lock.json", "src/x.ts"]),
      cmt("a3", "alice", "2024-08-03", ["package-lock.json", "src/x.ts"]),
    ];
    seed(commits);
    const risks = busFactor(store, { minTouches: 1 });
    expect(risks.find((r) => r.filePath === "package-lock.json")).toBeUndefined();
    expect(risks.find((r) => r.filePath === "src/x.ts")).toBeDefined();
  });

  it("respects minTouches threshold", () => {
    const commits: Commit[] = [cmt("a1", "alice", "2024-08-01", ["lonely.ts"])];
    seed(commits);
    expect(busFactor(store, { minTouches: 2 })).toEqual([]);
    expect(busFactor(store, { minTouches: 1 })).toHaveLength(1);
  });

  it("sorts by criticality score (high-touch solo > low-touch solo)", () => {
    const commits: Commit[] = [
      ...Array.from({ length: 12 }, (_, i) =>
        cmt(`a${i}`, "alice", `2024-08-${String(i + 1).padStart(2, "0")}`, ["hot.ts"]),
      ),
      ...Array.from({ length: 3 }, (_, i) => cmt(`b${i}`, "alice", `2024-09-0${i + 1}`, ["cold.ts"])),
    ];
    seed(commits);
    const risks = busFactor(store, { minTouches: 1 });
    expect(risks[0]!.filePath).toBe("hot.ts");
    expect(risks[0]!.score).toBeGreaterThan(risks[1]!.score);
  });

  it("respects topN limit", () => {
    const commits: Commit[] = [];
    for (let f = 0; f < 30; f++) {
      for (let i = 0; i < 3; i++) {
        commits.push(cmt(`f${f}c${i}`.padEnd(7, "x"), "alice", `2024-08-${String((i % 28) + 1).padStart(2, "0")}`, [`f${f}.ts`]));
      }
    }
    seed(commits);
    expect(busFactor(store, { minTouches: 1, topN: 5 })).toHaveLength(5);
  });
});
