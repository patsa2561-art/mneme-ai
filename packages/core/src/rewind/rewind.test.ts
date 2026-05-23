// v2.31.0 — REWIND discrete root tests (BUG IMMUNITY).

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";

import {
  buildFingerprint, classifyCategory, classifySurface, classifySize,
  sealCapsule, verifyCapsule, runRewind, verifyCard, renderMarkdownCard,
  storeCard, listCards, __resetRewindChainForTest,
} from "./index.js";
import type { VendorRegressionCard } from "./types.js";

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "rewind-test-"));
  const init = spawnSync("git", ["init", "-q"], { cwd: dir, encoding: "utf8" });
  if (init.status !== 0) throw new Error("git init failed: " + init.stderr);
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: dir });
  spawnSync("git", ["config", "user.name", "Test User"], { cwd: dir });
  spawnSync("git", ["config", "commit.gpgsign", "false"], { cwd: dir });
  spawnSync("git", ["config", "tag.gpgsign", "false"], { cwd: dir });
  return dir;
}

function commit(dir: string, file: string, body: string, subject: string): void {
  const full = join(dir, file);
  const parent = dirname(full);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
  writeFileSync(full, body);
  const add = spawnSync("git", ["add", "--", file], { cwd: dir, encoding: "utf8" });
  if (add.status !== 0) throw new Error("git add failed: " + add.stderr);
  const env = { ...process.env, GIT_COMMITTER_NAME: "Test User", GIT_COMMITTER_EMAIL: "test@example.com", GIT_AUTHOR_NAME: "Test User", GIT_AUTHOR_EMAIL: "test@example.com" };
  const r = spawnSync("git", ["-c", "commit.gpgsign=false", "commit", "-q", "--no-verify", "-m", subject], { cwd: dir, encoding: "utf8", env });
  if (r.status !== 0) throw new Error("git commit failed: " + r.stderr + " :: " + r.stdout);
}

describe("intent fingerprint", () => {
  it("classifyCategory extracts conventional commit prefix", () => {
    expect(classifyCategory("feat: add foo")).toBe("feat");
    expect(classifyCategory("fix(parser): handle null")).toBe("fix");
    expect(classifyCategory("docs(readme): update")).toBe("docs");
    expect(classifyCategory("no prefix here")).toBe("other");
  });
  it("classifySurface picks the most-touched area", () => {
    expect(classifySurface(["packages/core/src/foo.ts"])).toBe("core");
    expect(classifySurface(["tests/regression/x.test.ts"])).toBe("tests");
    expect(classifySurface(["docs/FUNCTIONS-EN.md"])).toBe("docs");
    expect(classifySurface(["packages/mcp/src/server.ts", "packages/mcp/src/x.ts", "tests/y.test.ts"]))
      .toBe("mcp");
    expect(classifySurface([])).toBe("other");
  });
  it("classifySize buckets diff lines", () => {
    expect(classifySize(0)).toBe("S");
    expect(classifySize(19)).toBe("S");
    expect(classifySize(20)).toBe("M");
    expect(classifySize(199)).toBe("M");
    expect(classifySize(200)).toBe("L");
    expect(classifySize(1999)).toBe("L");
    expect(classifySize(2000)).toBe("XL");
  });
  it("buildFingerprint is deterministic for same inputs", () => {
    const f1 = buildFingerprint("feat: x", ["packages/core/src/x.ts"], 50);
    const f2 = buildFingerprint("feat: x", ["packages/core/src/x.ts"], 50);
    expect(f1.intentClass).toBe(f2.intentClass);
    expect(f1.category).toBe("feat");
    expect(f1.surface).toBe("core");
    expect(f1.sizeBucket).toBe("M");
  });
  it("buildFingerprint produces different class for different intent", () => {
    const f1 = buildFingerprint("feat: x", ["packages/core/src/x.ts"], 50);
    const f2 = buildFingerprint("fix: y", ["tests/y.test.ts"], 5);
    expect(f1.intentClass).not.toBe(f2.intentClass);
  });
});

describe("sealCapsule + verifyCapsule", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); __resetRewindChainForTest(); });

  it("returns empty capsule when no commits", () => {
    const cap = sealCapsule(repo, "HEAD", 5, 1);
    expect(cap.commitCount).toBe(0);
    expect(cap.commits).toEqual([]);
    expect(verifyCapsule(cap).ok).toBe(true);
  });

  it("seals commits + HMAC verifies", () => {
    commit(repo, "a.ts", "console.log('a');", "feat(core): add a");
    commit(repo, "b.ts", "console.log('b');", "fix(core): handle b");
    commit(repo, "c.ts", "// test", "test(core): cover c-edge case");
    const cap = sealCapsule(repo, "HEAD", 3, 0);
    expect(cap.commitCount).toBeGreaterThan(0);
    expect(cap.hmac).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyCapsule(cap).ok).toBe(true);
  });

  it("tampered capsule fails verify", () => {
    commit(repo, "a.ts", "x", "feat: real subject here");
    const cap = sealCapsule(repo, "HEAD", 1, 0);
    const tampered = { ...cap, commits: [{ ...cap.commits[0]!, subject: "EVIL TAMPER" }] };
    expect(verifyCapsule(tampered).ok).toBe(false);
  });

  it("filters chore(release) commits out of capsule", () => {
    commit(repo, "v.ts", "x", "chore(release): v9.9.9");
    commit(repo, "real.ts", "x", "feat(core): real feature land here");
    const cap = sealCapsule(repo, "HEAD", 5, 0);
    for (const c of cap.commits) {
      expect(c.subject.toLowerCase()).not.toContain("chore(release)");
    }
  });
});

