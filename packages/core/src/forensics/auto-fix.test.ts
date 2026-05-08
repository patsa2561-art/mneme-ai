import { describe, expect, it } from "vitest";
import { autoFixFor, hasAutoFix, _SUGGESTIONS_FOR_TESTS } from "./auto-fix.js";
import type { RuleId } from "./stack-priors.js";

const RULES_THAT_FIRE_IN_PRACTICE: RuleId[] = [
  "weak-hash", "weak-cipher", "weak-rng", "hardcoded-secret",
  "sql-injection", "shell-injection", "xss-innerhtml", "xss-eval",
  "hardcoded-token", "jwt-no-verify", "cors-wildcard-credentials",
  "missing-auth-guard", "weak-webhook-signature",
  "logged-secret", "exposed-stack-trace",
  "idor-no-ownership-check", "ssrf", "prototype-pollution", "mass-assignment",
  "toctou-race", "setuid-root",
];

describe("forensics/auto-fix", () => {
  it("every customer-flagged rule has a suggestion", () => {
    for (const rule of RULES_THAT_FIRE_IN_PRACTICE) {
      expect(hasAutoFix(rule), `missing suggestion for ${rule}`).toBe(true);
    }
  });

  it("each suggestion has all required fields", () => {
    for (const [rule, s] of Object.entries(_SUGGESTIONS_FOR_TESTS)) {
      expect(s, `${rule}.title`).toBeDefined();
      expect(s!.title.length).toBeGreaterThan(8);
      expect(s!.patchHint.length).toBeGreaterThan(8);
      expect(s!.rationale.length).toBeGreaterThan(40);
      expect(["low", "medium", "high"]).toContain(s!.confidence);
    }
  });

  it("returns undefined for rules with no suggestion", () => {
    expect(autoFixFor("dependency-changed")).toBeUndefined();
    expect(autoFixFor("amount-zero-comparison")).toBeUndefined();
  });

  it("hardcoded-secret suggestion includes guidance to rotate the leaked secret", () => {
    const s = autoFixFor("hardcoded-secret");
    expect(s).toBeDefined();
    expect(s!.rationale).toMatch(/rotate/i);
  });

  it("sql-injection suggestion mentions parameterized queries", () => {
    const s = autoFixFor("sql-injection");
    expect(s).toBeDefined();
    expect(s!.title.toLowerCase()).toContain("parameter");
  });

  it("missing-auth-guard suggestion mentions @UseGuards", () => {
    const s = autoFixFor("missing-auth-guard");
    expect(s).toBeDefined();
    expect(s!.patchHint).toContain("@UseGuards");
  });
});
