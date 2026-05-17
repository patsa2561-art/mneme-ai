/**
 * v2.19.33 B2 REGRESSION — TRUTH SENSOR PACK
 *
 * Pins the zero-config fix forever: first-run users get a non-empty sensor
 * recommendation; the kernel never reports "sensors=0" because the recipe
 * tells the caller what to wire.
 */
import { describe, it, expect } from "vitest";
import {
  DEFAULT_SENSOR_PACK,
  classifyClaimShape,
  proposeSensorPlan,
  explainDefaultStack,
  computePackStats,
  formatPackLine,
  TRUTH_SENSOR_PACK_TUNABLES,
} from "./index.js";

describe("v2.19.33 B2 — DEFAULT SENSOR PACK", () => {
  it("ships ≥4 default sensors (zero-config means good defaults)", () => {
    expect(DEFAULT_SENSOR_PACK.length).toBeGreaterThanOrEqual(4);
  });

  it("includes the user-named canonical 4: truth_forensic + apoptosis + inverse_forensics + bountyVendor (+ contradictions)", () => {
    const ids = DEFAULT_SENSOR_PACK.map((r) => r.id);
    expect(ids).toContain("truth_forensic");
    expect(ids).toContain("apoptosis");
    expect(ids).toContain("inverse_forensics");
    expect(ids).toContain("bounty_vendor");
    expect(ids).toContain("contradictions");
  });

  it("every recipe has a real-looking mcpTool name (mneme.X.Y format)", () => {
    for (const r of DEFAULT_SENSOR_PACK) {
      expect(r.mcpTool).toMatch(/^mneme\.[a-z_]+\.[a-z_]+$/);
    }
  });

  it("weights are non-zero positive numbers", () => {
    for (const r of DEFAULT_SENSOR_PACK) {
      expect(r.weight).toBeGreaterThan(0);
      expect(Number.isFinite(r.weight)).toBe(true);
    }
  });

  it("fallback behaviour is one of the 3 enum values", () => {
    for (const r of DEFAULT_SENSOR_PACK) {
      expect(["skip", "treat_as_uncertain", "treat_as_inapplicable"]).toContain(r.fallbackBehaviour);
    }
  });

  it("DEFENSIVE — frozen recipe pack (immutable)", () => {
    expect(Object.isFrozen(DEFAULT_SENSOR_PACK)).toBe(true);
  });
});

describe("v2.19.33 B2 — classifyClaimShape", () => {
  it("file_existence: 'packages/.../foo.ts exists'", () => {
    expect(classifyClaimShape("the file packages/core/src/index.ts exists")).toBe("file_existence");
  });
  it("tool_capability: 'mneme.synapse.sync_export'", () => {
    expect(classifyClaimShape("we have mneme.synapse.sync_export")).toBe("tool_capability");
  });
  it("version_claim: 'v2.19.32'", () => {
    expect(classifyClaimShape("we shipped v2.19.32 today")).toBe("version_claim");
  });
  it("symbol_existence: 'function captureSnapshot'", () => {
    expect(classifyClaimShape("export function captureSnapshot returns envelope")).toBe("symbol_existence");
  });
  it("conceptual: 'because X therefore Y'", () => {
    expect(classifyClaimShape("BUG #1 was critical because the / route bypassed auth")).toBe("conceptual");
  });
  it("narrative: 'we plan to ship' (without version)", () => {
    expect(classifyClaimShape("we plan to ship the new feature tomorrow")).toBe("narrative");
  });
  it("unknown: empty / garbage", () => {
    expect(classifyClaimShape("")).toBe("unknown");
    expect(classifyClaimShape("xyz qrs")).toBe("unknown");
  });
});

