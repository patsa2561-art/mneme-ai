import { describe, expect, it } from "vitest";
import { STRAINS, listStrains, getStrain, compilePatterns } from "./strains.js";

describe("strains taxonomy", () => {
  it("registers exactly 8 strains", () => {
    expect(Object.keys(STRAINS).length).toBe(8);
  });

  it("all strains have a non-empty scientific name + common name + pathogenesis", () => {
    for (const s of listStrains()) {
      expect(s.scientificName.length).toBeGreaterThan(0);
      expect(s.commonName.length).toBeGreaterThan(0);
      expect(s.pathogenesis.length).toBeGreaterThan(20);
    }
  });

  it("severity is in [1, 5]", () => {
    for (const s of listStrains()) {
      expect(s.severity).toBeGreaterThanOrEqual(1);
      expect(s.severity).toBeLessThanOrEqual(5);
    }
  });

  it("listStrains returns sorted by severity desc then id", () => {
    const arr = listStrains();
    for (let i = 1; i < arr.length; i++) {
      const prev = arr[i - 1]!, cur = arr[i]!;
      expect(prev.severity > cur.severity || (prev.severity === cur.severity && prev.id < cur.id)).toBe(true);
    }
  });

  it("getStrain returns the matching strain", () => {
    expect(getStrain("citatio_viridis").id).toBe("citatio_viridis");
  });

  it("getStrain throws on unknown id", () => {
    expect(() => getStrain("xxx_unknown_strain" as unknown as "citatio_viridis")).toThrow();
  });

  it("compilePatterns returns regex with global flag", () => {
    const re = compilePatterns("citatio_viridis");
    expect(re.length).toBeGreaterThan(0);
    for (const r of re) expect(r.flags).toContain("g");
  });

  it("compilePatterns is idempotent (cached)", () => {
    const a = compilePatterns("api_phantasma");
    const b = compilePatterns("api_phantasma");
    expect(a).toBe(b);
  });
});
