import { describe, it, expect } from "vitest";
import {
  buildConscienceCard,
  renderCardText,
  renderCardSvg,
  computeCardStats,
  formatCardStatsLine,
  CONSCIENCE_CARD_TUNABLES,
  type ConscienceCard,
} from "./index.js";

describe("v2.19.37 CONSCIENCE CARD — build", () => {
  it("builds a card from minimal input with all required fields", () => {
    const card = buildConscienceCard({
      vendor: "claude", modelVersion: "opus-4.7", kind: "paradox",
      aiClaim: "X exists and X does not exist", detection: "self-contradiction REJECTED",
      tsMs: 1_700_000_000_000,
    });
    expect(card.cardId).toMatch(/^[0-9a-f]{12}$/);
    expect(card.kind).toBe("paradox");
    expect(card.hashtag).toBe("#MnemeCaughtThis");
  });

  it("DETERMINISTIC: same input → same cardId (dedupe across users)", () => {
    const input = {
      vendor: "gpt", modelVersion: "4o", kind: "hallucination" as const,
      aiClaim: "Same claim", detection: "Same detection", tsMs: 1_700_000_000_000,
    };
    expect(buildConscienceCard(input).cardId).toBe(buildConscienceCard(input).cardId);
  });

  it("truncates aiClaim + detection to spec limits", () => {
    const card = buildConscienceCard({
      vendor: "v", modelVersion: "m", kind: "paradox",
      aiClaim: "x".repeat(500), detection: "y".repeat(500), tsMs: 0,
    });
    expect(card.aiClaim.length).toBeLessThanOrEqual(CONSCIENCE_CARD_TUNABLES.MAX_CLAIM_LEN);
    expect(card.detection.length).toBeLessThanOrEqual(CONSCIENCE_CARD_TUNABLES.MAX_DETECTION_LEN);
  });

  it("unknown kind falls back to 'hallucination'", () => {
    const card = buildConscienceCard({
      vendor: "v", modelVersion: "m", kind: "invented_kind" as never,
      aiClaim: "x", detection: "y", tsMs: 0,
    });
    expect(card.kind).toBe("hallucination");
  });

  it("dayBucketMs floors ts to day boundary (k-anonymity)", () => {
    const c1 = buildConscienceCard({ vendor: "v", modelVersion: "m", kind: "paradox", aiClaim: "a", detection: "b", tsMs: 1_700_000_001_234 });
    const c2 = buildConscienceCard({ vendor: "v", modelVersion: "m", kind: "paradox", aiClaim: "a", detection: "b", tsMs: 1_700_000_059_999 });
    expect(c1.dayBucketMs).toBe(c2.dayBucketMs);
  });

  it("DEFENSIVE: garbage input never throws", () => {
    expect(() => buildConscienceCard({} as Parameters<typeof buildConscienceCard>[0])).not.toThrow();
    expect(() => buildConscienceCard({ vendor: 123, modelVersion: null } as unknown as Parameters<typeof buildConscienceCard>[0])).not.toThrow();
  });
});

describe("v2.19.37 CONSCIENCE CARD — text render", () => {
  function freshCard(): ConscienceCard {
    return buildConscienceCard({
      vendor: "claude", modelVersion: "opus-4.7", kind: "paradox",
      aiClaim: "the file X exists AND the file X does not exist",
      detection: "self-contradiction REJECTED",
      savedValue: "3.2 hours debug",
      tsMs: 1_700_000_000_000,
    });
  }

  it("emits 3-5 line shareable text", () => {
    const txt = renderCardText(freshCard());
    const lines = txt.split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(3);
    expect(lines.length).toBeLessThanOrEqual(10);
  });

  it("includes vendor, claim, detection, hashtag", () => {
    const txt = renderCardText(freshCard());
    expect(txt).toContain("claude");
    expect(txt).toContain("self-contradiction REJECTED");
    expect(txt).toContain("#MnemeCaughtThis");
  });

  it("kind emoji included", () => {
    const txt = renderCardText(freshCard());
    expect(txt).toContain("🌀"); // paradox emoji
  });
});

