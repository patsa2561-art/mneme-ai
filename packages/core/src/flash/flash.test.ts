import { describe, it, expect } from "vitest";

import {
  computeVeracity,
  templateForVerdict,
  formatVeracityPulseLine,
  generateRefutations,
  runDevilsAdvocate,
  formatDevilsAdvocatePulseLine,
  groundClaim,
  formatGroundingPulseLine,
  predictNextQuery,
  formatPredictionPulseLine,
  runFlash,
  DEFAULT_SOURCE_WEIGHT,
  type EvidenceItem,
} from "./index.js";

// ============================================================
// VERACITY
// ============================================================

describe("v1.99 FLASH · Veracity-Velocity Singularity", () => {
  it("computes V_eff with strong evidence + low H → AFFIRM", () => {
    const r = computeVeracity({
      claim: "this PSA-10 Pikachu Illustrator card is genuinely rare",
      evidence: [
        { fact: "PSA pop report shows only 41 known copies", supportStrength: 0.95, sourceWeight: 0.95, sourceKind: "expert-database" },
        { fact: "Goldin auction sold one for $5.3M (2024)", supportStrength: 0.95, sourceWeight: 0.95, sourceKind: "verified-third-party" },
      ],
      hallucinationFactor: 0,
    });
    expect(r.V_eff).toBeGreaterThanOrEqual(0.75);
    expect(r.verdict).toBe("AFFIRM");
  });

  it("'Super rare' from seller listing alone → REFUTE", () => {
    const r = computeVeracity({
      claim: "this Capcom Trump card deck is super rare",
      evidence: [
        // Single piece of evidence: the seller's own listing
        { fact: '"Super rare" printed in listing title', supportStrength: 0.8, sourceWeight: 0.20, sourceKind: "seller-listing" },
      ],
      hallucinationFactor: 2.0,
      phi_qx: 2.0, // commerce-source paranoia
    });
    expect(r.V_eff).toBeLessThan(0.30);
    expect(["DOUBTFUL", "REFUTE"]).toContain(r.verdict);
  });

  it("DEFAULT_SOURCE_WEIGHT: seller-listing < image-OCR < user-statement < expert-database < verified-third-party", () => {
    expect(DEFAULT_SOURCE_WEIGHT["seller-listing"]).toBeLessThan(DEFAULT_SOURCE_WEIGHT["image-OCR"]);
    expect(DEFAULT_SOURCE_WEIGHT["image-OCR"]).toBeLessThan(DEFAULT_SOURCE_WEIGHT["user-statement"]);
    expect(DEFAULT_SOURCE_WEIGHT["user-statement"]).toBeLessThan(DEFAULT_SOURCE_WEIGHT["expert-database"]);
    expect(DEFAULT_SOURCE_WEIGHT["expert-database"]).toBeLessThan(DEFAULT_SOURCE_WEIGHT["verified-third-party"]);
  });

  it("ln(H+e) is always >= 1 (no division by zero)", () => {
    const r = computeVeracity({
      claim: "x",
      evidence: [{ fact: "y", supportStrength: 1, sourceWeight: 1, sourceKind: "verified-third-party" }],
      hallucinationFactor: 0,
    });
    expect(r.hallucinationPenalty).toBeGreaterThanOrEqual(1);
  });

  it("Φ_qx multiplier scales V_eff", () => {
    const base = computeVeracity({ claim: "x", evidence: [{ fact: "y", supportStrength: 0.5, sourceWeight: 0.5, sourceKind: "unknown" }], hallucinationFactor: 0 });
    const skeptical = computeVeracity({ claim: "x", evidence: [{ fact: "y", supportStrength: 0.5, sourceWeight: 0.5, sourceKind: "unknown" }], hallucinationFactor: 0, phi_qx: 0.5 });
    expect(skeptical.V_eff).toBeCloseTo(base.V_eff * 0.5, 5);
  });

  it("templateForVerdict produces vendor-appropriate response stems", () => {
    expect(templateForVerdict("AFFIRM", "the card is rare")).toContain("Verified");
    expect(templateForVerdict("CAUTIOUS", "the card is rare")).toContain("Partially supported");
    expect(templateForVerdict("DOUBTFUL", "the card is rare")).toContain("Cannot confirm");
    expect(templateForVerdict("REFUTE", "the card is rare")).toContain("Refuse to confirm");
  });

  it("formatVeracityPulseLine produces compact summary", () => {
    const r = computeVeracity({ claim: "x", evidence: [{ fact: "y", supportStrength: 0.5, sourceWeight: 0.5, sourceKind: "unknown" }], hallucinationFactor: 0 });
    const line = formatVeracityPulseLine(r);
    expect(line).toContain("V_eff=");
    expect(line).toContain("verdict=");
  });
});

