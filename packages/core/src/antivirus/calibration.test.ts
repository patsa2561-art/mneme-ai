import { describe, expect, it } from "vitest";
import { brierScore, meanMargin, buildCalibrationReport } from "./calibration.js";

describe("antivirus calibration", () => {
  describe("brierScore", () => {
    it("is 0 on empty input", () => {
      expect(brierScore([])).toBe(0);
    });
    it("is 0 on perfect prediction", () => {
      expect(brierScore([
        { confidence: 1, actual: true },
        { confidence: 0, actual: false },
      ])).toBe(0);
    });
    it("is 1 on perfectly wrong prediction", () => {
      expect(brierScore([
        { confidence: 1, actual: false },
        { confidence: 0, actual: true },
      ])).toBe(1);
    });
    it("equals 0.25 for coin-flip 50% confidence", () => {
      expect(brierScore([
        { confidence: 0.5, actual: true },
        { confidence: 0.5, actual: false },
      ])).toBe(0.25);
    });
  });

  describe("meanMargin", () => {
    it("is 0 on coin-flip confidence", () => {
      expect(meanMargin([
        { confidence: 0.5, actual: true },
        { confidence: 0.5, actual: false },
      ])).toBe(0);
    });
    it("is 0.5 on always-decisive (0 or 1) confidence", () => {
      expect(meanMargin([
        { confidence: 1, actual: true },
        { confidence: 0, actual: false },
      ])).toBe(0.5);
    });
    it("is 0 on empty input", () => {
      expect(meanMargin([])).toBe(0);
    });
  });

  describe("buildCalibrationReport", () => {
    it("classifies an expert vaccine (decisive + accurate)", () => {
      const r = buildCalibrationReport([
        { confidence: 0.95, actual: true },
        { confidence: 0.05, actual: false },
        { confidence: 0.92, actual: true },
      ]);
      expect(r.brierBand).toBe("excellent");
      expect(r.decisivenessBand).toBe("decisive");
      expect(r.verdict).toBe("expert (decisive + accurate)");
    });
    it("classifies overconfident (decisive but wrong)", () => {
      const r = buildCalibrationReport([
        { confidence: 0.95, actual: false },
        { confidence: 0.05, actual: true },
        { confidence: 0.92, actual: false },
      ]);
      expect(r.brierBand).toBe("poor");
      expect(r.decisivenessBand).toBe("decisive");
      expect(r.verdict).toBe("overconfident (decisive but wrong)");
    });
    it("classifies honest doubt (low margin + low accuracy)", () => {
      const r = buildCalibrationReport([
        { confidence: 0.5, actual: true },
        { confidence: 0.55, actual: false },
        { confidence: 0.45, actual: true },
      ]);
      expect(r.decisivenessBand).toBe("uncertain");
      expect(r.verdict).toBe("honest doubt (low confidence + low accuracy)");
    });
    it("returns zero score on empty input", () => {
      const r = buildCalibrationReport([]);
      expect(r.brierScore).toBe(0);
      expect(r.meanMargin).toBe(0);
    });
  });
});
