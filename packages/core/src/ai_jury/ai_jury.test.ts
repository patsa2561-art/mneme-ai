import { describe, it, expect } from "vitest";
import { rule } from "./index.js";

describe("ai_jury · consensus rule", () => {
  it("identifies the majority cluster", () => {
    const v = rule("what is 2+2", [
      { vendor: "a", answer: "the answer is four" },
      { vendor: "b", answer: "two plus two equals four" },
      { vendor: "c", answer: "two plus two is five actually" },
    ]);
    expect(v.dissenters.length).toBeGreaterThanOrEqual(1);
    expect(v.dissenters).toContain("c");
    expect(v.consensus).toBeGreaterThan(0);
  });

  it("100% consensus when all agree", () => {
    const ans = "the answer is four";
    const v = rule("q", [{ vendor: "a", answer: ans }, { vendor: "b", answer: ans }, { vendor: "c", answer: ans }]);
    expect(v.consensus).toBe(1);
    expect(v.dissenters).toEqual([]);
  });

  it("handles empty jury safely", () => {
    const v = rule("q", []);
    expect(v.majorityIndex).toBe(-1);
    expect(v.consensus).toBe(0);
  });
});
