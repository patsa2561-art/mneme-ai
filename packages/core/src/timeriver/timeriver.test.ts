import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { execSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rewind, counterfactual } from "./timeriver.js";

function repoWith3Commits(): { repo: string; first: string; second: string; third: string } {
  const dir = mkdtempSync(join(tmpdir(), "mneme-time-"));
  execSync("git init -q", { cwd: dir, stdio: "ignore" });
  execSync(`git config user.email "t@t.com"`, { cwd: dir, stdio: "ignore" });
  execSync(`git config user.name "t"`, { cwd: dir, stdio: "ignore" });
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test", version: "1.0.0" }), "utf8");
  execSync(`git add .`, { cwd: dir, stdio: "ignore" });
  execSync(`git commit -q -m "initial"`, { cwd: dir, stdio: "ignore" });
  const first = execSync(`git -C "${dir}" rev-parse HEAD`, { encoding: "utf8" }).trim().slice(0, 7);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test", version: "1.1.0" }), "utf8");
  execSync(`git commit -aq -m "feat: v1.1"`, { cwd: dir, stdio: "ignore" });
  const second = execSync(`git -C "${dir}" rev-parse HEAD`, { encoding: "utf8" }).trim().slice(0, 7);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "test", version: "1.2.0" }), "utf8");
  execSync(`git commit -aq -m "feat: v1.2 add feature X"`, { cwd: dir, stdio: "ignore" });
  const third = execSync(`git -C "${dir}" rev-parse HEAD`, { encoding: "utf8" }).trim().slice(0, 7);
  return { repo: dir, first, second, third };
}
function teardown(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

describe("v1.63 Time-River · rewind by SHA", () => {
  let repo: string; let first: string; let second: string; let third: string;
  beforeEach(() => { ({ repo, first, second, third } = repoWith3Commits()); });
  afterEach(() => teardown(repo));

  it("rewind to first commit -> version 1.0.0 + 1 commit", () => {
    const s = rewind(repo, first);
    expect(s.ok).toBe(true);
    expect(s.version).toBe("1.0.0");
    expect(s.totalCommitsAtAnchor).toBe(1);
  });

  it("rewind to second commit -> version 1.1.0 + 2 commits", () => {
    const s = rewind(repo, second);
    expect(s.version).toBe("1.1.0");
    expect(s.totalCommitsAtAnchor).toBe(2);
  });

  it("rewind to third commit -> version 1.2.0 + 3 commits", () => {
    const s = rewind(repo, third);
    expect(s.version).toBe("1.2.0");
    expect(s.totalCommitsAtAnchor).toBe(3);
  });

  it("rewind to non-existent SHA -> ok=false", () => {
    const s = rewind(repo, "ffffff0");
    expect(s.ok).toBe(false);
    expect(s.reason).toContain("Could not resolve");
  });

  it("file list at anchor is non-empty", () => {
    const s = rewind(repo, third);
    expect(s.files.length).toBeGreaterThan(0);
    expect(s.files).toContain("package.json");
  });

  it("recentCommits include the anchor + earlier ones", () => {
    const s = rewind(repo, third);
    expect(s.recentCommits.length).toBeGreaterThanOrEqual(1);
    expect(s.recentCommits[0]!.subject).toContain("v1.2");
  });
});

describe("v1.63 Time-River · counterfactual answer", () => {
  let repo: string; let first: string; let third: string;
  beforeEach(() => { ({ repo, first, third } = repoWith3Commits()); });
  afterEach(() => teardown(repo));

  it("counterfactual at HEAD shows current state", () => {
    const a = counterfactual(repo, third);
    expect(a.snapshot.ok).toBe(true);
    expect(a.summary).toContain("1.2.0");
  });

  it("counterfactual with question -- adds answer-shape note", () => {
    const a = counterfactual(repo, first, "Does v1.2 exist?");
    expect(a.summary).toContain("Question was");
    expect(a.summary).toContain("v1.2");
  });

  it("counterfactual at unresolvable anchor -> failure message", () => {
    const a = counterfactual(repo, "9999999");
    expect(a.snapshot.ok).toBe(false);
    expect(a.summary).toContain("Could not resolve");
  });
});
