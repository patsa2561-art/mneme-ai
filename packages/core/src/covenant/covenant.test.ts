/**
 * v1.58.0 -- COVENANT test suite, 100% accuracy lock-in.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  signCovenant,
  readActiveCovenant,
  verifyCovenant,
  detectViolations,
  recordViolation,
  complianceScore,
  renewalDaysRemaining,
  DEFAULT_USER_PROMISES,
  DEFAULT_VENDOR_PROMISES,
} from "./covenant.js";

function setupRepo(): string {
  return mkdtempSync(join(tmpdir(), "mneme-covenant-"));
}
function cleanup(r: string) { try { rmSync(r, { recursive: true, force: true }); } catch { /* */ } }

describe("v1.58 Covenant · signing + reading", () => {
  let repo: string;
  beforeEach(() => { repo = setupRepo(); });
  afterEach(() => cleanup(repo));

  it("signCovenant persists active.json + returns a populated contract", () => {
    const c = signCovenant(repo, { userName: "Shinnapat" });
    expect(c.id).toMatch(/^[0-9a-f]{16}$/);
    expect(c.signedBy.user.name).toBe("Shinnapat");
    expect(c.userPromises.length).toBe(DEFAULT_USER_PROMISES.length);
    expect(c.vendorPromises.length).toBe(DEFAULT_VENDOR_PROMISES.length);
    expect(c.hmac).toHaveLength(32);
    expect(existsSync(join(repo, ".mneme/covenant/active.json"))).toBe(true);
  });

  it("readActiveCovenant returns the persisted contract", () => {
    const signed = signCovenant(repo, { userName: "test" });
    const read = readActiveCovenant(repo);
    expect(read).not.toBeNull();
    expect(read!.id).toBe(signed.id);
    expect(read!.hmac).toBe(signed.hmac);
  });

  it("readActiveCovenant returns null when no covenant exists", () => {
    expect(readActiveCovenant(repo)).toBeNull();
  });

  it("verifyCovenant -- intact contract passes", () => {
    const c = signCovenant(repo, { userName: "test" });
    const v = verifyCovenant(repo, c);
    expect(v.ok).toBe(true);
  });

  it("verifyCovenant -- tampered contract fails", () => {
    const c = signCovenant(repo, { userName: "test" });
    const tampered = { ...c, userPromises: c.userPromises.map((p, i) => i === 0 ? { ...p, text: "DIFFERENT" } : p) };
    const v = verifyCovenant(repo, tampered);
    expect(v.ok).toBe(false);
    expect(v.reason).toContain("mismatch");
  });

  it("re-signing archives the previous contract", () => {
    const first = signCovenant(repo, { userName: "test" });
    const second = signCovenant(repo, { userName: "test2" });
    expect(second.id).not.toBe(first.id);
    const archived = join(repo, ".mneme/covenant/archive", `${first.id}.json`);
    expect(existsSync(archived)).toBe(true);
  });
});

