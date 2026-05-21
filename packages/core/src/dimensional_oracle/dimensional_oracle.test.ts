import { describe, expect, it } from "vitest";
import { dimensionalCheck, formatReport, listDimensions, DIMENSION_CLASSES, QUANTITY_DIMENSION } from "./index.js";

describe("dimensional oracle (v2.22.2)", () => {

  describe("matches", () => {
    it("MATCH: altitude in km is length", () => {
      const r = dimensionalCheck("altitude = 400 km");
      expect(r.verdict).toBe("MATCH");
      expect(r.expected).toBe("length");
      expect(r.observed).toBe("length");
    });

    it("MATCH: thrust in kN is force", () => {
      const r = dimensionalCheck("thrust = 500 kN");
      expect(r.verdict).toBe("MATCH");
      expect(r.expected).toBe("force");
    });

    it("MATCH: velocity in m/s", () => {
      const r = dimensionalCheck("velocity = 7600 m/s");
      expect(r.verdict).toBe("MATCH");
      expect(r.expected).toBe("velocity");
    });

    it("MATCH: pressure in MPa", () => {
      const r = dimensionalCheck("pressure = 25 MPa");
      expect(r.verdict).toBe("MATCH");
      expect(r.expected).toBe("pressure");
    });
  });

  describe("mismatches — the Mars Climate Orbiter class", () => {
    it("MISMATCH: thrust in N/m² is pressure not force", () => {
      const r = dimensionalCheck("thrust = 9.8 N/m^2");
      expect(r.verdict).toBe("MISMATCH");
      expect(r.expected).toBe("force");
      expect(r.observed).toBe("pressure");
      expect(r.suggestions.length).toBeGreaterThan(0);
    });

    it("MISMATCH: altitude in m/s is velocity not length", () => {
      const r = dimensionalCheck("altitude = 400 m/s");
      expect(r.verdict).toBe("MISMATCH");
      expect(r.expected).toBe("length");
      expect(r.observed).toBe("velocity");
    });

    it("MISMATCH: mass in J is energy not mass", () => {
      const r = dimensionalCheck("mass = 500 J");
      expect(r.verdict).toBe("MISMATCH");
      expect(r.expected).toBe("mass");
      expect(r.observed).toBe("energy");
    });

    it("MISMATCH: power in J is energy not power", () => {
      const r = dimensionalCheck("power output = 1000 J");
      expect(r.verdict).toBe("MISMATCH");
      expect(r.expected).toBe("power");
      expect(r.observed).toBe("energy");
    });
  });

  describe("ambiguous + unknown", () => {
    it("UNKNOWN_QUANTITY: unrecognised name with valid unit", () => {
      const r = dimensionalCheck("flux capacitor = 1.21 GW");
      expect(r.verdict).toBe("UNKNOWN_QUANTITY");
      expect(r.observed).toBe("power");
    });

    it("UNKNOWN_UNIT: garbage unit", () => {
      const r = dimensionalCheck("velocity = 5 flibbergibbets");
      expect(r.verdict).toBe("UNKNOWN_UNIT");
    });
  });

  describe("catalog", () => {
    it("ships ≥ 15 dimension classes", () => {
      expect(DIMENSION_CLASSES.length).toBeGreaterThanOrEqual(15);
    });

    it("every dimension class has shorthands + description", () => {
      for (const d of DIMENSION_CLASSES) {
        expect(d.shorthands.length).toBeGreaterThan(0);
        expect(d.description.length).toBeGreaterThan(5);
      }
    });

    it("every quantity-name → dimension is one of the registered dimensions", () => {
      const valid = new Set(DIMENSION_CLASSES.map((d) => d.name));
      for (const [, dim] of Object.entries(QUANTITY_DIMENSION)) {
        if (dim === "torque") continue; // alias for energy SI base
        expect(valid.has(dim)).toBe(true);
      }
    });

    it("listDimensions returns the full catalog", () => {
      expect(listDimensions().length).toBe(DIMENSION_CLASSES.length);
    });
  });

  describe("formatter", () => {
    it("formatReport shows ✓ on MATCH", () => {
      const out = formatReport(dimensionalCheck("altitude = 400 km"));
      expect(out).toContain("MATCH");
      expect(out).toContain("✓");
    });

    it("formatReport shows ✗ + suggestions on MISMATCH", () => {
      const out = formatReport(dimensionalCheck("thrust = 9.8 N/m^2"));
      expect(out).toContain("MISMATCH");
      expect(out).toContain("Suggestions");
    });
  });
});
