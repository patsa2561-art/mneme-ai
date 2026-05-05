import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MnemeStore } from "../store/sqlite.js";
import { fingerprint, similarity, predict } from "./crystal-ball.js";
import { parseDiff } from "./commit-coach.js";
import type { Commit } from "../types.js";

let tmpDir: string;
let store: MnemeStore;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "mneme-cb-test-"));
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

describe("fingerprint", () => {
  it("extracts modules, extensions, shape, size, hasTests", () => {
    const diff = parseDiff(`diff --git a/src/auth/jwt.ts b/src/auth/jwt.ts
+const x = 1;`);
    const fp = fingerprint(diff);
    expect(fp.modules).toEqual(["src/auth"]);
    expect(fp.extensions).toEqual(["ts"]);
    expect(fp.size).toBe("tiny");
    expect(fp.hasTests).toBe(false);
  });

  it("flags hasTests when *.test.ts present", () => {
    const diff = parseDiff(`diff --git a/src/foo.test.ts b/src/foo.test.ts
+test('x', () => {});`);
    expect(fingerprint(diff).hasTests).toBe(true);
  });

  it("size buckets are tiny/small/medium/large by line count", () => {
    const tiny = fingerprint({ files: [], modules: [], added: 5, removed: 5, shape: "feat" });
    const small = fingerprint({ files: [], modules: [], added: 50, removed: 30, shape: "feat" });
    const medium = fingerprint({ files: [], modules: [], added: 200, removed: 200, shape: "feat" });
    const large = fingerprint({ files: [], modules: [], added: 800, removed: 100, shape: "feat" });
    expect(tiny.size).toBe("tiny");
    expect(small.size).toBe("small");
    expect(medium.size).toBe("medium");
    expect(large.size).toBe("large");
  });
});

describe("similarity", () => {
  const fp = (overrides: Partial<ReturnType<typeof fingerprint>> = {}) => ({
    modules: ["src/auth"],
    extensions: ["ts"],
    shape: "feat" as const,
    size: "small" as const,
    hasTests: false,
    ...overrides,
  });

  it("identical fingerprints score 1.0", () => {
    expect(similarity(fp(), fp())).toBe(1);
  });

  it("module overlap dominates the score (40% weight)", () => {
    const a = fp({ modules: ["src/auth"] });
    const b = fp({ modules: ["src/payment"] });
    // No module overlap → modules contributes 0
    // Same exts (1.0 × 0.2), shape (0.2), size (0.1), tests (0.1) = 0.6
    expect(similarity(a, b)).toBeCloseTo(0.6, 1);
  });

  it("size distance reduces score linearly", () => {
    const a = fp({ size: "tiny" });
    const b = fp({ size: "large" });
    const s = similarity(a, b);
    // Other dims identical (0.9 weight), size dim 0
    expect(s).toBeCloseTo(0.9, 1);
  });
});

describe("predict — empty repo edge case", () => {
  it("returns 'unknown' verdict when repo is empty", () => {
    const p = predict(store, "diff --git a/src/x.ts b/src/x.ts\n+const x = 1;");
    expect(p.verdict).toBe("unknown");
    expect(p.similarN).toBe(0);
    expect(p.recommendation.toLowerCase()).toMatch(/index|signal/);
  });
});

describe("predict — clean prediction", () => {
  it("predicts 'clear' when most similar past changes shipped cleanly", () => {
    const seedCommits = Array.from({ length: 20 }, (_, i) =>
      cmt(`a${i}1234567`, "alice", `2024-08-${String((i % 28) + 1).padStart(2, "0")}`, `feat(auth): add thing ${i}`, ["src/auth/jwt.ts"]),
    );
    seed(seedCommits);
    const p = predict(store, `diff --git a/src/auth/jwt.ts b/src/auth/jwt.ts
+const x = 1;`);
    expect(p.similarN).toBeGreaterThan(0);
    expect(p.verdict).toBe("clear");
    expect(p.pClean).toBeGreaterThan(0.8);
  });
});

describe("predict — risky prediction", () => {
  it("predicts 'risky' when many similar past changes needed follow-up fixes", () => {
    const commits: Commit[] = [];
    // 10 pairs of (shipped, fix-2-days-later) on src/auth
    for (let i = 0; i < 10; i++) {
      const day = String(i * 3 + 1).padStart(2, "0");
      const fixDay = String(i * 3 + 3).padStart(2, "0");
      commits.push(cmt(`a${i}_____`, "alice", `2024-08-${day}`, `feat(auth): add thing ${i}`, ["src/auth/jwt.ts"]));
      commits.push(cmt(`b${i}_____`, "alice", `2024-08-${fixDay}`, `fix: thing ${i} broke`, ["src/auth/jwt.ts"]));
    }
    seed(commits);
    const p = predict(store, `diff --git a/src/auth/jwt.ts b/src/auth/jwt.ts
+const x = 1;`);
    expect(p.similarN).toBeGreaterThanOrEqual(5);
    expect(["risky", "moderate"]).toContain(p.verdict);
    expect(p.pClean).toBeLessThan(0.7);
  });
});

describe("predict — low signal verdict", () => {
  it("returns 'unknown' when similar count is below 5", () => {
    seed([
      cmt("a1", "alice", "2024-08-01", "feat: thing", ["src/auth/jwt.ts"]),
      cmt("a2", "alice", "2024-08-02", "feat: thing 2", ["src/auth/jwt.ts"]),
    ]);
    const p = predict(store, `diff --git a/src/auth/jwt.ts b/src/auth/jwt.ts
+const x = 1;`);
    expect(["unknown", "clear"]).toContain(p.verdict);
    if (p.similarN < 5) expect(p.verdict).toBe("unknown");
  });
});

describe("predict — most-similar reference", () => {
  it("returns the most-similar past commit alongside the prediction", () => {
    seed([
      cmt("a1xxxxxx", "alice", "2024-08-01", "feat(auth): unique subject", ["src/auth/jwt.ts"]),
      ...Array.from({ length: 10 }, (_, i) =>
        cmt(`b${i}xxxxxx`, "alice", `2024-09-${String(i + 1).padStart(2, "0")}`, `feat: misc`, ["src/other/foo.ts"]),
      ),
    ]);
    const p = predict(store, `diff --git a/src/auth/jwt.ts b/src/auth/jwt.ts
+const x = 1;`);
    expect(p.mostSimilar?.hash).toBeDefined();
    expect(["clean", "trouble"]).toContain(p.mostSimilar?.outcome);
  });
});
