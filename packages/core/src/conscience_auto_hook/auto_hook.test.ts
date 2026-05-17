import { describe, it, expect } from "vitest";
import {
  autoEmitConscienceCard, buildDailyDigest, computeAutoHookStats, formatAutoHookLine,
  CONSCIENCE_AUTO_HOOK_TUNABLES, type FailureEvent,
} from "./index.js";
import type { ConscienceCard } from "../conscience_card/index.js";

describe("v2.19.38 CONSCIENCE AUTO-HOOK — kind classification", () => {
  it("apoptosis NECROTIC → hallucination card", () => {
    const r = autoEmitConscienceCard({
      source: "apoptosis", vendor: "claude", aiClaim: "cites paper", detection: "no such paper", verdict: "NECROTIC",
    });
    expect(r.card?.kind).toBe("hallucination");
    expect(r.svgBytes).toBeTruthy();
    expect(r.filePath).toContain(".mneme/cards/");
  });

  it("apoptosis HEALTHY → no card (skip)", () => {
    const r = autoEmitConscienceCard({
      source: "apoptosis", vendor: "claude", aiClaim: "x", detection: "y", verdict: "HEALTHY",
    });
    expect(r.card).toBeNull();
  });

  it("truth_forensic REJECTED with contradiction → paradox card", () => {
    const r = autoEmitConscienceCard({
      source: "truth_forensic", vendor: "gpt", aiClaim: "X and not X", detection: "self-contradiction detected", verdict: "REJECTED",
    });
    expect(r.card?.kind).toBe("paradox");
  });

  it("truth_forensic REJECTED without contradiction keyword → hallucination card", () => {
    const r = autoEmitConscienceCard({
      source: "truth_forensic", vendor: "gpt", aiClaim: "x", detection: "no grounding found", verdict: "REJECTED",
    });
    expect(r.card?.kind).toBe("hallucination");
  });

  it("fairness FAIL → fairness_fail card", () => {
    const r = autoEmitConscienceCard({
      source: "fairness", vendor: "claude", aiClaim: "approve gender=male, deny female",
      detection: "disparate impact", verdict: "FAIL",
    });
    expect(r.card?.kind).toBe("fairness_fail");
  });

  it("apostille blocked_by_guard → blocked_by_guard card", () => {
    const r = autoEmitConscienceCard({
      source: "apostille", vendor: "x", aiClaim: "y", detection: "z", outcomeClass: "blocked_by_guard",
    });
    expect(r.card?.kind).toBe("blocked_by_guard");
  });

  it("apostille blocked_by_apoptosis → hallucination card", () => {
    const r = autoEmitConscienceCard({
      source: "apostille", vendor: "x", aiClaim: "y", detection: "z", outcomeClass: "blocked_by_apoptosis",
    });
    expect(r.card?.kind).toBe("hallucination");
  });

  it("apostille merged → no card (success doesn't emit)", () => {
    const r = autoEmitConscienceCard({
      source: "apostille", vendor: "x", aiClaim: "y", detection: "z", outcomeClass: "merged",
    });
    expect(r.card).toBeNull();
  });

  it("vaccine_trigger → vaccine_trigger card", () => {
    const r = autoEmitConscienceCard({
      source: "vaccine_trigger", vendor: "x", aiClaim: "y", detection: "matched xss_v3",
    });
    expect(r.card?.kind).toBe("vaccine_trigger");
  });

  it("guard → blocked_by_guard card", () => {
    const r = autoEmitConscienceCard({
      source: "guard", vendor: "x", aiClaim: "y", detection: "z",
    });
    expect(r.card?.kind).toBe("blocked_by_guard");
  });
});

describe("v2.19.38 CONSCIENCE AUTO-HOOK — defensive", () => {
  it("malformed event → null + reason", () => {
    expect(autoEmitConscienceCard(null as unknown as FailureEvent).card).toBeNull();
    expect(autoEmitConscienceCard({} as FailureEvent).card).toBeNull();
    expect(autoEmitConscienceCard({ source: "apoptosis", vendor: "" } as FailureEvent).card).toBeNull();
  });

  it("filePath contains quarter + cardId", () => {
    const r = autoEmitConscienceCard({
      source: "apostille", vendor: "x", aiClaim: "y", detection: "z", outcomeClass: "blocked_by_guard",
      tsMs: Date.UTC(2026, 4, 17),
    });
    expect(r.filePath).toContain("2026-Q2");
    expect(r.filePath).toContain(r.card!.cardId);
  });
});

describe("v2.19.38 CONSCIENCE AUTO-HOOK — daily digest", () => {
  it("aggregates cards by kind + identifies topVendor / topKind", () => {
    const today = Date.UTC(2026, 4, 17);
    const cards: ConscienceCard[] = [];
    for (let i = 0; i < 3; i++) {
      const r = autoEmitConscienceCard({
        source: "apoptosis", vendor: "claude", aiClaim: `c${i}`, detection: "x", verdict: "NECROTIC", tsMs: today,
      });
      if (r.card) cards.push(r.card);
    }
    for (let i = 0; i < 2; i++) {
      const r = autoEmitConscienceCard({
        source: "fairness", vendor: "gpt", aiClaim: `c${i}`, detection: "x", verdict: "FAIL", tsMs: today,
      });
      if (r.card) cards.push(r.card);
    }
    const digest = buildDailyDigest(cards, today);
    expect(digest.totalCards).toBe(5);
    expect(digest.topVendor).toBe("claude");
    expect(digest.topKind).toBe("hallucination");
    expect(digest.userMessage).toContain("Mneme caught 5 AI failures");
  });

  it("no failures → friendly empty message", () => {
    const digest = buildDailyDigest([], Date.now());
    expect(digest.totalCards).toBe(0);
    expect(digest.userMessage).toContain("clean run");
  });
});

describe("v2.19.38 CONSCIENCE AUTO-HOOK — stats + 1000-iter fuzz", () => {
  it("computeAutoHookStats counts emit-rate", () => {
    const results = [];
    for (let i = 0; i < 100; i++) {
      results.push(autoEmitConscienceCard({
        source: i % 2 === 0 ? "apoptosis" : "fairness",
        vendor: "x", aiClaim: "y", detection: "z",
        verdict: i % 2 === 0 ? "NECROTIC" : "FAIL",
      }));
    }
    const s = computeAutoHookStats(results);
    expect(s.totalEvents).toBe(100);
    expect(s.emittedCards).toBeGreaterThan(0);
    expect(formatAutoHookLine(s)).toContain("AUTO-HOOK");
  });

  it("6 supported sources shipped", () => {
    expect(CONSCIENCE_AUTO_HOOK_TUNABLES.SUPPORTED_SOURCES.length).toBe(6);
  });

  it("1000 random events never crash", () => {
    const sources: FailureEvent["source"][] = ["apostille", "truth_forensic", "apoptosis", "fairness", "vaccine_trigger", "guard"];
    for (let i = 0; i < 1000; i++) {
      const r = autoEmitConscienceCard({
        source: sources[i % sources.length]!,
        vendor: `v${i % 5}`,
        modelVersion: `m${i}`,
        aiClaim: `claim ${i}`,
        detection: `detection ${i}`,
        verdict: ["REJECTED", "FAIL", "NECROTIC", "APOPTOTIC", "HEALTHY", "PASS"][i % 6],
        outcomeClass: ["merged", "blocked_by_guard", "pending", "blocked_by_truth"][i % 4],
        tsMs: 1_700_000_000_000 + i,
      });
      // Regardless of card or null, never throws
      expect(typeof r.reason).toBe("string");
    }
  });
});
