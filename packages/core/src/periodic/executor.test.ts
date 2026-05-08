import { describe, expect, it } from "vitest";
import { executePlan } from "./executor.js";
import { registry, declare } from "./registry.js";
import type { MoleculePlan } from "./compiler.js";

// Register a fixture element with a known implementation (this file
// itself exports `add2`).  This is the "real" path executors will use.
declare({
  id: "test.add2",
  kind: "element",
  summary: "add 2 to a number",
  description: "Test fixture element used by executor.test.ts to verify resolution + invocation.",
  inputs: { x: "number" },
  output: "number",
  cost: { io: "none", cpu: "trivial", msP50: 0.01 },
  deterministic: true,
  sideEffect: "none",
  tags: ["test"],
  modulePath: "./executor.test.js",
  exportName: "add2",
});

declare({
  id: "test.network",
  kind: "element",
  summary: "fixture with network side effect",
  description: "Used to test the forbidSideEffects sandbox.",
  inputs: {},
  output: "void",
  cost: { io: "network", cpu: "trivial", msP50: 100 },
  deterministic: false,
  sideEffect: "network",
  tags: ["test"],
  modulePath: "./executor.test.js",
  exportName: "shouldNotRun",
});

declare({
  id: "test.throws",
  kind: "element",
  summary: "fixture that throws",
  description: "Used to test that an executor failure is captured rather than killing the run.",
  inputs: {},
  output: "void",
  cost: { io: "none", cpu: "trivial", msP50: 0.01 },
  deterministic: true,
  sideEffect: "none",
  tags: ["test"],
  modulePath: "./executor.test.js",
  exportName: "throwBoom",
});

export function add2(args: { x: number }): number {
  return args.x + 2;
}
export function shouldNotRun(): void {
  throw new Error("This export should never be invoked when network is forbidden");
}
export function throwBoom(): void {
  throw new Error("intentional boom for tests");
}

const planOf = (ids: string[]): MoleculePlan => ({
  intent: "fixture",
  steps: ids.map((id) => ({ id, args: { x: 40 } })),
  estimatedMsP50: ids.length,
  source: "rule-based",
  trace: [],
});

describe("executor — basic", () => {
  it("invokes a real export and stores result in scratch", async () => {
    const plan = planOf(["test.add2"]);
    const result = await executePlan(plan, { cwd: process.cwd() });
    expect(result.ok).toBe(true);
    expect(result.results[0]!.ok).toBe(true);
    expect(result.scratch["test.add2"]).toBe(42);
  });

  it("captures errors without poisoning the run", async () => {
    const plan = planOf(["test.add2", "test.throws", "test.add2"]);
    const result = await executePlan(plan, { cwd: process.cwd() });
    expect(result.ok).toBe(false);
    expect(result.results[0]!.ok).toBe(true);
    expect(result.results[1]!.ok).toBe(false);
    expect(result.results[1]!.error).toContain("intentional boom");
    expect(result.results[2]!.ok).toBe(true);
  });

  it("forbidSideEffects skips network steps", async () => {
    const plan = planOf(["test.add2", "test.network"]);
    const result = await executePlan(plan, {
      cwd: process.cwd(),
      forbidSideEffects: ["network"],
    });
    expect(result.results[0]!.ok).toBe(true);
    expect(result.results[1]!.ok).toBe(false);
    expect(result.results[1]!.error).toMatch(/network.*forbidden/i);
  });

  it("returns placeholder error for unknown manifest id", async () => {
    const plan = planOf(["test.does-not-exist"]);
    const result = await executePlan(plan, { cwd: process.cwd() });
    expect(result.ok).toBe(false);
    expect(result.results[0]!.error).toMatch(/Unknown manifest/);
  });

  it("totalMs sums per-step durations", async () => {
    const plan = planOf(["test.add2", "test.add2"]);
    const result = await executePlan(plan, { cwd: process.cwd() });
    const sumStep = result.results.reduce((s, r) => s + r.msActual, 0);
    expect(result.totalMs).toBe(sumStep);
  });

  it("respects maxSteps cap", async () => {
    const plan = planOf(["test.add2", "test.add2", "test.add2"]);
    const result = await executePlan(plan, { cwd: process.cwd(), maxSteps: 2 });
    expect(result.results).toHaveLength(2);
  });
});

describe("executor — registry resolution sanity", () => {
  it("the test fixtures are registered", () => {
    expect(registry.get("test.add2")).toBeDefined();
    expect(registry.get("test.network")).toBeDefined();
  });
});