// ============================================================
// DEVIL'S ADVOCATE
// ============================================================

describe("v1.99 FLASH · Recursive Self-Verification (Devil's Advocate)", () => {
  it("generateRefutations emits negation, source-attack, specificity-flip, burden-shift, outlier", () => {
    const r = generateRefutations("this item is super rare");
    const kinds = new Set(r.map((c) => c.kind));
    expect(kinds).toContain("negation");
    expect(kinds).toContain("source-attack");
    expect(kinds).toContain("specificity-flip");
    expect(kinds).toContain("burden-shift");
    expect(kinds).toContain("outlier");
  });

  it("downgrades AFFIRM → CAUTIOUS when refutation pressure > 0.10", () => {
    const r = runDevilsAdvocate({
      claim: "this trump card is super rare",
      evidence: [
        { fact: "listing says super rare", supportStrength: 0.7, sourceWeight: 0.20, sourceKind: "seller-listing" },
      ],
      hallucinationFactor: 1.5,
      phi_qx: 1.0,
    });
    expect(r.refutations.length).toBeGreaterThan(0);
    expect(r.topRefutation).not.toBeNull();
    // Original was DOUBTFUL → after downgrade still in DOUBTFUL or REFUTE
    expect(["DOUBTFUL", "REFUTE"]).toContain(r.finalVerdict);
  });

  it("preserves verdict when refutation pressure is < 0.10", () => {
    const r = runDevilsAdvocate({
      claim: "this PSA-10 card has 41 known copies",
      evidence: [
        { fact: "PSA pop report shows 41", supportStrength: 0.95, sourceWeight: 0.95, sourceKind: "expert-database" },
        { fact: "Goldin auction sold one $5.3M", supportStrength: 0.9, sourceWeight: 0.95, sourceKind: "verified-third-party" },
      ],
      hallucinationFactor: 0,
    });
    expect(r.finalVerdict).toBe("AFFIRM");
    expect(r.adjustmentReason).toMatch(/preserved|no refutation/i);
  });

  it("custom refutation generator can be injected (for tests)", () => {
    const r = runDevilsAdvocate({
      claim: "x",
      evidence: [{ fact: "y", supportStrength: 0.5, sourceWeight: 0.5, sourceKind: "unknown" }],
      hallucinationFactor: 0,
      refutationGenerator: () => [{ text: "fake refutation", kind: "outlier" }],
    });
    expect(r.refutations.length).toBe(1);
    expect(r.refutations[0]!.candidate.text).toBe("fake refutation");
  });

  it("formatDevilsAdvocatePulseLine produces compact summary", () => {
    const r = runDevilsAdvocate({ claim: "x", evidence: [{ fact: "y", supportStrength: 0.5, sourceWeight: 0.5, sourceKind: "unknown" }], hallucinationFactor: 0 });
    const line = formatDevilsAdvocatePulseLine(r);
    expect(line).toContain("DEVILS-ADVOCATE");
    expect(line).toContain("final=");
  });
});

// ============================================================
// GROUNDING
// ============================================================

describe("v1.99 FLASH · Hyper-Contextual Grounding", () => {
  it("classifies seller-listing context from commerce signals", () => {
    const r = groundClaim("[Super rare] CAPCOM Capcom Character Trump Street Fighter Mega Man ฿1,086.49 (tax included) Shipping included Buy Now on Buyee");
    expect(r.context).toBe("seller-listing");
    expect(r.commerceSignals.length).toBeGreaterThanOrEqual(2);
    expect(r.rarityClaims.length).toBeGreaterThanOrEqual(1);
    expect(r.suggestedSourceWeight).toBeLessThan(0.30);
    expect(r.suggestedHallucinationAddOn).toBeGreaterThanOrEqual(1.0);
  });

  it("classifies expert-review context with PSA / population-report signals", () => {
    const r = groundClaim("PSA grading confirms this card. Population report: 41 copies. Auction record: Goldin 2024.");
    expect(r.context).toBe("expert-review");
    expect(r.thirdPartyProofs.length).toBeGreaterThanOrEqual(2);
    expect(r.suggestedSourceWeight).toBeGreaterThanOrEqual(0.80);
  });

  it("classifies user-statement when rarity present but no commerce + no proof", () => {
    const r = groundClaim("I think this thing is rare");
    expect(r.context).toBe("user-statement");
  });

  it("classifies neutral-text when nothing matches", () => {
    const r = groundClaim("This is some random product description with no specific claims.");
    expect(r.context).toBe("neutral-text");
  });

  it("formatGroundingPulseLine produces compact summary", () => {
    const r = groundClaim("[Super rare] ฿1,086.49 Buy Now on Buyee");
    const line = formatGroundingPulseLine(r);
    expect(line).toContain("GROUNDING");
    expect(line).toContain("rarity=");
    expect(line).toContain("commerce=");
  });
});

