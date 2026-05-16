import { describe, it, expect } from "vitest";
import { vendorMultiplier, buildMarketBoard, verifyMarketBoard, quotePremium, formatInsuranceLine } from "./index.js";

describe("v2.19 · MNEME INSURANCE MARKET — per-vendor premium multiplier", () => {
  it("clean established vendor earns discount (mult < 1)", () => {
    const vm = vendorMultiplier({ vendor: "claude", falseRateLB: 0.02, totalSamples: 5000 });
    expect(vm.multiplier).toBeLessThan(1.0);
    expect(vm.multiplier).toBeGreaterThanOrEqual(0.5);
  });

  it("dirty established vendor pays surcharge (mult > 1)", () => {
    const vm = vendorMultiplier({ vendor: "other", falseRateLB: 0.15, totalSamples: 5000 });
    expect(vm.multiplier).toBeGreaterThan(1.0);
  });

  it("unknown vendor gets under-measured penalty", () => {
    const measured = vendorMultiplier({ vendor: "grok", falseRateLB: 0.05, totalSamples: 5000 });
    const newcomer = vendorMultiplier({ vendor: "grok", falseRateLB: 0.05, totalSamples: 5 });
    expect(newcomer.multiplier).toBeGreaterThan(measured.multiplier);
    expect(newcomer.reasons.some((r) => r.includes("under-measured"))).toBe(true);
  });

  it("multiplier is clamped to [0.5, 3.0]", () => {
    const tooLow = vendorMultiplier({ vendor: "claude", falseRateLB: 0.0, totalSamples: 100_000 });
    expect(tooLow.multiplier).toBeGreaterThanOrEqual(0.5);
    const tooHigh = vendorMultiplier({ vendor: "other", falseRateLB: 0.99, totalSamples: 100_000 });
    expect(tooHigh.multiplier).toBeLessThanOrEqual(3.0);
  });

  it("works for every supported vendor", () => {
    const vendors = ["claude", "chatgpt", "gemini", "cursor", "copilot", "codex", "llama", "mistral", "qwen", "deepseek", "grok", "perplexity", "other"] as const;
    for (const v of vendors) {
      const vm = vendorMultiplier({ vendor: v, falseRateLB: 0.05, totalSamples: 1000 });
      expect(vm.vendor).toBe(v);
      expect(vm.multiplier).toBeGreaterThanOrEqual(0.5);
      expect(vm.multiplier).toBeLessThanOrEqual(3.0);
    }
  });

  it("market board is signed + verifiable", () => {
    const b = buildMarketBoard([
      { vendor: "claude", falseRateLB: 0.02, totalSamples: 5000 },
      { vendor: "chatgpt", falseRateLB: 0.04, totalSamples: 5000 },
      { vendor: "grok", falseRateLB: 0.08, totalSamples: 50 },
    ]);
    expect(b.sig).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyMarketBoard(b)).toBe(true);
    expect(b.multipliers[0]!.multiplier).toBeLessThanOrEqual(b.multipliers[b.multipliers.length - 1]!.multiplier);
  });

  it("market board detects tampering", () => {
    const b = buildMarketBoard([{ vendor: "claude", falseRateLB: 0.02, totalSamples: 5000 }]);
    const tampered = { ...b, multipliers: [{ ...b.multipliers[0]!, multiplier: 0.01 }] };
    expect(verifyMarketBoard(tampered)).toBe(false);
  });

  it("quotePremium multiplies tier base by vendor multiplier", () => {
    const b = buildMarketBoard([{ vendor: "claude", falseRateLB: 0.02, totalSamples: 5000 }]);
    const q = quotePremium({ vendor: "claude", tier: "team", board: b });
    expect(q.baseAnnualPremiumUsd).toBe(8400); // ORACLE v2.18 team tier
    expect(q.finalAnnualPremiumUsd).toBe(Math.round(8400 * q.multiplier));
    expect(q.multiplier).toBeLessThan(1.0); // good vendor
  });

  it("quotePremium defaults to x1.5 when vendor missing from board", () => {
    const b = buildMarketBoard([{ vendor: "claude", falseRateLB: 0.02, totalSamples: 5000 }]);
    const q = quotePremium({ vendor: "grok", tier: "starter", board: b });
    expect(q.multiplier).toBe(1.5);
    expect(q.reasons.some((r) => r.includes("not in market board"))).toBe(true);
  });

  it("measurable improvement: cheap vendor pays LESS than expensive vendor at same tier", () => {
    const b = buildMarketBoard([
      { vendor: "claude", falseRateLB: 0.02, totalSamples: 5000 }, // cheap
      { vendor: "other",  falseRateLB: 0.20, totalSamples: 5000 }, // expensive
    ]);
    const cheap = quotePremium({ vendor: "claude", tier: "business", board: b });
    const expensive = quotePremium({ vendor: "other", tier: "business", board: b });
    expect(cheap.finalAnnualPremiumUsd).toBeLessThan(expensive.finalAnnualPremiumUsd);
  });

  it("formatInsuranceLine summarises", () => {
    const b = buildMarketBoard([{ vendor: "claude", falseRateLB: 0.02, totalSamples: 5000 }]);
    const q = quotePremium({ vendor: "claude", tier: "team", board: b });
    expect(formatInsuranceLine(q)).toContain("INSURANCE");
    expect(formatInsuranceLine(q)).toContain("claude");
  });
});
