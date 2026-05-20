import { describe, it, expect } from "vitest";
import { predictMortality } from "./index.js";

describe("dep_mortality · scoring", () => {
  it("moment-style dead package scores high mortality (>= 0.45)", () => {
    const r = predictMortality({
      name: "moment", monthsSinceLatest: 30, monthsSinceFeatureRelease: 30,
      deprecated: false, maintainerCount: 3, prevMaintainerCount: 5,
    });
    expect(r.score).toBeGreaterThanOrEqual(0.45);
    expect(["watch", "moribund", "dead"]).toContain(r.band);
    // moment is in KNOWN_SUBSTITUTES so the recommendation mentions date-fns
    expect(r.recommendation.toLowerCase()).toMatch(/date-fns|dayjs|alternative/);
  });

  it("fresh active package scores low mortality + thriving band", () => {
    const r = predictMortality({
      name: "freshly-maintained", monthsSinceLatest: 0, monthsSinceFeatureRelease: 1,
      deprecated: false, maintainerCount: 4, prevMaintainerCount: 4,
    });
    expect(r.score).toBeLessThan(0.20);
    expect(["thriving", "healthy"]).toContain(r.band);
  });

  it("deprecated package gets a deprecation bump", () => {
    const r = predictMortality({
      name: "abandoned", monthsSinceLatest: 5, monthsSinceFeatureRelease: 6,
      deprecated: true, maintainerCount: 1, prevMaintainerCount: 1,
    });
    expect(r.reasons.find((rs) => rs.signal === "deprecation")?.raw).toBe(1);
    expect(r.probability18mo).toBeGreaterThan(0.2);
  });

  it("probability18mo is bounded in [0, 0.95]", () => {
    const r = predictMortality({
      name: "very-dead", monthsSinceLatest: 60, monthsSinceFeatureRelease: 60,
      deprecated: true, maintainerCount: 0, prevMaintainerCount: 5,
    });
    expect(r.probability18mo).toBeGreaterThanOrEqual(0);
    expect(r.probability18mo).toBeLessThanOrEqual(0.95);
  });
});
