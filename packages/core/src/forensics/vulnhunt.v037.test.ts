/**
 * v0.37 regression tests — Bayesian stack priors × AST evidence scoring.
 *
 * Direct-evidence test for the customer-reported bug:
 *   "NestJS + Mongoose repo received 16 false-positive CWE-89 findings"
 * The fix: stack prior for sql-injection drops to 0.05 in Mongoose-only
 * stacks, AND ast-evidence drops the score to ~0.05 inside logger calls.
 * Both layers conspire to keep the false positive out of the report.
 */
import { describe, expect, it } from "vitest";
import { huntVulnerabilities, stableHitId } from "./vulnhunt.js";
import { buildStackProfile, priorForRule, silenceReason } from "./stack-priors.js";
import { scoreEvidence } from "./ast-evidence.js";
import type { Commit } from "../types.js";

const fakeCommit = (subject: string, hash = "abc1234"): Commit => ({
  hash,
  shortHash: hash.slice(0, 7),
  subject,
  body: "",
  authorName: "Alice",
  authorEmail: "alice@x",
  authorDate: "2026-01-01T00:00:00Z",
  committerDate: "2026-01-01T00:00:00Z",
  parents: [],
  files: [],
  prNumber: undefined,
});

describe("v0.37 — stack priors", () => {
  it("silences SQL-injection rule in a Mongoose-only repo", () => {
    const stack = buildStackProfile(["mongoose", "@nestjs/core", "@nestjs/common"]);
    expect(stack.hasSql).toBe(false);
    expect(stack.hasNoSql).toBe(true);
    expect(stack.hasNestJS).toBe(true);
    const prior = priorForRule("sql-injection", stack);
    expect(prior).toBeLessThan(0.1);
  });

  it("activates SQL-injection rule when a SQL driver is present", () => {
    const stack = buildStackProfile(["pg", "express"]);
    expect(stack.hasSql).toBe(true);
    expect(priorForRule("sql-injection", stack)).toBeGreaterThan(0.5);
  });

  it("activates missing-auth-guard only on NestJS repos", () => {
    expect(priorForRule("missing-auth-guard", buildStackProfile(["express"]))).toBeLessThan(0.1);
    expect(priorForRule("missing-auth-guard", buildStackProfile(["@nestjs/core"]))).toBeGreaterThan(0.5);
  });

  it("activates webhook-signature only when a payment-gateway dep is present", () => {
    expect(priorForRule("weak-webhook-signature", buildStackProfile(["express"]))).toBeLessThan(0.2);
    expect(priorForRule("weak-webhook-signature", buildStackProfile(["express", "stripe"]))).toBeGreaterThan(0.5);
  });

  it("provides a human-readable silence reason when SQL rule is silenced", () => {
    const stack = buildStackProfile(["mongoose"]);
    const reason = silenceReason("sql-injection", stack);
    expect(reason).toBeTruthy();
    expect(reason).toMatch(/no SQL driver/i);
  });
});

describe("v0.37 — AST evidence scoring", () => {
  it("scores logger-call argument as ~0.05 (false-positive killer)", () => {
    const src = `
      function go() {
        this.logger.log("update order status: " + JSON.stringify(payload));
      }
    `;
    const idx = src.indexOf("update order");
    const ev = scoreEvidence(src, idx, "src/orders/orders.service.ts");
    expect(ev.context).toBe("logger-arg");
    expect(ev.score).toBeLessThan(0.2);
  });

  it("scores db-sink argument as ~0.95 (real query)", () => {
    const src = `
      const result = await db.query("SELECT * FROM users WHERE id = " + req.params.id);
    `;
    const idx = src.indexOf("SELECT");
    const ev = scoreEvidence(src, idx, "src/users.ts");
    expect(ev.context).toBe("db-sink");
    expect(ev.score).toBeGreaterThan(0.8);
  });

  it("scores comment-context as ~0.05", () => {
    const src = `
      // SELECT * FROM users WHERE id = \${userId}  -- example only
      const x = 1;
    `;
    const idx = src.indexOf("SELECT");
    const ev = scoreEvidence(src, idx, "src/users.ts");
    expect(ev.context).toBe("comment");
    expect(ev.score).toBeLessThan(0.1);
  });

  it("scores test-file matches at ~0.2", () => {
    const src = `console.log("test")`;
    const ev = scoreEvidence(src, 0, "src/users.test.ts");
    expect(ev.context).toBe("test-file");
    expect(ev.score).toBeLessThan(0.4);
  });
});

