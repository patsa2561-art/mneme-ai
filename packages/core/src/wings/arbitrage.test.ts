import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { recommendRoute, recordTrial, listCosts, listTrials } from "./arbitrage.js";

function seedCosts(repo: string, costs: object[]): void {
  mkdirSync(join(repo, ".mneme"), { recursive: true });
  writeFileSync(join(repo, ".mneme/vendor-costs.jsonl"), costs.map((c) => JSON.stringify(c)).join("\n") + "\n");
}

function seedTrials(repo: string, trials: object[]): void {
  mkdirSync(join(repo, ".mneme"), { recursive: true });
  writeFileSync(join(repo, ".mneme/vendor-trials.jsonl"), trials.map((t) => JSON.stringify(t)).join("\n") + "\n");
}

describe("wings/arbitrage · empty / cold start", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-arb-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("returns no recommendation when no costs on disk", () => {
    const r = recommendRoute(repo, "code-edit", 1000, 500);
    expect(r.recommended).toBeNull();
    expect(r.reasoning).toContain("no vendor costs");
  });

  it("uses 0.5 cold-start prior when no trials for any vendor", () => {
    seedCosts(repo, [{ vendor: "v1", model: "m1", perMTokIn: 1, perMTokOut: 2 }]);
    const r = recommendRoute(repo, "code-edit", 1_000_000, 1_000_000);
    expect(r.recommended).not.toBeNull();
    expect(r.recommended!.successRateLB).toBe(0.5);
    expect(r.recommended!.trialsSeen).toBe(0);
  });
});

describe("wings/arbitrage · cost computation", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-arb-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("computes per-million-token cost correctly", () => {
    seedCosts(repo, [{ vendor: "v1", model: "m1", perMTokIn: 5, perMTokOut: 15 }]);
    const r = recommendRoute(repo, "x", 1_000_000, 1_000_000);
    expect(r.recommended!.estCostUsd).toBeCloseTo(20, 4); // 5 + 15
  });

  it("scales linearly below a million", () => {
    seedCosts(repo, [{ vendor: "v1", model: "m1", perMTokIn: 5, perMTokOut: 15 }]);
    const r = recommendRoute(repo, "x", 100_000, 100_000);
    expect(r.recommended!.estCostUsd).toBeCloseTo(2, 4);
  });
});

describe("wings/arbitrage · success-rate weighting", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-arb-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("100%-success expensive vendor beats 30%-success cheap vendor on effective cost", () => {
    seedCosts(repo, [
      { vendor: "cheap", model: "c", perMTokIn: 1, perMTokOut: 1 },
      { vendor: "premium", model: "p", perMTokIn: 5, perMTokOut: 5 },
    ]);
    const trials: object[] = [];
    // 30 cheap-vendor trials: 9 success, 21 fail (30%)
    for (let i = 0; i < 9; i++) trials.push({ vendor: "cheap", taskClass: "code", outcome: "success", tokensIn: 0, tokensOut: 0, at: new Date(Date.now() - i * 60000).toISOString() });
    for (let i = 0; i < 21; i++) trials.push({ vendor: "cheap", taskClass: "code", outcome: "fail", tokensIn: 0, tokensOut: 0, at: new Date(Date.now() - (i + 9) * 60000).toISOString() });
    // 30 premium-vendor trials: all success (100%)
    for (let i = 0; i < 30; i++) trials.push({ vendor: "premium", taskClass: "code", outcome: "success", tokensIn: 0, tokensOut: 0, at: new Date(Date.now() - i * 60000).toISOString() });
    seedTrials(repo, trials);
    const r = recommendRoute(repo, "code", 1_000_000, 1_000_000);
    expect(r.recommended!.vendor).toBe("premium");
  });

  it("Wilson LB penalizes low-sample vendors", () => {
    seedCosts(repo, [
      { vendor: "low-sample", model: "x", perMTokIn: 1, perMTokOut: 1 },
      { vendor: "high-sample", model: "y", perMTokIn: 1, perMTokOut: 1 },
    ]);
    seedTrials(repo, [
      { vendor: "low-sample", taskClass: "x", outcome: "success", tokensIn: 0, tokensOut: 0, at: new Date().toISOString() },
      ...Array.from({ length: 50 }, (_, i) => ({ vendor: "high-sample", taskClass: "x", outcome: "success", tokensIn: 0, tokensOut: 0, at: new Date(Date.now() - i * 60000).toISOString() })),
    ]);
    const r = recommendRoute(repo, "x", 1_000_000, 1_000_000);
    const low = r.candidates.find((c) => c.vendor === "low-sample")!;
    const high = r.candidates.find((c) => c.vendor === "high-sample")!;
    expect(high.successRateLB).toBeGreaterThan(low.successRateLB);
  });

  it("0% success rate yields infinite effective cost (vendor unusable)", () => {
    seedCosts(repo, [{ vendor: "broken", model: "x", perMTokIn: 1, perMTokOut: 1 }]);
    seedTrials(repo, Array.from({ length: 30 }, (_, i) => ({
      vendor: "broken", taskClass: "x", outcome: "fail", tokensIn: 0, tokensOut: 0, at: new Date(Date.now() - i * 60000).toISOString(),
    })));
    const r = recommendRoute(repo, "x", 1_000_000, 1_000_000);
    expect(r.recommended).toBeNull();
    expect(r.reasoning).toContain("0");
  });
});

