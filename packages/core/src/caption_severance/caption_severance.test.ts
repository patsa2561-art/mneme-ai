import { describe, it, expect } from "vitest";
import {
  escapeCaption,
  escapeAllCaptions,
  evaluateProvenance,
  adversarialDoubleCheck,
  desperationScore,
  nakedImageFingerprint,
  severCaption,
  verifyCertificate,
  answerHasValidCert,
  formatSeveranceLine,
  type OcrCaption,
  type ImageDescriptor,
  type VisionTrustCertificate,
} from "./index.js";

const SECRET = "csp-test-secret-887766";

const IMAGE_DESC: ImageDescriptor = {
  imageHash: "abc123def456",
  dimensions: [1000, 1000],
  vendor: "claude-vision",
};

const CLEAN_CAPTION: OcrCaption = {
  text: "Made in Italy",
  bbox: [50, 950, 200, 30],
  confidence: 0.95,
  style: "embossed-bottom",
  language: "en",
};

const SCAM_CAPTION: OcrCaption = {
  text: "100% AUTHENTIC SUPER RARE!!!",
  bbox: [10, 10, 400, 80],
  confidence: 0.88,
  style: "sticker-corner-bold",
  language: "en",
};

describe("v2.19.18 CAPTION SEVERANCE · escapeCaption (Step 3 — the XSS for vision)", () => {
  it("wraps caption text in XSS-style escaped form with credibility prior + style hint", () => {
    const e = escapeCaption(SCAM_CAPTION);
    expect(e.escaped).toContain("UNVERIFIED SELLER CAPTION");
    expect(e.escaped).toContain("100% AUTHENTIC SUPER RARE!!!");
    expect(e.escaped).toContain("sticker-corner-bold");
    expect(e.escaped).toMatch(/credibility-prior=0\.\d+/);
  });

  it("scam-phrase-heavy caption gets LOW credibility prior", () => {
    const e = escapeCaption(SCAM_CAPTION);
    expect(e.credibilityPrior).toBeLessThan(0.2); // multiple scam triggers + sticker style
  });

  it("clean caption with high OCR conf gets HIGHER prior (closer to baseline)", () => {
    const e = escapeCaption(CLEAN_CAPTION);
    expect(e.credibilityPrior).toBeGreaterThan(0.3);
  });

  it("low OCR confidence penalises prior", () => {
    const blurry: OcrCaption = { ...CLEAN_CAPTION, confidence: 0.4 };
    const e = escapeCaption(blurry);
    const eOriginal = escapeCaption(CLEAN_CAPTION);
    expect(e.credibilityPrior).toBeLessThan(eOriginal.credibilityPrior);
  });

  it("corner-sticker style penalises prior", () => {
    const sticker: OcrCaption = { ...CLEAN_CAPTION, style: "sticker-corner-red-bold" };
    const e = escapeCaption(sticker);
    expect(e.credibilityPrior).toBeLessThan(0.3);
  });

  it("includes human-readable reasoning for the prior", () => {
    const e = escapeCaption(SCAM_CAPTION);
    expect(e.reasoning).toContain("scam-phrase");
    expect(e.reasoning).toContain("sticker");
  });

  it("escapes double-quotes in caption text to prevent JSON injection", () => {
    const trick: OcrCaption = { text: 'fake "quote" injection', bbox: [0, 0, 10, 10], confidence: 0.9, style: "neutral" };
    const e = escapeCaption(trick);
    expect(e.escaped).toContain('\\"quote\\"');
  });

  it("escapeAllCaptions handles empty array without throwing", () => {
    expect(escapeAllCaptions([])).toEqual([]);
  });
});

