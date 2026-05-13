import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mintBirthright, verifyBirthright, loadBirthright, computeRepoFingerprint, formatBirthrightPulseLine } from "./index.js";

function fakeRepo(): string {
  const root = mkdtempSync(join(tmpdir(), "mneme-birthright-test-"));
  mkdirSync(join(root, ".git"), { recursive: true });
  writeFileSync(join(root, ".git", "config"), "[remote \"origin\"]\n    url = git@github.com:user/repo.git\n");
  return root;
}

describe("v2.8 BIRTHRIGHT TOKEN", () => {
  const secret = "test-pole-secret";

  it("mintBirthright issues a token on a fresh repo", () => {
    const root = fakeRepo();
    const t = mintBirthright({ repoRoot: root, secret });
    expect(t.v).toBe(1);
    expect(t.id).toMatch(/^[0-9a-f]{24}$/);
    expect(t.hmac.length).toBe(64);
    expect(t.repoFingerprint.length).toBe(64);
  });

  it("mintBirthright is idempotent: second call returns the existing token", () => {
    const root = fakeRepo();
    const a = mintBirthright({ repoRoot: root, secret });
    const b = mintBirthright({ repoRoot: root, secret });
    expect(b.id).toBe(a.id);
    expect(b.mintedAt).toBe(a.mintedAt);
    expect(b.hmac).toBe(a.hmac);
  });

  it("force=true re-mints", () => {
    const root = fakeRepo();
    const a = mintBirthright({ repoRoot: root, secret });
    const b = mintBirthright({ repoRoot: root, secret, force: true });
    expect(b.id).not.toBe(a.id);
  });

  it("verifyBirthright catches tampering of the body", () => {
    const root = fakeRepo();
    const t = mintBirthright({ repoRoot: root, secret });
    const tampered = { ...t, mintedAt: "1999-01-01T00:00:00.000Z" };
    const v = verifyBirthright(tampered, secret);
    expect(v.ok).toBe(false);
    expect(v.verdict).toBe("TAMPERED");
  });

  it("verifyBirthright catches WRONG_REPO when fingerprint differs", () => {
    const rootA = fakeRepo();
    const rootB = fakeRepo();
    const t = mintBirthright({ repoRoot: rootA, secret });
    const v = verifyBirthright(t, secret, rootB);
    expect(v.ok).toBe(false);
    expect(v.verdict).toBe("WRONG_REPO");
  });

  it("verifyBirthright passes for the matching repo + secret", () => {
    const root = fakeRepo();
    const t = mintBirthright({ repoRoot: root, secret });
    const v = verifyBirthright(t, secret, root);
    expect(v.ok).toBe(true);
    expect(v.verdict).toBe("VALID");
  });

  it("loadBirthright reads the saved token", () => {
    const root = fakeRepo();
    const t = mintBirthright({ repoRoot: root, secret });
    const loaded = loadBirthright(root);
    expect(loaded?.id).toBe(t.id);
  });

  it("loadBirthright returns null on missing token", () => {
    const root = fakeRepo();
    expect(loadBirthright(root)).toBeNull();
  });

  it("computeRepoFingerprint differentiates repos with different .git/config", () => {
    const a = fakeRepo();
    const b = fakeRepo();
    // Modify b's git config
    writeFileSync(join(b, ".git", "config"), "[remote \"origin\"]\n    url = git@github.com:OTHER/repo.git\n");
    const fpA = computeRepoFingerprint(a);
    const fpB = computeRepoFingerprint(b);
    expect(fpA).not.toBe(fpB);
  });

  it("genealogy: a spawned replica records its parentId", () => {
    const root = fakeRepo();
    const parent = mintBirthright({ repoRoot: root, secret });
    const childRoot = fakeRepo();
    const child = mintBirthright({ repoRoot: childRoot, secret, parentId: parent.id });
    expect(child.parentId).toBe(parent.id);
  });

  it("formatBirthrightPulseLine emits a compact summary", () => {
    const root = fakeRepo();
    const t = mintBirthright({ repoRoot: root, secret });
    expect(formatBirthrightPulseLine(t)).toContain("BIRTHRIGHT");
    expect(formatBirthrightPulseLine(t)).toContain(t.id.slice(0, 8));
  });

  it("the saved token file has mode 0600 on POSIX", () => {
    if (process.platform === "win32") return;
    const root = fakeRepo();
    mintBirthright({ repoRoot: root, secret });
    const path = join(root, ".mneme", "birthright.token");
    const { statSync } = require("node:fs") as typeof import("node:fs");
    const m = statSync(path).mode & 0o777;
    expect(m).toBe(0o600);
  });
});