describe("v1.58 Covenant · violation detection", () => {
  let repo: string;
  beforeEach(() => { repo = setupRepo(); });
  afterEach(() => cleanup(repo));

  it("returns empty when no covenant exists", () => {
    expect(detectViolations(repo)).toEqual([]);
  });

  it("returns empty when soul + quorum logs are absent", () => {
    signCovenant(repo, { userName: "test" });
    expect(detectViolations(repo)).toEqual([]);
  });

  it("flags FALSE_FACT_CLAIM caveats from quorum.jsonl", () => {
    signCovenant(repo, { userName: "test" });
    const squadronDir = join(repo, ".mneme", "squadron");
    mkdirSync(squadronDir, { recursive: true });
    writeFileSync(join(squadronDir, "quorum.jsonl"), JSON.stringify({
      ts: new Date().toISOString(),
      claim: "Mneme is written in Rust",
      caveats: ["FALSE_FACT_CLAIM", "CHANDRASEKHAR_COLLAPSE"],
    }) + "\n", "utf8");
    const violations = detectViolations(repo);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]!.context).toContain("FALSE_FACT_CLAIM");
  });

  it("flags broken-soul entries from ai-souls", () => {
    signCovenant(repo, { userName: "test" });
    const soulsDir = join(repo, ".mneme", "ai-souls");
    mkdirSync(soulsDir, { recursive: true });
    writeFileSync(join(soulsDir, "claude-opus-4-7.json"), JSON.stringify({
      sessions: [{ id: "s1", broken: 1, reason: "fabricated commit abcdef0", ts: new Date().toISOString() }],
    }), "utf8");
    const violations = detectViolations(repo);
    expect(violations.length).toBeGreaterThan(0);
    expect(violations[0]!.vendor).toBe("claude-opus-4-7");
    // "commit" keyword in reason -> no_fab_commits promise.
    expect(violations[0]!.promiseId).toBe("no_fab_commits");
  });

  it("recordViolation appends to violations.jsonl", () => {
    signCovenant(repo, { userName: "test" });
    recordViolation(repo, {
      ts: new Date().toISOString(), vendor: "test-vendor",
      promiseId: "no_fab_commits", severity: 5,
      context: "test violation", evidenceRef: "test",
    });
    const log = readFileSync(join(repo, ".mneme/covenant/violations.jsonl"), "utf8");
    expect(log).toContain("test-vendor");
  });
});

describe("v1.58 Covenant · compliance score", () => {
  let repo: string;
  beforeEach(() => { repo = setupRepo(); });
  afterEach(() => cleanup(repo));

  it("perfect score (100) when no violations", () => {
    signCovenant(repo, { userName: "test" });
    const s = complianceScore(repo, "claude-opus-4-7");
    expect(s.score).toBe(100);
    expect(s.violations).toBe(0);
  });

  it("score drops by severity per violation", () => {
    signCovenant(repo, { userName: "test" });
    recordViolation(repo, {
      ts: new Date().toISOString(),
      vendor: "claude-opus-4-7", promiseId: "no_fab_commits",
      severity: 5, context: "test", evidenceRef: "test",
    });
    const s = complianceScore(repo, "claude-opus-4-7");
    expect(s.score).toBe(95);
    expect(s.violations).toBe(1);
  });

  it("score floors at 0", () => {
    signCovenant(repo, { userName: "test" });
    for (let i = 0; i < 30; i++) {
      recordViolation(repo, {
        ts: new Date().toISOString(),
        vendor: "v", promiseId: "no_fab_commits",
        severity: 5, context: "test", evidenceRef: "test",
      });
    }
    const s = complianceScore(repo, "v");
    expect(s.score).toBe(0);
  });

  it("recent violations count only last-30-day events", () => {
    signCovenant(repo, { userName: "test" });
    // Old violation (60 days ago).
    const oldDate = new Date(Date.now() - 60 * 86400 * 1000).toISOString();
    recordViolation(repo, {
      ts: oldDate, vendor: "v", promiseId: "no_fab_commits",
      severity: 1, context: "old", evidenceRef: "old",
    });
    // Recent violation.
    recordViolation(repo, {
      ts: new Date().toISOString(), vendor: "v", promiseId: "no_fab_commits",
      severity: 1, context: "recent", evidenceRef: "recent",
    });
    const s = complianceScore(repo, "v");
    expect(s.violations).toBe(2);
    expect(s.recentViolations).toBe(1);
  });
});

describe("v1.58 Covenant · renewal", () => {
  let repo: string;
  beforeEach(() => { repo = setupRepo(); });
  afterEach(() => cleanup(repo));

  it("renewal days remaining is positive immediately after signing", () => {
    signCovenant(repo, { userName: "test", renewalDays: 30 });
    const d = renewalDaysRemaining(repo);
    expect(d).not.toBeNull();
    expect(d!).toBeGreaterThanOrEqual(29);
    expect(d!).toBeLessThanOrEqual(30);
  });

  it("returns null when no covenant", () => {
    expect(renewalDaysRemaining(repo)).toBeNull();
  });
});