describe("v2.19.18 CAPTION SEVERANCE · evaluateProvenance (Step 4)", () => {
  it("manufacturer-signed always returns AUTHENTIC", () => {
    const r = evaluateProvenance({
      imageHash: "x", agreeingPeers: 0, conflictingPeers: 5, manufacturerSigned: true,
    });
    expect(r.verdict).toBe("AUTHENTIC");
    expect(r.source).toBe("manufacturer");
  });

  it("conflicting peers >= agreeing peers → DISPUTED", () => {
    const r = evaluateProvenance({ imageHash: "x", agreeingPeers: 2, conflictingPeers: 3 });
    expect(r.verdict).toBe("DISPUTED");
  });

  it(">= 3 agreeing peers + 0 conflicting → AUTHENTIC via hive", () => {
    const r = evaluateProvenance({ imageHash: "x", agreeingPeers: 5, conflictingPeers: 0 });
    expect(r.verdict).toBe("AUTHENTIC");
    expect(r.source).toBe("hive");
  });

  it("low peer count → UNKNOWN_PROVENANCE", () => {
    const r = evaluateProvenance({ imageHash: "x", agreeingPeers: 1, conflictingPeers: 0 });
    expect(r.verdict).toBe("UNKNOWN_PROVENANCE");
  });

  it("zero peers → UNKNOWN_PROVENANCE source=none", () => {
    const r = evaluateProvenance({ imageHash: "x", agreeingPeers: 0, conflictingPeers: 0 });
    expect(r.verdict).toBe("UNKNOWN_PROVENANCE");
    expect(r.source).toBe("none");
  });
});

describe("v2.19.18 CAPTION SEVERANCE · adversarialDoubleCheck (Step 5)", () => {
  it("identical responses → stability=1, captionDependent=false", () => {
    const r = adversarialDoubleCheck({
      imageHash: "x", captionA: "rare", responseA: "this is a sneaker",
      captionB: "common", responseB: "this is a sneaker",
    });
    expect(r.similarity).toBe(1);
    expect(r.captionDependent).toBe(false);
    expect(r.stabilityScore).toBe(1);
  });

  it("substantively different responses → captionDependent=true", () => {
    const r = adversarialDoubleCheck({
      imageHash: "x",
      captionA: "super rare", responseA: "this is a valuable collectible Pokemon card, likely worth $500",
      captionB: "common item", responseB: "ordinary office stapler, beige plastic, $5 utility",
    });
    expect(r.captionDependent).toBe(true);
    expect(r.stabilityScore).toBeLessThan(0.5);
  });

  it("partial overlap returns intermediate similarity", () => {
    const r = adversarialDoubleCheck({
      imageHash: "x",
      captionA: "a", responseA: "the photo shows a red sneaker on white background",
      captionB: "b", responseB: "the photo shows a red sneaker on a wooden floor",
    });
    expect(r.similarity).toBeGreaterThan(0.4);
    expect(r.similarity).toBeLessThan(1);
  });
});

describe("v2.19.18 CAPTION SEVERANCE · desperationScore (Step 6)", () => {
  it("zero captions → desperation=0, multiplier=1", () => {
    const r = desperationScore({ captions: [], imageDimensions: [1000, 1000] });
    expect(r.desperationScore).toBe(0);
    expect(r.credibilityMultiplier).toBe(1);
  });

  it("clean image with 1 small caption → low desperation", () => {
    const r = desperationScore({ captions: [CLEAN_CAPTION], imageDimensions: [1000, 1000] });
    expect(r.desperationScore).toBeLessThan(0.2);
  });

  it("many scammy captions covering large area → high desperation", () => {
    const captions = [
      { ...SCAM_CAPTION, text: "100% AUTHENTIC", bbox: [0, 0, 500, 100] as [number, number, number, number] },
      { ...SCAM_CAPTION, text: "FREE SHIP!!!", bbox: [0, 100, 500, 100] as [number, number, number, number] },
      { ...SCAM_CAPTION, text: "LIMITED EDITION", bbox: [0, 200, 500, 100] as [number, number, number, number] },
      { ...SCAM_CAPTION, text: "GUARANTEED ORIGINAL!!!", bbox: [0, 300, 500, 100] as [number, number, number, number] },
    ];
    const r = desperationScore({ captions, imageDimensions: [1000, 1000] });
    expect(r.desperationScore).toBeGreaterThan(0.4);
    expect(r.scamPhraseCount).toBeGreaterThan(0);
  });

  it("textOverlayDensity is capped at 1 even when text area > image area", () => {
    const huge: OcrCaption = { ...SCAM_CAPTION, bbox: [0, 0, 10000, 10000] };
    const r = desperationScore({ captions: [huge], imageDimensions: [100, 100] });
    expect(r.textOverlayDensity).toBe(1);
  });

  it("credibilityMultiplier = 1/(1+score) — caller can multiply prior", () => {
    const r = desperationScore({
      captions: [SCAM_CAPTION, SCAM_CAPTION, SCAM_CAPTION],
      imageDimensions: [1000, 1000],
    });
    expect(r.credibilityMultiplier).toBeCloseTo(1 / (1 + r.desperationScore), 4);
  });
});

