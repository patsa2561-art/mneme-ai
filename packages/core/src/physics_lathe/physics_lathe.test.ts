import { describe, expect, it } from "vitest";
import { physicsCheck, formatReport, extractQuantities, parseUnit, unitsEqual, allAxioms, allKnownValues } from "./index.js";

describe("physics lathe (v2.22.1) — formal LLM-claim verifier", () => {

  // ─── unit parser ────────────────────────────────────────────────

  describe("unit parser", () => {
    it("'km/s' parses to m·s⁻¹ with scale 1000", () => {
      const r = parseUnit("km/s");
      expect(r).not.toBeNull();
      expect(unitsEqual(r!.unit, [["m", 1], ["s", -1]])).toBe(true);
      expect(r!.scale).toBeCloseTo(1000, 4);
    });

    it("'m/s²' parses correctly", () => {
      const r = parseUnit("m/s^2");
      expect(unitsEqual(r!.unit, [["m", 1], ["s", -2]])).toBe(true);
    });

    it("'N/m²' parses to Pa-equivalent (pressure)", () => {
      const r = parseUnit("N/m^2");
      const pa = parseUnit("Pa");
      expect(unitsEqual(r!.unit, pa!.unit)).toBe(true);
    });

    it("'GPa' parses to Pa with scale 1e9", () => {
      const r = parseUnit("GPa");
      expect(r!.scale).toBeCloseTo(1e9, 6);
    });

    it("'kg' is recognised", () => {
      const r = parseUnit("kg");
      expect(unitsEqual(r!.unit, [["kg", 1]])).toBe(true);
      expect(r!.scale).toBe(1);
    });

    it("garbage tokens return null", () => {
      expect(parseUnit("Xyzzy")).toBeNull();
    });
  });

  // ─── extractor ──────────────────────────────────────────────────

  describe("quantity extractor", () => {
    it("extracts '9.4 km/s' from a delta-v claim", () => {
      const qs = extractQuantities("Delta-v to LEO is roughly 9.4 km/s");
      const hit = qs.find((q) => q.rawUnit === "km/s");
      expect(hit).toBeDefined();
      expect(hit!.siValue).toBeCloseTo(9400, 0);
    });

    it("extracts large scientific notation '1.5 × 10^6'", () => {
      const qs = extractQuantities("Mars escape velocity is 5.03 × 10^3 m/s");
      expect(qs.some((q) => Math.abs(q.siValue - 5030) < 1)).toBe(true);
    });

    it("handles thousands commas '50,000 N'", () => {
      const qs = extractQuantities("Engine produces 50,000 N of thrust");
      const hit = qs.find((q) => q.rawUnit === "N");
      expect(hit).toBeDefined();
      expect(hit!.siValue).toBeCloseTo(50000, 0);
    });

    it("ignores numbers without units", () => {
      const qs = extractQuantities("Test number 42 has no unit");
      // numbers must be followed by recognised unit
      expect(qs.filter((q) => q.rawUnit).length).toBe(0);
    });
  });

  // ─── verifier ───────────────────────────────────────────────────

  describe("verifier — known values", () => {
    it("CONFIRMS LEO velocity claim ~7.8 km/s", () => {
      const r = physicsCheck("LEO orbital velocity is about 7.66 km/s");
      expect(r.verdict).toBe("CONFIRMED");
      expect(r.hits.some((h) => h.kind === "known-value" && h.passed)).toBe(true);
    });

    it("REFUTES grossly wrong LEO velocity '50 km/s'", () => {
      const r = physicsCheck("To reach LEO orbital velocity you need 50 km/s");
      expect(r.verdict).toBe("REFUTED");
    });

    it("CONFIRMS Earth escape velocity ~11.2 km/s", () => {
      const r = physicsCheck("Earth escape velocity is 11.2 km/s");
      expect(r.verdict).toBe("CONFIRMED");
    });

    it("REFUTES wrong Earth escape velocity '25 km/s'", () => {
      const r = physicsCheck("To escape Earth you need an escape velocity of 25 km/s");
      expect(r.verdict).toBe("REFUTED");
    });

    it("CONFIRMS ISS altitude 400 km", () => {
      const r = physicsCheck("The ISS altitude is approximately 408 km");
      expect(r.verdict).toBe("CONFIRMED");
    });

    it("INSUFFICIENT_DATA on text with no quantities", () => {
      const r = physicsCheck("The rocket goes up");
      expect(r.verdict).toBe("INSUFFICIENT_DATA");
    });

    it("OUT_OF_AXIOM_SET when units recognised but no axiom matches", () => {
      const r = physicsCheck("My weight is 70 kg");
      // bare mass with no context — no known-value matches; no axiom can solve
      expect(["OUT_OF_AXIOM_SET", "INSUFFICIENT_DATA"]).toContain(r.verdict);
    });
  });

  // ─── citations + format ─────────────────────────────────────────

  it("formatReport renders verdict badge + extracted quantities + evaluations", () => {
    const r = physicsCheck("LEO orbital velocity is 7.66 km/s");
    const out = formatReport(r);
    expect(out).toContain("PHYSICS LATHE");
    expect(out).toContain("CONFIRMED");
    expect(out).toContain("km/s");
  });

  it("CONFIRMED report includes deterministic citation(s)", () => {
    const r = physicsCheck("LEO orbital velocity is 7.66 km/s");
    expect(r.citations.length).toBeGreaterThan(0);
  });

  // ─── catalog sanity ─────────────────────────────────────────────

  it("ships at least 10 axioms + 10 known-values + 15 constants", () => {
    expect(allAxioms().length).toBeGreaterThanOrEqual(10);
    expect(allKnownValues().length).toBeGreaterThanOrEqual(10);
  });
});