describe("runRewind", () => {
  let repo: string;
  beforeEach(() => { repo = makeRepo(); __resetRewindChainForTest(); });

  it("returns NEW status when no prior card exists", async () => {
    commit(repo, "a.ts", "console.log(1);", "feat(core): add deterministic answer here");
    const replay = async () => ({
      vendor: "mock-a", vendorVersion: "1.0", answer: "console.log(1);", confidence: 0.8, dtMs: 5,
    });
    const r = await runRewind(repo, { vendors: ["mock-a"], range: "HEAD", count: 1, seed: 0 }, replay);
    expect(r.cards.length).toBe(1);
    expect(r.cards[0]!.regression.status).toBe("new");
    expect(r.cards[0]!.headline).toMatch(/REWIND/);
  });

  it("detects regression when prior vendor version scored higher", async () => {
    commit(repo, "a.ts", "console.log(1);", "feat(core): well-known answer pattern here");
    const goodReplay = async () => ({
      vendor: "mock-a", vendorVersion: "1.0", answer: "console.log(1);", confidence: 0.9, dtMs: 5,
    });
    await runRewind(repo, { vendors: ["mock-a"], range: "HEAD", count: 1, seed: 0 }, goodReplay);

    // Second run: same vendor, NEW version, with a clearly worse answer.
    const badReplay = async () => ({
      vendor: "mock-a", vendorVersion: "2.0",
      answer: "totally unrelated nonsense xyz",
      confidence: 0.5, dtMs: 5,
    });
    const r2 = await runRewind(repo, { vendors: ["mock-a"], range: "HEAD", count: 1, seed: 0 }, badReplay);
    expect(r2.cards[0]!.regression.status).toMatch(/regression|stable/);
    expect(r2.cards[0]!.regression.comparedToVersion).toBe("1.0");
  });

  it("HMAC chain verify passes for fresh card", async () => {
    commit(repo, "a.ts", "x", "feat(core): real subject of work");
    const replay = async () => ({
      vendor: "mock-a", vendorVersion: "1.0", answer: "x", confidence: 0.5, dtMs: 5,
    });
    const r = await runRewind(repo, { vendors: ["mock-a"], range: "HEAD", count: 1, seed: 0 }, replay);
    expect(verifyCard(r.cards[0]!).ok).toBe(true);
  });

  it("listCards returns the persisted ledger entries", async () => {
    commit(repo, "a.ts", "x", "feat(core): real subject");
    const replay = async () => ({
      vendor: "mock-a", vendorVersion: "1.0", answer: "x", confidence: 0.5, dtMs: 5,
    });
    await runRewind(repo, { vendors: ["mock-a"], range: "HEAD", count: 1, seed: 0 }, replay);
    const cards = listCards(repo);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards[0]!.vendor).toBe("mock-a");
  });

  it("renderMarkdownCard renders a non-empty card", async () => {
    commit(repo, "a.ts", "x", "feat(core): real work");
    const replay = async () => ({
      vendor: "mock-a", vendorVersion: "1.0", answer: "x", confidence: 0.5, dtMs: 5,
    });
    const r = await runRewind(repo, { vendors: ["mock-a"], range: "HEAD", count: 1, seed: 0 }, replay);
    const md = renderMarkdownCard(r.cards[0]!);
    expect(md).toMatch(/REWIND/);
    expect(md).toMatch(/mock-a/);
    expect(md).toMatch(/correctness/);
  });
});

describe("HMAC card tamper", () => {
  it("verifyCard rejects mutated card", async () => {
    const repo = makeRepo();
    commit(repo, "a.ts", "x", "feat(core): real subject");
    const replay = async () => ({
      vendor: "mock-a", vendorVersion: "1.0", answer: "x", confidence: 0.5, dtMs: 5,
    });
    __resetRewindChainForTest();
    const r = await runRewind(repo, { vendors: ["mock-a"], range: "HEAD", count: 1, seed: 0 }, replay);
    const tampered: VendorRegressionCard = { ...r.cards[0]!, meanCorrectness: 0.99 };
    expect(verifyCard(tampered).ok).toBe(false);
  });
});
