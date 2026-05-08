/**
 * Query engine tests.
 *
 * Critical guarantees verified:
 *   • code-search: pattern matching is correct + bounded
 *   • code-search: skipped dirs honored (node_modules etc.)
 *   • code-search: bad regex returns structured error (no throw)
 *   • code-search: maxResults respected
 *   • git-history: real git log parsed correctly
 *   • git-history: missing path returns empty (not error)
 *   • git-history: shell metachar in path → refuse
 *   • entity-graph: returns structured "needs index" error
 *   • dispatcher: routes to correct executor
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execSync } from "node:child_process";
import {
  executeCodeSearch,
  executeGitHistory,
  executeEntityGraph,
  executeQuery,
  _SKIPPED_DIRS_FOR_TESTS,
} from "./query-engine.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-q-"));
});

afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

describe("executeCodeSearch — pattern matching", () => {
  it("finds matches in matching files", () => {
    mkdirSync(join(tmp, "src"));
    writeFileSync(join(tmp, "src/billing.ts"), "import Stripe from 'stripe';\nconst c = stripe.prices.list();\n");
    const r = executeCodeSearch(
      { kind: "code-search", patterns: ["stripe\\.prices\\."], fileExtensions: ["ts"], maxResults: 50, ranking: "centrality-desc" },
      tmp,
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.result.kind !== "code-search") throw new Error("expected ok");
    expect(r.result.hits).toHaveLength(1);
    expect(r.result.hits[0]!.path).toBe("src/billing.ts");
    expect(r.result.hits[0]!.line).toBe(2);
    expect(r.result.hits[0]!.matchedPattern).toBe("stripe\\.prices\\.");
  });

  it("respects file extension filter", () => {
    writeFileSync(join(tmp, "a.ts"), "stripe.prices.list();\n");
    writeFileSync(join(tmp, "b.txt"), "stripe.prices.list();\n"); // ignored
    const r = executeCodeSearch(
      { kind: "code-search", patterns: ["stripe\\.prices"], fileExtensions: ["ts"], maxResults: 50, ranking: "alphabetical" },
      tmp,
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.result.kind !== "code-search") throw new Error();
    expect(r.result.hits).toHaveLength(1);
    expect(r.result.hits[0]!.path).toBe("a.ts");
  });

  it("skips node_modules and dist directories", () => {
    mkdirSync(join(tmp, "node_modules", "stripe"), { recursive: true });
    mkdirSync(join(tmp, "dist"), { recursive: true });
    writeFileSync(join(tmp, "node_modules/stripe/index.ts"), "stripe.prices.list();\n");
    writeFileSync(join(tmp, "dist/bundle.ts"), "stripe.prices.list();\n");
    writeFileSync(join(tmp, "src.ts"), "stripe.prices.list();\n");
    mkdirSync(join(tmp, "src"));
    writeFileSync(join(tmp, "src.ts"), "stripe.prices.list();\n");

    const r = executeCodeSearch(
      { kind: "code-search", patterns: ["stripe\\.prices"], fileExtensions: ["ts"], maxResults: 50, ranking: "alphabetical" },
      tmp,
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.result.kind !== "code-search") throw new Error();
    // Only src.ts at root should match
    expect(r.result.hits).toHaveLength(1);
    expect(r.result.hits[0]!.path).toBe("src.ts");
  });

  it("respects maxResults cap", () => {
    for (let i = 0; i < 20; i++) writeFileSync(join(tmp, `f${i}.ts`), "stripe.prices.list();\n");
    const r = executeCodeSearch(
      { kind: "code-search", patterns: ["stripe\\.prices"], fileExtensions: ["ts"], maxResults: 5, ranking: "alphabetical" },
      tmp,
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.result.kind !== "code-search") throw new Error();
    expect(r.result.hits.length).toBeLessThanOrEqual(5);
  });

  it("returns empty hits when no match (still ok=true)", () => {
    writeFileSync(join(tmp, "a.ts"), "console.log('hello');\n");
    const r = executeCodeSearch(
      { kind: "code-search", patterns: ["nothing-matches"], fileExtensions: ["ts"], maxResults: 50, ranking: "alphabetical" },
      tmp,
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.result.kind !== "code-search") throw new Error();
    expect(r.result.hits).toEqual([]);
  });

  it("multiple patterns: matches union", () => {
    writeFileSync(join(tmp, "a.ts"), "stripe.prices.list()\nstripe.subscriptions.create()\n");
    const r = executeCodeSearch(
      {
        kind: "code-search",
        patterns: ["stripe\\.prices", "stripe\\.subscriptions"],
        fileExtensions: ["ts"],
        maxResults: 50,
        ranking: "alphabetical",
      },
      tmp,
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.result.kind !== "code-search") throw new Error();
    expect(r.result.hits).toHaveLength(2);
  });

  it("truncates very long lines in snippet", () => {
    const longLine = "x".repeat(500) + " stripe.prices ";
    writeFileSync(join(tmp, "a.ts"), longLine + "\n");
    const r = executeCodeSearch(
      { kind: "code-search", patterns: ["stripe\\.prices"], fileExtensions: ["ts"], maxResults: 50, ranking: "alphabetical" },
      tmp,
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.result.kind !== "code-search") throw new Error();
    expect(r.result.hits[0]!.snippet.length).toBeLessThanOrEqual(201); // 200 + ellipsis
  });
});

describe("executeCodeSearch — error paths", () => {
  it("returns structured error for invalid regex", () => {
    const r = executeCodeSearch(
      { kind: "code-search", patterns: ["[unclosed"], fileExtensions: ["ts"], maxResults: 50, ranking: "alphabetical" },
      tmp,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.stage).toBe("compile-pattern");
    expect(r.error.context).toMatchObject({ pattern: "[unclosed" });
  });

  it("does not throw on missing repoRoot (returns empty)", () => {
    const r = executeCodeSearch(
      { kind: "code-search", patterns: ["x"], fileExtensions: ["ts"], maxResults: 50, ranking: "alphabetical" },
      "/non-existent-dir-xyz",
    );
    // No exception, returns ok=true with empty hits because nothing scanned
    expect(r.ok).toBe(true);
  });
});

describe("executeGitHistory — happy path", () => {
  beforeEach(() => {
    execSync("git init -q", { cwd: tmp });
    execSync("git config user.email test@x", { cwd: tmp });
    execSync("git config user.name TestUser", { cwd: tmp });
    writeFileSync(join(tmp, "README.md"), "first\n");
    execSync("git add . && git commit -q -m firstCommit", { cwd: tmp });
    writeFileSync(join(tmp, "README.md"), "second\n");
    execSync("git add . && git commit -q -m secondCommit", { cwd: tmp });
  });

  it("returns commit log entries for a tracked file", () => {
    const r = executeGitHistory(
      { kind: "git-history", paths: ["README.md"], maxCommits: 10 },
      tmp,
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.result.kind !== "git-history") throw new Error();
    expect(r.result.entries.length).toBe(2);
    expect(r.result.entries[0]!.author).toBe("TestUser");
    expect(r.result.entries[0]!.subject).toMatch(/(first|second)Commit/);
    expect(r.result.entries[0]!.hash).toMatch(/^[a-f0-9]{40}$/);
  });

  it("respects maxCommits cap", () => {
    const r = executeGitHistory(
      { kind: "git-history", paths: ["README.md"], maxCommits: 1 },
      tmp,
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.result.kind !== "git-history") throw new Error();
    expect(r.result.entries.length).toBe(1);
  });

  it("returns empty (not error) for untracked path", () => {
    const r = executeGitHistory(
      { kind: "git-history", paths: ["nope.txt"], maxCommits: 10 },
      tmp,
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.result.kind !== "git-history") throw new Error();
    expect(r.result.entries).toEqual([]);
  });

  it("queries multiple paths in one call", () => {
    writeFileSync(join(tmp, "second.md"), "hi\n");
    execSync("git add . && git commit -q -m addSecond", { cwd: tmp });
    const r = executeGitHistory(
      { kind: "git-history", paths: ["README.md", "second.md"], maxCommits: 10 },
      tmp,
    );
    expect(r.ok).toBe(true);
    if (!r.ok || r.result.kind !== "git-history") throw new Error();
    expect(r.result.entries.length).toBeGreaterThanOrEqual(3);
  });
});

describe("executeGitHistory — security", () => {
  it("refuses path containing shell metacharacters", () => {
    const r = executeGitHistory(
      { kind: "git-history", paths: ["a; rm -rf /"], maxCommits: 10 },
      tmp,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.stage).toBe("git");
    expect(r.error.message).toMatch(/metacharacters/);
  });
});

describe("executeEntityGraph — placeholder", () => {
  it("returns structured 'needs index' error (does not crash)", () => {
    const r = executeEntityGraph(
      { kind: "entity-graph", entityKinds: ["function"], relationKinds: ["calls"], maxDepth: 2 },
      tmp,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.stage).toBe("entity-graph");
    expect(r.error.message).toMatch(/index/);
  });
});

describe("executeQuery — top-level dispatcher", () => {
  it("routes code-search to its executor", () => {
    writeFileSync(join(tmp, "a.ts"), "x\n");
    const r = executeQuery(
      { kind: "code-search", patterns: ["x"], fileExtensions: ["ts"], maxResults: 5, ranking: "alphabetical" },
      tmp,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.result.kind).toBe("code-search");
  });
});

describe("constants exposed", () => {
  it("includes node_modules in skipped dirs", () => {
    expect(_SKIPPED_DIRS_FOR_TESTS.has("node_modules")).toBe(true);
    expect(_SKIPPED_DIRS_FOR_TESTS.has(".git")).toBe(true);
    expect(_SKIPPED_DIRS_FOR_TESTS.has("dist")).toBe(true);
  });
});
