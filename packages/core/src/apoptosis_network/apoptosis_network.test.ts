import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  record, diagnose, checkPattern, recordCounterPattern,
  exportFederationRows, importFederation,
  fingerprint, anonymousRepoId,
  formatVerdict, formatCheckResult,
  APOPTOSIS_THRESHOLDS,
  type PatternRecord,
} from "./index.js";

describe("apoptosis_network", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-apo-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("fingerprint + anonymousRepoId", () => {
    it("fingerprint is deterministic + 32 hex chars", () => {
      const a = fingerprint("foo bar");
      const b = fingerprint("foo bar");
      expect(a).toBe(b);
      expect(a).toMatch(/^[a-f0-9]{32}$/);
    });
    it("fingerprint is case-insensitive + whitespace-tolerant", () => {
      expect(fingerprint("FOO BAR")).toBe(fingerprint("foo bar"));
      expect(fingerprint("  foo bar  ")).toBe(fingerprint("foo bar"));
    });
    it("anonymousRepoId is stable for the same path", () => {
      const a = anonymousRepoId(repo);
      const b = anonymousRepoId(repo);
      expect(a).toBe(b);
      expect(a).toMatch(/^[a-f0-9]{16}$/);
    });
  });

  describe("record + diagnose", () => {
    it("empty repo → HEALTHY verdict", async () => {
      const v = await diagnose(repo, "pattern X");
      expect(v.stage).toBe("HEALTHY");
      expect(v.attemptCount).toBe(0);
    });

    it("2 attempts → still HEALTHY (below inflamedMinAttempts)", async () => {
      await record(repo, { patternTokens: "race", description: "race", vendor: "claude", outcome: "failure", failureClass: "race-prevented" });
      await record(repo, { patternTokens: "race", description: "race", vendor: "claude", outcome: "failure" });
      const v = await diagnose(repo, "race");
      expect(v.stage).toBe("HEALTHY");
      expect(v.attemptCount).toBe(2);
    });

    it("3 attempts mostly success → INFLAMED (failure-rate below necrotic threshold)", async () => {
      // 2 successes + 1 failure = 33% failure rate, below 50% NECROTIC bar.
      // But >= 3 attempts triggers INFLAMED.
      for (let i = 0; i < 3; i++) {
        await record(repo, { patternTokens: "race", description: "race", vendor: "claude", outcome: i === 0 ? "failure" : "success" });
      }
      const v = await diagnose(repo, "race");
      expect(v.stage).toBe("INFLAMED");
    });

    it("3 attempts, all failures (100%) → NECROTIC", async () => {
      for (let i = 0; i < 3; i++) {
        await record(repo, { patternTokens: "race", description: "race", vendor: "claude", outcome: "failure" });
      }
      const v = await diagnose(repo, "race");
      // 3 attempts in one repo from one vendor — doesn't meet APOPTOTIC bar
      // (needs >= 3 distinct repos and >= 2 distinct vendors).
      expect(v.stage).toBe("NECROTIC");
    });
  });

  describe("APOPTOTIC requires multi-repo + multi-vendor + age", () => {
    it("simulating 3 repos × 2 vendors × 1+ weeks → APOPTOTIC", async () => {
      // We can't fake distinct repoIds via direct record() — but we CAN
      // write directly into the patterns.jsonl with synthetic repo ids
      // to simulate federated rows. (The verdict computes from BOTH
      // local + federation rows.)
      const dir = join(repo, ".mneme/apoptosis");
      mkdirSync(dir, { recursive: true });
      const fp = fingerprint("dangerous-pattern");
      const now = Date.now();
      const tooOld = new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString();   // 8 days ago
      const rows: PatternRecord[] = [];
      const vendors = ["claude", "gpt", "gemini"];
      const repos = ["repo-a", "repo-b", "repo-c", "repo-d"];
      let count = 0;
      for (const r of repos) {
        for (const v of vendors) {
          rows.push({
            v: 1, fingerprint: fp, description: "dangerous", repoId: r, vendor: v,
            outcome: "failure", failureClass: "race-prevented",
            ts: count++ === 0 ? tooOld : new Date(now - 60_000).toISOString(),
            sig: "stub",
          });
        }
      }
      // Add one success so failure-rate is computed properly.
      rows.push({ v: 1, fingerprint: fp, description: "dangerous", repoId: "repo-x", vendor: "claude", outcome: "success", ts: tooOld, sig: "stub" });
      writeFileSync(join(dir, "federation.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

      const v = await diagnose(repo, "dangerous-pattern");
      expect(v.attemptCount).toBeGreaterThanOrEqual(APOPTOSIS_THRESHOLDS.apoptoticMinFailureCount);
      expect(v.distinctRepos).toBeGreaterThanOrEqual(APOPTOSIS_THRESHOLDS.apoptoticMinDistinctRepos);
      expect(v.distinctVendors).toBeGreaterThanOrEqual(APOPTOSIS_THRESHOLDS.apoptoticMinDistinctVendors);
      expect(v.ageWeeks).toBeGreaterThanOrEqual(APOPTOSIS_THRESHOLDS.apoptoticMinAgeWeeks);
      expect(v.stage).toBe("APOPTOTIC");
    });
  });

  describe("checkPattern (refuse-at-source)", () => {
    it("HEALTHY → refuse=false", async () => {
      const r = await checkPattern(repo, "fresh-pattern");
      expect(r.refuse).toBe(false);
      expect(r.verdict).toBe("HEALTHY");
    });
    it("APOPTOTIC → refuse=true + reason mentions repos + vendors + lineage sig", async () => {
      // Same seeding trick as above.
      const dir = join(repo, ".mneme/apoptosis");
      mkdirSync(dir, { recursive: true });
      const fp = fingerprint("dangerous");
      const now = Date.now();
      const rows: PatternRecord[] = [];
      for (const r of ["a", "b", "c", "d"]) {
        for (const v of ["claude", "gpt"]) {
          rows.push({
            v: 1, fingerprint: fp, description: "dangerous", repoId: r, vendor: v,
            outcome: "failure", failureClass: "race-prevented",
            ts: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
            sig: "stub",
          });
        }
      }
      writeFileSync(join(dir, "federation.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");

      const r = await checkPattern(repo, "dangerous");
      expect(r.refuse).toBe(true);
      expect(r.verdict).toBe("APOPTOTIC");
      expect(r.lineageSig).toMatch(/^[A-Za-z0-9_-]{20,}$/);
      expect(r.reason).toContain("APOPTOSIS");
      expect(r.reason).toContain("repos");
      expect(r.reason).toContain("vendors");
    });
  });

  describe("counter-patterns", () => {
    it("recordCounterPattern surfaces as suggestion in NECROTIC/APOPTOTIC verdicts", async () => {
      // Make pattern NECROTIC.
      for (let i = 0; i < 4; i++) {
        await record(repo, { patternTokens: "race", description: "race", vendor: "claude", outcome: "failure" });
      }
      recordCounterPattern(repo, {
        failedTokens: "race",
        successTokens: "use-mutex",
        description: "use a distributed mutex with TTL",
      });
      const v = await diagnose(repo, "race");
      expect(v.stage).toBe("NECROTIC");
      expect(v.counterPatterns.length).toBeGreaterThan(0);
      expect(v.counterPatterns[0]!.description).toContain("mutex");
    });
  });

  describe("federation export/import", () => {
    it("round-trips rows + dedups on import", async () => {
      await record(repo, { patternTokens: "x", description: "x", vendor: "claude", outcome: "failure" });
      const rows = exportFederationRows(repo);
      expect(rows.length).toBe(1);
      const other = mkdtempSync(join(tmpdir(), "mneme-apo-other-"));
      try {
        const r1 = importFederation(other, rows);
        expect(r1.imported).toBe(1);
        const r2 = importFederation(other, rows);
        expect(r2.skipped).toBe(1);
      } finally {
        try { rmSync(other, { recursive: true, force: true }); } catch { /* */ }
      }
    });
  });

  describe("formatters", () => {
    it("formatVerdict renders the stage badge + counters", async () => {
      await record(repo, { patternTokens: "x", description: "x", vendor: "claude", outcome: "failure" });
      const v = await diagnose(repo, "x");
      const out = formatVerdict(v);
      expect(out).toContain("APOPTOSIS NETWORK");
      expect(out).toContain(v.stage);
    });
    it("formatCheckResult shows REFUSED for APOPTOTIC", async () => {
      const dir = join(repo, ".mneme/apoptosis");
      mkdirSync(dir, { recursive: true });
      const fp = fingerprint("dangerous");
      const now = Date.now();
      const rows: PatternRecord[] = [];
      for (const r of ["a", "b", "c"]) for (const v of ["claude", "gpt"]) {
        rows.push({ v: 1, fingerprint: fp, description: "d", repoId: r, vendor: v, outcome: "failure", ts: new Date(now - 10 * 86400000).toISOString(), sig: "stub" });
      }
      writeFileSync(join(dir, "federation.jsonl"), rows.map((r) => JSON.stringify(r)).join("\n") + "\n", "utf8");
      const r = await checkPattern(repo, "dangerous");
      const out = formatCheckResult(r);
      expect(out).toContain("REFUSED");
    });
  });
});
