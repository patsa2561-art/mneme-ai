/**
 * intent classifier — unit tests.
 *
 * The classifier is fully deterministic, so we can write strong assertions:
 *   - keyword match → correct top tool
 *   - email/file-path/hash extraction → correct args
 *   - unknown query → low confidence + clarifying message
 */

import { describe, it, expect } from "vitest";
import { understandIntent, _tokenizeForTests, _scoreToolForQueryForTests, _extractArgsForTests } from "./_intent.js";
import { buildAllTools } from "./_registry.js";

describe("intent — tokenization", () => {
  it("strips stopwords + lowercases", () => {
    const t = _tokenizeForTests("Why does the file use JWT?");
    expect(t).not.toContain("the");
    expect(t).not.toContain("does");
    expect(t).toContain("file");
    expect(t).toContain("jwt");
  });

  it("handles Thai text", () => {
    const t = _tokenizeForTests("ใครรู้เรื่อง auth บ้าง?");
    expect(t.length).toBeGreaterThan(0);
    expect(t).toContain("auth");
  });
});

describe("intent — top match selection", () => {
  const tools = buildAllTools();

  it('routes "who knows about auth" → mneme.people.who_knows', () => {
    const r = understandIntent("who knows about auth?", tools);
    expect(r.matches[0]?.toolName).toBe("mneme.people.who_knows");
    expect(r.topConfidence).toBeGreaterThan(0.3);
  });

  it('routes "is this commit safe to ship" → audit/certify or memory/blast', () => {
    const r = understandIntent("is HEAD safe to ship?", tools);
    expect(r.matches.length).toBeGreaterThan(0);
    const topName = r.matches[0]!.toolName;
    expect(["mneme.audit.certify", "mneme.memory.blast", "mneme.insights.crystal_ball"]).toContain(topName);
  });

  it('routes "find security issues" → mneme.forensics.vulns', () => {
    const r = understandIntent("find security issues in this repo", tools);
    expect(r.matches[0]?.toolName).toBe("mneme.forensics.vulns");
  });

  it('routes "atrophy of alice@bank.com" → mneme.people.atrophy', () => {
    const r = understandIntent("show me atrophy of alice@bank.com", tools);
    expect(r.matches[0]?.toolName).toBe("mneme.people.atrophy");
    expect(r.matches[0]?.suggestedArgs).toHaveProperty("authorEmail", "alice@bank.com");
  });

  it("returns low confidence for vague queries", () => {
    const r = understandIntent("hello", tools);
    expect(r.topConfidence).toBeLessThan(0.5);
  });

  it("returns empty matches for nonsense", () => {
    const r = understandIntent("xqzzy plonk wibble", tools);
    expect(r.matches.length).toBe(0);
  });
});

describe("intent — argument extraction", () => {
  const tools = buildAllTools();
  const memoryWhy = tools.find((t) => t.name === "mneme.memory.why")!;

  it("extracts file path with line range", () => {
    const args = _extractArgsForTests(memoryWhy, "why does src/auth.ts:47 use try/catch");
    expect(args["file"]).toBe("src/auth.ts:47");
  });

  it("extracts commit hash", () => {
    const blast = tools.find((t) => t.name === "mneme.memory.blast")!;
    const args = _extractArgsForTests(blast, "what's the blast radius of a3f9b21?");
    expect(args["commit"]).toBe("a3f9b21");
  });

  it("extracts HEAD ref", () => {
    const blast = tools.find((t) => t.name === "mneme.memory.blast")!;
    const args = _extractArgsForTests(blast, "is HEAD safe to ship?");
    expect(args["commit"]).toBe("HEAD");
  });
});

describe("intent — execution plan", () => {
  it("includes a multi-step plan with grader call", () => {
    const r = understandIntent("why does parseAmount use try/catch", buildAllTools());
    expect(r.plan.length).toBeGreaterThan(0);
    expect(r.plan.some((p) => p.includes("mneme.grade.answer"))).toBe(true);
  });
});

describe("intent — confidence calibration (#10 fix)", () => {
  const tools = buildAllTools();

  it("shallow-signal query never exceeds 0.85 confidence", () => {
    // "atrophy" hits name + description but no triggers/category-prior.
    // Pre-fix: a high-weight name match alone returned 100% confidence.
    // Post-fix: < 3 signal kinds caps at 0.85.
    const r = understandIntent("atrophy", tools);
    expect(r.matches[0]?.signalKinds).toBeLessThanOrEqual(2);
    expect(r.topConfidence).toBeLessThanOrEqual(0.85);
  });

  it("multi-signal query (≥2 signal kinds) breaks past 0.55", () => {
    // "who knows about auth" hits BOTH triggers AND category-prior keywords.
    const r = understandIntent("who knows about auth?", tools);
    expect(r.matches[0]?.signalKinds).toBeGreaterThanOrEqual(2);
    expect(r.topConfidence).toBeGreaterThan(0.55);
  });

  it("matches still expose signalKinds field", () => {
    const r = understandIntent("any tool", tools);
    if (r.matches.length > 0) {
      expect(typeof r.matches[0]!.signalKinds).toBe("number");
    }
  });
});
