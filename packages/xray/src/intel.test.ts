import { describe, it, expect } from "vitest";
import { buildKeystones, buildActionPlan, intelGauntlet, KEYSTONE_OWNER } from "./intel.js";

describe("TEAM INTELLIGENCE — keystones + action plan (accurate, traceable, legal)", () => {
  // A report where one file both ripples widely AND is single-owned.
  const report = {
    secrets: { totalFindings: 3, hits: [{ kind: "aws", file: "src/config.ts", line: 42 }] },
    security: { destructive: [{ command: "rm -rf build", where: "scripts/clean.sh", signals: [] }] },
    deps: { byBand: { dead: 2, moribund: 1 }, atRisk: [{ name: "request", band: "dead", successor: "got" }], licenseFlags: [{ name: "gpllib", license: "GPL-3.0", class: "strong-copyleft" }] },
    busFactor: { fragileFiles: [{ file: "core/auth.ts", topAuthorShare: 0.95, commits: 80 }, { file: "lib/util.ts", topAuthorShare: 0.2, commits: 10 }] },
    hotspots: { hotspots: [{ file: "core/auth.ts", changes: 50, loc: 400, expert: "odin" }] },
    complexity: { hotspots: [{ file: "core/auth.ts", bodyLines: 200, startLine: 12 }] },
    coupling: { pairs: [
      { a: "core/auth.ts", b: "lib/util.ts", confidence: 0.8, coChanges: 12, hidden: true },
      { a: "core/auth.ts", b: "api/pay.ts", confidence: 0.6, coChanges: 7, hidden: false },
    ] },
  };

  it("keystone = high-reach ∩ single-owner, verbatim — nothing invented", () => {
    const { keystones } = buildKeystones(report);
    expect(keystones.length).toBeGreaterThan(0);
    const k = keystones[0];
    expect(k.file).toBe("core/auth.ts");          // the file that is BOTH coupled and single-owned
    expect(k.ownerPct).toBeCloseTo(0.95);          // verbatim from fragileFiles
    expect(k.partners).toBe(2);                    // util.ts + pay.ts
    expect(k.expert).toBe("odin");                 // factual top author (who to ask)
    expect(k.score).toBeCloseTo((0.8 + 0.6) * 0.95);
  });

  it("a widely-coupled file that is NOT single-owned is not a keystone (no false alarm)", () => {
    const r2 = { coupling: { pairs: [{ a: "lib/util.ts", b: "x.ts", confidence: 0.9, coChanges: 5, hidden: false }] }, busFactor: { fragileFiles: [{ file: "lib/util.ts", topAuthorShare: 0.3, commits: 5 }] } };
    expect(buildKeystones(r2).keystones.length).toBe(0);
    expect(KEYSTONE_OWNER).toBe(0.6);
  });

  it("action plan is severity-ranked and every line cites a real source", () => {
    const { items } = buildActionPlan(report);
    expect(items.length).toBeGreaterThan(0);
    // sorted high → low
    const rank = { high: 0, med: 1, low: 2 } as const;
    for (let i = 1; i < items.length; i++) expect(rank[items[i].sev]).toBeGreaterThanOrEqual(rank[items[i - 1].sev]);
    // secrets surfaces as high with the exact location
    const sec = items.find((x) => x.title.includes("credential"));
    expect(sec?.sev).toBe("high");
    expect(sec?.source).toBe("config.ts:42");
    // every item is traceable
    for (const it of items) { expect(it.title).toBeTruthy(); expect(it.source).toBeTruthy(); }
  });

  it("a clean report yields an empty, honest plan (no fabricated busywork)", () => {
    const clean = buildActionPlan({ secrets: { totalFindings: 0 }, security: { destructive: [] }, deps: { byBand: {}, atRisk: [], licenseFlags: [] }, busFactor: { fragileFiles: [] }, coupling: { pairs: [] }, complexity: { hotspots: [] } });
    expect(clean.items.length).toBe(0);
    expect(clean.note).toContain("clear");
  });

  it("total + deterministic over garbage input", () => {
    expect(() => buildActionPlan(null)).not.toThrow();
    expect(() => buildKeystones(undefined)).not.toThrow();
    expect(() => buildActionPlan({ deps: "x", coupling: 5, busFactor: null })).not.toThrow();
  });

  it("stress: intelGauntlet scores 100 over 100,000 random reports", () => {
    const g = intelGauntlet(100_000);
    if (g.score !== 100) console.error(g.checks.filter((c) => !c.pass));
    expect(g.score).toBe(100);
    expect(g.iterations).toBe(100_000);
  }, 30_000);
});
