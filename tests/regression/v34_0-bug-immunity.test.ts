// v2.34.0 — BUG IMMUNITY PROTOCOL v2 — pinned regression tests for
// every bug closed in v2.34.0. Each row encodes:
//   - finding id (R1/R3/NEW1/NEW2/NEW3 from the v2.31.0 audit card)
//   - the contract that was broken
//   - the source file that fixes it
//   - the exact assertion that proves it stayed fixed
//
// If the bug ever returns, the test in this file fails forever.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ── R1 + NEW2 — self-reference + paradox detector ────────────────────
// Source-of-truth file: packages/core/src/squadron/acgv_self_reference.ts

describe("R1+NEW2 — self-reference + paradox detector (PINNED)", () => {
  it("self-reference detector flags 'this claim verifies itself'", async () => {
    const mod = await import("../../packages/core/src/squadron/acgv_self_reference.js");
    const r = mod.detectSelfReference("this claim verifies itself");
    expect(r.flagged).toBe(true);
    expect(r.matches.some((m) => m.class === "self_reference")).toBe(true);
  });

  it("paradox detector flags 'This statement is false'", async () => {
    const mod = await import("../../packages/core/src/squadron/acgv_self_reference.js");
    const r = mod.detectSelfReference("This statement is false.");
    expect(r.flagged).toBe(true);
    expect(r.matches.some((m) => m.class === "liar_paradox")).toBe(true);
    expect(mod.dominantClass(r.matches)).toBe("self_paradox");
  });

  it("ACGV pipeline returns SELF_PARADOX_DETECTED caveat for liar paradox", async () => {
    const acgv = await import("../../packages/core/src/squadron/acgv.js");
    const r = await acgv.runACGVAsync({ claim: "this statement is false", noEmitVaccine: true });
    expect(r.caveats).toContain("SELF_PARADOX_DETECTED");
    // CRITICAL: must NOT be IMPOSSIBLE_REFUTE — that was the regression.
    expect(r.verdict).not.toBe("IMPOSSIBLE_REFUTE");
  });

  it("ACGV pipeline returns SELF_REFERENCE_DETECTED caveat for plain self-reference", async () => {
    const acgv = await import("../../packages/core/src/squadron/acgv.js");
    const r = await acgv.runACGVAsync({ claim: "this claim verifies itself", noEmitVaccine: true });
    expect(r.caveats).toContain("SELF_REFERENCE_DETECTED");
    expect(r.verdict).not.toBe("IMPOSSIBLE_REFUTE");
  });

  it("explainer emits SELF-PARADOX headline (not generic NEEDS-DATA)", async () => {
    const acgv = await import("../../packages/core/src/squadron/acgv.js");
    const explain = await import("../../packages/core/src/squadron/acgv_explain.js");
    const r = await acgv.runACGVAsync({ claim: "this statement is false", noEmitVaccine: true });
    const e = explain.explain(r, "this statement is false");
    expect(e.headline).toMatch(/SELF-PARADOX/);
  });

  it("non-self-referential claim is NOT flagged", async () => {
    const mod = await import("../../packages/core/src/squadron/acgv_self_reference.js");
    const r = mod.detectSelfReference("React 19 introduces server components");
    expect(r.flagged).toBe(false);
  });
});

// ── NEW3 — fake commit hash oracle ───────────────────────────────────
// Source-of-truth file: packages/core/src/squadron/acgv_commit_hash_oracle.ts

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "hashoracle-"));
  spawnSync("git", ["init", "-q"], { cwd: dir });
  spawnSync("git", ["config", "user.email", "t@t.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "t"], { cwd: dir });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  return dir;
}
function commitFile(dir: string, file: string, body: string, subject: string): string {
  writeFileSync(join(dir, file), body);
  spawnSync("git", ["add", "--", file], { cwd: dir });
  const env = { ...process.env, GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t.com", GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t.com" };
  spawnSync("git", ["-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", subject], { cwd: dir, env });
  const r = spawnSync("git", ["rev-parse", "HEAD"], { cwd: dir, encoding: "utf8" });
  return (r.stdout ?? "").trim();
}

describe("NEW3 — fake commit hash oracle (PINNED)", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); });

  it("oracle detects fake hash a1b2c3d4 in a fresh repo", async () => {
    const mod = await import("../../packages/core/src/squadron/acgv_commit_hash_oracle.js");
    commitFile(repo, "a.txt", "x", "first commit");
    const r = mod.scanCommitHashes("commit a1b2c3d4 fixed the auth bug", repo);
    expect(r.scanned).toBe(true);
    expect(r.hasFakeHash).toBe(true);
    expect(r.matches[0]!.exists).toBe(false);
  });

  it("oracle confirms a REAL hash from the repo", async () => {
    const mod = await import("../../packages/core/src/squadron/acgv_commit_hash_oracle.js");
    const sha = commitFile(repo, "a.txt", "x", "real commit");
    const short = sha.slice(0, 7);
    const r = mod.scanCommitHashes(`commit ${short} introduced foo`, repo);
    expect(r.scanned).toBe(true);
    expect(r.hasFakeHash).toBe(false);
    expect(r.matches[0]!.exists).toBe(true);
  });

  it("oracle skips pure-decimal sequences (not SHAs)", async () => {
    const mod = await import("../../packages/core/src/squadron/acgv_commit_hash_oracle.js");
    commitFile(repo, "a.txt", "x", "c");
    const r = mod.scanCommitHashes("port 8080 timestamp 1234567890", repo);
    expect(r.scanned).toBe(false);
  });

  it("oracle is no-op outside a git repo", async () => {
    const mod = await import("../../packages/core/src/squadron/acgv_commit_hash_oracle.js");
    const nonGit = mkdtempSync(join(tmpdir(), "nongit-"));
    const r = mod.scanCommitHashes("commit a1b2c3d4 fixed it", nonGit);
    expect(r.scanned).toBe(false);
  });
});

