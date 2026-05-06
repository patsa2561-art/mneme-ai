/**
 * Tests for `mneme do` smart dispatcher routing.
 *
 * We DON'T spawn child processes here — we test the routing logic
 * (classify + extractParam + expandStep) directly. End-to-end is covered
 * by the smoke test at v0.20.0 ship time.
 */
import { describe, it, expect } from "vitest";
import { __INTERNALS } from "./do.js";

const { classify, expandStep, extractParam } = __INTERNALS;

describe("mneme do — intent classification", () => {
  it('routes "find security issues" → security-audit flow', () => {
    expect(classify("find security issues")?.id).toBe("security-audit");
    expect(classify("any vulnerabilities?")?.id).toBe("security-audit");
    expect(classify("did we leak any secrets")?.id).toBe("security-audit");
    expect(classify("hunt for cve")?.id).toBe("security-audit");
  });

  it('routes "is the codebase healthy" → health-check', () => {
    expect(classify("is the codebase healthy")?.id).toBe("health-check");
    expect(classify("repo health")?.id).toBe("health-check");
    expect(classify("status report")?.id).toBe("health-check");
  });

  it('routes "who knows about X" → expert-finder', () => {
    expect(classify("who knows about auth")?.id).toBe("expert-finder");
    expect(classify("who is the expert for payments")?.id).toBe("expert-finder");
    expect(classify("bus factor for the api layer")?.id).toBe("expert-finder");
  });

  it('routes "blast radius" → blast-radius flow', () => {
    expect(classify("blast radius of abc1234")?.id).toBe("blast-radius");
    expect(classify("what would break if I revert this")?.id).toBe("blast-radius");
    expect(classify("safe to merge?")?.id).toBe("blast-radius");
  });

  it('routes "decisions / adr / why did we" → decision-archaeology', () => {
    expect(classify("what decisions did we make about caching")?.id).toBe("decision-archaeology");
    expect(classify("show me adr-style decisions")?.id).toBe("decision-archaeology");
    expect(classify("design choices")?.id).toBe("decision-archaeology");
  });

  it('routes "onboard / new hire" → newbie-onboarding', () => {
    expect(classify("onboard a new dev")?.id).toBe("newbie-onboarding");
    expect(classify("getting started")?.id).toBe("newbie-onboarding");
    expect(classify("what is this project")?.id).toBe("newbie-onboarding");
  });

  it('routes "should we ship" → release-readiness', () => {
    expect(classify("should we ship today")?.id).toBe("release-readiness");
    expect(classify("release ready?")?.id).toBe("release-readiness");
    expect(classify("can I deploy")?.id).toBe("release-readiness");
  });

  it("returns null for unmatched queries (so the CLI shows a helpful error)", () => {
    expect(classify("aaaaaaaaaa qqqqqqqqq")).toBeNull();
    expect(classify("how do I write a test in jest")).toBeNull();
  });
});

describe("mneme do — placeholder expansion", () => {
  it("substitutes {topic} with extracted nouns", () => {
    const out = expandStep("who-knows {topic}", "who knows about authentication?");
    expect(out).toBe('who-knows "authentication"');
  });

  it("substitutes {hash} with a detected commit hash", () => {
    const out = expandStep("blast {hash}", "blast radius of abc1234def");
    expect(out).toBe("blast abc1234def");
  });

  it("falls back to HEAD when no hash is in the query", () => {
    const out = expandStep("blast {hash}", "what would break if I revert");
    expect(out).toBe("blast HEAD");
  });

  it("substitutes {query} with the entire raw question, quoted", () => {
    const out = expandStep("ask {query}", "why did we adopt JWT");
    expect(out).toBe('ask "why did we adopt JWT"');
  });
});

describe("mneme do — extractParam", () => {
  it("extracts hash from query containing 7-char-or-longer hex", () => {
    expect(extractParam("blast abc1234 please", "hash")).toBe("abc1234");
    expect(extractParam("blast deadbeef0000", "hash")).toBe("deadbeef0000");
  });

  it("falls back to HEAD when no hex is in the query", () => {
    expect(extractParam("any thoughts", "hash")).toBe("HEAD");
  });

  it("strips connector words from topic extraction", () => {
    const out = extractParam("who knows about authentication", "topic");
    // "who knows about" all stripped, "authentication" remains
    expect(out.toLowerCase()).toContain("authentication");
    expect(out.toLowerCase()).not.toContain("who");
    expect(out.toLowerCase()).not.toContain("knows");
    expect(out.toLowerCase()).not.toContain("about");
  });

  it("returns 'code' when topic extraction yields nothing", () => {
    expect(extractParam("who", "topic")).toBe("code");
  });
});
