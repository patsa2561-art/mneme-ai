/**
 * v2.19.35 R1 REGRESSION — buildAutoCheckPlan (1-step zero-config truth check)
 */
import { describe, it, expect } from "vitest";
import { buildAutoCheckPlan, DEFAULT_SENSOR_PACK } from "./index.js";

describe("v2.19.35 R1 — buildAutoCheckPlan zero-config", () => {
  it("plan contains N invoke steps + 1 fuse step for default stack", () => {
    const plan = buildAutoCheckPlan({ claim: "mneme.synapse.sync_export is registered" });
    expect(plan.steps.length).toBeGreaterThanOrEqual(2);
    const invokes = plan.steps.filter((s) => s.kind === "invoke");
    const fuses = plan.steps.filter((s) => s.kind === "fuse");
    expect(invokes.length).toBeGreaterThanOrEqual(1);
    expect(fuses.length).toBe(1);
    expect(fuses[0]!.mcpTool).toBe("mneme.truth.check_multi");
  });

  it("each invoke step has a sensorId + mcpTool from DEFAULT_SENSOR_PACK", () => {
    const plan = buildAutoCheckPlan({ claim: "claim x" });
    const sensorIds = DEFAULT_SENSOR_PACK.map((s) => s.id);
    for (const step of plan.steps) {
      if (step.kind === "invoke") {
        expect(step.sensorId).toBeDefined();
        expect(sensorIds).toContain(step.sensorId!);
      }
    }
  });

  it("invoke args have claim text substituted", () => {
    const claim = "MUST verify this exact text";
    const plan = buildAutoCheckPlan({ claim });
    for (const step of plan.steps) {
      if (step.kind === "invoke" && "claim" in step.args) {
        expect(step.args.claim).toBe(claim);
      }
    }
  });

  it("fuse step has sensors placeholder for AI agent to fill", () => {
    const plan = buildAutoCheckPlan({ claim: "x" });
    const fuse = plan.steps.find((s) => s.kind === "fuse")!;
    expect(fuse.args.sensors).toBe("<COLLECT_FROM_PRIOR_STEPS>");
    expect(fuse.args.claim).toBe("x");
  });

  it("collectionRule gives AI agent unambiguous instructions", () => {
    const plan = buildAutoCheckPlan({ claim: "x" });
    expect(plan.collectionRule).toContain("invoke");
    expect(plan.collectionRule).toContain("sensors");
    expect(plan.collectionRule).toContain("fuse");
  });

  it("full=true → all 5 default sensors invoked", () => {
    const plan = buildAutoCheckPlan({ claim: "abc", full: true });
    const invokes = plan.steps.filter((s) => s.kind === "invoke");
    expect(invokes.length).toBe(DEFAULT_SENSOR_PACK.length);
  });

  it("DEFENSIVE: empty claim still produces plan with ≥1 invoke + 1 fuse", () => {
    const plan = buildAutoCheckPlan({ claim: "" });
    expect(plan.steps.filter((s) => s.kind === "invoke").length).toBeGreaterThanOrEqual(1);
    expect(plan.steps.filter((s) => s.kind === "fuse").length).toBe(1);
  });

  it("each invoke step has a known onFailure value", () => {
    const plan = buildAutoCheckPlan({ claim: "x" });
    for (const s of plan.steps) {
      expect(["skip", "treat_as_uncertain", "treat_as_inapplicable"]).toContain(s.onFailure);
    }
  });

  it("step numbering is sequential 1..N", () => {
    const plan = buildAutoCheckPlan({ claim: "x", full: true });
    for (let i = 0; i < plan.steps.length; i++) {
      expect(plan.steps[i]!.step).toBe(i + 1);
    }
  });

  it("plan rationale mentions claim shape", () => {
    const plan = buildAutoCheckPlan({ claim: "the file packages/core/src/index.ts exists" });
    expect(plan.rationale).toContain("file_existence");
  });
});
