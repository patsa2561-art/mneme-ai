import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execSync } from "node:child_process";
import { readCommits, readFileChanges } from "./log.js";

let repoDir: string;

function git(cmd: string): void {
  execSync(`git ${cmd}`, {
    cwd: repoDir,
    stdio: "ignore",
    env: { ...process.env, GIT_AUTHOR_NAME: "Tester", GIT_AUTHOR_EMAIL: "t@x.io", GIT_COMMITTER_NAME: "Tester", GIT_COMMITTER_EMAIL: "t@x.io" },
  });
}

function writeCommit(file: string, content: string, subject: string, body?: string): void {
  const p = join(repoDir, file);
  mkdirSync(join(p, ".."), { recursive: true });
  writeFileSync(p, content, "utf8");
  git(`add "${file}"`);
  const cmd = body
    ? `commit -m "${subject}" -m "${body}"`
    : `commit -m "${subject}"`;
  git(cmd);
}

beforeAll(() => {
  repoDir = mkdtempSync(join(tmpdir(), "mneme-log-test-"));
  git("init -q -b main");
  git('config user.email "t@x.io"');
  git('config user.name "Tester"');

  writeCommit("README.md", "hello", "initial commit");
  writeCommit("src/a.ts", "export const a = 1;\n", "feat: add module a (#42)");
  writeCommit("src/a.ts", "export const a = 2;\n", "fix: bug in module a", "Refs GH-7 and FOO-9");
  writeCommit("src/b.ts", "export const b = 1;\n", "Merge pull request #99 from feat/b");
});

afterAll(() => {
  rmSync(repoDir, { recursive: true, force: true });
});

describe("readCommits", () => {
  it("reads all commits in reverse chronological order", async () => {
    const commits = await readCommits({ cwd: repoDir });
    expect(commits.length).toBe(4);
    expect(commits[0]!.subject).toMatch(/Merge pull request/);
    expect(commits[commits.length - 1]!.subject).toBe("initial commit");
  });

  it("populates author + dates", async () => {
    const [latest] = await readCommits({ cwd: repoDir, maxCount: 1 });
    expect(latest!.authorName).toBe("Tester");
    expect(latest!.authorEmail).toBe("t@x.io");
    expect(latest!.authorDate).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("detects PR number from (#N) suffix", async () => {
    const commits = await readCommits({ cwd: repoDir });
    const featCommit = commits.find((c) => c.subject.startsWith("feat: add module a"))!;
    expect(featCommit.prNumber).toBe(42);
  });

  it("detects PR number from 'Merge pull request #N'", async () => {
    const commits = await readCommits({ cwd: repoDir });
    const merge = commits.find((c) => c.subject.startsWith("Merge pull request"))!;
    expect(merge.prNumber).toBe(99);
  });

  it("extracts issue refs from body", async () => {
    const commits = await readCommits({ cwd: repoDir });
    const fix = commits.find((c) => c.subject.startsWith("fix: bug"))!;
    expect(fix.issueRefs).toBeDefined();
    expect(fix.issueRefs!.length).toBeGreaterThan(0);
  });

  it("respects maxCount", async () => {
    const commits = await readCommits({ cwd: repoDir, maxCount: 2 });
    expect(commits).toHaveLength(2);
  });

  it("populates files for each commit", async () => {
    const commits = await readCommits({ cwd: repoDir });
    const initial = commits.find((c) => c.subject === "initial commit")!;
    expect(initial.files).toContain("README.md");
  });
});

describe("readFileChanges", () => {
  it("returns insertion/deletion counts per file", async () => {
    const commits = await readCommits({ cwd: repoDir, maxCount: 1 });
    const changes = await readFileChanges(repoDir, commits[0]!.hash);
    expect(changes.length).toBeGreaterThan(0);
    const c = changes[0]!;
    expect(c.commitHash).toBe(commits[0]!.hash);
    expect(typeof c.insertions).toBe("number");
    expect(typeof c.deletions).toBe("number");
  });
});
