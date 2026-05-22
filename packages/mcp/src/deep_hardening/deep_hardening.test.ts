// v2.26.0 — Deep-hardening unit tests.

import { describe, it, expect } from "vitest";
import { classifyToolName } from "./name_validator.js";
import { validateArgs } from "./schema_required.js";
import { cancelManager } from "./cancel_manager.js";

describe("name_validator (N3)", () => {
  it("accepts canonical names", () => {
    for (const n of [
      "mneme.welcome",
      "mneme.fuzz.run",
      "mneme.codegraph.build",
      "mneme.security.honeypot_status",
      "mneme.x_y.z_0",
    ]) {
      expect(classifyToolName(n).ok).toBe(true);
    }
  });

  it("rejects every malicious shape from the audit", () => {
    const bad = [
      "",
      "../../../etc/passwd",
      "__proto__.constructor",
      "A".repeat(10_000),
      "🎯",
      "Mneme.Capabilities",
      "evil.exec",
      "mneme/foo",
      "mneme\\foo",
      "mneme..foo",
      "mneme.foo bar",
      "mneme.foo\nbar",
    ];
    for (const n of bad) {
      const v = classifyToolName(n);
      expect(v.ok, `expected reject for ${JSON.stringify(n).slice(0, 60)}`).toBe(false);
    }
  });

  it("non-string inputs are rejected as empty", () => {
    expect(classifyToolName(null).classification).toBe("empty");
    expect(classifyToolName(undefined).classification).toBe("empty");
    expect(classifyToolName(123 as unknown).classification).toBe("empty");
  });
});

describe("schema_required (N2 + N10)", () => {
  it("accepts when no schema present", () => {
    expect(validateArgs({}, undefined).ok).toBe(true);
  });

  it("rejects missing required fields", () => {
    const v = validateArgs({}, { type: "object", properties: { x: { type: "string" } }, required: ["x"] });
    expect(v.ok).toBe(false);
    expect(v.violations[0]?.kind).toBe("missing");
  });

  it("rejects wrong-type fields", () => {
    const v = validateArgs({ x: 123 }, { type: "object", properties: { x: { type: "string" } }, required: ["x"] });
    expect(v.ok).toBe(false);
    expect(v.violations[0]?.kind).toBe("wrong-type");
  });

  it("accepts integer where number is required", () => {
    const v = validateArgs({ n: 5 }, { type: "object", properties: { n: { type: "number" } } });
    expect(v.ok).toBe(true);
  });

  it("ignores extra unknown fields (forward-compat)", () => {
    const v = validateArgs({ x: "abc", extra: 1 }, { type: "object", properties: { x: { type: "string" } }, required: ["x"] });
    expect(v.ok).toBe(true);
  });

  it("rejects required=null", () => {
    const v = validateArgs({ x: null }, { type: "object", properties: { x: { type: "string" } }, required: ["x"] });
    expect(v.ok).toBe(false);
    expect(v.violations[0]?.kind).toBe("null-required");
  });
});

describe("cancel_manager (N6)", () => {
  it("register + unregister", () => {
    const sig = cancelManager.register(101, "test.tool");
    expect(sig).toBeDefined();
    expect(cancelManager.size()).toBeGreaterThanOrEqual(1);
    cancelManager.unregister(101);
  });

  it("cancel fires AbortController", async () => {
    const sig = cancelManager.register(102, "test.tool");
    expect(sig.aborted).toBe(false);
    const ok = cancelManager.cancel(102, "test-reason");
    expect(ok).toBe(true);
    expect(sig.aborted).toBe(true);
    cancelManager.unregister(102);
  });

  it("cancel returns false for unknown id", () => {
    expect(cancelManager.cancel(999999, "x")).toBe(false);
  });
});
