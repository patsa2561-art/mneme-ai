import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { parseGitLog, computeOverlaps, analyze, DEFAULT_STIGMERGY_CONFIG, buildFixture, verifyAgainstFixture } from "./index.js";
import type { CommitFact } from "./types.js";

let repo: string;
beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-stigmergy-")); });
afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

const NOW_MS = Date.parse("2026-05-10T12:00:00Z");
const iso = (offsetMs: number): string => new Date(NOW_MS + offsetMs).toISOString();

describe("parseGitLog", () => {
  it("parses well-formed git-log output", () => {
    const raw = [
      `abc1234|alice@x.com|${iso(0)}`,
      `src/foo.ts`,
      `src/bar.ts`,
      ``,
      `def5678|bob@x.com|${iso(-3600000)}`,
      `src/foo.ts`,
      ``,
    ].join("\n");
    const c = parseGitLog(raw);
    expect(c).toHaveLength(2);
    expect(c[0]!.email).toBe("alice@x.com");
    expect(c[0]!.files).toEqual(["src/foo.ts", "src/bar.ts"]);
    expect(c[1]!.email).toBe("bob@x.com");
    expect(c[1]!.files).toEqual(["src/foo.ts"]);
  });

  it("returns [] on empty input", () => {
    expect(parseGitLog("")).toEqual([]);
  });

  it("normalizes emails to lowercase", () => {
    const raw = `abc1234|ALICE@X.COM|${iso(0)}\nsrc/foo.ts\n`;
    const c = parseGitLog(raw);
    expect(c[0]!.email).toBe("alice@x.com");
  });

  it("filters incomplete commits (missing sha or email)", () => {
    const raw = `||${iso(0)}\nsrc/foo.ts\n`;
    expect(parseGitLog(raw)).toEqual([]);
  });
});

