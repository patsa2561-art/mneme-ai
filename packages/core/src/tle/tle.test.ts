import { describe, it, expect } from "vitest";
import { tleGauntlet, parseTle, orbitInfo } from "./index.js";
describe("TLE INTELLIGENCE", () => {
  it("MEASURED: tleGauntlet = 100", () => { const g = tleGauntlet(); if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass)); expect(g.score).toBe(100); });
  it("ISS element set → LEO ~92.9 min ~414 km (Kepler-exact)", () => {
    const el = parseTle("1 25544U 98067A   24001.50000000  .00016717  00000-0  10270-3 0  9000","2 25544  51.6400 200.0000 0006700  90.0000 270.0000 15.50000000 10000");
    const oi = orbitInfo(el);
    expect(oi.orbitClass).toBe("LEO"); expect(Math.abs(oi.periodMin-92.9)).toBeLessThan(0.5); expect(Math.abs(oi.perigeeAltKm-414)).toBeLessThan(8);
  });
});
