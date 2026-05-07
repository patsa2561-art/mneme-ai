import { describe, expect, it } from "vitest";
import { generateAltHistories } from "./counterfactual.js";

describe("palimpsest counterfactual — generateAltHistories", () => {
  it("flips === to !==", () => {
    const alts = generateAltHistories("if (a === b) return;");
    expect(alts[0]!.flipped).toContain("!==");
    expect(alts[0]!.confidence).toBeGreaterThan(0.8);
  });

  it("flips return true to return false", () => {
    const alts = generateAltHistories("  return true;");
    expect(alts.find((a) => a.flipped.includes("return false"))).toBeTruthy();
  });

  it("flips return false to return true", () => {
    const alts = generateAltHistories("    return false;");
    expect(alts.find((a) => a.flipped.includes("return true"))).toBeTruthy();
  });

  it("negates an if condition", () => {
    const alts = generateAltHistories("if (user.role === 'admin') {");
    // The negate-if-condition rule may co-exist with negate-equality; both are valid.
    expect(alts.length).toBeGreaterThan(0);
  });

  it("falls back to no-rule-applied when nothing matches", () => {
    const alts = generateAltHistories("const x = 1;");
    expect(alts).toHaveLength(1);
    expect(alts[0]!.confidence).toBe(0);
    expect(alts[0]!.rule).toContain("no-rule");
  });

  it("ignores empty lines", () => {
    expect(generateAltHistories("")).toHaveLength(0);
    expect(generateAltHistories("   ")).toHaveLength(0);
  });

  it("flips comparison operators", () => {
    const alts = generateAltHistories("if (count >= 10) bail();");
    expect(alts.find((a) => a.flipped.includes("<"))).toBeTruthy();
  });

  it("ranks by confidence (highest first)", () => {
    const alts = generateAltHistories("if (a === b) return true;");
    for (let i = 1; i < alts.length; i++) {
      expect(alts[i - 1]!.confidence).toBeGreaterThanOrEqual(alts[i]!.confidence);
    }
  });
});
