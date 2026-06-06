import { describe, it, expect } from "vitest";
import { orbitalGauntlet, parseSpaceWeather, spaceWeatherAdvisory, isOverhead } from "./index.js";
describe("ORBITAL — sensory nerve to the sky", () => {
  it("MEASURED: orbitalGauntlet = 100", () => { const g = orbitalGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
  it("a G4 storm tightens the charter; quiet does not", () => {
    const storm = spaceWeatherAdvisory(parseSpaceWeather({ "0": { G: { Scale: "4" }, R: { Scale: "1" }, S: { Scale: "0" } } }, [{ kp_index: 8 }]));
    expect(storm.level).toBe("severe"); expect(storm.charterSuggestion?.lowerMaxRiskTo).toBe(0.4);
    const quiet = spaceWeatherAdvisory(parseSpaceWeather({ "0": { G: { Scale: "0" }, R: { Scale: "0" }, S: { Scale: "0" } } }, [{ kp_index: 2 }]));
    expect(quiet.level).toBe("nominal"); expect(quiet.charterSuggestion).toBeNull();
  });
  it("overhead geometry: sub-point is overhead, antipode is not", () => {
    expect(isOverhead(13.7, 100.5, 420, 13.7, 100.5).overhead).toBe(true);
    expect(isOverhead(13.7, 100.5, 420, -13.7, -79.5).overhead).toBe(false);
  });
});
