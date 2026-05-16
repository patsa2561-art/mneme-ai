import { describe, it, expect } from "vitest";
import { judgeWithTrinity, verifyTrinity, rollupTrinity, formatTrinityLine } from "./index.js";

describe("v2.19 · MNEME TRINITY VOTE — consensus + tiebreaker ensemble", () => {
  it("skips tiebreaker when consensus pair agrees", async () => {
    let tiebreakerCalled = false;
    const v = await judgeWithTrinity({
      prompt: "what is 2+2",
      taskClass: "fact_check",
      expectedFacts: [{ description: "contains 4", mustContain: ["4"] }],
      consensusPair: [
        { vendor: "claude", text: "The answer is 4.", costUsd: 0.01 },
        { vendor: "chatgpt", text: "It's 4.", costUsd: 0.005 },
      ],
      tiebreakerVendor: "grok",
      tiebreakerProvider: async () => {
        tiebreakerCalled = true;
        return { vendor: "grok", text: "4" };
      },
    });
    expect(v.tiebreakUsed).toBe(false);
    expect(tiebreakerCalled).toBe(false);
    expect(v.estimatedTiebreakerCostSavedUsd).toBeGreaterThan(0);
    expect(v.chosenVendor === "claude" || v.chosenVendor === "chatgpt").toBe(true);
  });

  it("calls tiebreaker when consensus pair disagrees", async () => {
    let tiebreakerCalled = false;
    const v = await judgeWithTrinity({
      prompt: "what's the rare token",
      taskClass: "fact_check",
      expectedFacts: [{ description: "contains XYZZY", mustContain: ["XYZZY"] }],
      consensusPair: [
        { vendor: "claude", text: "XYZZY is the token." }, // passes
        { vendor: "chatgpt", text: "I'm not sure, maybe ABC123?" }, // fails
      ],
      tiebreakerVendor: "grok",
      tiebreakerProvider: async () => {
        tiebreakerCalled = true;
        return { vendor: "grok", text: "Definitively XYZZY." };
      },
    });
    expect(v.tiebreakUsed).toBe(true);
    expect(tiebreakerCalled).toBe(true);
    expect(v.estimatedTiebreakerCostSavedUsd).toBe(0);
  });

  it("any vendor can serve as tiebreaker (vendor-agnostic)", async () => {
    const tbVendors = ["grok", "gemini", "cursor", "perplexity", "llama"] as const;
    for (const tbv of tbVendors) {
      const v = await judgeWithTrinity({
        prompt: "x",
        taskClass: "fact_check",
        expectedFacts: [{ description: "contains x", mustContain: ["x"] }],
        consensusPair: [
          { vendor: "claude", text: "x" },
          { vendor: "chatgpt", text: "no" },
        ],
        tiebreakerVendor: tbv,
        tiebreakerProvider: () => ({ vendor: tbv, text: "x" }),
      });
      expect(v.tiebreakerVendor).toBe(tbv);
      expect(v.tiebreakUsed).toBe(true);
    }
  });

  it("verdict is signed + verifiable", async () => {
    const v = await judgeWithTrinity({
      prompt: "x", taskClass: "other",
      expectedFacts: [{ description: "x", mustContain: ["x"] }],
      consensusPair: [
        { vendor: "claude", text: "x" },
        { vendor: "chatgpt", text: "x" },
      ],
      tiebreakerVendor: "grok",
      tiebreakerProvider: () => ({ vendor: "grok", text: "x" }),
    });
    expect(v.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyTrinity(v).ok).toBe(true);
    const tampered = { ...v, chosenVendor: "other" as const, chosenResponse: "EVIL TWIN" };
    expect(verifyTrinity(tampered).ok).toBe(false);
  });

  it("rollup measures tiebreak rate + cost saved across many verdicts", async () => {
    const vs = [];
    for (let i = 0; i < 10; i++) {
      const agree = i < 8;
      const v = await judgeWithTrinity({
        prompt: `q${i}`,
        taskClass: "fact_check",
        expectedFacts: [{ description: "contains x", mustContain: ["x"] }],
        consensusPair: [
          { vendor: "claude", text: agree ? "x" : "x", costUsd: 0.01 },
          { vendor: "chatgpt", text: agree ? "x" : "no", costUsd: 0.01 },
        ],
        tiebreakerVendor: "grok",
        tiebreakerProvider: () => ({ vendor: "grok", text: "x" }),
      });
      vs.push(v);
    }
    const r = rollupTrinity(vs);
    expect(r.totalVerdicts).toBe(10);
    expect(r.tiebreaksTriggered).toBe(2);
    expect(r.tiebreakRate).toBe(0.2);
    expect(r.totalCostSavedUsd).toBeGreaterThan(0);
  });

  it("measurable improvement: tiebreakRate stays low in normal use (claim: <30%)", async () => {
    // Simulate 100 prompts where the pair agrees 85% of the time.
    const vs = [];
    for (let i = 0; i < 100; i++) {
      const agree = i % 100 < 85;
      const v = await judgeWithTrinity({
        prompt: `q${i}`,
        taskClass: "fact_check",
        expectedFacts: [{ description: "contains x", mustContain: ["x"] }],
        consensusPair: [
          { vendor: "claude", text: "x" },
          { vendor: "chatgpt", text: agree ? "x" : "no" },
        ],
        tiebreakerVendor: "grok",
        tiebreakerProvider: () => ({ vendor: "grok", text: "x" }),
      });
      vs.push(v);
    }
    const r = rollupTrinity(vs);
    expect(r.tiebreakRate).toBeLessThan(0.30);
  });

  it("formatTrinityLine summarises", async () => {
    const v = await judgeWithTrinity({
      prompt: "x", taskClass: "other",
      expectedFacts: [{ description: "x", mustContain: ["x"] }],
      consensusPair: [
        { vendor: "claude", text: "x" },
        { vendor: "chatgpt", text: "x" },
      ],
      tiebreakerVendor: "grok",
      tiebreakerProvider: () => ({ vendor: "grok", text: "x" }),
    });
    expect(formatTrinityLine(v)).toContain("TRINITY");
  });
});
