import { describe, expect, it } from "vitest";
import {
  QUARK_PERSONAS, DOMAIN_WEIGHTS,
  quarkReviewer, spawnQuarkJury, fuseQuarkVerdicts,
} from "./quark_jury.js";
import { mockReviewer, holdCourt, type ReviewRequest, type ReviewVerdict } from "./conscience.js";

const REQ: ReviewRequest = {
  workItemKind: "evolve-patch",
  description: "extract helper",
};

describe("perspective quark jury", () => {
  describe("QUARK_PERSONAS catalog", () => {
    it("ships all 6 quark flavors", () => {
      const expected = ["up", "down", "charm", "strange", "top", "bottom"];
      expect(Object.keys(QUARK_PERSONAS).sort()).toEqual(expected.sort());
    });
    it("every persona has a non-empty system prompt + label + temperature", () => {
      for (const p of Object.values(QUARK_PERSONAS)) {
        expect(p.label.length).toBeGreaterThan(0);
        expect(p.systemPrompt.length).toBeGreaterThan(20);
        expect(p.temperature).toBeGreaterThan(0);
        expect(p.temperature).toBeLessThan(1);
      }
    });
  });

  describe("DOMAIN_WEIGHTS", () => {
    it("has entries for every supported workItemKind", () => {
      expect(DOMAIN_WEIGHTS["evolve-patch"]).toBeDefined();
      expect(DOMAIN_WEIGHTS["vaccine-proposal"]).toBeDefined();
      expect(DOMAIN_WEIGHTS["refactor"]).toBeDefined();
      expect(DOMAIN_WEIGHTS["docs"]).toBeDefined();
      expect(DOMAIN_WEIGHTS["other"]).toBeDefined();
    });
    it("security weight is HIGHER for evolve-patch than for docs", () => {
      expect(DOMAIN_WEIGHTS["evolve-patch"]!.top).toBeGreaterThan(DOMAIN_WEIGHTS["docs"]!.top!);
    });
    it("elegance weight is HIGHER for refactor than for vaccine-proposal", () => {
      expect(DOMAIN_WEIGHTS["refactor"]!.charm).toBeGreaterThan(DOMAIN_WEIGHTS["vaccine-proposal"]!.charm!);
    });
  });

  describe("quarkReviewer wrapping", () => {
    it("tags the reviewer id with the persona label", async () => {
      const wrapped = quarkReviewer(mockReviewer("base", 7, true), "top");
      const v = await wrapped.review(REQ);
      expect(v.reviewer).toContain("base");
      expect(v.reviewer).toContain("security");
    });
  });

  describe("spawnQuarkJury", () => {
    it("returns exactly 6 jurors (one per quark flavor)", () => {
      const jury = spawnQuarkJury(mockReviewer("base", 7, true));
      expect(jury.length).toBe(6);
      const tags = jury.map((j) => j.id.split("+")[1]);
      expect(tags.sort()).toEqual(["edge-cases", "elegance", "optimist", "performance", "pessimist", "security"]);
    });
  });

  describe("fuseQuarkVerdicts (NUCLEAR FUSION)", () => {
    function buildVerdicts(scores: Record<string, number>): ReviewVerdict[] {
      return Object.entries(scores).map(([flavorLabel, score]) => ({
        reviewer: `base+${flavorLabel}`,
        score, accept: score >= 6, reason: `${flavorLabel} verdict`, ms: 0,
      }));
    }

    it("stable nucleus: all quarks agree on high score => 'merge-stable'", () => {
      const verdicts = buildVerdicts({
        optimist: 8, pessimist: 8, elegance: 8,
        "edge-cases": 8, security: 8, performance: 8,
      });
      const r = fuseQuarkVerdicts(verdicts, "evolve-patch");
      expect(r.stable).toBe(true);
      expect(r.band).toBe("merge-stable");
      expect(r.meanScore).toBe(8);
      expect(r.variance).toBe(0);
    });

    it("unstable nucleus: high mean but high variance => 'merge-with-watch'", () => {
      const verdicts = buildVerdicts({
        optimist: 9, pessimist: 9, elegance: 9,
        "edge-cases": 9, security: 3, performance: 9,         // security disagrees
      });
      const r = fuseQuarkVerdicts(verdicts, "evolve-patch");
      expect(r.stable).toBe(false);
      expect(r.variance).toBeGreaterThan(2.5);
      expect(r.band).toBe("merge-with-watch");
    });

    it("reject when mean is low across all quarks", () => {
      const verdicts = buildVerdicts({
        optimist: 4, pessimist: 3, elegance: 3,
        "edge-cases": 2, security: 3, performance: 4,
      });
      const r = fuseQuarkVerdicts(verdicts, "evolve-patch");
      expect(r.band).toBe("reject");
    });

    it("ENERGY YIELD weights domain-relevant quarks higher", () => {
      const verdicts = buildVerdicts({
        optimist: 5, pessimist: 5, elegance: 5,
        "edge-cases": 5, security: 10, performance: 5,
      });
      // For evolve-patch, security weight is 1.5 (highest). So energyYield > mean.
      const r = fuseQuarkVerdicts(verdicts, "evolve-patch");
      expect(r.energyYield).toBeGreaterThan(r.meanScore - 0.5);
      // Same scores for "docs" should yield LESS (security weight 0.3 there).
      const rDocs = fuseQuarkVerdicts(verdicts, "docs");
      expect(rDocs.energyYield).toBeLessThan(r.energyYield);
    });
  });

  describe("integration with holdCourt", () => {
    it("spawnQuarkJury + holdCourt produces a court verdict", async () => {
      // Use a mock that returns 8/accept regardless of persona prompt --
      // we're testing the WIRING, not the prompting.
      const base = mockReviewer("ollama:llama3:3b", 8, true);
      const r = await holdCourt(spawnQuarkJury(base), REQ);
      expect(r.individualVerdicts.length).toBe(6);
      expect(r.band).toBe("merge");
    });
  });
});
