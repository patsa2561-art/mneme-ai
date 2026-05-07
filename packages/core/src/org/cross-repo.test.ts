import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MnemeStore } from "../store/sqlite.js";
import type { Commit } from "../types.js";
import { runOrgNervousSystem, type RepoHandle } from "./index.js";

let tmpDir: string;
const stores: MnemeStore[] = [];

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-cross-"));
});

afterEach(() => {
  for (const s of stores.splice(0)) s.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function newStore(name: string): MnemeStore {
  const s = new MnemeStore(join(tmpDir, name, "mneme.db"));
  stores.push(s);
  return s;
}

function commit(
  hash: string,
  email: string,
  iso: string,
  files: string[],
): Commit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    authorName: email.split("@")[0]!,
    authorEmail: email,
    authorDate: iso,
    committerDate: iso,
    subject: `commit ${hash}`,
    body: "",
    parents: [],
    files,
  };
}

function pad(prefix: string, n: number): string {
  return (prefix + n.toString().padStart(2, "0")).padEnd(16, "f");
}

function seed(s: MnemeStore, commits: Commit[]) {
  s.upsertCommits(commits);
  for (const c of commits) {
    if (c.files.length === 0) continue;
    s.upsertFileChanges(
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

describe("org/cross-repo — empty + single-repo paths", () => {
  it("handles an empty handles array gracefully", () => {
    const r = runOrgNervousSystem(
      { name: "empty-org", reposRequested: 0, reposMissing: [] },
      [],
    );
    expect(r.totals.commits).toBe(0);
    expect(r.crossRepoPairs).toEqual([]);
    expect(r.crossRepoAtrophy).toEqual([]);
    expect(r.limits.some((l) => l.includes("No indexed repos"))).toBe(true);
  });

  it("flags a single-repo org as undercount", () => {
    const s = newStore("solo");
    seed(s, [commit(pad("a", 1), "alice@x.io", "2024-01-01T00:00:00Z", ["a.ts"])]);
    const handles: RepoHandle[] = [{ path: "/work/solo", store: s }];
    const r = runOrgNervousSystem(
      { name: "small", reposRequested: 1, reposMissing: [] },
      handles,
    );
    expect(r.org.reposIndexed).toBe(1);
    expect(r.limits.some((l) => l.includes("≥ 2"))).toBe(true);
  });
});

describe("org/cross-repo — totals", () => {
  it("sums commits + dedupes authors across repos", () => {
    const repoA = newStore("repoA");
    const repoB = newStore("repoB");
    seed(repoA, [
      commit(pad("a", 1), "alice@x.io", "2024-01-01T00:00:00Z", ["src/a.ts"]),
      commit(pad("a", 2), "bob@x.io", "2024-01-02T00:00:00Z", ["src/a.ts"]),
    ]);
    seed(repoB, [
      commit(pad("b", 1), "alice@x.io", "2024-01-03T00:00:00Z", ["src/b.ts"]),
      commit(pad("b", 2), "carol@x.io", "2024-01-04T00:00:00Z", ["src/b.ts"]),
    ]);
    const r = runOrgNervousSystem(
      { name: "x", reposRequested: 2, reposMissing: [] },
      [
        { path: "/work/A", store: repoA },
        { path: "/work/B", store: repoB },
      ],
    );
    expect(r.totals.commits).toBe(4);
    expect(r.totals.authors).toBe(3);
    expect(r.totals.files).toBe(2);
  });

  it("propagates reposMissing into the limits panel", () => {
    const r = runOrgNervousSystem(
      { name: "x", reposRequested: 3, reposMissing: ["/work/X"] },
      [],
    );
    expect(r.limits.some((l) => l.includes("not yet indexed"))).toBe(true);
  });
});

describe("org/cross-repo — pair detection", () => {
  it("surfaces pairs that appear in ≥2 repos", () => {
    // Both repos: Alice commits, then Bob commits within window on similar topics.
    const t0 = "2024-01-01T00:00:00Z";
    const t1 = "2024-01-01T01:00:00Z";
    const t2 = "2024-01-01T02:00:00Z";
    const t3 = "2024-01-01T03:00:00Z";

    const a = newStore("a");
    seed(a, [
      commit(pad("aa", 1), "alice@x.io", t0, ["src/auth/a.ts"]),
      commit(pad("aa", 2), "bob@x.io", t1, ["src/auth/b.ts"]),
      commit(pad("aa", 3), "alice@x.io", t2, ["src/auth/c.ts"]),
      commit(pad("aa", 4), "bob@x.io", t3, ["src/auth/d.ts"]),
    ]);
    const b = newStore("b");
    seed(b, [
      commit(pad("bb", 1), "alice@x.io", t0, ["src/billing/a.ts"]),
      commit(pad("bb", 2), "bob@x.io", t1, ["src/billing/b.ts"]),
      commit(pad("bb", 3), "alice@x.io", t2, ["src/billing/c.ts"]),
      commit(pad("bb", 4), "bob@x.io", t3, ["src/billing/d.ts"]),
    ]);

    const r = runOrgNervousSystem(
      { name: "two", reposRequested: 2, reposMissing: [] },
      [
        { path: "/work/A", store: a },
        { path: "/work/B", store: b },
      ],
      { telepathyWindowHours: 24 },
    );
    // Alice ↔ Bob should be the leading cross-repo pair.
    expect(r.crossRepoPairs.length).toBeGreaterThan(0);
    const top = r.crossRepoPairs[0]!;
    expect(top.reposCovered).toBe(2);
    expect([top.authorA.email, top.authorB.email].sort()).toEqual([
      "alice@x.io",
      "bob@x.io",
    ]);
  });

  it("excludes pairs that only show up in a single repo", () => {
    const a = newStore("a");
    seed(a, [
      commit(pad("aa", 1), "alice@x.io", "2024-01-01T00:00:00Z", ["src/x/a.ts"]),
      commit(pad("aa", 2), "bob@x.io", "2024-01-01T01:00:00Z", ["src/x/b.ts"]),
      commit(pad("aa", 3), "alice@x.io", "2024-01-01T02:00:00Z", ["src/x/c.ts"]),
      commit(pad("aa", 4), "bob@x.io", "2024-01-01T03:00:00Z", ["src/x/d.ts"]),
    ]);
    const b = newStore("b");
    seed(b, [commit(pad("bb", 1), "alice@x.io", "2024-01-02T00:00:00Z", ["src/y/a.ts"])]);
    const r = runOrgNervousSystem(
      { name: "x", reposRequested: 2, reposMissing: [] },
      [
        { path: "/work/A", store: a },
        { path: "/work/B", store: b },
      ],
    );
    // Alice-Bob pair is in repoA only — not a cross-repo pair.
    expect(r.crossRepoPairs).toEqual([]);
  });
});

describe("org/cross-repo — atrophy aggregation", () => {
  it("merges at-risk files from every repo into one ranked list", () => {
    const a = newStore("a");
    const b = newStore("b");
    // a.ts: only one stale touch by alice in repoA.
    seed(a, [
      commit(pad("aa", 1), "alice@x.io", "2020-01-01T00:00:00Z", ["src/a.ts"]),
    ]);
    // c.ts: also stale, in repoB.
    seed(b, [
      commit(pad("bb", 1), "carol@x.io", "2020-01-01T00:00:00Z", ["src/c.ts"]),
    ]);
    const r = runOrgNervousSystem(
      { name: "x", reposRequested: 2, reposMissing: [] },
      [
        { path: "/work/A", store: a },
        { path: "/work/B", store: b },
      ],
    );
    const paths = r.crossRepoAtrophy.map((row) => row.filePath);
    expect(paths).toContain("src/a.ts");
    expect(paths).toContain("src/c.ts");
    // Each row should know which repo it lives in.
    for (const row of r.crossRepoAtrophy) {
      expect(["/work/A", "/work/B"]).toContain(row.repoPath);
    }
  });
});
