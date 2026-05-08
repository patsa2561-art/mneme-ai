/**
 * Mneme metrics tests — every formula verified deterministically.
 */

import { describe, it, expect } from "vitest";
import {
  computeHKD,
  computeTWS,
  computeCVR,
  computeHRR,
  computeREI,
  computeKAH,
  computePCS,
  MNEME_METRICS,
} from "./mneme-metrics.js";

// ─── HKD ─────────────────────────────────────────────────────────────

describe("computeHKD — Hidden Knowledge Density", () => {
  it("returns 0 density for empty input", () => {
    const r = computeHKD({ files: [] });
    expect(r.density).toBe(0);
    expect(r.totalLines).toBe(0);
  });

  it("flags file with ≤2 authors AND >180 days stale", () => {
    const r = computeHKD({
      files: [
        { path: "old.ts", totalLines: 100, distinctAuthors: 1, daysSinceLastTouch: 200 },
        { path: "fresh.ts", totalLines: 100, distinctAuthors: 5, daysSinceLastTouch: 10 },
      ],
    });
    expect(r.density).toBe(0.5);
    expect(r.hiddenLines).toBe(100);
    expect(r.topRiskFiles[0]!.path).toBe("old.ts");
  });

  it("does NOT flag fresh file even with 1 author", () => {
    const r = computeHKD({
      files: [{ path: "fresh.ts", totalLines: 100, distinctAuthors: 1, daysSinceLastTouch: 30 }],
    });
    expect(r.density).toBe(0);
  });

  it("does NOT flag old file with many authors", () => {
    const r = computeHKD({
      files: [{ path: "old.ts", totalLines: 100, distinctAuthors: 10, daysSinceLastTouch: 365 }],
    });
    expect(r.density).toBe(0);
  });

  it("ranks risky files by line count desc, caps at 10", () => {
    const r = computeHKD({
      files: Array.from({ length: 15 }, (_, i) => ({
        path: `f${i}.ts`,
        totalLines: 100 - i, // descending
        distinctAuthors: 1,
        daysSinceLastTouch: 365,
      })),
    });
    expect(r.topRiskFiles).toHaveLength(10);
    expect(r.topRiskFiles[0]!.path).toBe("f0.ts"); // most lines
  });
});

// ─── TWS ─────────────────────────────────────────────────────────────

describe("computeTWS — Tribal Wisdom Score", () => {
  it("returns 0 score with no citations", () => {
    const r = computeTWS({ toolCalls: [{ citedHashes: [], resolvedHashes: [], corroboratedHashes: [] }] });
    expect(r.score).toBe(0);
    expect(r.totalCalls).toBe(1);
    expect(r.groundedCalls).toBe(0);
  });

  it("computes score = corroborated / total citations", () => {
    const r = computeTWS({
      toolCalls: [
        { citedHashes: ["a", "b", "c"], resolvedHashes: ["a", "b", "c"], corroboratedHashes: ["a", "b"] },
      ],
    });
    expect(r.score).toBeCloseTo(2 / 3);
    expect(r.totalCitations).toBe(3);
    expect(r.corroboratedCitations).toBe(2);
  });

  it("counts groundedCalls (calls with at least 1 corroborated hash)", () => {
    const r = computeTWS({
      toolCalls: [
        { citedHashes: ["a"], resolvedHashes: ["a"], corroboratedHashes: ["a"] },
        { citedHashes: ["b"], resolvedHashes: ["b"], corroboratedHashes: [] },
      ],
    });
    expect(r.groundedCalls).toBe(1);
    expect(r.totalCalls).toBe(2);
  });
});

// ─── CVR ─────────────────────────────────────────────────────────────

describe("computeCVR — Constitution Violation Rate", () => {
  it("computes per-100 rate", () => {
    const r = computeCVR({ refusalsCount: 5, commitsInWindow: 100 });
    expect(r.ratePer100).toBe(5);
  });

  it("returns 0 for empty window", () => {
    const r = computeCVR({ refusalsCount: 0, commitsInWindow: 0 });
    expect(r.ratePer100).toBe(0);
  });

  it("scales correctly when commits != 100", () => {
    const r = computeCVR({ refusalsCount: 10, commitsInWindow: 50 });
    expect(r.ratePer100).toBe(20);
  });
});

// ─── HRR ─────────────────────────────────────────────────────────────

describe("computeHRR — Hallucination Reduction Ratio", () => {
  it("computes ratio + reduction", () => {
    const r = computeHRR({
      hallucinationRateWithMneme: 0.04,
      hallucinationRateWithoutMneme: 0.40,
    });
    expect(r.ratio).toBeCloseTo(0.1);
    expect(r.reduction).toBeCloseTo(0.9); // 90% reduction
  });

  it("zero baseline → infinity ratio when with-mneme > 0", () => {
    const r = computeHRR({ hallucinationRateWithMneme: 0.1, hallucinationRateWithoutMneme: 0 });
    expect(r.ratio).toBe(Infinity);
  });

  it("zero on both sides → ratio 0 reduction 1", () => {
    const r = computeHRR({ hallucinationRateWithMneme: 0, hallucinationRateWithoutMneme: 0 });
    expect(r.ratio).toBe(0);
    expect(r.reduction).toBe(1);
  });
});