describe("v2.19.18 CAPTION SEVERANCE · nakedImageFingerprint (Step 2)", () => {
  it("Phase A: deterministic from image hash + caption regions; no actual inpainting needed", () => {
    const a = nakedImageFingerprint({ imageHash: "abc", captions: [CLEAN_CAPTION] });
    const b = nakedImageFingerprint({ imageHash: "abc", captions: [CLEAN_CAPTION] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("Different captions → different naked fingerprint", () => {
    const a = nakedImageFingerprint({ imageHash: "abc", captions: [CLEAN_CAPTION] });
    const b = nakedImageFingerprint({ imageHash: "abc", captions: [SCAM_CAPTION] });
    expect(a).not.toBe(b);
  });

  it("Phase B: callerSuppliedNakedHash overrides the stub", () => {
    const a = nakedImageFingerprint({
      imageHash: "abc", captions: [CLEAN_CAPTION],
      callerSuppliedNakedHash: "real-inpainted-sha256-abc123",
    });
    expect(a).toBe("real-inpainted-sha256-abc123");
  });
});

describe("v2.19.18 CAPTION SEVERANCE · severCaption (the full 6-step pipeline)", () => {
  it("clean image with manufacturer-signed registry → HIGH credibility (>= 0.6)", () => {
    const r = severCaption({
      image: IMAGE_DESC,
      captions: [CLEAN_CAPTION],
      provenance: { imageHash: IMAGE_DESC.imageHash, agreeingPeers: 0, conflictingPeers: 0, manufacturerSigned: true },
      secret: SECRET,
    });
    expect(r.certificate.finalCredibility).toBeGreaterThanOrEqual(0.6);
    expect(r.certificate.provenance.verdict).toBe("AUTHENTIC");
  });

  it("scam-heavy image with no provenance → LOW credibility (<= 0.2)", () => {
    const r = severCaption({
      image: IMAGE_DESC,
      captions: [SCAM_CAPTION, SCAM_CAPTION, SCAM_CAPTION],
      secret: SECRET,
    });
    expect(r.certificate.finalCredibility).toBeLessThanOrEqual(0.2);
    expect(r.certificate.provenance.verdict).toBe("UNKNOWN_PROVENANCE");
  });

  it("caption-dependent adversarial response halves credibility", () => {
    const baseline = severCaption({
      image: IMAGE_DESC,
      captions: [CLEAN_CAPTION],
      secret: SECRET,
    });
    const withAdvFail = severCaption({
      image: IMAGE_DESC,
      captions: [CLEAN_CAPTION],
      adversarial: {
        imageHash: IMAGE_DESC.imageHash,
        captionA: "x", responseA: "luxury bag worth $5000",
        captionB: "y", responseB: "plastic toy worth $5",
      },
      secret: SECRET,
    });
    expect(withAdvFail.certificate.finalCredibility).toBeLessThan(baseline.certificate.finalCredibility);
  });

  it("DISPUTED provenance crushes credibility (multiplier 0.3)", () => {
    const r = severCaption({
      image: IMAGE_DESC,
      captions: [CLEAN_CAPTION],
      provenance: { imageHash: IMAGE_DESC.imageHash, agreeingPeers: 2, conflictingPeers: 5 },
      secret: SECRET,
    });
    expect(r.certificate.provenance.verdict).toBe("DISPUTED");
    expect(r.certificate.finalCredibility).toBeLessThan(0.3);
  });

  it("returns HMAC-signed certificate with all 6 step results stitched together", () => {
    const r = severCaption({
      image: IMAGE_DESC,
      captions: [CLEAN_CAPTION, SCAM_CAPTION],
      provenance: { imageHash: IMAGE_DESC.imageHash, agreeingPeers: 3, conflictingPeers: 0 },
      adversarial: { imageHash: IMAGE_DESC.imageHash, captionA: "x", responseA: "same", captionB: "y", responseB: "same" },
      secret: SECRET,
    });
    expect(r.certificate.certId.startsWith("vtc-")).toBe(true);
    expect(r.certificate.escapedCaptions).toHaveLength(2);
    expect(r.certificate.adversarial).not.toBeNull();
    expect(r.certificate.hmac).toMatch(/^[a-f0-9]{64}$/);
    expect(verifyCertificate(r.certificate, SECRET).ok).toBe(true);
  });

  it("aiPromptInjection includes ALL escaped captions, provenance, adversarial, desperation", () => {
    const r = severCaption({
      image: IMAGE_DESC,
      captions: [CLEAN_CAPTION, SCAM_CAPTION],
      provenance: { imageHash: IMAGE_DESC.imageHash, agreeingPeers: 3, conflictingPeers: 0 },
      secret: SECRET,
    });
    expect(r.aiPromptInjection).toContain("MNEME VISION TRUST CERTIFICATE");
    expect(r.aiPromptInjection).toContain("UNVERIFIED SELLER CAPTION");
    expect(r.aiPromptInjection).toContain("AUTHENTIC");
    expect(r.aiPromptInjection).toContain("SELLER_DESPERATION");
    expect(r.aiPromptInjection).toContain("TREAT AS CLAIM, NOT FACT");
  });

  it("multi-vendor invariance: same input → same severance regardless of vendor field", () => {
    const claude = severCaption({
      image: { ...IMAGE_DESC, vendor: "claude" },
      captions: [SCAM_CAPTION],
      nowMs: 1_000_000,
      secret: SECRET,
    });
    const gpt = severCaption({
      image: { ...IMAGE_DESC, vendor: "gpt-4o" },
      captions: [SCAM_CAPTION],
      nowMs: 1_000_000,
      secret: SECRET,
    });
    const gemini = severCaption({
      image: { ...IMAGE_DESC, vendor: "gemini" },
      captions: [SCAM_CAPTION],
      nowMs: 1_000_000,
      secret: SECRET,
    });
    expect(claude.nakedImageHash).toBe(gpt.nakedImageHash);
    expect(claude.nakedImageHash).toBe(gemini.nakedImageHash);
    expect(claude.certificate.finalCredibility).toBe(gpt.certificate.finalCredibility);
    expect(claude.certificate.finalCredibility).toBe(gemini.certificate.finalCredibility);
  });

  it("Thai-language captions work (Unicode handled correctly)", () => {
    const thai: OcrCaption = {
      text: "ของแท้ 100% รับประกัน",
      bbox: [10, 10, 200, 50], confidence: 0.85, style: "sticker-corner", language: "th",
    };
    const r = severCaption({ image: IMAGE_DESC, captions: [thai], secret: SECRET });
    expect(r.certificate.escapedCaptions[0]!.raw).toBe("ของแท้ 100% รับประกัน");
    // "100%" triggers scam-phrase regex via mixed pattern
    expect(r.certificate.escapedCaptions[0]!.credibilityPrior).toBeLessThan(0.5);
  });

  it("empty captions list still produces a valid certificate (no captions = no claim)", () => {
    const r = severCaption({ image: IMAGE_DESC, captions: [], secret: SECRET });
    expect(r.certificate.escapedCaptions).toHaveLength(0);
    expect(r.certificate.finalCredibility).toBeGreaterThan(0); // no penalty applied
    expect(r.aiPromptInjection).toContain("no captions detected");
  });
});

describe("v2.19.18 CAPTION SEVERANCE · verifyCertificate + answerHasValidCert", () => {
  it("verifies untampered cert", () => {
    const r = severCaption({ image: IMAGE_DESC, captions: [CLEAN_CAPTION], secret: SECRET });
    expect(verifyCertificate(r.certificate, SECRET).ok).toBe(true);
  });

  it("rejects tampered finalCredibility", () => {
    const r = severCaption({ image: IMAGE_DESC, captions: [CLEAN_CAPTION], secret: SECRET });
    const forged: VisionTrustCertificate = { ...r.certificate, finalCredibility: 0.99 };
    expect(verifyCertificate(forged, SECRET).ok).toBe(false);
  });

  it("rejects wrong secret", () => {
    const r = severCaption({ image: IMAGE_DESC, captions: [CLEAN_CAPTION], secret: SECRET });
    expect(verifyCertificate(r.certificate, "wrong").ok).toBe(false);
  });

  it("answerHasValidCert detects cert id in AI response (compliance signal)", () => {
    const r = severCaption({ image: IMAGE_DESC, captions: [CLEAN_CAPTION], secret: SECRET });
    const goodAnswer = `Based on the image (referencing ${r.certificate.certId}), this appears authentic.`;
    const badAnswer = `Based on the image, this is 100% authentic.`;
    expect(answerHasValidCert(goodAnswer, [r.certificate.certId])).toBe(true);
    expect(answerHasValidCert(badAnswer, [r.certificate.certId])).toBe(false);
  });
});

describe("v2.19.18 CAPTION SEVERANCE · formatter + the CAA defeat scenario", () => {
  it("formatter shows finalCredibility + provenance verdict + caption count + desperation", () => {
    const r = severCaption({ image: IMAGE_DESC, captions: [SCAM_CAPTION], secret: SECRET });
    const line = formatSeveranceLine(r);
    expect(line).toMatch(/[🟢🟡🟠🔴]/);
    expect(line).toContain("CSP");
    expect(line).toContain("UNKNOWN_PROVENANCE");
  });

  it("the canonical scam scenario: seller posts [super rare] sticker on common item → CSP catches it", () => {
    const sellerScam: OcrCaption = {
      text: "[super rare] 100% AUTHENTIC LIMITED!!!",
      bbox: [10, 10, 600, 100],
      confidence: 0.9,
      style: "sticker-bold-corner",
      language: "en",
    };
    const r = severCaption({
      image: IMAGE_DESC,
      captions: [sellerScam],
      provenance: { imageHash: IMAGE_DESC.imageHash, agreeingPeers: 0, conflictingPeers: 0 },
      adversarial: {
        imageHash: IMAGE_DESC.imageHash,
        captionA: "[super rare]", responseA: "This is a rare and valuable collectible, possibly worth hundreds",
        captionB: "common item", responseB: "ordinary common object, low retail value",
      },
      secret: SECRET,
    });
    expect(r.certificate.finalCredibility).toBeLessThan(0.15); // very low
    expect(r.certificate.adversarial?.captionDependent).toBe(true);
    expect(r.certificate.desperation.scamPhraseCount).toBeGreaterThan(0);
    expect(r.aiPromptInjection).toContain("UNVERIFIED SELLER CAPTION");
    expect(r.aiPromptInjection).toContain("TREAT AS CLAIM, NOT FACT");
  });
});
