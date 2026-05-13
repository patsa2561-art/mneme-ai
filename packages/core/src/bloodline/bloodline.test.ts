import { describe, it, expect } from "vitest";
import {
  createGenome,
  applyEvolutionaryPressure,
  batchApply,
  computeDnaFingerprint,
  personalityReport,
  formatBloodlinePulseLine,
  serializeGenome,
  parseGenome,
  PRESSURE,
  type BloodlineEvent,
} from "./index.js";

describe("v2.0 BLOODLINE · evolutionary pressure", () => {
  it("verified-good event reinforces fitness", () => {
    const g = createGenome();
    const s = applyEvolutionaryPressure(g, { id: "e1", ts: 1, kind: "verified-good", strainId: "redis", trace: "ok" });
    expect(s.fitness).toBeCloseTo(1.0 + PRESSURE.REINFORCE_BOOST, 5);
    expect(s.reinforced).toBeGreaterThan(0);
  });

  it("user-rejected event decays fitness multiplicatively", () => {
    const g = createGenome();
    applyEvolutionaryPressure(g, { id: "e1", ts: 1, kind: "verified-good", strainId: "redis", trace: "ok" });
    const before = g.strains.get("redis")!.fitness;
    applyEvolutionaryPressure(g, { id: "e2", ts: 2, kind: "user-rejected", strainId: "redis", trace: "no" });
    const after = g.strains.get("redis")!.fitness;
    expect(after).toBeLessThan(before);
    expect(after).toBeCloseTo(before * PRESSURE.DECAY_FACTOR, 5);
  });

  it("hallucination spawns vaccine variant counter + small bump", () => {
    const g = createGenome();
    applyEvolutionaryPressure(g, { id: "e1", ts: 1, kind: "hallucination", strainId: "phantom-fn", trace: "AI invented function" });
    const s = g.strains.get("phantom-fn")!;
    expect(s.vaccineVariants).toBe(1);
    expect(s.fitness).toBeGreaterThan(1.0);
  });

  it("apoptosed=true when fitness drops below threshold", () => {
    const g = createGenome();
    applyEvolutionaryPressure(g, { id: "init", ts: 1, kind: "verified-good", strainId: "x", trace: "ok" });
    // Crush it with many rejections
    for (let i = 0; i < 20; i++) {
      applyEvolutionaryPressure(g, { id: `r${i}`, ts: 10 + i, kind: "user-rejected", strainId: "x", trace: "no" });
    }
    expect(g.strains.get("x")!.apoptosed).toBe(true);
  });

  it("DNA fingerprint is deterministic + stable", () => {
    const g1 = createGenome();
    const events: BloodlineEvent[] = [
      { id: "a", ts: 1, kind: "verified-good", strainId: "x", trace: "" },
      { id: "b", ts: 2, kind: "user-rejected", strainId: "y", trace: "" },
    ];
    batchApply(g1, events);
    const dna1 = computeDnaFingerprint(g1);
    const g2 = createGenome();
    batchApply(g2, events);
    const dna2 = computeDnaFingerprint(g2);
    expect(dna1).toBe(dna2);
  });

  it("DNA fingerprint differs when EVENT ORDER differs", () => {
    const a: BloodlineEvent[] = [
      { id: "a", ts: 1, kind: "verified-good", strainId: "x", trace: "" },
      { id: "b", ts: 2, kind: "hallucination", strainId: "y", trace: "" },
    ];
    const b: BloodlineEvent[] = [
      { id: "b", ts: 2, kind: "hallucination", strainId: "y", trace: "" },
      { id: "a", ts: 1, kind: "verified-good", strainId: "x", trace: "" },
    ];
    const g1 = createGenome(); batchApply(g1, a);
    const g2 = createGenome(); batchApply(g2, b);
    expect(computeDnaFingerprint(g1)).not.toBe(computeDnaFingerprint(g2));
  });

  it("personalityReport produces sigma deviations against baseline", () => {
    const g = createGenome();
    applyEvolutionaryPressure(g, { id: "a", ts: 1, kind: "verified-good", strainId: "x", trace: "" });
    applyEvolutionaryPressure(g, { id: "b", ts: 2, kind: "verified-good", strainId: "x", trace: "" });
    applyEvolutionaryPressure(g, { id: "c", ts: 3, kind: "verified-good", strainId: "x", trace: "" });
    const r = personalityReport(g, { meanFitness: { x: 1.0 }, stdDev: { x: 0.05 } });
    expect(r.sigmaDeviations.length).toBeGreaterThan(0);
    expect(r.sigmaDeviations[0]!.strainId).toBe("x");
    expect(r.sigmaDeviations[0]!.sigma).toBeGreaterThan(2);
  });

  it("personalityReport summary mentions top deviation", () => {
    const g = createGenome();
    applyEvolutionaryPressure(g, { id: "a", ts: 1, kind: "verified-good", strainId: "x", trace: "" });
    const r = personalityReport(g, { meanFitness: { x: 1.0 }, stdDev: { x: 0.05 } });
    expect(r.summary).toContain("σ");
  });

  it("formatBloodlinePulseLine produces compact summary", () => {
    const g = createGenome();
    applyEvolutionaryPressure(g, { id: "a", ts: 1, kind: "verified-good", strainId: "x", trace: "" });
    const line = formatBloodlinePulseLine(g);
    expect(line).toContain("BLOODLINE");
    expect(line).toContain("DNA=");
  });

  it("serialize → parse round-trip", () => {
    const g = createGenome();
    applyEvolutionaryPressure(g, { id: "a", ts: 1, kind: "verified-good", strainId: "x", trace: "" });
    const text = serializeGenome(g);
    const parsed = parseGenome(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.strains.get("x")?.fitness).toBeCloseTo(1.10, 5);
    expect(parsed!.history.length).toBe(1);
  });
});
