/**
 * Truth Confession — unit tests for the pure scoring functions.
 * The handler itself is integration-tested via _contract.test.ts.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { confessDraft, extractClaims } from "./_confess.js";

describe("extractClaims", () => {
  it("finds commit-hash candidates (7-40 hex chars)", () => {
    const draft = "see commit a3f9b21 and also c0e2d5f0a1b2c3d4 for context";
    const out = extractClaims(draft);
    expect(out.hashes).toContain("a3f9b21");
    expect(out.hashes).toContain("c0e2d5f0a1b2c3d4");
  });

  it("finds file-path candidates with extension + slash", () => {
    const draft = "look at src/auth/middleware.ts and packages/web/index.ts";
    const out = extractClaims(draft);
    expect(out.paths).toContain("src/auth/middleware.ts");
    expect(out.paths).toContain("packages/web/index.ts");
  });

  it("finds numeric claims (X commits / N tests / M files etc.)", () => {
    const draft = "we have 3129 tests passing and 87 commits in this window";
    const out = extractClaims(draft);
    expect(out.numbers.some((n) => n.includes("tests"))).toBe(true);
    expect(out.numbers.some((n) => n.includes("commits"))).toBe(true);
  });

  it("dedupes within each kind", () => {
    const draft = "commit a3f9b21 — see commit a3f9b21 again, and src/foo.ts twice: src/foo.ts";
    const out = extractClaims(draft);
    expect(out.hashes.length).toBe(1);
    expect(out.paths.length).toBe(1);
  });

  it("ignores false-positive paths with .. or absurd length", () => {
    const draft = "path ../etc/passwd is bad and " + "x/".repeat(150) + "y.ts is too long";
    const out = extractClaims(draft);
    expect(out.paths).not.toContain("../etc/passwd");
  });
});

describe("confessDraft — verdicts on a synthetic repo", () => {
  let tmp: string;
  let realFile: string;
  beforeEach(() => {
    tmp = mkdtempSync(join(tmpdir(), "mneme-confess-"));
    // Create a real file we can claim about.
    mkdirSync(join(tmp, "src"), { recursive: true });
    realFile = "src/real.ts";
    writeFileSync(join(tmp, realFile), "export const x = 1;\n");
  });
  afterEach(() => {
    try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("returns 'unverifiable' when no checkable claims found", () => {
    const r = confessDraft("Generally, things look good.", 0.5, tmp);
    expect(r.verdict).toBe("unverifiable");
    expect(r.trustDelta).toBe(0);
    expect(r.findings).toHaveLength(0);
  });

  it("returns 'hallucination' when only missing claims", () => {
    const r = confessDraft("see src/does/not/exist.ts for the fix", 0.9, tmp);
    expect(r.verdict).toBe("hallucination");
    expect(r.trustDelta).toBeLessThan(0);
    expect(r.findings.some((f) => f.status === "missing")).toBe(true);
  });

  it("returns 'verified' when only resolved claims", () => {
    const r = confessDraft(`see ${realFile} for the fix`, 0.5, tmp);
    expect(r.verdict).toBe("verified");
    expect(r.trustDelta).toBeGreaterThan(0);
    expect(r.findings.every((f) => f.status === "resolved")).toBe(true);
  });

  it("returns 'partially_verified' when mixed resolved + missing", () => {
    const r = confessDraft(`see ${realFile} (good) and src/fake.ts (bad)`, 0.7, tmp);
    expect(r.verdict).toBe("partially_verified");
    expect(r.trustDelta).toBeLessThan(0);
  });

  it("penalizes overconfidence: hallucination + high selfConfidence ⇒ harder penalty", () => {
    const overconfident = confessDraft("see src/fake.ts", 0.95, tmp);
    const humble = confessDraft("see src/fake.ts", 0.3, tmp);
    expect(overconfident.trustDelta).toBeLessThan(humble.trustDelta);
  });

  it("rewards calibration: verified + low selfConfidence ⇒ extra credit", () => {
    const humble = confessDraft(`see ${realFile}`, 0.3, tmp);
    const confident = confessDraft(`see ${realFile}`, 0.9, tmp);
    expect(humble.trustDelta).toBeGreaterThan(confident.trustDelta);
  });

  it("trustDelta is clamped to [-1, +1]", () => {
    const r = confessDraft("see src/a.ts and src/b.ts and src/c.ts and src/d.ts and src/e.ts", 1, tmp);
    expect(r.trustDelta).toBeGreaterThanOrEqual(-1);
    expect(r.trustDelta).toBeLessThanOrEqual(1);
  });
});
