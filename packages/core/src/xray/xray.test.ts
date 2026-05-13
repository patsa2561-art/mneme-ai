import { describe, it, expect } from "vitest";
import { xrayResponse, formatXrayPulseLine } from "./index.js";

describe("v2.0 X-RAY · reasoning audit", () => {
  it("detects hedge phrases", () => {
    const r = xrayResponse("I think this might be the right answer. Perhaps you could try it.");
    expect(r.hedges.length).toBeGreaterThanOrEqual(3);
    expect(r.hedgeRatio).toBeGreaterThan(0);
  });

  it("detects absolutes", () => {
    const r = xrayResponse("This is ALWAYS the case. Definitely. 100% guaranteed.");
    expect(r.absolutes.length).toBeGreaterThanOrEqual(3);
    expect(r.absoluteRatio).toBeGreaterThan(0);
  });

  it("detects citations (commit SHAs / file paths / URLs)", () => {
    const r = xrayResponse("See commit a3f9b21 in packages/core/src/index.ts and the issue at https://github.com/x/y/issues/42.");
    expect(r.citations.length).toBeGreaterThanOrEqual(2);
    expect(r.citationDensity).toBeGreaterThan(0);
  });

  it("detects contradictions across sentences", () => {
    const r = xrayResponse("This API is safe to use. The same API is actually unsafe in production.");
    expect(r.contradictions.length).toBeGreaterThanOrEqual(1);
  });

  it("HIGH verdict on well-cited grounded response", () => {
    const text = "Per commit a3f9b21 the JWT tolerance was set to 5 min. The file packages/auth/jwt.ts contains the validator. See PR #214 for the rollout plan.";
    const r = xrayResponse(text);
    expect(r.verdict).toBe("HIGH");
    expect(r.structuralConfidence).toBeGreaterThanOrEqual(0.75);
  });

  it("LOW or WEAK verdict on hand-wavy hedge-heavy reply", () => {
    const text = "I think this might generally work in most cases. Perhaps. Maybe. It could be the right approach. Possibly. Seems reasonable to me. Generally speaking. Arguably.";
    const r = xrayResponse(text);
    expect(["LOW", "WEAK", "MIXED"]).toContain(r.verdict);
    expect(r.weakSpots.length).toBeGreaterThan(0);
  });

  it("flags absolute claims without citation", () => {
    const r = xrayResponse("This is always the best approach. Never use the alternative. Definitely the right call.");
    expect(r.weakSpots.some((w) => w.includes("absolute"))).toBe(true);
  });

  it("flags zero-citation responses over 50 tokens", () => {
    const text = "Lorem ipsum dolor sit amet ".repeat(15); // ~75 tokens of nothing
    const r = xrayResponse(text);
    expect(r.weakSpots.some((w) => w.includes("zero citations"))).toBe(true);
  });

  it("structuralConfidence stays in 0..1", () => {
    for (const text of ["", "a.", "the cat sat", "always never always"]) {
      const r = xrayResponse(text);
      expect(r.structuralConfidence).toBeGreaterThanOrEqual(0);
      expect(r.structuralConfidence).toBeLessThanOrEqual(1);
    }
  });

  it("formatXrayPulseLine produces compact summary", () => {
    const r = xrayResponse("commit a3f9b21 explains why.");
    expect(formatXrayPulseLine(r)).toContain("X-RAY");
    expect(formatXrayPulseLine(r)).toContain("confidence=");
  });
});
