import { describe, it, expect } from "vitest";
import { buildRiskMap, riskMapGauntlet, MAP_W, MAP_H, MAP_CAP } from "./riskmap.js";

describe("RISK MAP — the key-person-risk constellation (deterministic, accurate)", () => {
  it("stress: gauntlet scores 100 over 100,000 random reports (total · coords-in-box · range · edges · cap · deterministic)", () => {
    const g = riskMapGauntlet(100_000);
    expect(g.iterations).toBe(100_000);
    expect(g.score).toBe(100);
    expect(g.checks.every((c) => c.pass)).toBe(true);
  }, 60_000);

  it("nodes + edges come VERBATIM from the report (accuracy contract — nothing invented)", () => {
    const report = {
      busFactor: { fragileFiles: [{ file: "core/auth.ts", topAuthorShare: 0.95, commits: 40 }, { file: "lib/util.ts", topAuthorShare: 0.4, commits: 10 }] },
      hotspots: { hotspots: [{ file: "core/auth.ts", changes: 120, loc: 800 }] },
      complexity: { hotspots: [] },
      coupling: { pairs: [{ a: "core/auth.ts", b: "lib/util.ts", confidence: 0.8, hidden: true }] },
    };
    const m = buildRiskMap(report);
    const files = m.nodes.map((n) => n.file).sort();
    expect(files).toEqual(["core/auth.ts", "lib/util.ts"]);
    // highest single-owner share → highest risk → index 0 (nearest centre)
    expect(m.nodes[0].file).toBe("core/auth.ts");
    expect(m.nodes[0].risk).toBeCloseTo(0.95, 5);   // verbatim, not invented
    // the edge connects exactly the coupled pair
    expect(m.edges.length).toBe(1);
    const e = m.edges[0];
    expect(new Set([m.nodes[e.a].file, m.nodes[e.b].file])).toEqual(new Set(["core/auth.ts", "lib/util.ts"]));
    expect(e.hidden).toBe(true);
    expect(e.weight).toBeCloseTo(0.8, 5);
  });

  it("a file with NO measured signal is never drawn (no fabrication)", () => {
    const m = buildRiskMap({ busFactor: { fragileFiles: [] }, hotspots: { hotspots: [] }, complexity: { hotspots: [] }, coupling: { pairs: [] } });
    expect(m.nodes.length).toBe(0);
    expect(m.edges.length).toBe(0);
    expect(m.note).toMatch(/no per-file risk signals/);
  });

  it("caps the node count + keeps coordinates inside the viewBox", () => {
    const fragileFiles = Array.from({ length: 80 }, (_, i) => ({ file: `f${i}.ts`, topAuthorShare: (i % 100) / 100, commits: i }));
    const m = buildRiskMap({ busFactor: { fragileFiles }, hotspots: { hotspots: [] }, complexity: { hotspots: [] }, coupling: { pairs: [] } });
    expect(m.nodes.length).toBeLessThanOrEqual(MAP_CAP);
    for (const n of m.nodes) { expect(n.x).toBeGreaterThanOrEqual(0); expect(n.x).toBeLessThanOrEqual(MAP_W); expect(n.y).toBeGreaterThanOrEqual(0); expect(n.y).toBeLessThanOrEqual(MAP_H); }
  });

  it("is total: garbage / missing report never throws", () => {
    expect(() => buildRiskMap(null)).not.toThrow();
    expect(() => buildRiskMap({ busFactor: { fragileFiles: [{ file: "", topAuthorShare: NaN }] }, coupling: { pairs: [{ a: "", b: undefined, confidence: NaN }] } })).not.toThrow();
  });
});