describe("wings/arbitrage · diversity tie-breaker", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-arb-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("picks least-recently-used vendor when 2 within 10%", () => {
    seedCosts(repo, [
      { vendor: "recent", model: "x", perMTokIn: 1, perMTokOut: 1 },
      { vendor: "stale", model: "y", perMTokIn: 1, perMTokOut: 1 },
    ]);
    const now = Date.now();
    const trials: object[] = [];
    for (let i = 0; i < 30; i++) trials.push({ vendor: "recent", taskClass: "x", outcome: "success", tokensIn: 0, tokensOut: 0, at: new Date(now - i * 60000).toISOString() });
    for (let i = 0; i < 30; i++) trials.push({ vendor: "stale", taskClass: "x", outcome: "success", tokensIn: 0, tokensOut: 0, at: new Date(now - 30 * 86400000 - i * 60000).toISOString() });
    seedTrials(repo, trials);
    const r = recommendRoute(repo, "x", 1000, 1000);
    expect(r.recommended!.vendor).toBe("stale");
    expect(r.recommended!.diversityPick).toBe(true);
  });

  it("does NOT pick diversity when costs differ > 10%", () => {
    seedCosts(repo, [
      { vendor: "cheap", model: "x", perMTokIn: 1, perMTokOut: 1 },
      { vendor: "expensive", model: "y", perMTokIn: 5, perMTokOut: 5 },
    ]);
    const trials: object[] = [];
    const now = Date.now();
    for (let i = 0; i < 30; i++) trials.push({ vendor: "cheap", taskClass: "x", outcome: "success", tokensIn: 0, tokensOut: 0, at: new Date(now - i * 60000).toISOString() });
    for (let i = 0; i < 30; i++) trials.push({ vendor: "expensive", taskClass: "x", outcome: "success", tokensIn: 0, tokensOut: 0, at: new Date(now - 30 * 86400000 - i * 60000).toISOString() });
    seedTrials(repo, trials);
    const r = recommendRoute(repo, "x", 1000, 1000);
    expect(r.recommended!.vendor).toBe("cheap");
    expect(r.recommended!.diversityPick).toBe(false);
  });
});

describe("wings/arbitrage · recordTrial round-trip", () => {
  let repo: string;
  beforeEach(() => { repo = mkdtempSync(join(tmpdir(), "mneme-arb-")); });
  afterEach(() => { try { rmSync(repo, { recursive: true, force: true }); } catch { /* */ } });

  it("recordTrial appends to trials.jsonl and survives readback", () => {
    recordTrial(repo, { vendor: "v1", taskClass: "t", outcome: "success", tokensIn: 100, tokensOut: 200 });
    recordTrial(repo, { vendor: "v1", taskClass: "t", outcome: "fail", tokensIn: 0, tokensOut: 0 });
    const trials = listTrials(repo);
    expect(trials).toHaveLength(2);
    expect(trials[0]!.outcome).toBe("success");
    expect(trials[1]!.outcome).toBe("fail");
  });

  it("listCosts returns empty when file absent", () => {
    expect(listCosts(repo)).toEqual([]);
  });
});
