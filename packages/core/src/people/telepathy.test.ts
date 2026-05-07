import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MnemeStore } from "../store/sqlite.js";
import {
  extractCoAuthorEmails,
  telepathy,
  topicsForPaths,
} from "./telepathy.js";
import type { Commit } from "../types.js";

let tmpDir: string;
let store: MnemeStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-telepathy-test-"));
  store = new MnemeStore(join(tmpDir, "mneme.db"));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

function cmt(
  hash: string,
  author: string,
  isoDate: string,
  files: string[],
  body = "",
): Commit {
  return {
    hash,
    shortHash: hash.slice(0, 7),
    authorName: author,
    authorEmail: `${author}@x`,
    authorDate: isoDate,
    committerDate: isoDate,
    subject: `commit by ${author}`,
    body,
    parents: [],
    files,
  };
}

function seed(commits: Commit[]) {
  store.upsertCommits(commits);
  for (const c of commits) {
    if (c.files.length === 0) continue;
    store.upsertFileChanges(
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

// ─── pure helpers ─────────────────────────────────────────────────────

describe("topicsForPaths", () => {
  it("uses depth-2 directory as the topic for nested paths", () => {
    const t = topicsForPaths([
      "packages/core/src/audit/baseline.ts",
      "packages/core/src/audit/trace.ts",
    ]);
    // Both share a common topic key.
    expect(t.has("packages/core/src")).toBe(true);
  });

  it("uses the parent directory for shallow paths", () => {
    const t = topicsForPaths(["src/auth.ts"]);
    expect(t.has("src")).toBe(true);
  });

  it("treats top-level files as a top-level token", () => {
    const t = topicsForPaths(["README.md"]);
    expect(t.has("README.md")).toBe(true);
  });

  it("returns an empty set for empty input", () => {
    expect(topicsForPaths([]).size).toBe(0);
  });
});

describe("extractCoAuthorEmails", () => {
  it("parses Co-authored-by trailers", () => {
    const body = "fix: thing\n\nCo-authored-by: Bob <bob@x>\nCo-authored-by: Eve <Eve@X>";
    const out = extractCoAuthorEmails(body);
    expect(out).toEqual(expect.arrayContaining(["bob@x", "eve@x"]));
  });

  it("returns [] for empty body", () => {
    expect(extractCoAuthorEmails("")).toEqual([]);
  });
});

// ─── happy path ───────────────────────────────────────────────────────

describe("telepathy — happy path", () => {
  it("surfaces a repeated pair on a shared topic", () => {
    // Alice + Bob: 4 events on the same dir, within window.
    const commits: Commit[] = [];
    for (let i = 0; i < 4; i++) {
      const day = `2024-01-${String((i * 2) + 1).padStart(2, "0")}`;
      commits.push(cmt(`a${i}aaaa`, "alice", `${day}T08:00:00Z`, ["src/auth/login.ts"]));
      commits.push(cmt(`b${i}bbbb`, "bob",   `${day}T20:00:00Z`, ["src/auth/session.ts"]));
    }
    seed(commits);
    const r = telepathy(store, { windowHours: 48, minEvents: 2, topN: 5 });
    expect(r.pairs.length).toBe(1);
    const pair = r.pairs[0]!;
    const emails = [pair.authorA.email, pair.authorB.email].sort();
    expect(emails).toEqual(["alice@x", "bob@x"]);
    expect(pair.events).toBeGreaterThanOrEqual(4);
    expect(pair.topTopic.topic).toBe("src/auth");
    expect(pair.score).toBeGreaterThan(0);
  });

  it("ranks pairs by score descending", () => {
    const commits: Commit[] = [];
    // Strong pair: alice + bob, 5 hits.
    for (let i = 0; i < 5; i++) {
      const day = `2024-02-${String(i + 1).padStart(2, "0")}`;
      commits.push(cmt(`p${i}aaaa`, "alice", `${day}T08:00:00Z`, ["src/auth/x.ts"]));
      commits.push(cmt(`p${i}bbbb`, "bob",   `${day}T10:00:00Z`, ["src/auth/y.ts"]));
    }
    // Weaker pair: carol + dan, 3 hits, more opportunities.
    for (let i = 0; i < 3; i++) {
      const day = `2024-02-${String(i + 1).padStart(2, "0")}`;
      commits.push(cmt(`q${i}cccc`, "carol", `${day}T11:00:00Z`, ["src/api/x.ts"]));
      commits.push(cmt(`q${i}dddd`, "dan",   `${day}T12:00:00Z`, ["src/api/y.ts"]));
    }
    seed(commits);
    const r = telepathy(store, { windowHours: 48, minEvents: 3, topN: 5 });
    expect(r.pairs.length).toBe(2);
    expect(r.pairs[0]!.score).toBeGreaterThanOrEqual(r.pairs[1]!.score);
  });
});

// ─── edge cases ───────────────────────────────────────────────────────

describe("telepathy — edge cases", () => {
  it("returns empty result on an empty repo", () => {
    const r = telepathy(store);
    expect(r.pairs).toEqual([]);
    expect(r.stats.commitCount).toBe(0);
    expect(r.stats.authorCount).toBe(0);
  });

  it("returns empty result with a single author", () => {
    seed([
      cmt("aaaaaaaa", "alice", "2024-01-01T08:00:00Z", ["src/auth/login.ts"]),
      cmt("bbbbbbbb", "alice", "2024-01-02T08:00:00Z", ["src/auth/session.ts"]),
    ]);
    const r = telepathy(store, { minEvents: 1 });
    expect(r.pairs).toEqual([]);
    expect(r.stats.authorCount).toBe(1);
  });

  it("excludes co-authored commits — explicit collaboration is NOT telepathy", () => {
    const body = "feat: ship\n\nCo-authored-by: Bob <bob@x>";
    seed([
      cmt("c1c1c1c1", "alice", "2024-01-01T08:00:00Z", ["src/auth/x.ts"], body),
      cmt("c2c2c2c2", "bob",   "2024-01-01T10:00:00Z", ["src/auth/y.ts"]),
      cmt("c3c3c3c3", "alice", "2024-01-02T08:00:00Z", ["src/auth/x.ts"], body),
      cmt("c4c4c4c4", "bob",   "2024-01-02T10:00:00Z", ["src/auth/y.ts"]),
    ]);
    const r = telepathy(store, { minEvents: 1 });
    expect(r.pairs).toEqual([]);
  });

  it("respects narrow time window (drops events outside)", () => {
    seed([
      cmt("d1aaaaaa", "alice", "2024-01-01T00:00:00Z", ["src/auth/x.ts"]),
      cmt("d2bbbbbb", "bob",   "2024-01-01T01:00:00Z", ["src/auth/y.ts"]),
      cmt("d3aaaaaa", "alice", "2024-01-05T00:00:00Z", ["src/auth/x.ts"]),
      cmt("d4bbbbbb", "bob",   "2024-01-05T01:00:00Z", ["src/auth/y.ts"]),
      cmt("d5aaaaaa", "alice", "2024-01-10T00:00:00Z", ["src/auth/x.ts"]),
      cmt("d6bbbbbb", "bob",   "2024-01-10T01:00:00Z", ["src/auth/y.ts"]),
    ]);
    const narrow = telepathy(store, { windowHours: 2, minEvents: 1 });
    const wide = telepathy(store, { windowHours: 48, minEvents: 1 });
    expect(narrow.pairs[0]!.events).toBe(3);
    expect(wide.pairs[0]!.events).toBeGreaterThanOrEqual(3);
    // Wider window may admit more opportunities; events should not decrease.
    expect(wide.pairs[0]!.events).toBeGreaterThanOrEqual(narrow.pairs[0]!.events);
  });

  it("filters pairs below minEvents", () => {
    seed([
      cmt("e1aaaaaa", "alice", "2024-01-01T00:00:00Z", ["src/auth/x.ts"]),
      cmt("e2bbbbbb", "bob",   "2024-01-01T01:00:00Z", ["src/auth/y.ts"]),
      cmt("e3aaaaaa", "alice", "2024-01-02T00:00:00Z", ["src/auth/x.ts"]),
      cmt("e4bbbbbb", "bob",   "2024-01-02T01:00:00Z", ["src/auth/y.ts"]),
    ]);
    const strict = telepathy(store, { windowHours: 24, minEvents: 5 });
    expect(strict.pairs).toEqual([]);
    const lax = telepathy(store, { windowHours: 24, minEvents: 1 });
    expect(lax.pairs.length).toBe(1);
  });

  it("ignores pairs with no shared topic", () => {
    seed([
      cmt("f1aaaaaa", "alice", "2024-01-01T00:00:00Z", ["src/auth/x.ts"]),
      cmt("f2bbbbbb", "bob",   "2024-01-01T01:00:00Z", ["src/billing/y.ts"]),
      cmt("f3aaaaaa", "alice", "2024-01-02T00:00:00Z", ["src/auth/x.ts"]),
      cmt("f4bbbbbb", "bob",   "2024-01-02T01:00:00Z", ["src/billing/y.ts"]),
    ]);
    const r = telepathy(store, { windowHours: 6, minEvents: 1 });
    expect(r.pairs).toEqual([]);
  });

  it("filters by --author email when provided", () => {
    seed([
      cmt("g1aaaaaa", "alice", "2024-01-01T00:00:00Z", ["src/auth/x.ts"]),
      cmt("g2bbbbbb", "bob",   "2024-01-01T01:00:00Z", ["src/auth/y.ts"]),
      cmt("g3cccccc", "carol", "2024-01-01T02:00:00Z", ["src/auth/z.ts"]),
      cmt("g4ddddd1", "dan",   "2024-01-01T03:00:00Z", ["src/auth/q.ts"]),
      cmt("g5aaaaaa", "alice", "2024-01-02T00:00:00Z", ["src/auth/x.ts"]),
      cmt("g6bbbbbb", "bob",   "2024-01-02T01:00:00Z", ["src/auth/y.ts"]),
      cmt("g7cccccc", "carol", "2024-01-02T02:00:00Z", ["src/auth/z.ts"]),
      cmt("g8ddddd1", "dan",   "2024-01-02T03:00:00Z", ["src/auth/q.ts"]),
    ]);
    const all = telepathy(store, { windowHours: 24, minEvents: 1 });
    const onlyAlice = telepathy(store, { windowHours: 24, minEvents: 1, authorEmail: "alice@x" });
    expect(all.pairs.length).toBeGreaterThan(onlyAlice.pairs.length);
    for (const p of onlyAlice.pairs) {
      expect([p.authorA.email, p.authorB.email]).toContain("alice@x");
    }
  });

  it("topN caps the result list", () => {
    const commits: Commit[] = [];
    // Generate many co-active pairs.
    const names = ["a", "b", "c", "d", "e", "f"];
    let h = 0;
    for (let day = 1; day <= 8; day++) {
      for (const n of names) {
        commits.push(
          cmt(
            `t${(h++).toString(16).padStart(7, "0")}`,
            n,
            `2024-03-${String(day).padStart(2, "0")}T0${names.indexOf(n)}:00:00Z`,
            ["src/auth/file.ts"],
          ),
        );
      }
    }
    seed(commits);
    const r = telepathy(store, { windowHours: 24, minEvents: 1, topN: 3 });
    expect(r.pairs.length).toBeLessThanOrEqual(3);
  });

  it("orders authorA by lower email lexically (canonical pair)", () => {
    seed([
      cmt("h1bbbbbb", "bob",   "2024-01-01T00:00:00Z", ["src/auth/x.ts"]),
      cmt("h2aaaaaa", "alice", "2024-01-01T01:00:00Z", ["src/auth/y.ts"]),
      cmt("h3bbbbbb", "bob",   "2024-01-02T00:00:00Z", ["src/auth/x.ts"]),
      cmt("h4aaaaaa", "alice", "2024-01-02T01:00:00Z", ["src/auth/y.ts"]),
    ]);
    const r = telepathy(store, { windowHours: 24, minEvents: 1 });
    expect(r.pairs[0]!.authorA.email < r.pairs[0]!.authorB.email).toBe(true);
  });
});

// ─── stats + JSON shape ───────────────────────────────────────────────

describe("telepathy — stats and JSON shape", () => {
  it("populates stats correctly", () => {
    seed([
      cmt("k1aaaaaa", "alice", "2024-01-01T00:00:00Z", ["src/auth/x.ts"]),
      cmt("k2bbbbbb", "bob",   "2024-01-01T01:00:00Z", ["src/auth/y.ts"]),
      cmt("k3aaaaaa", "alice", "2024-01-02T00:00:00Z", ["src/auth/x.ts"]),
      cmt("k4bbbbbb", "bob",   "2024-01-02T01:00:00Z", ["src/auth/y.ts"]),
    ]);
    const r = telepathy(store, { windowHours: 24, minEvents: 1 });
    expect(r.stats.authorCount).toBe(2);
    expect(r.stats.commitCount).toBe(4);
    expect(r.stats.windowHours).toBe(24);
    expect(r.stats.pairsEvaluated).toBeGreaterThanOrEqual(1);
  });

  it("each pair's recentEvents are newest-first and capped at 3", () => {
    const commits: Commit[] = [];
    for (let i = 0; i < 6; i++) {
      const day = `2024-04-${String(i + 1).padStart(2, "0")}`;
      commits.push(cmt(`r${i}aaaaa`, "alice", `${day}T08:00:00Z`, ["src/auth/x.ts"]));
      commits.push(cmt(`r${i}bbbbb`, "bob",   `${day}T10:00:00Z`, ["src/auth/y.ts"]));
    }
    seed(commits);
    const r = telepathy(store, { windowHours: 24, minEvents: 1 });
    const events = r.pairs[0]!.recentEvents;
    expect(events.length).toBeLessThanOrEqual(3);
    for (let i = 1; i < events.length; i++) {
      expect(Date.parse(events[i - 1]!.laterAt)).toBeGreaterThanOrEqual(
        Date.parse(events[i]!.laterAt),
      );
    }
  });

  it("score is non-negative and finite for every reported pair", () => {
    seed([
      cmt("s1aaaaaa", "alice", "2024-01-01T00:00:00Z", ["src/auth/x.ts"]),
      cmt("s2bbbbbb", "bob",   "2024-01-01T01:00:00Z", ["src/auth/y.ts"]),
      cmt("s3aaaaaa", "alice", "2024-01-02T00:00:00Z", ["src/auth/x.ts"]),
      cmt("s4bbbbbb", "bob",   "2024-01-02T01:00:00Z", ["src/auth/y.ts"]),
      cmt("s5aaaaaa", "alice", "2024-01-03T00:00:00Z", ["src/auth/x.ts"]),
      cmt("s6bbbbbb", "bob",   "2024-01-03T01:00:00Z", ["src/auth/y.ts"]),
    ]);
    const r = telepathy(store, { windowHours: 24, minEvents: 1 });
    for (const p of r.pairs) {
      expect(Number.isFinite(p.score)).toBe(true);
      expect(p.score).toBeGreaterThanOrEqual(0);
    }
  });
});