// ── R3 — INPUT_TRUNCATED visible in headline ─────────────────────────
// Source-of-truth: packages/core/src/squadron/acgv_explain.ts

describe("R3 — INPUT_TRUNCATED surfacing (PINNED)", () => {
  it("explainer headline includes the truncation ratio", async () => {
    const explain = await import("../../packages/core/src/squadron/acgv_explain.js");
    const fake = {
      verdict: "PASSTHROUGH" as const,
      confidence: 0,
      caveats: ["INPUT_TRUNCATED:8000/50000"],
      layers: {
        vaccineMatch: null, grounding: [],
        chandrasekhar: { verdict: "UNKNOWN_MASS", mass: 0, density: 0, rhoCritLow: 0, rhoCritHigh: 0, confidence: 0, citations: [], reasoning: "" } as never,
        godel: { status: "SKIPPED" as const, core: [], certificate: "", upgrade: false },
        confession: null, confessionRequest: null,
      },
      summary: "x", reasoning: "y", vaccineEmitted: false,
    };
    const e = explain.explain(fake as never, "x".repeat(50000));
    expect(e.headline).toMatch(/truncated/i);
    expect(e.headline).toMatch(/8000/);
    expect(e.headline).toMatch(/50000/);
  });
});

// ── NEW1 — pulse-inbox consistency (single source of truth) ──────────
// Source-of-truth: packages/core/src/inbox.ts `countUnsentDisplayable`
// + `isDisplayableUnsent`.

describe("NEW1 — pulse-inbox consistency (PINNED)", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "inbox-cons-"));
    mkdirSync(join(repo, ".mneme"), { recursive: true });
  });

  it("countUnsentDisplayable filters stale-version banners that pulse also filters", async () => {
    const inbox = await import("../../packages/core/src/inbox.js");
    const f = join(repo, ".mneme", "inbox.jsonl");
    appendFileSync(f, JSON.stringify({ id: "stale", sent: false, title: "Mneme v9.9.9 available — You're on v1.0.0", priority: "high" }) + "\n");
    appendFileSync(f, JSON.stringify({ id: "live", sent: false, title: "real message", priority: "high" }) + "\n");
    // With currentVer = "2.34.0", the stale "You're on v1.0.0" entry should be skipped.
    const displayable = inbox.countUnsentDisplayable(repo, "2.34.0");
    const rawUnsent = inbox.countUnsent(repo);
    expect(rawUnsent).toBe(2); // raw count includes stale
    expect(displayable).toBe(1); // displayable strips stale → matches what pulse displays
    expect(rawUnsent).toBeGreaterThan(displayable); // proves the filter actually does work
  });

  it("listDisplayableUnsent returns same set as countUnsentDisplayable", async () => {
    const inbox = await import("../../packages/core/src/inbox.js");
    const f = join(repo, ".mneme", "inbox.jsonl");
    appendFileSync(f, JSON.stringify({ id: "a", sent: false, title: "fresh" }) + "\n");
    appendFileSync(f, JSON.stringify({ id: "b", sent: true, title: "sent" }) + "\n");
    appendFileSync(f, JSON.stringify({ id: "c", sent: false, title: "You're on v0.0.1" }) + "\n");
    const list = inbox.listDisplayableUnsent(repo, "2.34.0");
    const count = inbox.countUnsentDisplayable(repo, "2.34.0");
    expect(list.length).toBe(count);
    expect(list[0]!.id).toBe("a");
  });

  it("isDisplayableUnsent: sent message is always undisplayable", async () => {
    const inbox = await import("../../packages/core/src/inbox.js");
    expect(inbox.isDisplayableUnsent({ id: "x", sent: true, title: "t" } as never, "2.34.0")).toBe(false);
  });
});
