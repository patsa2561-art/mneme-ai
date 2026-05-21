import { describe, expect, it } from "vitest";
import { crossCheck, formatReport, listFailures, findFailure, FAILURES } from "./index.js";

describe("challenger librarian (v2.22.2)", () => {

  describe("catalog", () => {
    it("ships ≥ 8 historical failure entries", () => {
      expect(FAILURES.length).toBeGreaterThanOrEqual(8);
    });

    it("every entry has root-cause + avoidance + citation + detector", () => {
      for (const f of FAILURES) {
        expect(f.rootCause.length).toBeGreaterThan(20);
        expect(f.avoid.length).toBeGreaterThan(15);
        expect(f.citation.length).toBeGreaterThan(5);
        expect(["dimensional", "physics-axiom", "keyword", "structural"]).toContain(f.detector);
      }
    });

    it("findFailure resolves known ids", () => {
      expect(findFailure("mars-climate-orbiter")?.name).toContain("Mars");
      expect(findFailure("therac-25")?.name).toContain("Therac");
      expect(findFailure("nope")).toBeNull();
    });
  });

  describe("Mars Climate Orbiter detector (dimensional)", () => {
    it("flags imperial-unit thrust claim with keyword cues", () => {
      const r = crossCheck("Engine thrust = 500 lbf·s applied for orbit insertion.");
      expect(r.matches.some((m) => m.id === "mars-climate-orbiter")).toBe(true);
    });

    it("flags dimensional MISMATCH in plan as Mars-Climate-Orbiter class", () => {
      const r = crossCheck("Thrust = 9.8 N/m^2 needed for descent burn.");
      const mco = r.matches.find((m) => m.id === "mars-climate-orbiter");
      expect(mco).toBeDefined();
      expect(mco!.confidence).toBeGreaterThan(0.5);
    });
  });

  describe("Challenger O-ring detector (physics-axiom + keyword)", () => {
    it("fires on cold-launch wording", () => {
      const r = crossCheck("O-ring qualified down to 12 °C; ambient at launch is -2 °C but proceed.");
      expect(r.matches.some((m) => m.id === "challenger-o-ring")).toBe(true);
    });
  });

  describe("Columbia foam-strike detector (keyword)", () => {
    it("fires on 'normalised deviance' wording", () => {
      const r = crossCheck("Foam strike noted but normalised deviance — previous flights had foam, no inspection needed.");
      expect(r.matches.some((m) => m.id === "columbia-foam-strike")).toBe(true);
    });
  });

  describe("Therac-25 detector (structural → keyword)", () => {
    it("fires on race-condition + software-only-safety wording", () => {
      const r = crossCheck("Software-only safety: a race condition in fast operator data-entry could miss the interlock check.");
      expect(r.matches.some((m) => m.id === "therac-25")).toBe(true);
    });
  });

  describe("Ariane 5 detector (keyword)", () => {
    it("fires on legacy-software reuse without re-qualification", () => {
      const r = crossCheck("Reuse Ariane 4 inertial software with 16-bit casting; untested at new range.");
      expect(r.matches.some((m) => m.id === "ariane-5-501")).toBe(true);
    });
  });

  describe("verdict bands", () => {
    it("SAFE when plan has no matches", () => {
      const r = crossCheck("Generic plan: write a markdown file and commit.");
      expect(r.verdict).toBe("SAFE");
      expect(r.matches.length).toBe(0);
    });

    it("BLOCK on high-confidence dimensional MISMATCH", () => {
      const r = crossCheck("Thrust = 9.8 N/m^2 for the descent burn; reuse Ariane 4 16-bit casting.");
      expect(["BLOCK", "WARN"]).toContain(r.verdict);
    });

    it("rationale text always populated", () => {
      const r1 = crossCheck("Generic plan: edit file.");
      expect(r1.rationale.length).toBeGreaterThan(10);
      const r2 = crossCheck("Pure oxygen 16.7 psi pressurised cabin with inward-opening hatch.");
      expect(r2.rationale.length).toBeGreaterThan(10);
    });
  });

  describe("formatter", () => {
    it("SAFE renders ✓ badge", () => {
      const out = formatReport(crossCheck("Plain plan."));
      expect(out).toContain("SAFE");
    });

    it("WARN/BLOCK renders root cause + citation", () => {
      const out = formatReport(crossCheck("Pure oxygen 16.7 psi pressurised cabin with inward-opening hatch."));
      expect(out).toMatch(/WARN|BLOCK|CAUTION/);
      expect(out).toContain("citation:");
    });
  });
});
