import { describe, expect, it } from "vitest";
import {
  visualSwap, damerauSwap, phoneticDrift, crossNamespace, versionDrift,
  bestEffortMutate,
} from "./mutators.js";

describe("antivirus mutators", () => {
  describe("visualSwap", () => {
    it("swaps a 0/O lookalike pair", () => {
      const r = visualSwap("path0/foo");
      expect(r).toBe("pathO/foo");
    });
    it("returns null when no swap pair applies", () => {
      // No pair candidate at all
      expect(visualSwap("xyzxyz")).toBeNull();
    });
    it("never returns the input unchanged on success", () => {
      const r = visualSwap("rndr");
      expect(r).not.toBeNull();
      expect(r).not.toBe("rndr");
    });
  });

  describe("damerauSwap", () => {
    it("transposes adjacent characters with seed 0", () => {
      const r = damerauSwap("abcd", 0);
      expect(r).toBe("bacd");
    });
    it("substitutes when adjacent chars are equal", () => {
      const r = damerauSwap("aabc", 0);
      // pos 0: a,a equal -> substitute pos 0 with charCode+1 = b
      expect(r).toBe("babc");
    });
    it("returns null on length < 2", () => {
      expect(damerauSwap("a", 0)).toBeNull();
      expect(damerauSwap("", 0)).toBeNull();
    });
    it("is deterministic across seeds", () => {
      // seed picks position; same seed + same input -> same result.
      expect(damerauSwap("abcdef", 1)).toBe(damerauSwap("abcdef", 1));
    });
  });

  describe("phoneticDrift", () => {
    it("rewrites anthropic -> anthrophic", () => {
      const r = phoneticDrift("the @anthropic-ai package");
      expect(r).toContain("anthrophic");
    });
    it("returns null when no replacement matches", () => {
      expect(phoneticDrift("xyz")).toBeNull();
    });
  });

  describe("crossNamespace", () => {
    it("swaps @vue -> @react", () => {
      expect(crossNamespace("@vue/router")).toBe("@react/router");
    });
    it("swaps @anthropic -> @openai", () => {
      expect(crossNamespace("@anthropic/sdk")).toBe("@openai/sdk");
    });
    it("returns null for non-scoped packages", () => {
      expect(crossNamespace("lodash")).toBeNull();
    });
  });

  describe("versionDrift", () => {
    it("bumps minor + decrements patch", () => {
      expect(versionDrift("v1.27.8")).toBe("v1.28.7");
    });
    it("returns null when no version-shaped substring exists", () => {
      expect(versionDrift("no version here")).toBeNull();
    });
    it("clamps patch >= 0", () => {
      // 1.0.0 -> 1.1.0 (patch decrements but clamped to 0)
      expect(versionDrift("v1.0.0")).toBe("v1.1.0");
    });
  });

  describe("bestEffortMutate", () => {
    it("returns the first applicable mutator + its name", () => {
      const r = bestEffortMutate("@vue/router", 0);
      expect(r).not.toBeNull();
      expect(r!.name).toBe("crossNamespace");
      expect(r!.mutated).toBe("@react/router");
    });
    it("falls through to damerauSwap when no other mutator applies", () => {
      const r = bestEffortMutate("xyzxyz", 0);
      expect(r).not.toBeNull();
      expect(r!.name).toBe("damerauSwap");
    });
    it("returns null when no mutator applies (single char)", () => {
      expect(bestEffortMutate("x", 0)).toBeNull();
    });
    it("never returns the input unchanged", () => {
      const r = bestEffortMutate("commit a3f9b21c", 5);
      expect(r).not.toBeNull();
      expect(r!.mutated).not.toBe("commit a3f9b21c");
    });
  });
});
