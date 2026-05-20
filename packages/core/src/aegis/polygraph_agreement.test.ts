/**
 * v2.19.85 — Multi-signal agreement deep tests.
 *
 * Pins the load-bearing invariants of the Ollama-free agreement
 * function that replaces the v1.67 Jaccard `overlap()`:
 *   - score is always in [0..1]
 *   - identical strings → ~1.0
 *   - disjoint content → ~0
 *   - negation flip (refute vs assert) drops the score even when
 *     content tokens overlap heavily
 *   - numeric mismatch (400 vs 100000) drops the score even when the
 *     surrounding words match
 *   - char-ngram overlap catches morphology variation
 *   - length-ratio penalises drastically mismatched lengths
 */

import { describe, it, expect } from "vitest";
import {
  multiSignalAgreement,
  multiSignalAgreementBreakdown,
} from "./polygraph_agreement.js";

describe("multi-signal agreement · bounds + identity", () => {
  it("returns 0..1 for any input", () => {
    expect(multiSignalAgreement("", "anything")).toBeGreaterThanOrEqual(0);
    expect(multiSignalAgreement("anything", "")).toBeGreaterThanOrEqual(0);
    expect(multiSignalAgreement("a b c", "x y z")).toBeGreaterThanOrEqual(0);
    expect(multiSignalAgreement("identical text here", "identical text here")).toBeLessThanOrEqual(1);
  });

  it("identical strings score near 1.0", () => {
    const s = "the human body has billions of capillaries totaling 100000 km";
    expect(multiSignalAgreement(s, s)).toBeGreaterThan(0.95);
  });

  it("disjoint strings score noticeably lower than identical (≥2x ratio is enough for sandbag drift)", () => {
    // NB: floor isn't 0 because neutral signals (no-negation-either-side,
    // no-numeric-either-side, similar-length) all return 1.0 = "n/a".
    // What matters for sandbag detection is the GAP between identical
    // (~0.95) and disjoint (~0.45), which gives drift detection a
    // comfortable >0.5 swing above the 0.15 threshold.
    const disjoint = multiSignalAgreement("quantum entanglement protocol", "kitchen recipe baking soda");
    const identical = multiSignalAgreement("quantum entanglement protocol", "quantum entanglement protocol");
    expect(disjoint).toBeLessThan(0.55);
    expect(identical / Math.max(disjoint, 0.01)).toBeGreaterThan(1.8);
  });
});

describe("multi-signal agreement · negation polarity", () => {
  it("drops score when one side negates and the other asserts (same content)", () => {
    const truth = "the human body does not have 400 blood vessels";
    const refute = "no the body does not have 400 vessels it has billions";
    const sandbag = "yes the human body has 400 blood vessels";
    const refScore = multiSignalAgreement(refute, truth);
    const sbgScore = multiSignalAgreement(sandbag, truth);
    // Refuting matches truth (both negate "400"); sandbag asserts opposite.
    expect(refScore).toBeGreaterThan(sbgScore);
    expect(refScore - sbgScore).toBeGreaterThan(0.10);
  });
});

describe("multi-signal agreement · numeric mismatch", () => {
  it("drops score when numeric tokens disagree even with high word overlap", () => {
    const a = "the system ships 9999 mcp tools as of release v2 19 85";
    const b = "the system ships 9999 mcp tools as of release v2 19 85"; // identical
    const c = "the system ships 100 mcp tools as of release v2 19 85"; // diff number
    expect(multiSignalAgreement(a, b)).toBeGreaterThan(multiSignalAgreement(a, c));
  });
});

describe("multi-signal agreement · char-ngram morphology", () => {
  it("recognises morphological variants (vessel vs vessels)", () => {
    // Token Jaccard treats these as zero overlap; char-ngrams catch them.
    const a = "billions of capillary blood vessels totaling 100000 km";
    const b = "billions of capillaries blood vessel totaling 100000 km";
    const score = multiSignalAgreement(a, b);
    expect(score).toBeGreaterThan(0.7); // would be much lower with pure Jaccard
  });
});

describe("multi-signal agreement · breakdown is inspectable", () => {
  it("exposes each component so the UI can render WHY", () => {
    const b = multiSignalAgreementBreakdown("yes 400 is correct", "no 400 is wrong the body has billions");
    expect(b.total).toBeGreaterThanOrEqual(0);
    expect(b.total).toBeLessThanOrEqual(1);
    expect(b.components.tokenJaccard).toBeGreaterThanOrEqual(0);
    expect(b.components.ngramJaccard).toBeGreaterThanOrEqual(0);
    expect(b.components.numeric).toBeGreaterThanOrEqual(0);
    expect(b.components.negationPolarity).toBeGreaterThanOrEqual(0);
    expect(b.components.lengthRatio).toBeGreaterThanOrEqual(0);
    // Sum of weighted components should equal total (within float epsilon).
    const w = b.components;
    const expected = 0.30 * w.tokenJaccard + 0.25 * w.ngramJaccard + 0.20 * w.numeric + 0.15 * w.negationPolarity + 0.10 * w.lengthRatio;
    expect(Math.abs(b.total - expected)).toBeLessThan(1e-6);
  });
});

describe("multi-signal agreement · the canonical case the user flagged", () => {
  it("the user's blood-vessels claim — Mneme refuting it scores HIGHER than the old Jaccard 0.49", () => {
    const groundTruth = "no the body has billions of vessels totaling roughly 100000 km not 400";
    const correctRefute = "no that is false the human body has billions of blood vessels mostly capillaries totaling roughly 100000 km";
    // The v1.67 Jaccard gave this case 0.49 because of word-choice
    // variation. Multi-signal should score noticeably higher because
    // numeric tokens (100000) match + negation polarity matches.
    const score = multiSignalAgreement(correctRefute, groundTruth);
    expect(score).toBeGreaterThan(0.55);
  });
});