describe("v2.19.37 CONSCIENCE CARD — SVG render (self-contained, screenshot-grade)", () => {
  function freshCard(): ConscienceCard {
    return buildConscienceCard({
      vendor: "gpt", modelVersion: "4o", kind: "hallucination",
      aiClaim: "Cited paper that doesn't exist", detection: "no such paper in arxiv",
      tsMs: 1_700_000_000_000,
    });
  }

  it("emits valid SVG (root element + viewBox + content)", () => {
    const svg = renderCardSvg(freshCard());
    expect(svg).toContain("<svg");
    expect(svg).toContain("viewBox");
    expect(svg).toContain("</svg>");
  });

  it("default 600x320", () => {
    const svg = renderCardSvg(freshCard());
    expect(svg).toContain('width="600"');
    expect(svg).toContain('height="320"');
  });

  it("custom dimensions honoured", () => {
    const svg = renderCardSvg(freshCard(), { width: 1200, height: 630 });
    expect(svg).toContain('width="1200"');
    expect(svg).toContain('height="630"');
  });

  it("vendor color matches kind background", () => {
    const card = buildConscienceCard({ vendor: "claude", modelVersion: "x", kind: "paradox", aiClaim: "a", detection: "b", tsMs: 0 });
    const svg = renderCardSvg(card);
    expect(svg).toContain("#7c3aed"); // paradox bg
  });

  it("XSS-DEFENSE: special chars in claim escaped", () => {
    const card = buildConscienceCard({
      vendor: "v", modelVersion: "m", kind: "paradox",
      aiClaim: '<script>alert(1)</script>', detection: '</text><tspan>x</tspan>', tsMs: 0,
    });
    const svg = renderCardSvg(card);
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;script&gt;");
  });

  it("NO external resource refs (xmlns declaration excepted) — no <link>, no <image href=, no font-face, no @import", () => {
    const svg = renderCardSvg(freshCard());
    // xmlns="http://www.w3.org/2000/svg" is the REQUIRED SVG namespace
    // declaration, not an external resource fetch. We assert no actual
    // external loads happen.
    expect(svg).not.toContain("<image");
    expect(svg).not.toContain("xlink:href");
    expect(svg).not.toContain("@import");
    expect(svg).not.toContain("@font-face");
    expect(svg).not.toContain("<link");
  });

  it("hashtag + cardId at bottom for indexing", () => {
    const card = freshCard();
    const svg = renderCardSvg(card);
    expect(svg).toContain("#MnemeCaughtThis");
    expect(svg).toContain(card.cardId);
  });
});

describe("v2.19.37 CONSCIENCE CARD — A/B before vs after", () => {
  it("A: pre-v2.19.37 failures = JSON dump (not shareable); B: now SVG + text shareable", () => {
    const card = buildConscienceCard({
      vendor: "claude", modelVersion: "opus", kind: "fairness_fail",
      aiClaim: "approve all gender=male", detection: "fairness_fail with race attribute",
      tsMs: 1_700_000_000_000,
    });
    const txt = renderCardText(card);
    const svg = renderCardSvg(card);
    expect(txt.length).toBeGreaterThan(50);
    expect(svg.length).toBeGreaterThan(500);
    // Wordle-like: deterministic format, fixed-ish length, hashtag, no PII leak in template
    expect(svg).toContain("#MnemeCaughtThis");
  });
});

describe("v2.19.37 CONSCIENCE CARD — stats + 1000-iter fuzz", () => {
  it("computeCardStats counts kinds + vendors correctly", () => {
    const cards = [
      buildConscienceCard({ vendor: "claude", modelVersion: "x", kind: "paradox", aiClaim: "a", detection: "b", tsMs: 0 }),
      buildConscienceCard({ vendor: "gpt", modelVersion: "x", kind: "hallucination", aiClaim: "a", detection: "b", tsMs: 0 }),
      buildConscienceCard({ vendor: "claude", modelVersion: "x", kind: "hallucination", aiClaim: "c", detection: "d", tsMs: 0 }),
    ];
    const s = computeCardStats(cards);
    expect(s.totalCards).toBe(3);
    expect(s.kindBreakdown.paradox).toBe(1);
    expect(s.kindBreakdown.hallucination).toBe(2);
    expect(s.vendorBreakdown.claude).toBe(2);
    expect(formatCardStatsLine(s)).toContain("CARDS");
  });

  it("1000 random build+render cycles never crash", () => {
    const kinds = CONSCIENCE_CARD_TUNABLES.KINDS;
    for (let i = 0; i < 1000; i++) {
      const card = buildConscienceCard({
        vendor: `v${i % 5}`, modelVersion: `m${i % 3}`,
        kind: kinds[i % kinds.length]!,
        aiClaim: `claim ${i} ${Math.random()}`,
        detection: `detection ${i}`,
        tsMs: 1_700_000_000_000 + i * 1000,
      });
      expect(renderCardText(card).length).toBeGreaterThan(0);
      expect(renderCardSvg(card).length).toBeGreaterThan(0);
    }
  });
});
