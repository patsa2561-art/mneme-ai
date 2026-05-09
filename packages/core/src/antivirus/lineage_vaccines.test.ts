import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { snapshotForChromosome, mergeInheritedVaccines } from "./lineage_vaccines.js";
import { seedPharmacopoeia, readPharmacopoeia } from "./pharmacopoeia.js";

describe("Lamarckian vaccine inheritance", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-av-lin-"));
    mkdirSync(join(repo, ".mneme"), { recursive: true });
    seedPharmacopoeia(repo);
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("snapshotForChromosome produces all seed vaccines", () => {
    const snap = snapshotForChromosome(repo);
    expect(snap.length).toBe(8);
    expect(snap[0]!.id.length).toBeGreaterThan(0);
  });

  it("mergeInheritedVaccines accepts inheritance from a chromosome", () => {
    const inherited = [{
      chromosomeId: "test-chrom-1",
      signatures: [{
        id: "anti_unknown_strain_v1",
        strain: "citatio_viridis",
        version: "2.0.0",
        source: "inherited" as const,
        efficacy: {
          totalCases: 10, tp: 9, tn: 1, fp: 0, fn: 0,
          precision: 1.0, recall: 1.0, f1: 1.0,
          ranAt: new Date().toISOString(), signature: "deadbeef",
        },
        registeredAt: new Date().toISOString(),
      }],
    }];
    const merged = mergeInheritedVaccines(repo, inherited);
    expect(merged.vaccines.some((v) => v.id === "anti_unknown_strain_v1")).toBe(true);
  });

  it("inheritance picks higher F1 over lower local F1", () => {
    // Manually set local efficacy to 0.5
    const p = readPharmacopoeia(repo);
    const local = p.vaccines.find((v) => v.strain === "citatio_viridis")!;
    local.efficacy = {
      totalCases: 10, tp: 5, tn: 5, fp: 0, fn: 0,
      precision: 1.0, recall: 0.5, f1: 0.6667,
      ranAt: new Date().toISOString(), signature: "x",
    };
    writeFileSync(
      join(repo, ".mneme/antivirus/pharmacopoeia.json"),
      JSON.stringify(p, null, 2),
    );
    // Inherit a HIGHER F1 for the same vaccine
    const inherited = [{
      chromosomeId: "ancestor-1",
      signatures: [{
        id: local.id, strain: local.strain, version: local.version,
        source: "inherited" as const,
        efficacy: {
          totalCases: 10, tp: 10, tn: 0, fp: 0, fn: 0,
          precision: 1.0, recall: 1.0, f1: 1.0,
          ranAt: new Date().toISOString(), signature: "y",
        },
        registeredAt: new Date().toISOString(),
      }],
    }];
    const merged = mergeInheritedVaccines(repo, inherited);
    const upgraded = merged.vaccines.find((v) => v.id === local.id);
    expect(upgraded?.efficacy?.f1).toBeCloseTo(1.0, 3);
  });

  it("mergeInheritedVaccines is a no-op when no inheritance", () => {
    const before = readPharmacopoeia(repo).vaccines.length;
    const merged = mergeInheritedVaccines(repo, []);
    expect(merged.vaccines.length).toBe(before);
  });
});
