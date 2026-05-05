import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MnemeStore } from "../store/sqlite.js";
import { parseDiff, suggestSubject, checkScope, recommendReviewers, coach } from "./commit-coach.js";
import type { Commit } from "../types.js";

let tmpDir: string;
let store: MnemeStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-coach-test-"));
  store = new MnemeStore(join(tmpDir, "mneme.db"));
});

afterEach(() => {
  store.close();
  rmSync(tmpDir, { recursive: true, force: true });
});

const cmt = (hash: string, author: string, date: string, subject: string, files: string[]): Commit => ({
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

function seed(commits: Commit[]) {
  store.upsertCommits(commits);
  for (const c of commits) {
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

const SAMPLE_DIFF = `diff --git a/src/auth/jwt.ts b/src/auth/jwt.ts
index abc..def 100644
--- a/src/auth/jwt.ts
+++ b/src/auth/jwt.ts
@@ -1,3 +1,5 @@
 export function sign(payload) {
-  return jwt.sign(payload, KEY);
+  return jwt.sign(payload, KEY, { expiresIn: "15m" });
 }
+export function refresh(token) { return jwt.refresh(token); }
diff --git a/src/auth/middleware.ts b/src/auth/middleware.ts
index 111..222 100644
--- a/src/auth/middleware.ts
+++ b/src/auth/middleware.ts
@@ -10,2 +10,3 @@
 export const authGuard = () => {
+  validateExpiry();
 };
`;

describe("parseDiff", () => {
  it("extracts file paths from `diff --git` headers", () => {
    const d = parseDiff(SAMPLE_DIFF);
    expect(d.files).toContain("src/auth/jwt.ts");
    expect(d.files).toContain("src/auth/middleware.ts");
  });

  it("counts added and removed lines", () => {
    const d = parseDiff(SAMPLE_DIFF);
    expect(d.added).toBeGreaterThan(0);
    expect(d.removed).toBeGreaterThan(0);
  });

  it("groups files into top-2-segment modules", () => {
    const d = parseDiff(SAMPLE_DIFF);
    expect(d.modules).toEqual(["src/auth"]);
  });

  it("classifies test-only diffs as 'test'", () => {
    const d = parseDiff(`diff --git a/tests/unit/foo.test.ts b/tests/unit/foo.test.ts
+const x = 1;`);
    expect(d.shape).toBe("test");
  });

  it("classifies docs-only diffs as 'docs'", () => {
    const d = parseDiff(`diff --git a/docs/CONTRIBUTING.md b/docs/CONTRIBUTING.md
+- new bullet`);
    expect(d.shape).toBe("docs");
  });

  it("classifies balanced add/remove ≥ 5 lines as 'refactor'", () => {
    const lines = ["diff --git a/src/x.ts b/src/x.ts"];
    for (let i = 0; i < 10; i++) {
      lines.push(`-old line ${i}`);
      lines.push(`+new line ${i}`);
    }
    expect(parseDiff(lines.join("\n")).shape).toBe("refactor");
  });
});

describe("suggestSubject", () => {
  it("uses Conventional Commits format when repo history shows it", () => {
    const diff = parseDiff(SAMPLE_DIFF);
    const subject = suggestSubject(diff, ["feat(auth): add jwt", "fix(auth): typo"]);
    expect(subject).toMatch(/^[a-z]+\([^)]+\):\s/);
  });

  it("falls back to imperative subject when repo doesn't use Conventional", () => {
    const diff = parseDiff(SAMPLE_DIFF);
    const subject = suggestSubject(diff, ["update stuff", "fix bug"]);
    expect(subject).not.toMatch(/^[a-z]+\(/);
  });
});

describe("checkScope", () => {
  it("approves single-module diffs", () => {
    const diff = parseDiff(SAMPLE_DIFF);
    const r = checkScope(diff);
    expect(r.scopeOK).toBe(true);
  });

  it("warns at 4+ modules", () => {
    const diff = {
      files: [],
      modules: ["src/a", "src/b", "src/c", "src/d", "src/e"],
      added: 0,
      removed: 0,
      shape: "feat" as const,
    };
    const r = checkScope(diff);
    expect(r.scopeOK).toBe(false);
    expect(r.message.toLowerCase()).toMatch(/scope creep|split/);
  });
});

describe("recommendReviewers — store-backed", () => {
  it("returns top reviewers ordered by ownership", () => {
    seed([
      cmt("a1", "alice", "2024-08-01", "fix", ["src/auth/jwt.ts"]),
      cmt("a2", "alice", "2024-08-02", "fix", ["src/auth/jwt.ts"]),
      cmt("a3", "alice", "2024-08-03", "fix", ["src/auth/jwt.ts"]),
      cmt("b1", "bob", "2024-08-04", "fix", ["src/auth/middleware.ts"]),
      cmt("b2", "bob", "2024-08-05", "fix", ["src/auth/middleware.ts"]),
    ]);
    const reviewers = recommendReviewers(store, ["src/auth/jwt.ts", "src/auth/middleware.ts"]);
    expect(reviewers).toHaveLength(2);
    expect(reviewers.map((r) => r.name).sort()).toEqual(["alice", "bob"]);
  });

  it("returns empty when no files provided", () => {
    expect(recommendReviewers(store, [])).toEqual([]);
  });
});

describe("coach — end-to-end", () => {
  it("returns a complete CoachAdvice payload", () => {
    seed([
      cmt("a1", "alice", "2024-08-01", "feat(auth): add jwt", ["src/auth/jwt.ts"]),
      cmt("a2", "alice", "2024-08-02", "fix(auth): typo", ["src/auth/jwt.ts"]),
    ]);
    const advice = coach(store, SAMPLE_DIFF);
    expect(advice.diff.files.length).toBeGreaterThan(0);
    expect(advice.suggestedSubject.length).toBeGreaterThan(0);
    expect(advice.scopeMessage.length).toBeGreaterThan(0);
  });

  it("surfaces past-regret warnings when similar fixes happened recently", () => {
    seed([
      cmt("a1", "alice", "2024-08-01", "refactor: simplify session middleware", ["src/auth/middleware.ts"]),
      cmt("a2", "alice", "2024-08-01", "hotfix: CSRF disappeared", ["src/auth/middleware.ts"]),
    ]);
    const advice = coach(store, SAMPLE_DIFF);
    expect(advice.warnings.length).toBeGreaterThan(0);
    expect(advice.warnings[0]!.pattern.toLowerCase()).toMatch(/middleware|hotfix/);
  });
});
