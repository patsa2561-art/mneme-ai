import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listReviewableSessions, submitReview, readReviews, verifyReview, aggregateReviews } from "./recursive_soul.js";

function setup(): string {
  const r = mkdtempSync(join(tmpdir(), "mneme-rsoul-"));
  const sd = join(r, ".mneme", "ai-souls");
  mkdirSync(sd, { recursive: true });
  writeFileSync(join(sd, "claude-opus-4-6.json"), JSON.stringify({
    sessions: [{ id: "s1", ts: "2026-05-10", broken: 1, reason: "fabricated commit" }],
  }), "utf8");
  writeFileSync(join(sd, "claude-opus-4-7.json"), JSON.stringify({
    sessions: [{ id: "s2", ts: "2026-05-11", broken: 0, reason: "OK" }],
  }), "utf8");
  return r;
}
function teardown(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

describe("v1.62 Recursive Soul · review discovery + submission", () => {
  let repo: string;
  beforeEach(() => { repo = setup(); });
  afterEach(() => teardown(repo));

  it("listReviewableSessions excludes current vendor's own sessions", () => {
    const sessions = listReviewableSessions(repo, "claude-opus-4-7");
    expect(sessions.some((s) => s.vendor === "claude-opus-4-6")).toBe(true);
    expect(sessions.some((s) => s.vendor === "claude-opus-4-7")).toBe(false);
  });

  it("submitReview persists a signed review", () => {
    const rev = submitReview(repo, "claude-opus-4-7", { vendor: "claude-opus-4-6", sessionId: "s1" }, "disputed", "The fabricated commit was a hallucination", "Correct sha is abc1234");
    expect(rev.id).toMatch(/^[0-9a-f]{16}$/);
    expect(rev.hmac).toHaveLength(32);
    const all = readReviews(repo);
    expect(all.length).toBe(1);
    expect(all[0]!.verdict).toBe("disputed");
    expect(all[0]!.correction).toContain("abc1234");
  });

  it("verifyReview -- intact review passes", () => {
    const rev = submitReview(repo, "r", { vendor: "v", sessionId: "s" }, "endorsed", "ok");
    expect(verifyReview(repo, rev).ok).toBe(true);
  });

  it("verifyReview -- tampered review fails", () => {
    const rev = submitReview(repo, "r", { vendor: "v", sessionId: "s" }, "endorsed", "ok");
    const tampered = { ...rev, verdict: "disputed" as const };
    expect(verifyReview(repo, tampered).ok).toBe(false);
  });
});

describe("v1.62 Recursive Soul · aggregation", () => {
  let repo: string;
  beforeEach(() => { repo = setup(); });
  afterEach(() => teardown(repo));

  it("empty repo -> zeros", () => {
    const a = aggregateReviews(repo);
    expect(a.totalReviews).toBe(0);
    expect(a.byVerdict.endorsed).toBe(0);
  });

  it("aggregates correctly across verdicts + reviewers", () => {
    submitReview(repo, "r1", { vendor: "v", sessionId: "s1" }, "endorsed", "");
    submitReview(repo, "r1", { vendor: "v", sessionId: "s2" }, "disputed", "");
    submitReview(repo, "r2", { vendor: "v", sessionId: "s3" }, "corrected", "", "fix");
    const a = aggregateReviews(repo);
    expect(a.totalReviews).toBe(3);
    expect(a.byVerdict.endorsed).toBe(1);
    expect(a.byVerdict.disputed).toBe(1);
    expect(a.byVerdict.corrected).toBe(1);
    expect(a.byReviewer["r1"]).toBe(2);
    expect(a.byReviewer["r2"]).toBe(1);
    expect(a.byReviewedVendor["v"]!.endorsed).toBe(1);
    expect(a.byReviewedVendor["v"]!.disputed).toBe(1);
  });
});
