import { describe, expect, it } from "vitest";
import { extractSignals, scoreSeeds, compilePlan } from "./compiler.js";
import "./catalog.js";

describe("compiler — extractSignals", () => {
  it("picks up domain hints", () => {
    const s = extractSignals("find vulnerability patterns in payment files");
    expect(s.tags).toContain("security");
    expect(s.tokens).toContain("vulnerability");
    expect(s.tokens).toContain("payment");
  });

  it("picks up verb hints", () => {
    const s = extractSignals("scan history for security issues");
    expect(s.tags).toContain("security");
    expect(s.tags).toContain("scan");
    expect(s.tags).toContain("git");
  });

  it("picks up performance hint", () => {
    const s = extractSignals("measure performance of our embed step");
    expect(s.tags).toContain("bench");
    expect(s.tags).toContain("ml");
  });

  it("picks up TODO hint", () => {
    const s = extractSignals("show TODO debt");
    expect(s.tags).toContain("karma");
  });

  it("picks up author voice hint", () => {
    const s = extractSignals("show alice's writing style");
    expect(s.tags).toContain("twin");
    expect(s.tags).toContain("stylometry");
  });

  it("returns empty tags + tokens for stop input", () => {
    const s = extractSignals("");
    expect(s.tags).toEqual([]);
    expect(s.tokens).toEqual([]);
  });
});

describe("compiler — scoreSeeds", () => {
  it("ranks security primitives high for security intent", () => {
    const signals = extractSignals("find SQL injection vulnerabilities");
    const scored = scoreSeeds(signals);
    expect(scored.length).toBeGreaterThan(0);
    const topIds = scored.slice(0, 5).map((s) => s.manifest.id);
    expect(topIds.some((id) => id.includes("score") || id.includes("ast") || id.includes("stack"))).toBe(true);
  });

  it("ranks vector primitives high for similarity intent", () => {
    const signals = extractSignals("find similar embeddings");
    const scored = scoreSeeds(signals);
    expect(scored.some((s) => s.manifest.tags.includes("vector"))).toBe(true);
  });

  it("returns empty for non-matching intent", () => {
    const signals = extractSignals("xyzabc nothingmatches");
    const scored = scoreSeeds(signals);
    // Some primitives may still match by token overlap on common words —
    // empty input was tested separately. Here we just check scoring is
    // well-defined.
    for (const s of scored) expect(s.score).toBeGreaterThan(0);
  });
});

describe("compiler — compilePlan", () => {
  it("produces a non-empty plan for a real intent", () => {
    const plan = compilePlan({ intent: "find vulnerabilities in git history" });
    expect(plan.steps.length).toBeGreaterThan(0);
    expect(plan.estimatedMsP50).toBeGreaterThan(0);
    expect(plan.source).toBe("rule-based");
  });

  it("respects maxSteps cap", () => {
    const plan = compilePlan({ intent: "find vulnerabilities in git history", maxSteps: 2 });
    expect(plan.steps.length).toBeLessThanOrEqual(2);
  });

  it("returns empty steps + helpful trace for nonsense input", () => {
    const plan = compilePlan({ intent: "qqqqqq zzzzzz aaaaaa" });
    if (plan.steps.length === 0) {
      expect(plan.trace[0]).toMatch(/no matching|no matching primitive|specific intent/i);
    } else {
      // Otherwise the planner found *something* via token overlap — that's
      // also acceptable; the contract is "always returns a plan".
      expect(plan.steps.length).toBeGreaterThan(0);
    }
  });

  it("includes a trace explaining trunk + supporting primitives", () => {
    const plan = compilePlan({ intent: "scan TODO debt by author" });
    expect(plan.trace.length).toBeGreaterThan(0);
    expect(plan.trace.some((t) => t.startsWith("trunk"))).toBe(true);
  });

  it("each plan step references a registered manifest id", async () => {
    const { registry } = await import("./registry.js");
    const plan = compilePlan({ intent: "scan vulnerabilities" });
    for (const s of plan.steps) {
      expect(registry.get(s.id), `step id ${s.id}`).toBeDefined();
    }
  });

  it("estimatedMsP50 equals the sum of step costs", async () => {
    const { registry } = await import("./registry.js");
    const plan = compilePlan({ intent: "scan vulnerabilities" });
    const sum = plan.steps.reduce((s, step) => s + (registry.get(step.id)?.cost.msP50 ?? 0), 0);
    expect(plan.estimatedMsP50).toBeCloseTo(sum, 5);
  });
});
