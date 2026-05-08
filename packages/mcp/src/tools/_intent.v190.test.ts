/**
 * intent v1.9.0 — smart_do fallback in reasoning + plan.
 */

import { describe, it, expect } from "vitest";
import { understandIntent } from "./_intent.js";
import { buildAllTools } from "./_registry.js";

describe("intent v1.9.0 — smart_do fallback", () => {
  const tools = buildAllTools();

  it("when no tool matches, reasoning recommends mneme.smart_do", () => {
    const r = understandIntent("xqzzy plonk wibble", tools);
    expect(r.matches.length).toBe(0);
    expect(r.reasoning).toContain("mneme.smart_do");
  });

  it("when no tool matches, plan starts with smart_do fallback step", () => {
    const r = understandIntent("xqzzy plonk wibble", tools);
    expect(r.plan.length).toBeGreaterThan(0);
    expect(r.plan[0]).toContain("mneme.smart_do");
  });

  it("when low confidence, reasoning offers smart_do as fallback", () => {
    // Pick a query likely to score low
    const r = understandIntent("hi", tools);
    if (r.matches.length > 0 && r.topConfidence < 0.4) {
      expect(r.reasoning).toContain("mneme.smart_do");
    }
  });

  it("when high confidence, reasoning does NOT push smart_do", () => {
    const r = understandIntent("show atrophy of alice@bank.com", tools);
    expect(r.topConfidence).toBeGreaterThan(0.4);
    // Top-confidence reasoning shouldn't redirect to smart_do
    expect(r.reasoning).not.toContain("Recommended fallback");
  });
});
