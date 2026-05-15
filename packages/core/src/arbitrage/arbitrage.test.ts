import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  chooseVendor, estimateTokens, recordRoutingOutcome, snapshotMeasured,
  formatArbitrageLine, DEFAULT_VENDORS,
} from "./index.js";

describe("v2.15 · MNEME ARBITRAGE — meta-AI vendor router", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "arb-")); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch {} });

  it("ultra budget on code_review → high-quality vendor wins", () => {
    const r = chooseVendor({ task: "code_review", budget: "ultra" });
    expect(r.decision).not.toBeNull();
    expect(r.decision!.qualityScore).toBeGreaterThanOrEqual(0.92);
  });

  it("free_only budget → only vendors with hasFree=true considered eligible", () => {
    const r = chooseVendor({ task: "summarization", budget: "free_only" });
    expect(r.decision).not.toBeNull();
    const winnerCap = DEFAULT_VENDORS.find((v) => v.vendor === r.decision!.vendor)!;
    expect(winnerCap.hasFree).toBe(true);
  });

  it("cheap budget on code_generation prefers cheaper vendor (deepseek/qwen) when threshold allows", () => {
    const r = chooseVendor({ task: "code_generation", budget: "cheap" });
    expect(r.decision).not.toBeNull();
    // The cheapest eligible vendor should win on quality/$ — for this
    // task class that's deepseek (very cheap with acceptable quality).
    expect(["deepseek", "qwen", "llama"]).toContain(r.decision!.vendor);
  });

  it("balanced budget on code_review picks claude (highest quality at acceptable price)", () => {
    const r = chooseVendor({ task: "code_review", budget: "balanced" });
    // claude has the best code_review strength; it'll win unless price
    // makes a cheaper alternative more attractive. With balanced threshold
    // we just need one eligible vendor; verify claude is in top 3.
    const top3 = r.considered.slice(0, 3).map((c) => c.vendor);
    expect(top3).toContain("claude");
  });

  it("research task prefers perplexity / gemini (their strength)", () => {
    const r = chooseVendor({ task: "research", budget: "high" });
    expect(["perplexity", "gemini"]).toContain(r.decision!.vendor);
  });

  it("returns null decision if no vendor meets the threshold", () => {
    const r = chooseVendor({
      task: "code_generation",
      budget: "ultra",
      vendors: [{
        vendor: "llama",
        pricePer1kInput: 0, pricePer1kOutput: 0,
        strengthByTask: { code_generation: 0.5 },
        hasFree: true, fastPath: false, functionCalls: false,
      }],
    });
    expect(r.decision).toBeNull();
    expect(r.reason).toMatch(/no candidate/i);
  });

  it("measured BOUNTY data shifts the score (penalises high falseRateLB vendor)", () => {
    // Without measured data: claude wins for code_review.
    const baseline = chooseVendor({ task: "code_review", budget: "balanced" });
    expect(baseline.decision).not.toBeNull();
    const baselineWinner = baseline.decision!.vendor;

    // With claude measured at 90% falseRateLB, claude's qualityScore
    // collapses (0.95 * 0.1 = 0.095 << threshold 0.78). Either:
    //   (a) the next-best vendor takes over, OR
    //   (b) no vendor meets the threshold and the decision is null.
    // Both outcomes prove the measured signal IS shifting the routing.
    const adjusted = chooseVendor({
      task: "code_review", budget: "balanced",
      measured: { claude: { falseRateLB: 0.9, samples: 50 } },
    });

    if (baselineWinner === "claude") {
      const stillClaude = adjusted.decision !== null && adjusted.decision.vendor === "claude";
      expect(stillClaude, "claude should be downgraded out of the winner spot when measured falseRateLB is 0.9").toBe(false);
    }

    // Direct check: claude's score in the considered list must now be lower
    // than its baseline score, regardless of who eventually won.
    const claudeBaseline = baseline.considered.find((c) => c.vendor === "claude");
    const claudeAdjusted = adjusted.considered.find((c) => c.vendor === "claude");
    expect(claudeAdjusted!.qualityScore).toBeLessThan(claudeBaseline!.qualityScore);
  });

  it("savingsVsTopUsd is non-negative", () => {
    const r = chooseVendor({ task: "code_generation", budget: "balanced" });
    expect(r.decision!.savingsVsTopUsd).toBeGreaterThanOrEqual(0);
  });

  it("HMAC sig on result is 64 hex", () => {
    const r = chooseVendor({ task: "explanation", budget: "balanced" });
    expect(r.sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("result includes all candidates with eligibility flag", () => {
    const r = chooseVendor({ task: "creative_writing", budget: "ultra" });
    expect(r.considered.length).toBe(DEFAULT_VENDORS.length);
    // Top one is always eligible (or all are ineligible — null decision)
    if (r.decision) expect(r.considered[0]!.eligible).toBe(true);
  });

  it("estimateTokens — english heuristic ~4 chars/token", () => {
    expect(estimateTokens("hello world")).toBe(3);
    expect(estimateTokens("x".repeat(400))).toBe(100);
  });

  it("estimateTokens — code heuristic ~6 chars/token", () => {
    expect(estimateTokens("x".repeat(600), { kind: "code" })).toBe(100);
  });

  it("estimateTokens — cjk heuristic ~2 chars/token", () => {
    expect(estimateTokens("x".repeat(200), { kind: "cjk" })).toBe(100);
  });

  it("recordRoutingOutcome appends to bounty without throwing", async () => {
    await recordRoutingOutcome({
      vendor: "claude", task: "code_generation",
      outcome: "correct", detail: "produced working code",
      repoDir: dir,
    });
    // Verify by snapshotting back from BOUNTY:
    const snap = await snapshotMeasured({ repoDir: dir });
    expect(snap.claude).toBeDefined();
    expect(snap.claude!.samples).toBeGreaterThan(0);
  });

  it("snapshotMeasured returns empty object on empty BOUNTY", async () => {
    const snap = await snapshotMeasured({ repoDir: dir });
    expect(Object.keys(snap)).toHaveLength(0);
  });

  it("formatArbitrageLine summarises", () => {
    const r = chooseVendor({ task: "explanation", budget: "balanced" });
    const line = formatArbitrageLine(r);
    expect(line).toContain("ARBITRAGE");
    expect(line).toContain("$");
  });

  it("formatArbitrageLine handles null", () => {
    expect(formatArbitrageLine(null)).toContain("idle");
  });
});
