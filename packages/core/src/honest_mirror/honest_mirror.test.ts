// v2.30.0 — HONEST MIRROR discrete root tests (BUG IMMUNITY).

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  scrub, computeDelta, suggestedWeight,
  runCalibration, verifyReport, __resetHonestMirrorChainForTest,
} from "./index.js";

describe("DP scrubber (anonymizer)", () => {
  it("redacts AWS access keys", () => {
    const r = scrub("my key is AKIAIOSFODNN7EXAMPLE");
    expect(r.text).not.toContain("AKIAIOSFODNN7EXAMPLE");
    expect(r.text).toMatch(/<AWS_KEY:[a-f0-9]+>/);
    expect(r.redactedKinds["aws_key"]).toBe(1);
  });
  it("redacts emails", () => {
    const r = scrub("contact me at user@example.com");
    expect(r.text).not.toContain("user@example.com");
    expect(r.text).toMatch(/<EMAIL:[a-f0-9]+>/);
  });
  it("redacts GitHub tokens", () => {
    const r = scrub("token ghp_abcdefghijklmnopqrstuvwxyz123456");
    expect(r.text).not.toContain("ghp_abcdefghijklmnopqrstuvwxyz123456");
    expect(r.text).toMatch(/<GH_TOKEN:[a-f0-9]+>/);
  });
  it("redacts JWTs", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4ifQ.4XB6L-OFh3xHkXgPv5sWmIqWPNCxrcXh4PCm4yV2A2g";
    const r = scrub(`token: ${jwt}`);
    expect(r.text).not.toContain(jwt);
  });
  it("redacts PEM private key blocks", () => {
    const pem = "-----BEGIN PRIVATE KEY-----\nABCDEF\n-----END PRIVATE KEY-----";
    const r = scrub(pem);
    expect(r.text).not.toContain("BEGIN PRIVATE KEY");
  });
  it("preserves SHA git-hash short form + tags long form", () => {
    const sha = "0123456789abcdef0123456789abcdef01234567";
    const r = scrub(`see commit ${sha} for details`);
    expect(r.text).toContain("0123456");  // first 7 preserved
    expect(r.text).toMatch(/<SHA:[a-f0-9]+>/);
  });
  it("identity transform when nothing to redact", () => {
    const t = "totally clean text with no secrets";
    const r = scrub(t);
    expect(r.text).toBe(t);
    expect(r.redactionCount).toBe(0);
  });
  it("scrub is deterministic — same input → same output", () => {
    const a = scrub("contact user@example.com");
    const b = scrub("contact user@example.com");
    expect(a.text).toBe(b.text);
  });
});

describe("computeDelta + suggestedWeight", () => {
  it("well-calibrated when confidence ≈ correctness", async () => {
    const same = "fix typo in bridge_hardening test file";
    const d = await computeDelta("art-1",
      { vendor: "v1", answer: same, confidence: 0.5, dtMs: 1 },
      { text: same, kind: "commit_diff" });
    expect(d.semanticSimilarity).toBeGreaterThan(0.5); // identical strings → jaccard = 1
    expect(d.interpretation).toMatch(/well-calibrated|under-confident/);
  });
  it("flags over-confidence when reply unrelated", async () => {
    const d = await computeDelta("art-2",
      { vendor: "v1", answer: "totally unrelated answer", confidence: 0.95, dtMs: 1 },
      { text: "the actual fix is in foo.ts line 42", kind: "commit_diff" });
    expect(d.calibrationDelta).toBeGreaterThan(0.5);
    expect(d.interpretation).toMatch(/over-confident/);
  });
  it("suggestedWeight clamps to [0.1, 0.95]", () => {
    expect(suggestedWeight([])).toBe(0.5);
    const all_perfect = Array.from({ length: 5 }, () => ({
      vendor: "v", artifactId: "a", semanticSimilarity: 1, reportedConfidence: 1,
      measuredCorrectness: 1, calibrationDelta: 0, interpretation: "",
    }));
    expect(suggestedWeight(all_perfect)).toBeLessThanOrEqual(0.95);
    const all_bad = Array.from({ length: 5 }, () => ({
      vendor: "v", artifactId: "a", semanticSimilarity: 0, reportedConfidence: 0.99,
      measuredCorrectness: 0, calibrationDelta: 0.99, interpretation: "",
    }));
    expect(suggestedWeight(all_bad)).toBeGreaterThanOrEqual(0.1);
  });
});

describe("runCalibration + HMAC chain", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mneme-honest-mirror-"));
    __resetHonestMirrorChainForTest();
  });

  it("returns report even when no git source available", async () => {
    const replay = async ({ vendor }: { vendor: string }) => ({
      vendor, answer: "mock answer", confidence: 0.5, dtMs: 1,
    });
    const r = await runCalibration(dir, { vendors: ["mock"], mockOnly: true, count: 3 }, replay);
    expect(r.artifactCount).toBe(0); // no git in temp dir
    expect(r.perVendor.length).toBe(1);
    expect(r.perVendor[0]!.suggestedAletheiaWeight).toBe(0.5); // neutral
  });

  it("HMAC chain verifies on clean report", async () => {
    const replay = async ({ vendor }: { vendor: string }) => ({
      vendor, answer: "x", confidence: 0.5, dtMs: 1,
    });
    const r = await runCalibration(dir, { vendors: ["a"], mockOnly: true, count: 1 }, replay);
    expect(verifyReport(r).ok).toBe(true);
  });

  it("HMAC chain rejects tampered report", async () => {
    const replay = async ({ vendor }: { vendor: string }) => ({
      vendor, answer: "x", confidence: 0.5, dtMs: 1,
    });
    const r = await runCalibration(dir, { vendors: ["a"], mockOnly: true, count: 1 }, replay);
    (r as { totalMs: number }).totalMs = -999;
    expect(verifyReport(r).ok).toBe(false);
  });
});
