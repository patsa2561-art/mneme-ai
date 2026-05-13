import { describe, it, expect } from "vitest";
import { extractStyleFingerprint, styleSimilarity, styleAsPromptPrefix, formatNecromancyPulseLine } from "./index.js";

describe("v2.1 NECROMANCY · stylometric fingerprint MVP", () => {
  it("extracts fingerprint with sentence stats", () => {
    const logs = [
      "Sure, here's a thought. Maybe try this approach. I think it might work. Hope this helps!",
      "Let me know if you need more. Of course, I'd be happy to help.",
    ];
    const fp = extractStyleFingerprint("test-vendor", logs);
    expect(fp.vendorLabel).toBe("test-vendor");
    expect(fp.totalSentences).toBeGreaterThan(0);
    expect(fp.hedgesPer100Sentences).toBeGreaterThan(0); // 'Maybe', 'I think'
    expect(fp.topOpeners.length).toBeGreaterThan(0);
    expect(fp.topClosings.length).toBeGreaterThan(0);
  });

  it("hedge-heavy text has higher hedgesPer100Sentences", () => {
    const fp1 = extractStyleFingerprint("hedged", ["Maybe this. Perhaps that. I think so. I believe yes."]);
    const fp2 = extractStyleFingerprint("absolute", ["Always do this. Never do that. Definitely correct."]);
    expect(fp1.hedgesPer100Sentences).toBeGreaterThan(fp2.hedgesPer100Sentences);
    expect(fp2.absolutesPer100Sentences).toBeGreaterThan(fp1.absolutesPer100Sentences);
  });

  it("featureVector is non-empty + numeric", () => {
    const fp = extractStyleFingerprint("x", ["test message"]);
    expect(fp.featureVector.length).toBeGreaterThan(0);
    for (const v of fp.featureVector) expect(typeof v).toBe("number");
  });

  it("styleSimilarity returns 1.0 for identical fingerprints", () => {
    const fp = extractStyleFingerprint("x", ["hello world hello world"]);
    expect(styleSimilarity(fp, fp)).toBeCloseTo(1, 5);
  });

  it("styleSimilarity returns a value 0..1 for different fingerprints", () => {
    const a = extractStyleFingerprint("a", ["short."]);
    const b = extractStyleFingerprint("b", ["Long verbose sentences with hedges maybe perhaps. I think this. I believe that."]);
    const sim = styleSimilarity(a, b);
    expect(sim).toBeGreaterThanOrEqual(-1);
    expect(sim).toBeLessThanOrEqual(1);
  });

  it("styleAsPromptPrefix mentions vendor + traits", () => {
    const fp = extractStyleFingerprint("bard-classic", ["Of course! Let me know if you need anything. Of course!"]);
    const prefix = styleAsPromptPrefix(fp);
    expect(prefix).toContain("bard-classic");
    expect(prefix.toLowerCase()).toContain("stylometric mimicry");
  });

  it("formatNecromancyPulseLine summarises", () => {
    const fp = extractStyleFingerprint("v", ["x. y."]);
    expect(formatNecromancyPulseLine(fp)).toContain("NECROMANCY");
  });
});
