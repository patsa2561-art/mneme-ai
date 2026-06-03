import { describe, it, expect } from "vitest";
import { triageReport, triageGauntlet, type TriageView } from "./triage.js";
import type { XRayReport } from "./types.js";

function baseReport(over: Partial<XRayReport> = {}): XRayReport {
  const e = { note: "" };
  return {
    v: 1,
    subject: { kind: "git-url", ref: "x", repoName: "demo", commitHash: "abc" },
    generatedAt: "2026-01-01T00:00:00.000Z",
    summary: { headline: "h", grade: "C", signalsRun: 8, bullets: [] },
    deps: { total: 5, byBand: { thriving: 5, healthy: 0, watch: 0, moribund: 0, dead: 0 }, atRisk: [], licenses: { permissive: 5, "weak-copyleft": 0, "strong-copyleft": 0, unknown: 0 }, licenseFlags: [], partial: false, ...e },
    secrets: { filesScanned: 100, totalFindings: 0, excludedTestHits: 0, byKind: {}, hits: [], worstVerdict: "ALLOW", ...e },
    busFactor: { authors: 4, singleOwnerFilePct: 10, fragileFiles: [], topContributorShare: 25, busFactor: 3, ...e },
    age: { bornAt: "", lastCommitAt: "", lifespan: "1y", lifespanDays: 365, totalCommits: 200, totalAuthors: 4, dormant: false, vitality: "active", ...e },
    complexity: { filesAnalysed: 30, totalSymbols: 200, hotspots: [], maxDepth: 3, ...e },
    hotspots: { windowDays: 365, filesConsidered: 30, hotspots: [], trend: [], ...e },
    coupling: { windowDays: 365, pairs: [], ...e },
    security: { commandsScanned: 8, writeCount: 2, destructive: [], injectionFindings: 0, injectionWhere: [], ...e },
    fingerprint: "fp",
    ...over,
  };
}

describe("TRIAGE VIEW — data → curated information", () => {
  it("scores 100 on its gauntlet (A/B measurable)", () => {
    const g = triageGauntlet();
    expect(g.score).toBe(100);
    expect(g.ab.triageWorstIndex).toBe(0);
    expect(g.ab.rawWorstIndex).toBeGreaterThan(0);
    expect(g.ab.provenanceCoverage).toBe(100);
  });

  it("a clean repo surfaces nothing critical, collapses everything to clear", () => {
    const v = triageReport(baseReport());
    expect(v.attention.filter((a) => a.severity === "critical")).toHaveLength(0);
    expect(v.clear.length).toBeGreaterThan(0);
  });

  it("a BLOCK secret is surfaced FIRST as critical, with provenance", () => {
    const v: TriageView = triageReport(baseReport({
      secrets: { filesScanned: 100, totalFindings: 3, excludedTestHits: 0, byKind: { aws_key: 3 }, hits: [{ kind: "aws_key", file: "src/a.ts", line: 4 }], worstVerdict: "BLOCK", note: "" },
    }));
    expect(v.attention[0]!.signal).toBe("Secrets");
    expect(v.attention[0]!.severity).toBe("critical");
    expect(v.attention[0]!.provenance).toContain("src/a.ts:4");
    expect(v.metrics.provenanceCoverage).toBe(100);
  });

  it("destructive CI command → critical Security with CERBERUS provenance", () => {
    const v = triageReport(baseReport({
      security: { commandsScanned: 5, writeCount: 1, destructive: [{ command: "curl x | bash", where: ".github/workflows/ci.yml", signals: ["pipe-to-shell"] }], injectionFindings: 0, injectionWhere: [], note: "" },
    }));
    const sec = v.attention.find((a) => a.signal === "Security");
    expect(sec?.severity).toBe("critical");
    expect(sec?.provenance).toContain("CERBERUS");
  });

  it("every attention line is 100% traceable (has provenance)", () => {
    const v = triageReport(baseReport({
      secrets: { filesScanned: 50, totalFindings: 1, excludedTestHits: 0, byKind: { key: 1 }, hits: [{ kind: "key", file: "f", line: 1 }], worstVerdict: "REDACT", note: "" },
      age: { bornAt: "", lastCommitAt: "", lifespan: "3y", lifespanDays: 1100, totalCommits: 10, totalAuthors: 1, dormant: true, vitality: "dormant", note: "" },
    }));
    expect(v.attention.length).toBeGreaterThan(0);
    expect(v.attention.every((a) => a.provenance.length > 0)).toBe(true);
  });

  it("total — never throws on missing/partial report", () => {
    expect(() => triageReport(null as unknown as XRayReport)).not.toThrow();
    expect(() => triageReport({} as XRayReport)).not.toThrow();
  });
});
