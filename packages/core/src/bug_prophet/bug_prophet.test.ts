import { describe, it, expect } from "vitest";
import { prophesy, formatBugProphetLine } from "./index.js";

describe("v2.15.1 · MNEME BUG PROPHET — pre-bug detection", () => {
  it("baseline empty corpora → low_risk verdict", async () => {
    const r = await prophesy({ change: { description: "add a getter" }, stubs: {} });
    expect(r.verdict).toBe("low_risk");
    expect(r.regressionRisk).toBeLessThan(0.25);
    expect(r.sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("SOUL scar match → high_risk", async () => {
    const r = await prophesy({
      change: { description: "deploy on Friday afternoon" },
      stubs: {
        soulFindings: { findings: [{ category: "scars", ruleId: "no-friday-deploys", severity: "block" }] },
      },
    });
    expect(["high_risk", "very_high_risk"]).toContain(r.verdict);
    expect(r.evidence.some((e) => e.source === "soul_scar")).toBe(true);
  });

  it("HIVE pattern with 80% bad outcomes → very_high_risk", async () => {
    const r = await prophesy({
      change: { description: "refactor auth flow" },
      stubs: {
        hiveLookup: {
          totalObservations: 20,
          byOutcome: { good: 4, bad: 12, regression: 4, unknown: 0 },
        },
      },
    });
    expect(["high_risk", "very_high_risk"]).toContain(r.verdict);
    expect(r.evidence.some((e) => e.source === "hive_regression")).toBe(true);
  });

  it("BOUNTY high vendor falseRateLB → adds evidence + bumps risk", async () => {
    const a = await prophesy({
      change: { description: "small typo fix", proposedBy: "claude" },
      stubs: { bountyFalseRateLB: 0.6 },
    });
    const b = await prophesy({
      change: { description: "small typo fix", proposedBy: "claude" },
      stubs: { bountyFalseRateLB: 0.0 },
    });
    expect(a.regressionRisk).toBeGreaterThan(b.regressionRisk);
    expect(a.evidence.some((e) => e.source === "bounty_trust")).toBe(true);
  });

  it("compounding evidence: scar + replica bad + hive bad → very_high_risk", async () => {
    const r = await prophesy({
      change: { description: "deploy on Friday", proposedBy: "claude" },
      stubs: {
        soulFindings: { findings: [{ category: "scars", ruleId: "friday-deploy-incident", severity: "block" }] },
        replicaSimilarBad: [{ question: "Friday afternoon deploy?", action: "shipped anyway" }],
        hiveLookup: { totalObservations: 10, byOutcome: { good: 2, bad: 6, regression: 2, unknown: 0 } },
        bountyFalseRateLB: 0.4,
      },
    });
    expect(r.verdict).toBe("very_high_risk");
    expect(r.regressionRisk).toBeGreaterThan(0.7);
  });

  it("mitigations include scar-specific advice when scar evidence present", async () => {
    const r = await prophesy({
      change: { description: "Friday deploy" },
      stubs: { soulFindings: { findings: [{ category: "scars", ruleId: "x", severity: "block" }] } },
    });
    expect(r.mitigations.some((m) => /scar|past self/i.test(m))).toBe(true);
  });

  it("complexity heuristic surfaces evidence at score > 0.5", async () => {
    const lots = Array.from({ length: 250 }, (_, i) =>
      `function f${i}() { if (x) { for (let j = 0; j < 10; j++) try { call(); } catch (e) {} } }`
    ).join("\n");
    const r = await prophesy({
      change: { description: "big refactor", content: lots, files: Array.from({ length: 10 }, (_, i) => `src/${i}.ts`) },
      stubs: { complexityScore: 0.8 },
    });
    expect(r.evidence.some((e) => e.source === "complexity")).toBe(true);
  });

  it("low confidence on empty corpora (≤0.55)", async () => {
    const r = await prophesy({ change: { description: "x" }, stubs: {} });
    expect(r.confidence).toBeLessThanOrEqual(0.55);
  });

  it("confidence rises with richer corpora", async () => {
    const r = await prophesy({
      change: { description: "x" },
      stubs: {
        soulFindings: { findings: [] },
        replicaBadCount: 50,
        hiveLookup: { totalObservations: 100, byOutcome: { good: 80, bad: 10, regression: 10, unknown: 0 } },
      },
    });
    expect(r.confidence).toBeGreaterThan(0.55);
  });

  it("HMAC sig on full report", async () => {
    const r = await prophesy({ change: { description: "x" }, stubs: {} });
    expect(r.sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("formatBugProphetLine summarises", async () => {
    const r = await prophesy({ change: { description: "x" }, stubs: {} });
    expect(formatBugProphetLine(r)).toContain("BUG PROPHET");
    expect(formatBugProphetLine(r)).toContain("%");
  });

  it("verdict buckets are monotonic with risk", async () => {
    const lo = await prophesy({ change: { description: "noop" }, stubs: {} });
    const hi = await prophesy({
      change: { description: "deploy on Friday", proposedBy: "claude" },
      stubs: {
        soulFindings: { findings: [{ category: "scars", ruleId: "x", severity: "block" }] },
        hiveLookup: { totalObservations: 20, byOutcome: { good: 1, bad: 15, regression: 4, unknown: 0 } },
        bountyFalseRateLB: 0.6,
      },
    });
    expect(hi.regressionRisk).toBeGreaterThan(lo.regressionRisk);
  });
});
