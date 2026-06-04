import { describe, it, expect } from "vitest";
import { buildAirQuality, airQualityGauntlet } from "./airquality.js";

describe("CONTEXT AIR QUALITY — one breathability number (measured composite, honest)", () => {
  it("a clean repo is Pristine (100)", () => {
    const a = buildAirQuality({ secrets: { totalFindings: 0 }, security: { destructive: [] }, busFactor: { singleOwnerFilePct: 0 }, coupling: { pairs: [] }, deps: { byBand: {} }, complexity: { hotspots: [] } });
    expect(a.score).toBe(100);
    expect(a.band).toBe("Pristine");
    expect(a.pollutants).toEqual([]);
  });

  it("a toxic repo is Hazardous + names the worst pollutant first", () => {
    const a = buildAirQuality({ secrets: { totalFindings: 40 }, security: { destructive: [{}, {}, {}] }, busFactor: { singleOwnerFilePct: 100 }, coupling: { pairs: Array.from({ length: 20 }, () => ({ hidden: true })) }, deps: { byBand: { dead: 9 } }, complexity: { hotspots: Array.from({ length: 9 }, () => ({ bodyLines: 300 })) } });
    expect(a.band).toBe("Hazardous");
    expect(a.score).toBeLessThan(30);
    expect(a.pollutants[0].impact).toBeGreaterThanOrEqual(a.pollutants[a.pollutants.length - 1].impact);
    expect(a.pollutants.every((p) => p.name && p.detail)).toBe(true);
  });

  it("each pollutant is verbatim-derived (e.g. 3 secrets → secrets pollutant present)", () => {
    const a = buildAirQuality({ secrets: { totalFindings: 3 }, security: { destructive: [] }, busFactor: { singleOwnerFilePct: 0 }, coupling: { pairs: [] }, deps: { byBand: {} }, complexity: { hotspots: [] } });
    const sec = a.pollutants.find((p) => p.name === "Leaked secrets");
    expect(sec).toBeTruthy();
    expect(sec!.detail).toContain("3 credential");
    expect(a.score).toBeLessThan(100);
  });

  it("total on garbage", () => {
    expect(() => buildAirQuality(null)).not.toThrow();
    expect(() => buildAirQuality({ secrets: "x", coupling: 5 })).not.toThrow();
    expect(buildAirQuality(null).score).toBe(100); // no signals = nothing toxic measured
  });

  it("stress: airQualityGauntlet scores 100 over 100,000 random reports", () => {
    const g = airQualityGauntlet(100_000);
    if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass));
    expect(g.score).toBe(100);
  }, 20_000);
});