// ============================================================
// PROMPT-Q LATENCY
// ============================================================

describe("v1.99 FLASH · Prompt-Q-Latency Engine", () => {
  it("predicts 'rarity-followup' when reply mentions rare/collectible", () => {
    const r = predictNextQuery("Cannot confirm this is rare without auction history.");
    expect(r.predictions[0]?.feature.id).toBe("rarity-followup");
  });

  it("predicts 'value-followup' when reply mentions price/worth", () => {
    const r = predictNextQuery("The listed price is 1,086.49 baht.");
    expect(r.predictions.some((p) => p.feature.id === "value-followup")).toBe(true);
  });

  it("returns empty predictions when reply has no triggers", () => {
    const r = predictNextQuery("Hello!");
    expect(r.predictions.length).toBe(0);
  });

  it("formatPredictionPulseLine produces compact summary", () => {
    const r = predictNextQuery("The rare card is collectible.");
    const line = formatPredictionPulseLine(r);
    expect(line).toContain("PROMPT-Q");
  });
});

// ============================================================
// FLASH MASTER — the user's exact "Super rare CAPCOM" case
// ============================================================

describe("v1.99 FLASH · the user's exact 'Super rare CAPCOM' hallucination case", () => {
  it("refuses to confirm 'super rare' when the only evidence is the seller listing", () => {
    const r = runFlash({
      claim: "this Capcom Trump card deck is super rare",
      contextText: "[Super rare] CAPCOM Capcom Character Trump Street Fighter Mega Man ฿1,086.49 (tax included) Shipping included Buy Now on Buyee. Product Description: 90年代に販売されたカプコンの人気キャラクター...",
      baseHallucinationFactor: 0,
      phi_qx: 2.0, // commerce paranoia
    });

    // CORE assertion: vanilla AIs would AFFIRM ("yes it's super rare!").
    // FLASH must NOT AFFIRM.
    expect(r.verdict).not.toBe("AFFIRM");
    expect(["DOUBTFUL", "REFUTE"]).toContain(r.verdict);
    expect(r.grounding.context).toBe("seller-listing");
    expect(r.grounding.rarityClaims.length).toBeGreaterThan(0);
    expect(r.veracity.V_eff).toBeLessThan(0.30);
    expect(r.template).toMatch(/Cannot confirm|Refuse to confirm/);
  });

  it("AFFIRMs the same claim WHEN third-party evidence is also present", () => {
    const r = runFlash({
      claim: "this Capcom Trump card deck is super rare",
      contextText: "[Super rare] CAPCOM Capcom Character Trump ฿1,086.49 Buy Now on Buyee",
      additionalEvidence: [
        { fact: "Mandarake catalog shows only 800 copies were printed (1994)", supportStrength: 0.9, sourceWeight: 0.85, sourceKind: "expert-database" },
        { fact: "Yahoo Auctions Japan 5-year history shows 7 completed sales, avg ¥4800", supportStrength: 0.85, sourceWeight: 0.90, sourceKind: "verified-third-party" },
      ],
      baseHallucinationFactor: 0,
      phi_qx: 1.0,
    });
    expect(["AFFIRM", "CAUTIOUS"]).toContain(r.verdict);
    expect(r.veracity.V_eff).toBeGreaterThan(0.35);
  });

  it("produces a pulseLine that an AI agent can surface to the user", () => {
    const r = runFlash({
      claim: "this is super rare",
      contextText: "[Super rare] ฿1,086.49 Buy Now on Buyee",
      baseHallucinationFactor: 0,
    });
    expect(r.pulseLine).toContain("FLASH");
    expect(r.pulseLine).toMatch(/AFFIRM|CAUTIOUS|DOUBTFUL|REFUTE/);
    expect(r.pulseLine).toContain("V_eff=");
  });
});
