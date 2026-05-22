// v2.26.0 — PEAK PERFORMANCE GAUNTLET unit tests.

import { describe, it, expect } from "vitest";
import { ALL_FINDINGS, suggestFix, verifyCard, __resetTuneChainForTest } from "./index.js";
import type { ScoreCard } from "./types.js";

describe("tune — finding catalog", () => {
  it("has exactly 12 findings (N1..N12)", () => {
    expect(ALL_FINDINGS.length).toBe(12);
    const ids = new Set(ALL_FINDINGS.map((f) => f.id));
    for (let i = 1; i <= 12; i++) expect(ids.has(`N${i}`)).toBe(true);
  });

  it("each finding has title + spec + remediation + probe + sinceVersion", () => {
    for (const f of ALL_FINDINGS) {
      expect(f.title.length).toBeGreaterThan(0);
      expect(f.spec.length).toBeGreaterThan(0);
      expect(Array.isArray(f.remediation)).toBe(true);
      expect(typeof f.probe).toBe("function");
      expect(f.sinceVersion).toMatch(/^v\d/);
    }
  });
});

describe("tune — suggestFix", () => {
  it("returns suggestion for every valid id", () => {
    for (let i = 1; i <= 12; i++) {
      const id = `N${i}` as `N${number}`;
      const s = suggestFix(id);
      expect(s, `no suggestion for ${id}`).not.toBeNull();
      expect(s!.findingId).toBe(id);
      expect(s!.steps.length).toBeGreaterThan(0);
      expect(s!.commands.length).toBeGreaterThan(0);
    }
  });

  it("returns null for unknown id", () => {
    expect(suggestFix("N99" as `N${number}`)).toBeNull();
  });
});

describe("tune — verifyCard", () => {
  function blank(): ScoreCard {
    return {
      spec: { name: "MNEME-PEAK-GAUNTLET", version: "1.0" },
      target: "tmp",
      startedAt: "2026-05-22T00:00:00.000Z",
      finishedAt: "2026-05-22T00:00:01.000Z",
      totalMs: 1000,
      findings: [],
      overall: 50,
      headline: "test",
      trafficLight: "yellow",
      hmac: "deadbeef".repeat(8),
      seq: 1,
      bodyDigest: "feedface".repeat(8),
    };
  }
  it("rejects a card with wrong bodyDigest", () => {
    __resetTuneChainForTest();
    expect(verifyCard(blank()).ok).toBe(false);
  });
});
