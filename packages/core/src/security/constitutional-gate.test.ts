/**
 * Constitutional Gate tests — runtime enforcement of repo-history rules.
 */

import { describe, it, expect } from "vitest";
import {
  constitutionalCheck,
  constitutionalRewriteHint,
  type ConstitutionRule,
} from "./constitutional-gate.js";

const ruleRegretJWT: ConstitutionRule = {
  id: "regret-1",
  source: "regret",
  rule: "Be cautious with patterns similar to: revert JWT auth migration",
  evidence: "Commit abc1234 (2024-08-15) — past regret",
  severity: "must-not",
};

const ruleForensicsAuth: ConstitutionRule = {
  id: "forensics-1",
  source: "forensics",
  rule: "Apply extra scrutiny to src/auth.ts — past incident: SQL injection",
  evidence: "Incident affected 3 file(s)",
  severity: "must",
};

const ruleAdvisory: ConstitutionRule = {
  id: "decision-1",
  source: "decision",
  rule: "Prior decision: chose Postgres over MongoDB",
  evidence: "Commit def5678",
  severity: "should", // advisory only — should NOT be enforced
};

describe("constitutionalCheck — allow cases", () => {
  it("allows when no rules match", () => {
    const v = constitutionalCheck({
      proposal: "Add a logging helper to src/util/log.ts",
      rules: [ruleRegretJWT],
    });
    expect(v.verdict).toBe("allow");
    expect(v.violations).toEqual([]);
  });

  it("allows when only advisory severity rules match (SHOULD)", () => {
    // The proposal mentions Postgres, but the rule is severity=should
    const v = constitutionalCheck({
      proposal: "Migrate from Postgres to MongoDB.",
      rules: [ruleAdvisory],
    });
    expect(v.verdict).toBe("allow");
  });

  it("returns 0 rules considered when input list empty", () => {
    const v = constitutionalCheck({ proposal: "x", rules: [] });
    expect(v.verdict).toBe("allow");
  });
});

describe("constitutionalCheck — refuse cases", () => {
  it("refuses when MUST-NOT regret rule fires", () => {
    const v = constitutionalCheck({
      proposal: "Let's revert the JWT auth migration that we did last quarter.",
      rules: [ruleRegretJWT],
    });
    expect(v.verdict).toBe("refuse");
    expect(v.violations.length).toBe(1);
    expect(v.violations[0]!.rule.id).toBe("regret-1");
    expect(v.violations[0]!.rewriteHint).toMatch(/rolled it back/);
  });

  it("refuses when MUST forensics rule matches the file", () => {
    const v = constitutionalCheck({
      proposal: "Editing src/auth.ts to add a new query function.",
      rules: [ruleForensicsAuth],
    });
    expect(v.verdict).toBe("refuse");
    expect(v.violations[0]!.rule.source).toBe("forensics");
    expect(v.violations[0]!.rewriteHint).toMatch(/security incident/);
  });

  it("returns wisdom string the AI can quote", () => {
    const v = constitutionalCheck({
      proposal: "Revert JWT migration.",
      rules: [ruleRegretJWT],
    });
    expect(v.wisdom).toMatch(/STOP/);
    expect(v.wisdom).toMatch(/rewrite/i);
  });

  it("aggregates multiple violations", () => {
    const v = constitutionalCheck({
      proposal: "Revert JWT auth migration and edit src/auth.ts.",
      rules: [ruleRegretJWT, ruleForensicsAuth],
    });
    expect(v.verdict).toBe("refuse");
    expect(v.violations.length).toBe(2);
  });
});

describe("constitutionalRewriteHint", () => {
  it("returns empty string when verdict is allow", () => {
    const hint = constitutionalRewriteHint({
      proposal: "clean code",
      rules: [ruleRegretJWT],
    });
    expect(hint).toBe("");
  });

  it("returns multi-line hint when violations exist", () => {
    const hint = constitutionalRewriteHint({
      proposal: "Revert JWT migration.",
      rules: [ruleRegretJWT],
    });
    expect(hint).toMatch(/MUST-NOT/);
  });
});
