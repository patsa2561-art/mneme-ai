import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { writeEchoToCommit, readEchoFromCommit } from "./echo_commit.js";

function git(repo: string, args: string[]): { ok: boolean; stdout: string; stderr: string } {
  const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" });
  return { ok: r.status === 0, stdout: r.stdout?.trim() ?? "", stderr: r.stderr?.trim() ?? "" };
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "cosmic-echo-"));
  git(dir, ["init", "-q"]);
  git(dir, ["config", "user.email", "test@cosmic.local"]);
  git(dir, ["config", "user.name", "Cosmic Test"]);
  // Disable signing so the test runs in CI without GPG.
  git(dir, ["config", "commit.gpgsign", "false"]);
  writeFileSync(join(dir, "README.md"), "test repo for cosmic echo\n");
  git(dir, ["add", "README.md"]);
  const ci = git(dir, ["commit", "-q", "-m", "init"]);
  if (!ci.ok) throw new Error(`git commit failed: ${ci.stderr}`);
  return dir;
}

describe("v2.13 · ECHO-FROM-COMMITS (HMAC-signed git note)", () => {
  let repo: string;
  beforeEach(() => {
    repo = makeRepo();
  });

  it("writes a signed envelope and reads it back verified", () => {
    const w = writeEchoToCommit({
      repoDir: repo,
      state: { v: "2.13.0", note: "echo test" },
      cosmicUrl: "https://cosmic.example.com/sessions/abc",
      secret: "echo-test-secret",
    });
    if (!w.ok) {
      console.error("write failed:", w.error);
    }
    expect(w.ok).toBe(true);
    expect(w.commitSha).toMatch(/^[0-9a-f]{40}$/);

    const r = readEchoFromCommit(repo, w.commitSha, "echo-test-secret");
    expect(r.ok).toBe(true);
    expect(r.verified).toBe(true);
    expect(r.envelope?.state).toEqual({ v: "2.13.0", note: "echo test" });
    expect(r.envelope?.cosmicUrl).toBe("https://cosmic.example.com/sessions/abc");
  });

  it("verify=false when wrong secret presented (tamper-evident)", () => {
    writeEchoToCommit({
      repoDir: repo,
      state: { v: "2.13.0" },
      secret: "right-secret",
    });
    const r = readEchoFromCommit(repo, undefined, "wrong-secret");
    expect(r.ok).toBe(true);
    expect(r.verified).toBe(false);
    expect(r.reason).toContain("HMAC mismatch");
  });

  it("survives state with nested objects + arrays", () => {
    const state = { v: "2.13.0", commits: [{ sha: "abc", subject: "feat" }, { sha: "def", subject: "fix" }], meta: { live: true } };
    const w = writeEchoToCommit({ repoDir: repo, state, secret: "s" });
    expect(w.ok).toBe(true);
    const r = readEchoFromCommit(repo, w.commitSha, "s");
    expect(r.envelope?.state).toEqual(state);
    expect(r.verified).toBe(true);
  });

  it("write -f overwrites a prior echo on the same commit", () => {
    const w1 = writeEchoToCommit({ repoDir: repo, state: { v: "first" }, secret: "s" });
    expect(w1.ok).toBe(true);
    const w2 = writeEchoToCommit({ repoDir: repo, state: { v: "second" }, secret: "s" });
    expect(w2.ok).toBe(true);
    const r = readEchoFromCommit(repo, w1.commitSha, "s");
    expect((r.envelope?.state as { v: string }).v).toBe("second");
  });

  it("read returns ok=false when no echo exists", () => {
    const r = readEchoFromCommit(repo, undefined, "s");
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("no echo");
  });
});