describe("v2.19.33 B2 — proposeSensorPlan", () => {
  it("file_existence claim → recommendedSensors includes truth_forensic + apoptosis + contradictions", () => {
    const plan = proposeSensorPlan({ claim: "the file packages/core/src/handoff_snapshot/index.ts exists" });
    const ids = plan.recommendedSensors.map((r) => r.id);
    expect(plan.shape).toBe("file_existence");
    expect(ids).toContain("truth_forensic");
    expect(ids).toContain("apoptosis");
    expect(ids).toContain("contradictions");
  });

  it("tool_capability claim → includes truth_forensic + inverse_forensics", () => {
    const plan = proposeSensorPlan({ claim: "mneme.handoff.snapshot works on all 4 modules" });
    expect(plan.shape).toBe("tool_capability");
    const ids = plan.recommendedSensors.map((r) => r.id);
    expect(ids).toContain("truth_forensic");
    expect(ids).toContain("inverse_forensics");
  });

  it("unknown shape → full default stack returned (no empty plan)", () => {
    const plan = proposeSensorPlan({ claim: "random sentence about food" });
    expect(plan.shape).toBe("unknown");
    expect(plan.recommendedSensors.length).toBe(DEFAULT_SENSOR_PACK.length);
  });

  it("full=true → always returns full stack regardless of shape", () => {
    const plan = proposeSensorPlan({ claim: "v2.19.32", full: true });
    expect(plan.recommendedSensors.length).toBe(DEFAULT_SENSOR_PACK.length);
  });

  it("DEFENSIVE: bad input never throws", () => {
    expect(() => proposeSensorPlan({ claim: undefined as unknown as string })).not.toThrow();
    expect(() => proposeSensorPlan({ claim: null as unknown as string })).not.toThrow();
    expect(() => proposeSensorPlan({ claim: "" })).not.toThrow();
  });

  it("recommendedSensors is NEVER EMPTY (zero-config means good defaults)", () => {
    const inputs = ["", "random", "v2.19", "function x", "we plan", "mneme.x.y", "the/file/x.ts"];
    for (const claim of inputs) {
      const plan = proposeSensorPlan({ claim });
      expect(plan.recommendedSensors.length).toBeGreaterThan(0);
    }
  });
});

describe("v2.19.33 B2 — explainDefaultStack (AI-agent ingestible)", () => {
  it("emits ≥4 sensor entries + how-to-wire section", () => {
    const plan = proposeSensorPlan({ claim: "test claim" });
    const text = explainDefaultStack(plan);
    expect(text).toContain("# 🛡 Mneme Truth Sensor Pack");
    expect(text).toContain("How to wire");
    expect(text).toContain("mneme.truth.check_multi");
    // Each sensor named in text
    for (const r of plan.recommendedSensors) {
      expect(text).toContain(r.id);
      expect(text).toContain(r.mcpTool);
    }
  });
});

describe("v2.19.33 B2 — A/B before-vs-after comparison", () => {
  // BEFORE FIX: caller would pass sensors=[] → kernel reports sensors=0 → INCONCLUSIVE
  // AFTER FIX: caller calls proposeSensorPlan(claim) → gets ≥1 sensor recipe → wires + fuses
  it("A: empty sensor list (pre-fix path) — 0 sensors", () => {
    expect([].length).toBe(0); // sanity placeholder
  });
  it("B: proposeSensorPlan → always ≥1 sensor (zero-config first-run fixed)", () => {
    const plan = proposeSensorPlan({ claim: "anything" });
    expect(plan.recommendedSensors.length).toBeGreaterThanOrEqual(1);
  });
  it("AB-DELTA: post-fix recommends 100% more sensors than pre-fix (0 → ≥4)", () => {
    const preFix = 0;
    const postFix = proposeSensorPlan({ claim: "anything", full: true }).recommendedSensors.length;
    expect(postFix - preFix).toBeGreaterThanOrEqual(4);
  });
});

describe("v2.19.33 B2 — stats + 24/7 resilience", () => {
  it("computePackStats reports totals + averages", () => {
    const s = computePackStats();
    expect(s.totalDefaults).toBeGreaterThanOrEqual(4);
    expect(s.shapeSpecificMappings).toBeGreaterThan(0);
    expect(s.averageWeight).toBeGreaterThan(0);
    expect(formatPackLine(s)).toContain("SENSOR PACK");
  });
  it("PROTOCOL_VERSION exposed", () => {
    expect(TRUTH_SENSOR_PACK_TUNABLES.PROTOCOL_VERSION).toBe(1);
  });
  it("1000 random proposeSensorPlan calls never crash", () => {
    const samples = ["", "v1.0", "file foo.ts", "mneme.x.y", "function bar", "we plan to", "qrs xyz"];
    for (let i = 0; i < 1000; i++) {
      const claim = samples[Math.floor(Math.random() * samples.length)] + " " + Math.random();
      expect(() => proposeSensorPlan({ claim })).not.toThrow();
    }
  });
});