describe("v0.37 — huntVulnerabilities filters false positives via posterior", () => {
  it("does NOT report SQL-injection in a Mongoose-only repo even with a matching log line", () => {
    // Reproduces the customer's actual NestJS+Mongoose case.
    const diff =
      `diff --git a/src/orders/orders.service.ts b/src/orders/orders.service.ts\n` +
      `--- a/src/orders/orders.service.ts\n` +
      `+++ b/src/orders/orders.service.ts\n` +
      `@@ -10,1 +10,3 @@\n` +
      `+    this.logger.log(\`update order status \${orderId}\`);\n` +
      `+    await this.orderStatusService.updateStatus(orderId);\n`;
    const stack = buildStackProfile(["mongoose", "@nestjs/core", "@nestjs/common"]);
    const report = huntVulnerabilities([{ commit: fakeCommit("feat: order status"), diff }], { stack });
    const sqlHits = report.hits.filter((h) => h.rule === "sql-injection");
    expect(sqlHits).toHaveLength(0);
    expect(report.silenced.find((s) => s.rule === "sql-injection")).toBeTruthy();
  });

  it("DOES report SQL-injection in a pg+express repo with a real query sink", () => {
    const diff =
      `diff --git a/src/users.ts b/src/users.ts\n` +
      `--- a/src/users.ts\n` +
      `+++ b/src/users.ts\n` +
      `@@ -1,1 +1,1 @@\n` +
      `+    await pool.query(\`SELECT * FROM users WHERE id = \${userId}\`);\n`;
    const stack = buildStackProfile(["pg", "express"]);
    const report = huntVulnerabilities([{ commit: fakeCommit("feat: lookup"), diff }], { stack });
    const sqlHits = report.hits.filter((h) => h.rule === "sql-injection");
    expect(sqlHits.length).toBeGreaterThan(0);
    expect(sqlHits[0]!.posterior).toBeGreaterThan(0.5);
  });

  it("ranks hits by posterior descending (most-likely-real first)", () => {
    // Two hits — one in db-sink (~0.95), one in test file (~0.2).
    const diff =
      `diff --git a/src/users.ts b/src/users.ts\n+    await pool.query(\`SELECT * FROM users WHERE id = \${id}\`);\n` +
      `diff --git a/src/users.test.ts b/src/users.test.ts\n+    await pool.query(\`SELECT * FROM tests WHERE id = \${id}\`);\n`;
    const stack = buildStackProfile(["pg"]);
    const report = huntVulnerabilities(
      [{ commit: fakeCommit("test: cover queries"), diff }],
      { stack, minPosterior: 0.1 },
    );
    expect(report.hits.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < report.hits.length; i++) {
      expect(report.hits[i - 1]!.posterior).toBeGreaterThanOrEqual(report.hits[i]!.posterior);
    }
  });

  it("honors suppressed ids", () => {
    const diff =
      `diff --git a/src/users.ts b/src/users.ts\n+    await pool.query(\`SELECT * FROM users WHERE id = \${id}\`);\n`;
    const stack = buildStackProfile(["pg"]);
    const commit = fakeCommit("feat: lookup");
    const dryReport = huntVulnerabilities([{ commit, diff }], { stack });
    expect(dryReport.hits.length).toBeGreaterThan(0);
    const suppressedId = dryReport.hits[0]!.id;
    const suppressedRun = huntVulnerabilities([{ commit, diff }], { stack, suppressedIds: new Set([suppressedId]) });
    expect(suppressedRun.hits.find((h) => h.id === suppressedId)).toBeUndefined();
    expect(suppressedRun.dropped).toBeGreaterThan(0);
  });

  it("stableHitId is deterministic across runs", () => {
    const a = stableHitId("abc1234567890", "sql-injection", "SELECT * FROM x");
    const b = stableHitId("abc1234567890", "sql-injection", "SELECT * FROM x");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}$/);
  });

  it("reports each rule's prior + evidence + posterior on every hit", () => {
    const diff = `diff --git a/src/users.ts b/src/users.ts\n+    await pool.query(\`SELECT * FROM x WHERE id = \${id}\`);\n`;
    const stack = buildStackProfile(["pg"]);
    const r = huntVulnerabilities([{ commit: fakeCommit("x"), diff }], { stack });
    expect(r.hits[0]!.prior).toBeGreaterThan(0);
    expect(r.hits[0]!.evidenceScore).toBeGreaterThan(0);
    expect(r.hits[0]!.posterior).toBeGreaterThan(0);
    expect(r.hits[0]!.posterior).toBeLessThanOrEqual(r.hits[0]!.prior * r.hits[0]!.evidenceScore + 0.01);
  });
});