// ─── REI ─────────────────────────────────────────────────────────────

describe("computeREI — Regret Echo Index", () => {
  it("flags commit that matches regret without referencing it", () => {
    const r = computeREI({
      newCommits: [
        { hash: "c1", matchingRegretHashes: ["r1"], referencedRegretHashes: [] },
      ],
    });
    expect(r.silentEchoes).toBe(1);
    expect(r.index).toBe(1);
  });

  it("does NOT flag commit that references the regret", () => {
    const r = computeREI({
      newCommits: [
        { hash: "c1", matchingRegretHashes: ["r1"], referencedRegretHashes: ["r1"] },
      ],
    });
    expect(r.silentEchoes).toBe(0);
    expect(r.index).toBe(0);
  });

  it("flags commit that matches multiple but references some", () => {
    const r = computeREI({
      newCommits: [
        { hash: "c1", matchingRegretHashes: ["r1", "r2", "r3"], referencedRegretHashes: ["r1"] },
      ],
    });
    expect(r.silentEchoes).toBe(1); // r2, r3 unreferenced
    expect(r.topSilentEchoes[0]!.matchingRegrets).toEqual(["r2", "r3"]);
  });

  it("returns 0 for empty commits", () => {
    const r = computeREI({ newCommits: [] });
    expect(r.index).toBe(0);
  });

  it("caps topSilentEchoes at 10", () => {
    const r = computeREI({
      newCommits: Array.from({ length: 20 }, (_, i) => ({
        hash: `c${i}`,
        matchingRegretHashes: [`r${i}`],
        referencedRegretHashes: [],
      })),
    });
    expect(r.topSilentEchoes.length).toBe(10);
  });
});

// ─── KAH ─────────────────────────────────────────────────────────────

describe("computeKAH — Knowledge Atrophy Halflife", () => {
  it("returns infinity for too few datapoints", () => {
    const r = computeKAH({ series: [{ daysSinceFirst: 0, atrophyScore: 0 }] });
    expect(r.halflifeWeeks).toBe(Infinity);
  });

  it("estimates halflife from synthetic exponential decay", () => {
    // Construct: expertise = exp(-λ*t) with λ = 0.01/day → halflife ≈ 69.3 days ≈ 9.9 weeks
    const lambda = 0.01;
    const series = Array.from({ length: 10 }, (_, i) => {
      const t = i * 30;
      const expertise = Math.exp(-lambda * t);
      const atrophy = (1 - expertise) * 100;
      return { daysSinceFirst: t, atrophyScore: atrophy };
    });
    const r = computeKAH({ series });
    expect(r.lambdaPerDay).toBeCloseTo(lambda, 2);
    expect(r.halflifeWeeks).toBeCloseTo(Math.LN2 / lambda / 7, 1);
    expect(r.rSquared).toBeGreaterThan(0.99);
  });

  it("returns infinity halflife when no decay observed (constant series)", () => {
    const series = [
      { daysSinceFirst: 0, atrophyScore: 0 },
      { daysSinceFirst: 30, atrophyScore: 0 },
      { daysSinceFirst: 60, atrophyScore: 0 },
    ];
    const r = computeKAH({ series });
    expect(r.halflifeWeeks).toBe(Infinity);
  });
});

// ─── PCS ─────────────────────────────────────────────────────────────

describe("computePCS — Provenance Chain Strength", () => {
  it("returns 1 for empty window (no chain to break)", () => {
    const r = computePCS({ totalCommitsInWindow: 0, commitsWithUnbrokenChain: 0 });
    expect(r.strength).toBe(1);
  });

  it("returns fraction unbroken / total", () => {
    const r = computePCS({ totalCommitsInWindow: 100, commitsWithUnbrokenChain: 95 });
    expect(r.strength).toBe(0.95);
  });

  it("0 unbroken → strength 0", () => {
    const r = computePCS({ totalCommitsInWindow: 100, commitsWithUnbrokenChain: 0 });
    expect(r.strength).toBe(0);
  });
});

// ─── Catalog metadata ────────────────────────────────────────────────

describe("MNEME_METRICS catalog", () => {
  it("declares all 7 metrics", () => {
    expect(MNEME_METRICS).toHaveLength(7);
    const codes = MNEME_METRICS.map((m) => m.code).sort();
    expect(codes).toEqual(["CVR", "HKD", "HRR", "KAH", "PCS", "REI", "TWS"]);
  });

  it("each metric has fullName + summary + why", () => {
    for (const m of MNEME_METRICS) {
      expect(m.fullName.length).toBeGreaterThan(5);
      expect(m.summary.length).toBeGreaterThan(20);
      expect(m.why.length).toBeGreaterThan(20);
    }
  });
});
