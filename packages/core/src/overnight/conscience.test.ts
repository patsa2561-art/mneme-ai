import { describe, expect, it } from "vitest";
import {
  holdCourt, mockReviewer, parseReviewerJSON, defaultFreeMockJury,
  DEFAULT_THRESHOLDS,
  type ReviewRequest,
} from "./conscience.js";

const REQ: ReviewRequest = {
  workItemKind: "evolve-patch",
  description: "extract helper from inline duplication",
  before: "code A x2",
  after: "helper(x); helper(y)",
};

describe("dual-conscience court", () => {
  describe("holdCourt aggregation", () => {
    it("returns 'reject' when jury is empty", async () => {
      const r = await holdCourt([], REQ);
      expect(r.band).toBe("reject");
      expect(r.individualVerdicts).toEqual([]);
    });

    it("returns 'merge' when median >= 7 AND >50% accept", async () => {
      const jury = [
        mockReviewer("a", 8, true),
        mockReviewer("b", 7, true),
        mockReviewer("c", 9, true),
      ];
      const r = await holdCourt(jury, REQ);
      expect(r.band).toBe("merge");
      expect(r.medianScore).toBe(8);
      expect(r.acceptFraction).toBe(1);
    });

    it("returns 'review' when median >= 5 OR acceptFraction >= 0.4 (borderline)", async () => {
      const jury = [
        mockReviewer("a", 5.5, true),
        mockReviewer("b", 5.5, false),
      ];
      const r = await holdCourt(jury, REQ);
      expect(r.band).toBe("review");
    });

    it("returns 'reject' when median < 5 AND acceptFraction < 0.4", async () => {
      const jury = [
        mockReviewer("a", 3, false),
        mockReviewer("b", 2, false),
        mockReviewer("c", 4, false),
      ];
      const r = await holdCourt(jury, REQ);
      expect(r.band).toBe("reject");
    });

    it("median is RESISTANT to a single rogue reviewer", async () => {
      // 4 reviewers say 8/accept, 1 rogue says 0/reject. Median = 8.
      const jury = [
        mockReviewer("a", 8, true),
        mockReviewer("b", 8, true),
        mockReviewer("c", 8, true),
        mockReviewer("d", 8, true),
        mockReviewer("rogue", 0, false),
      ];
      const r = await holdCourt(jury, REQ);
      expect(r.medianScore).toBe(8);
      expect(r.band).toBe("merge");
    });

    it("a thrown reviewer is captured as a neutral 5/false abstain", async () => {
      const throwing = {
        id: "throws",
        async review(): Promise<never> { throw new Error("network down"); },
      };
      const jury = [throwing, mockReviewer("ok", 8, true)];
      const r = await holdCourt(jury, REQ);
      const throwsVerdict = r.individualVerdicts.find((v) => v.reviewer === "throws");
      expect(throwsVerdict).toBeDefined();
      expect(throwsVerdict!.score).toBe(5);
      expect(throwsVerdict!.accept).toBe(false);
      expect(throwsVerdict!.error).toContain("network down");
    });
  });

  describe("parseReviewerJSON", () => {
    it("parses well-formed reviewer JSON", () => {
      const v = parseReviewerJSON("test", `{"score": 8.5, "accept": true, "reason": "good"}`, 100);
      expect(v.score).toBe(8.5);
      expect(v.accept).toBe(true);
      expect(v.reason).toBe("good");
    });
    it("clamps score into [0, 10]", () => {
      expect(parseReviewerJSON("test", `{"score": 15, "accept": true, "reason": "x"}`, 0).score).toBe(10);
      expect(parseReviewerJSON("test", `{"score": -3, "accept": false, "reason": "x"}`, 0).score).toBe(0);
    });
    it("extracts JSON from a verbose response", () => {
      const raw = `Sure! Here is the review: {"score": 7, "accept": true, "reason": "nice"} -- end.`;
      const v = parseReviewerJSON("test", raw, 0);
      expect(v.score).toBe(7);
    });
    it("returns neutral 5/false on malformed JSON", () => {
      const v = parseReviewerJSON("test", `not json at all`, 0);
      expect(v.score).toBe(5);
      expect(v.accept).toBe(false);
      expect(v.error).toBeDefined();
    });
    it("defaults to safe values when fields are missing", () => {
      const v = parseReviewerJSON("test", `{}`, 0);
      expect(v.score).toBe(5);
      expect(v.accept).toBe(false);
      expect(v.reason).toBeTruthy();
    });
  });

  describe("defaultFreeMockJury", () => {
    it("returns a jury that works without any API keys", async () => {
      const r = await holdCourt(defaultFreeMockJury(), REQ);
      expect(r.individualVerdicts.length).toBe(2);
      expect(r.band).toBe("merge");                  // mocks tuned to merge
    });
  });

  describe("threshold customization", () => {
    it("user can lower mergeMedian threshold via custom thresholds", async () => {
      const jury = [mockReviewer("a", 6, true), mockReviewer("b", 6, true)];
      const strict = await holdCourt(jury, REQ);
      expect(strict.band).toBe("review");            // 6 < default merge=7

      const lax = await holdCourt(jury, REQ, { ...DEFAULT_THRESHOLDS, mergeMedian: 5 });
      expect(lax.band).toBe("merge");                // 6 >= custom merge=5
    });
  });
});
