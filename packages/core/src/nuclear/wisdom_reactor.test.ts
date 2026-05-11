import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeMassDefect, decayConstantFor, aliveness,
  computeEvolveQ, theoreticalClusterRadius, computeClusterRadius,
  computeCriticality, recordFollowupBurst, readRecentFollowups,
  computeReactorReport,
  HALF_LIFE_DAYS, WISDOM_C_SQUARED, CLUSTER_R_ZERO,
} from "./wisdom_reactor.js";

describe("wisdom_reactor (nuclear physics → Mneme metrics)", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-react-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  describe("E = mc² (mass defect → wisdom yield)", () => {
    it("computeMassDefect: positive yield when raw > synthesized", () => {
      const r = computeMassDefect({
        rawChunks: 1000, rawLessons: 50, rawCommits: 100,
        synthesizedDna: 200, synthesizedLessons: 30,
      });
      expect(r.massDefect).toBe(1150 - 230);     // 920
      expect(r.wisdomYield).toBe(920 * WISDOM_C_SQUARED);
    });
    it("clamps mass defect at 0 (synthesized > raw is unphysical)", () => {
      const r = computeMassDefect({
        rawChunks: 10, rawLessons: 0, rawCommits: 0,
        synthesizedDna: 100, synthesizedLessons: 100,
      });
      expect(r.massDefect).toBe(0);
      expect(r.wisdomYield).toBe(0);
    });
    it("survives undefined/null inputs (defensive)", () => {
      // @ts-expect-error -- testing runtime resilience
      const r = computeMassDefect({});
      expect(r.massDefect).toBe(0);
    });
  });

  describe("N(t) = N₀·e^(-λt) (radioactive atrophy)", () => {
    it("decayConstantFor matches λ = ln(2)/T_½", () => {
      const lambdaHot = decayConstantFor("hot");
      expect(lambdaHot).toBeCloseTo(Math.LN2 / HALF_LIFE_DAYS.hot, 10);
    });
    it("aliveness at exactly T_½ is 0.5", () => {
      expect(aliveness(HALF_LIFE_DAYS.hot, "hot")).toBeCloseTo(0.5, 5);
      expect(aliveness(HALF_LIFE_DAYS.cold, "cold")).toBeCloseTo(0.5, 5);
    });
    it("aliveness at 2×T_½ is 0.25", () => {
      expect(aliveness(2 * HALF_LIFE_DAYS.warm, "warm")).toBeCloseTo(0.25, 5);
    });
    it("aliveness at age 0 is 1.0 (no decay yet)", () => {
      expect(aliveness(0, "hot")).toBe(1);
    });
    it("hot files decay much faster than library files", () => {
      const t = 365;  // 1 year
      const hotAlive = aliveness(t, "hot");
      const libraryAlive = aliveness(t, "library");
      expect(hotAlive).toBeLessThan(0.05);
      expect(libraryAlive).toBeGreaterThan(0.85);
    });
  });

  describe("Q = (m_initial - m_final)·c² (EVOLVE patch energy)", () => {
    it("Q > 0 for templates that compress code", () => {
      const r = computeEvolveQ([
        { id: "extract-helper", locBefore: 100, locAfter: 60, confidence: 0.8 },
        { id: "remove-dead-code", locBefore: 50, locAfter: 20, confidence: 0.9 },
      ]);
      expect(r.perTemplate[0]!.Q).toBe((100 - 60) * 0.8);   // 32
      expect(r.perTemplate[1]!.Q).toBe((50 - 20) * 0.9);    // 27
    });
    it("Q < 0 for templates that add complexity", () => {
      const r = computeEvolveQ([{ id: "add-feature-flag", locBefore: 10, locAfter: 25, confidence: 0.7 }]);
      expect(r.perTemplate[0]!.Q).toBeLessThan(0);
    });
    it("ranked sorts highest-yield first", () => {
      const r = computeEvolveQ([
        { id: "low", locBefore: 10, locAfter: 8, confidence: 0.5 },        // Q=1
        { id: "high", locBefore: 100, locAfter: 20, confidence: 0.9 },     // Q=72
        { id: "mid", locBefore: 50, locAfter: 30, confidence: 0.8 },       // Q=16
      ]);
      expect(r.ranked[0]!.templateId).toBe("high");
      expect(r.ranked[1]!.templateId).toBe("mid");
      expect(r.ranked[2]!.templateId).toBe("low");
    });
  });

  describe("R = r₀·A^(1/3) (cluster radius)", () => {
    it("singleton cluster has the smallest radius", () => {
      expect(theoreticalClusterRadius(1)).toBe(CLUSTER_R_ZERO * 1);
    });
    it("scales as cube root of A", () => {
      const r8 = theoreticalClusterRadius(8);
      const r64 = theoreticalClusterRadius(64);
      // A 8× larger A gives 2× larger R (since cbrt(8) = 2).
      expect(r64 / r8).toBeCloseTo(2, 5);
    });
    it("flags clusters that exceed their theoretical radius", () => {
      const r = computeClusterRadius([
        { id: "tight", A: 100, observedR: 0.1 },
        { id: "blurry", A: 100, observedR: 1.0 },             // way too big
      ]);
      expect(r.overflows.length).toBe(1);
      expect(r.overflows[0]!.clusterId).toBe("blurry");
    });
  });

  describe("k = neutrons criticality", () => {
    it("k = 1.0 with empty / single-element history (stable)", () => {
      expect(computeCriticality([]).band).toBe("stable");
      expect(computeCriticality([5]).k).toBe(1.0);
    });
    it("k > 1.2 → supercritical → quiet verbosity", () => {
      // each step: 2× the prior. avg ratio = 2.
      const r = computeCriticality([1, 2, 4, 8, 16]);
      expect(r.k).toBeCloseTo(2, 1);
      expect(r.band).toBe("supercritical");
      expect(r.suggestedVerbosity).toBe("quiet");
    });
    it("k < 0.8 → subcritical → proactive verbosity", () => {
      const r = computeCriticality([10, 5, 2, 1]);
      expect(r.k).toBeLessThan(0.8);
      expect(r.band).toBe("subcritical");
      expect(r.suggestedVerbosity).toBe("proactive");
    });
    it("k near 1 → stable → balanced verbosity", () => {
      const r = computeCriticality([5, 5, 5, 5]);
      expect(r.k).toBeCloseTo(1, 5);
      expect(r.band).toBe("stable");
      expect(r.suggestedVerbosity).toBe("balanced");
    });
    it("recordFollowupBurst persists + readRecentFollowups returns them", () => {
      recordFollowupBurst(repo, 3);
      recordFollowupBurst(repo, 5);
      recordFollowupBurst(repo, 7);
      const recent = readRecentFollowups(repo, 5);
      expect(recent).toEqual([3, 5, 7]);
    });
  });

  describe("computeReactorReport (composite)", () => {
    it("returns a banner string + every sub-report", () => {
      const r = computeReactorReport({
        repoRoot: repo,
        rawChunks: 500, rawLessons: 20, rawCommits: 100,
        synthesizedDna: 50, synthesizedLessons: 10,
        evolveTemplates: [{ id: "t1", locBefore: 100, locAfter: 30, confidence: 0.9 }],
        clusters: [{ id: "c1", A: 50, observedR: 0.05 }],
      });
      expect(r.banner).toMatch(/wisdom-yield=\d+/);
      expect(r.banner).toMatch(/k=[\d.]+/);
      expect(r.mass.wisdomYield).toBeGreaterThan(0);
      expect(r.evolveQ.ranked.length).toBe(1);
      expect(r.atrophy.perBand.hot.tHalfDays).toBe(30);
    });
  });
});