describe("computeOverlaps", () => {
  function commit(sha: string, email: string, atOffsetMs: number, files: string[]): CommitFact {
    return { sha, email, at: iso(atOffsetMs), files };
  }

  it("zero pairs when only one author touched all files", () => {
    const r = computeOverlaps([
      commit("a", "alice@x.com", 0, ["src/x.ts", "src/y.ts"]),
      commit("b", "alice@x.com", -3600000, ["src/x.ts"]),
    ]);
    expect(r).toEqual([]);
  });

  it("detects shared files between two authors", () => {
    const r = computeOverlaps([
      commit("a", "alice@x.com", 0, ["src/foo.ts"]),
      commit("b", "bob@x.com", -3600000, ["src/foo.ts"]),
    ]);
    expect(r).toHaveLength(1);
    expect(r[0]!.sharedFiles).toBe(1);
  });

  it("detects synchrony when 2 authors touch same file within 24h", () => {
    const r = computeOverlaps([
      commit("a", "alice@x.com", 0, ["src/foo.ts"]),
      commit("b", "bob@x.com", -1000 * 3600 * 12, ["src/foo.ts"]), // 12h earlier
    ]);
    expect(r[0]!.synchronyHits).toBe(1);
    expect(r[0]!.firstCoTouch).not.toBeNull();
  });

  it("does NOT count synchrony beyond the 24h window", () => {
    const r = computeOverlaps([
      commit("a", "alice@x.com", 0, ["src/foo.ts"]),
      commit("b", "bob@x.com", -1000 * 3600 * 48, ["src/foo.ts"]), // 48h earlier
    ]);
    expect(r[0]!.synchronyHits).toBe(0);
  });

  it("detects carry-on when author B extends file A introduced", () => {
    // Alice introduces foo.ts, Bob extends it 3 days later.
    const r = computeOverlaps([
      commit("b", "bob@x.com", -1000 * 86400 * 3, ["src/foo.ts"]), // bob 3d ago
      commit("a", "alice@x.com", -1000 * 86400 * 5, ["src/foo.ts"]), // alice 5d ago (introducer)
    ]);
    expect(r[0]!.carryOnHits).toBe(1);
  });

  it("does NOT count carry-on beyond the 7d window", () => {
    const r = computeOverlaps([
      commit("b", "bob@x.com", -1000 * 86400 * 30, ["src/foo.ts"]),
      commit("a", "alice@x.com", -1000 * 86400 * 60, ["src/foo.ts"]),
    ]);
    expect(r[0]!.carryOnHits).toBe(0);
  });

  it("ranks pairs by stigmergyScore desc", () => {
    const r = computeOverlaps([
      // Pair (alice, bob) - HIGH: shared + synchrony + carry-on
      commit("a1", "alice@x.com", -86400_000, ["src/hot.ts"]),
      commit("a2", "bob@x.com", -3600_000, ["src/hot.ts"]),
      commit("a3", "bob@x.com", 0, ["src/hot.ts"]),
      // Pair (carol, dave) - LOW: just shared
      commit("a4", "carol@x.com", -1000 * 86400 * 60, ["src/cold.ts"]),
      commit("a5", "dave@x.com", -1000 * 86400 * 30, ["src/cold.ts"]),
    ]);
    expect(r.length).toBeGreaterThanOrEqual(2);
    expect(r[0]!.stigmergyScore).toBeGreaterThan(r[r.length - 1]!.stigmergyScore);
  });

  it("scores stay in [0, 100]", () => {
    const commits: CommitFact[] = [];
    for (let i = 0; i < 50; i++) {
      commits.push(commit(`sha${i}`, "alice@x.com", -i * 1000, ["f.ts"]));
      commits.push(commit(`shb${i}`, "bob@x.com", -i * 1000 - 100, ["f.ts"]));
    }
    const r = computeOverlaps(commits);
    expect(r[0]!.stigmergyScore).toBeLessThanOrEqual(100);
    expect(r[0]!.stigmergyScore).toBeGreaterThanOrEqual(0);
  });

  it("DEFAULT_STIGMERGY_CONFIG is exported with sensible values", () => {
    expect(DEFAULT_STIGMERGY_CONFIG.windowCommits).toBeGreaterThan(0);
    expect(DEFAULT_STIGMERGY_CONFIG.synchronyHours).toBeGreaterThan(0);
    expect(DEFAULT_STIGMERGY_CONFIG.carryOnDays).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// v1.27.7: synthetic fixture + verification harness
// ─────────────────────────────────────────────────────────────────────────
describe("v1.27.7 fixture + verifyAgainstFixture", () => {
  it("buildFixture produces deterministic 5-author commits", () => {
    const f1 = buildFixture(42);
    const f2 = buildFixture(42);
    expect(f1.commits.length).toBe(f2.commits.length);
    expect(f1.commits[0]!.sha).toBe(f2.commits[0]!.sha);
    expect(f1.commits[0]!.email).toBe(f2.commits[0]!.email);
    const authors = new Set(f1.commits.map((c) => c.email));
    expect(authors.size).toBe(5);
    expect(authors.has("alice@example.com")).toBe(true);
    expect(authors.has("eve@example.com")).toBe(true);
  });

  it("buildFixture has expected pairs declared", () => {
    const f = buildFixture(42);
    const highPairs = f.expectedPairs.filter((p) => p.band === "high");
    expect(highPairs).toHaveLength(2);
    expect(f.loneAuthors).toContain("eve@example.com");
  });

  it("verifyAgainstFixture passes -- algorithm detects engineered pairs", () => {
    const r = verifyAgainstFixture(computeOverlaps);
    expect(r.ok).toBe(true);
    // alice+bob and carol+dave should both score high.
    const ab = r.detectedScores["alice@example.com::bob@example.com"];
    const cd = r.detectedScores["carol@example.com::dave@example.com"];
    expect(ab).toBeDefined();
    expect(cd).toBeDefined();
    expect(ab!).toBeGreaterThanOrEqual(50);
    expect(cd!).toBeGreaterThanOrEqual(50);
  });

  it("verifyAgainstFixture surfaces alice+carol below threshold (weak overlap)", () => {
    const r = verifyAgainstFixture(computeOverlaps);
    const ac = r.detectedScores["alice@example.com::carol@example.com"];
    expect(ac).toBeDefined();
    expect(ac!).toBeGreaterThan(0);
    expect(ac!).toBeLessThan(30);
  });

  it("verifyAgainstFixture: eve never appears in a HIGH pair", () => {
    const r = verifyAgainstFixture(computeOverlaps);
    const eveKeys = Object.keys(r.detectedScores).filter((k) => k.includes("eve@example.com"));
    for (const k of eveKeys) {
      expect(r.detectedScores[k]!).toBeLessThan(50);
    }
  });
});

describe("analyze (e2e against a real git repo)", () => {
  it("returns sane report on a fresh git repo", () => {
    spawnSync("git", ["init", "-q"], { cwd: repo });
    spawnSync("git", ["config", "user.email", "alice@x.com"], { cwd: repo });
    spawnSync("git", ["config", "user.name", "alice"], { cwd: repo });
    mkdirSync(join(repo, "src"), { recursive: true });
    writeFileSync(join(repo, "src/foo.ts"), "x", "utf8");
    spawnSync("git", ["add", "."], { cwd: repo });
    spawnSync("git", ["commit", "-q", "-m", "init"], { cwd: repo });

    const r = analyze(repo);
    expect(r.commitsAnalysed).toBeGreaterThanOrEqual(1);
    expect(r.authorCount).toBeGreaterThanOrEqual(1);
  });

  it("returns empty report when git not initialized", () => {
    const r = analyze(repo);
    expect(r.commitsAnalysed).toBe(0);
    expect(r.pairs).toEqual([]);
  });
});
