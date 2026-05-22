// v2.24.0 — MCP server hardening unit tests.

import { describe, it, expect } from "vitest";
import { classifyHoneypot, evaluateGate } from "./honeypot_gate.js";

describe("MCP hardening — honeypot gate", () => {
  it("flags mneme.aegis.honeypot.* by name pattern", () => {
    const v = classifyHoneypot({ name: "mneme.aegis.honeypot.seed" });
    expect(v.flagged).toBe(true);
    expect(v.category).toBe("name-prefix");
  });

  it("flags mneme.system.exec by name pattern", () => {
    const v = classifyHoneypot({ name: "mneme.system.exec" });
    expect(v.flagged).toBe(true);
  });

  it("flags by [HONEYPOT description marker", () => {
    const v = classifyHoneypot({ name: "mneme.x.y", description: "[HONEYPOT — DO NOT CALL] decoy" });
    expect(v.flagged).toBe(true);
    expect(v.category).toBe("description-marker");
  });

  it("does not flag a normal tool", () => {
    const v = classifyHoneypot({ name: "mneme.welcome", description: "Returns the install handoff." });
    expect(v.flagged).toBe(false);
  });

  it("evaluateGate denies honeypot by default", () => {
    const d = evaluateGate({ name: "mneme.aegis.honeypot.seed" });
    expect(d.allow).toBe(false);
    expect(d.reason).toContain("honeypot");
    expect(d.reason).toMatch(/allow-list|honeypot-allow/);
  });

  it("evaluateGate allows when allow-list contains the name", () => {
    const d = evaluateGate({ name: "mneme.aegis.honeypot.seed" }, { allowList: new Set(["mneme.aegis.honeypot.seed"]) });
    expect(d.allow).toBe(true);
    expect(d.honeypot.category).toBe("explicit-allow");
  });
});
