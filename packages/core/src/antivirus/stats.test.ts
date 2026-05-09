import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStats, recordScan, deriveMetrics } from "./stats.js";

describe("antivirus stats", () => {
  let repo: string;
  beforeEach(() => {
    repo = mkdtempSync(join(tmpdir(), "mneme-av-stats-"));
    mkdirSync(join(repo, ".mneme"), { recursive: true });
  });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* ignore */ } });

  it("readStats returns empty stats on a fresh repo", () => {
    const s = readStats(repo);
    expect(s.totalScans).toBe(0);
    expect(s.totalInfectionsCaught).toBe(0);
    expect(Object.keys(s.byStrain).length).toBe(8);
  });

  it("recordScan increments totals + per-strain counts", () => {
    const summary = {
      scanId: "test-1", ranAt: new Date().toISOString(),
      draftLengthChars: 100, claimsExamined: 5, infections: 2,
      totalMs: 12, vaccinesUsed: ["anti_citatio_viridis_v1"],
    };
    recordScan(repo, summary, { citatio_viridis: 2 });
    const s = readStats(repo);
    expect(s.totalScans).toBe(1);
    expect(s.totalClaimsExamined).toBe(5);
    expect(s.totalInfectionsCaught).toBe(2);
    expect(s.byStrain.citatio_viridis.caught).toBe(2);
    expect(s.recentScans.length).toBe(1);
  });

  it("recentScans are capped (no unbounded growth)", () => {
    for (let i = 0; i < 60; i++) {
      recordScan(repo, {
        scanId: `s${i}`, ranAt: new Date().toISOString(),
        draftLengthChars: 50, claimsExamined: 1, infections: 0,
        totalMs: 5, vaccinesUsed: [],
      }, {});
    }
    const s = readStats(repo);
    expect(s.recentScans.length).toBeLessThanOrEqual(50);
  });

  it("deriveMetrics computes catchRate correctly", () => {
    recordScan(repo, {
      scanId: "x", ranAt: new Date().toISOString(),
      draftLengthChars: 0, claimsExamined: 10, infections: 3,
      totalMs: 5, vaccinesUsed: [],
    }, { citatio_viridis: 3 });
    const m = deriveMetrics(readStats(repo));
    expect(m.catchRate).toBeCloseTo(0.3, 5);
    expect(m.topStrain).toBe("citatio_viridis");
  });

  it("deriveMetrics handles zero-claims gracefully", () => {
    const m = deriveMetrics(readStats(repo));
    expect(m.catchRate).toBe(0);
    expect(m.topStrain).toBeNull();
  });
});
