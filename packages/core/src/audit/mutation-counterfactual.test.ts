import { describe, expect, it } from "vitest";
import {
  MUTATORS,
  planMutants,
  scoreMutationVerdict,
} from "./mutation-counterfactual.js";

describe("MUTATORS — operator correctness", () => {
  it("negate-equality flips === ↔ !==", () => {
    const op = MUTATORS.find((m) => m.kind === "negate-equality")!;
    expect(op.apply("if (a === b) {}")).toBe("if (a !== b) {}");
    expect(op.apply("if (a !== b) {}")).toBe("if (a === b) {}");
  });
  it("negate-equality flips == ↔ !=", () => {
    const op = MUTATORS.find((m) => m.kind === "negate-equality")!;
    expect(op.apply("if (a == 5) {}")).toBe("if (a != 5) {}");
  });
  it("flip-comparison swaps direction", () => {
    const op = MUTATORS.find((m) => m.kind === "flip-comparison")!;
    expect(op.apply("if (a < b)")).toBe("if (a > b)");
    expect(op.apply("if (a >= b)")).toBe("if (a <= b)");
  });
  it("invert-boolean swaps true/false", () => {
    const op = MUTATORS.find((m) => m.kind === "invert-boolean")!;
    expect(op.apply("const x = true;")).toBe("const x = false;");
    expect(op.apply("const x = false;")).toBe("const x = true;");
  });
  it("negate-return-bool flips return statements", () => {
    const op = MUTATORS.find((m) => m.kind === "negate-return-bool")!;
    expect(op.apply("    return true;")).toBe("    return false;");
    expect(op.apply("  return false;")).toBe("  return true;");
  });
  it("off-by-one bumps numeric literals", () => {
    const op = MUTATORS.find((m) => m.kind === "off-by-one")!;
    expect(op.apply("const x = i + 1")).toBe("const x = i + 2");
  });
  it("remove-throw deletes throw statements", () => {
    const op = MUTATORS.find((m) => m.kind === "remove-throw")!;
    expect(op.apply("    throw new Error('bad');")).toMatch(/throw removed/);
  });
  it("constant-zero replaces numeric literals", () => {
    const op = MUTATORS.find((m) => m.kind === "constant-zero")!;
    expect(op.apply("const x = 42;")).toBe("const x = 0;");
  });
  it("constant-empty-string replaces strings", () => {
    const op = MUTATORS.find((m) => m.kind === "constant-empty-string")!;
    expect(op.apply('const x = "hello";')).toBe('const x = "";');
  });
  it("operators return undefined when not applicable", () => {
    expect(MUTATORS.find((m) => m.kind === "negate-equality")!.apply("const x = 1;")).toBeUndefined();
    expect(MUTATORS.find((m) => m.kind === "negate-return-bool")!.apply("const x = 1;")).toBeUndefined();
  });
});

describe("planMutants", () => {
  it("generates mutants up to the cap", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `if (a === ${i}) return true;`);
    const plans = planMutants(lines, 16);
    expect(plans.length).toBeLessThanOrEqual(16);
    expect(plans.length).toBeGreaterThan(0);
  });
  it("skips comment-only lines", () => {
    const lines = [
      "// just a comment",
      "# python comment",
      "* jsdoc line",
      "if (a === b) {}",
    ];
    const plans = planMutants(lines, 16);
    expect(plans.every((p) => p.lineIndex === 3)).toBe(true);
  });
  it("returns empty list when nothing matches", () => {
    expect(planMutants(["// just a comment"], 16)).toEqual([]);
  });
  it("each plan has matching original + mutated text", () => {
    const lines = ["if (a === b) {}", "return true;"];
    const plans = planMutants(lines, 16);
    for (const p of plans) {
      expect(p.original).toBe(lines[p.lineIndex]);
      expect(p.mutated).not.toBe(p.original);
    }
  });
});

describe("scoreMutationVerdict — calibration", () => {
  it("no baseline → skipped", () => {
    const r = scoreMutationVerdict({ totalMutants: 10, killedMutants: 5, haveBaseline: false });
    expect(r.distribution.collapsed).toBe("skipped");
    expect(r.label).toBe("n/a");
    expect(r.score).toBe(-1);
  });
  it("zero applicable mutants → skipped", () => {
    const r = scoreMutationVerdict({ totalMutants: 0, killedMutants: 0, haveBaseline: true });
    expect(r.distribution.collapsed).toBe("skipped");
    expect(r.label).toBe("n/a");
  });
  it("score < 0.4 → fail (weak tests)", () => {
    const r = scoreMutationVerdict({ totalMutants: 10, killedMutants: 3, haveBaseline: true });
    expect(r.distribution.collapsed).toBe("fail");
    expect(r.label).toBe("weak");
  });
  it("score 0.4-0.6 → warn (mediocre)", () => {
    const r = scoreMutationVerdict({ totalMutants: 10, killedMutants: 5, haveBaseline: true });
    expect(r.distribution.collapsed).toBe("warn");
    expect(r.label).toBe("decent");
  });
  it("score 0.6-0.8 → pass (strong)", () => {
    const r = scoreMutationVerdict({ totalMutants: 10, killedMutants: 7, haveBaseline: true });
    expect(r.distribution.collapsed).toBe("pass");
    expect(r.label).toBe("strong");
  });
  it("score ≥ 0.8 → strong pass (exceptional)", () => {
    const r = scoreMutationVerdict({ totalMutants: 10, killedMutants: 9, haveBaseline: true });
    expect(r.distribution.collapsed).toBe("pass");
    expect(r.label).toBe("exceptional");
    expect(r.distribution.confidence).toBeGreaterThan(0.85);
  });
  it("rationale always references the score", () => {
    const r = scoreMutationVerdict({ totalMutants: 10, killedMutants: 7, haveBaseline: true });
    expect(r.rationale).toMatch(/70%|0\.7/);
  });
});
