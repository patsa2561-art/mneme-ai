import { describe, it, expect } from "vitest";
import { evaluateEngagement, defaultPolicy, engagementGauntlet } from "./index.js";

describe("AGENT ENGAGEMENT POLICY — robots.txt for AI agents (enforced at the gate)", () => {
  const p = defaultPolicy();
  it("BLOCKS a write to a forbidden path", () => {
    expect(evaluateEngagement(p, { kind: "write", paths: ["svc/.env"] }).decision).toBe("BLOCK");
    expect(evaluateEngagement(p, { kind: "write", paths: ["a/secrets/k.json"] }).decision).toBe("BLOCK");
  });
  it("NEEDS_COSIGN for a sensitive action", () => {
    expect(evaluateEngagement(p, { kind: "push:main" }).decision).toBe("NEEDS_COSIGN");
  });
  it("BLOCKS a forbidden license + ALLOWS a clean write", () => {
    expect(evaluateEngagement(p, { kind: "add-dep", license: "GPL-3.0" }).decision).toBe("BLOCK");
    expect(evaluateEngagement(p, { kind: "write", paths: ["src/util.ts"] }).decision).toBe("ALLOW");
  });
  it("BLOCK takes precedence over NEEDS_COSIGN", () => {
    expect(evaluateEngagement(p, { kind: "push:main", paths: [".env"] }).decision).toBe("BLOCK");
  });
  it("total on garbage", () => {
    expect(() => evaluateEngagement(null as never, { kind: "x" })).not.toThrow();
  });
  it("MEASURED: engagementGauntlet = 100", () => {
    const g = engagementGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass));
    expect(g.score).toBe(100);
  });
});
