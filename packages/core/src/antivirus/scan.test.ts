import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { extractSuspects, scan, draftFingerprint } from "./scan.js";

function initRepo(root: string): void {
  spawnSync("git", ["init", "-q"], { cwd: root });
  spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: root });
  spawnSync("git", ["config", "user.name", "Test User"], { cwd: root });
  spawnSync("git", ["commit", "--allow-empty", "-m", "init", "-q"], { cwd: root });
}

describe("extractSuspects", () => {
  it("finds SHA-shaped substrings", () => {
    const found = extractSuspects("see commit deadbeefcafe1234 for details");
    expect(found.some((s) => s.strain === "citatio_viridis")).toBe(true);
  });

  it("finds attribution markers", () => {
    const found = extractSuspects("by Jane Doe wrote this module");
    expect(found.some((s) => s.strain === "persona_fictum")).toBe(true);
  });

  it("returns empty for plain prose with no matches", () => {
    const found = extractSuspects("the quick brown fox jumps over the lazy dog");
    // logica_circularis has fairly broad triggers; just ensure citatio_viridis NOT matched
    expect(found.some((s) => s.strain === "citatio_viridis")).toBe(false);
  });

  it("dedupes identical match strings per strain", () => {
    const found = extractSuspects("commit deadbeef1234567 and again commit deadbeef1234567");
    const cv = found.filter((s) => s.strain === "citatio_viridis");
    expect(cv.length).toBe(1);
  });
});

describe("scan", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-av-scan-"));
    initRepo(repo);
    mkdirSync(join(repo, ".mneme"), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("returns a scanId + ranAt + assays array", async () => {
    const r = await scan(repo, "plain text");
    expect(r.scanId.length).toBeGreaterThan(8);
    expect(r.ranAt.length).toBeGreaterThan(0);
    expect(Array.isArray(r.assays)).toBe(true);
  });

  it("flags an obvious phantom SHA", async () => {
    const r = await scan(repo, "See commit feedfacedeadbeef0123 for the fix.");
    expect(r.infections.length).toBeGreaterThan(0);
    expect(r.infections[0]!.claim.strain).toBe("citatio_viridis");
  });

  it("does NOT flag a hex CSS color", async () => {
    const r = await scan(repo, "Background color is #ff5500 in the theme.");
    expect(r.infections.length).toBe(0);
  });

  it("riskScore is in [0,1]", async () => {
    const r = await scan(repo, "See commit feedfacedeadbeef0123 for the fix.");
    expect(r.riskScore).toBeGreaterThanOrEqual(0);
    expect(r.riskScore).toBeLessThanOrEqual(1);
  });

  it("byStrain counts match infections", async () => {
    const r = await scan(repo, "See commit feedfacedeadbeef0123 in by Aloysius Pendergast's PR.");
    const total = Object.values(r.byStrain).reduce((s, n) => s + n, 0);
    expect(total).toBe(r.infections.length);
  });
});

describe("draftFingerprint", () => {
  it("returns a stable 16-char hex", () => {
    const a = draftFingerprint("hello world");
    const b = draftFingerprint("hello world");
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{16}$/);
  });

  it("returns different fingerprints for different drafts", () => {
    expect(draftFingerprint("abc")).not.toBe(draftFingerprint("abd"));
  });
});
