/**
 * compliance — FIPS detection + enforcement tests.
 *
 * These tests don't require FIPS to be enabled; they verify the gate
 * behaves correctly in both modes by checking detection + enforcement
 * outcomes.
 */

import { describe, it, expect } from "vitest";
import {
  PRIMITIVES,
  isFipsActive,
  enforceCompliance,
  requireCompliance,
} from "./compliance.js";

describe("compliance — primitive inventory", () => {
  it("lists all cryptographic primitives Mneme uses", () => {
    expect(PRIMITIVES.length).toBeGreaterThanOrEqual(6);
    const names = PRIMITIVES.map((p) => p.name);
    expect(names).toContain("AES-256-GCM");
    expect(names).toContain("HMAC-SHA-256");
    expect(names).toContain("Ed25519");
    expect(names).toContain("scrypt");
    expect(names).toContain("SHA-256");
  });

  it("every primitive marks FIPS status (we use only FIPS-approved algorithms)", () => {
    for (const p of PRIMITIVES) {
      expect(p.fipsApproved).toBe(true);
    }
  });

  it("each primitive describes its use", () => {
    for (const p of PRIMITIVES) {
      expect(p.used.length).toBeGreaterThan(0);
    }
  });
});

describe("compliance — isFipsActive", () => {
  it("returns boolean (true xor false)", () => {
    expect(typeof isFipsActive()).toBe("boolean");
  });
});

describe("compliance — enforceCompliance", () => {
  it("profile=none always passes", () => {
    const r = enforceCompliance("none");
    expect(r.ok).toBe(true);
    expect(r.profile).toBe("none");
  });

  it("profile=fips140 reports fipsActive flag", () => {
    const r = enforceCompliance("fips140");
    expect(r.profile).toBe("fips140");
    // Either fips is active and ok=true, or fips is inactive and ok=false
    if (r.fipsActive) {
      expect(r.ok).toBe(true);
    } else {
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/FIPS/);
    }
  });

  it("returns the primitive inventory in every check", () => {
    const r = enforceCompliance("none");
    expect(r.primitives.length).toBeGreaterThan(0);
  });
});

describe("compliance — requireCompliance", () => {
  it("does not throw for profile=none", () => {
    expect(() => requireCompliance("none")).not.toThrow();
  });

  it("throws for profile=fips140 when FIPS inactive", () => {
    if (!isFipsActive()) {
      expect(() => requireCompliance("fips140")).toThrow(/FIPS/);
    }
  });
});
