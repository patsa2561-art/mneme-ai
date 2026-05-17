import { describe, it, expect } from "vitest";
import {
  jaccardSimilarity,
  runSleepCycle,
  verifyCycleReport,
  applyWeightUpdates,
  morningDigest,
  formatSleepCycleLine,
  type YesterdayPrediction,
  type YesterdayActualCall,
  type PatternWeight,
} from "./index.js";

const SECRET = "sleep-training-test-secret-997744";

function pred(patternId: string, eventSig: string, tool: string, conf: number, ts = 1): YesterdayPrediction {
  return { patternId, eventSig, predictedTool: tool, confidenceAtPrediction: conf, ts };
}

function act(eventSig: string, tool: string, ts = 1): YesterdayActualCall {
  return { eventSig, toolName: tool, ts };
}

describe("v2.19.25 SLEEP TRAINING · jaccardSimilarity (canonical fitness function)", () => {
  it("identical sets -> 1.0", () => {
    expect(jaccardSimilarity(["a", "b"], ["a", "b"])).toBe(1.0);
  });
  it("disjoint sets -> 0.0", () => {
    expect(jaccardSimilarity(["a"], ["b"])).toBe(0.0);
  });
  it("both empty -> 1.0 (vacuous match)", () => {
    expect(jaccardSimilarity([], [])).toBe(1.0);
  });
  it("one empty -> 0.0", () => {
    expect(jaccardSimilarity(["a"], [])).toBe(0.0);
    expect(jaccardSimilarity([], ["b"])).toBe(0.0);
  });
  it("partial overlap (2/3) -> 0.667", () => {
    // {a,b,c} ∩ {b,c,d} = {b,c} = 2; union = 4; 2/4 = 0.5
    expect(jaccardSimilarity(["a", "b", "c"], ["b", "c", "d"])).toBeCloseTo(0.5, 5);
  });
  it("duplicate elements are deduplicated (set semantics)", () => {
    expect(jaccardSimilarity(["a", "a", "b"], ["a", "b"])).toBe(1.0);
  });
});

describe("v2.19.25 SLEEP TRAINING · runSleepCycle (the brain)", () => {
  it("perfect prediction -> jaccard 1.0; positive delta if conf < 1", () => {
    const r = runSleepCycle({
      yesterdayPredictions: [pred("p1", "sigA", "mneme.ask", 0.5)],
      yesterdayActualCalls: [act("sigA", "mneme.ask")],
      cycleAt: 1_000_000,
      secret: SECRET,
    });
    expect(r.patternFitness.length).toBe(1);
    expect(r.patternFitness[0]!.jaccard).toBe(1.0);
    expect(r.patternFitness[0]!.confidenceDelta).toBeGreaterThan(0);
  });

  it("wrong prediction -> jaccard 0.0; negative delta", () => {
    const r = runSleepCycle({
      yesterdayPredictions: [pred("p1", "sigA", "mneme.WRONG", 0.8)],
      yesterdayActualCalls: [act("sigA", "mneme.RIGHT")],
      cycleAt: 0,
      secret: SECRET,
    });
    expect(r.patternFitness[0]!.jaccard).toBe(0.0);
    expect(r.patternFitness[0]!.confidenceDelta).toBeLessThan(0);
  });

  it("learningRate 0 -> no weight movement; learningRate 1 -> jump to jaccard", () => {
    const preds = [pred("p1", "sigA", "x", 0.5)];
    const acts = [act("sigA", "x")];
    const zero = runSleepCycle({ yesterdayPredictions: preds, yesterdayActualCalls: acts, cycleAt: 0, learningRate: 0, secret: SECRET });
    expect(zero.patternFitness[0]!.confidenceDelta).toBe(0);
    const one = runSleepCycle({ yesterdayPredictions: preds, yesterdayActualCalls: acts, cycleAt: 0, learningRate: 1, secret: SECRET });
    expect(one.patternFitness[0]!.confidenceDelta).toBe(0.5); // (1.0 - 0.5) × 1 = 0.5
  });

  it("hit rate = mean jaccard across all pattern fitness cells", () => {
    const r = runSleepCycle({
      yesterdayPredictions: [
        pred("p1", "sigA", "x", 0.5),
        pred("p2", "sigB", "y", 0.5),
      ],
      yesterdayActualCalls: [
        act("sigA", "x"), // p1 perfect
        act("sigB", "z"), // p2 wrong
      ],
      cycleAt: 0,
      secret: SECRET,
    });
    expect(r.hitRate).toBeCloseTo((1.0 + 0.0) / 2, 5);
  });

  it("hitRateDelta against previous cycle (trajectory)", () => {
    const r = runSleepCycle({
      yesterdayPredictions: [pred("p1", "sigA", "x", 0.5)],
      yesterdayActualCalls: [act("sigA", "x")],
      previousHitRate: 0.2,
      cycleAt: 0,
      secret: SECRET,
    });
    expect(r.hitRate).toBe(1.0);
    expect(r.hitRateDelta).toBe(0.8);
  });

  it("multiple predictions per (pattern, sig) cell accumulate; max-jaccard tool set", () => {
    const r = runSleepCycle({
      yesterdayPredictions: [
        pred("p1", "sigA", "x", 0.5),
        pred("p1", "sigA", "y", 0.5),
        pred("p1", "sigA", "z", 0.5),
      ],
      yesterdayActualCalls: [
        act("sigA", "x"), act("sigA", "y"),
      ],
      cycleAt: 0,
      secret: SECRET,
    });
    // predicted={x,y,z}; actual={x,y}; jaccard = 2/3 ≈ 0.667
    expect(r.patternFitness[0]!.jaccard).toBeCloseTo(2 / 3, 5);
    expect(r.patternFitness[0]!.predictionCount).toBe(3);
  });

  it("HMAC sig verifies untampered; rejects tamper", () => {
    const r = runSleepCycle({
      yesterdayPredictions: [pred("p1", "sigA", "x", 0.5)],
      yesterdayActualCalls: [act("sigA", "x")],
      cycleAt: 0,
      secret: SECRET,
    });
    expect(verifyCycleReport(r, SECRET)).toBe(true);
    expect(verifyCycleReport({ ...r, hitRate: 0.99 }, SECRET)).toBe(false);
  });

  it("MEASURED 100% determinism: same input -> same sig (30 trials)", () => {
    const input = {
      yesterdayPredictions: [pred("p1", "sigA", "x", 0.5), pred("p2", "sigB", "y", 0.3)],
      yesterdayActualCalls: [act("sigA", "x"), act("sigB", "z")],
      cycleAt: 1_000_000,
      secret: SECRET,
    };
    const firstSig = runSleepCycle(input).sig;
    let allEqual = true;
    for (let i = 0; i < 30; i++) {
      if (runSleepCycle(input).sig !== firstSig) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });
});

describe("v2.19.25 SLEEP TRAINING · applyWeightUpdates (clamp + accumulate)", () => {
  it("positive delta -> confidence climbs (clamped to 1.0)", () => {
    const patterns: PatternWeight[] = [{ patternId: "p1", confidence: 0.5 }];
    const report = runSleepCycle({
      yesterdayPredictions: [pred("p1", "sigA", "x", 0.5)],
      yesterdayActualCalls: [act("sigA", "x")],
      cycleAt: 0,
      learningRate: 1,
      secret: SECRET,
    });
    const { updated, changes } = applyWeightUpdates({ patterns, report });
    expect(updated[0]!.confidence).toBe(1.0);
    expect(changes[0]!.before).toBe(0.5);
    expect(changes[0]!.after).toBe(1.0);
    expect(changes[0]!.delta).toBe(0.5);
  });

  it("negative delta -> confidence drops (clamped to 0.01)", () => {
    const patterns: PatternWeight[] = [{ patternId: "p1", confidence: 0.5 }];
    const report = runSleepCycle({
      yesterdayPredictions: [pred("p1", "sigA", "wrong", 0.5)],
      yesterdayActualCalls: [act("sigA", "right")],
      cycleAt: 0,
      learningRate: 1,
      secret: SECRET,
    });
    const { updated } = applyWeightUpdates({ patterns, report });
    expect(updated[0]!.confidence).toBeLessThan(0.5);
  });

  it("unknown patternId starts at neutral 0.5 then adjusts", () => {
    const report = runSleepCycle({
      yesterdayPredictions: [pred("brand_new_pattern", "sigA", "x", 0.5)],
      yesterdayActualCalls: [act("sigA", "x")],
      cycleAt: 0,
      learningRate: 1,
      secret: SECRET,
    });
    const { updated } = applyWeightUpdates({ patterns: [], report });
    expect(updated.length).toBe(1);
    expect(updated[0]!.patternId).toBe("brand_new_pattern");
    expect(updated[0]!.confidence).toBeCloseTo(1.0, 5);
  });

  it("multiple eventSigs for same pattern -> deltas accumulate", () => {
    // pattern p1 fires for sigA (right) AND sigB (wrong) on the same night
    const report = runSleepCycle({
      yesterdayPredictions: [
        pred("p1", "sigA", "x", 0.5),
        pred("p1", "sigB", "y", 0.5),
      ],
      yesterdayActualCalls: [
        act("sigA", "x"),       // sigA: jaccard 1.0; delta +0.5
        act("sigB", "DIFFERENT"), // sigB: jaccard 0.0; delta -0.5
      ],
      cycleAt: 0,
      learningRate: 1,
      secret: SECRET,
    });
    const { updated } = applyWeightUpdates({ patterns: [{ patternId: "p1", confidence: 0.5 }], report });
    // deltas sum to 0; confidence stays at 0.5
    expect(updated[0]!.confidence).toBeCloseTo(0.5, 5);
  });
});

describe("v2.19.25 SLEEP TRAINING · MEASURED 30-night hit-rate trajectory (compounding)", () => {
  it("MEASURED hit rate climbs from ~20% (day 1) to >=70% (day 30) when ineffective patterns are filtered out by confidence threshold", () => {
    // Realistic scenario: 5 patterns compete per event sig — 2 correct + 3 wrong.
    // Caller filters: only fire patterns with confidence >= 0.4 each day.
    // SLEEP TRAINING penalises wrong patterns nightly; their confidence drops
    // below threshold; they stop firing; hit rate climbs as noise filtered out.
    const TRUTH_TOOLS = { sigA: "mneme.ask", sigB: "mneme.why" };
    let patterns: PatternWeight[] = [
      // Correct patterns
      { patternId: "good_A", confidence: 0.5 },
      { patternId: "good_B", confidence: 0.5 },
      // Wrong patterns (different tool from truth)
      { patternId: "noise_A1", confidence: 0.5 },
      { patternId: "noise_A2", confidence: 0.5 },
      { patternId: "noise_B1", confidence: 0.5 },
    ];
    const patternBehavior: Record<string, { sig: keyof typeof TRUTH_TOOLS; tool: string }> = {
      good_A:   { sig: "sigA", tool: "mneme.ask" },
      good_B:   { sig: "sigB", tool: "mneme.why" },
      noise_A1: { sig: "sigA", tool: "mneme.noise1" },
      noise_A2: { sig: "sigA", tool: "mneme.noise2" },
      noise_B1: { sig: "sigB", tool: "mneme.noise3" },
    };
    const FIRE_THRESHOLD = 0.4;
    let previousHitRate = 0;
    let hitRateDay1 = 0;
    let hitRateDay30 = 0;
    for (let day = 1; day <= 30; day++) {
      // Day's predictions: only patterns with confidence >= threshold fire.
      const preds: YesterdayPrediction[] = [];
      for (const p of patterns) {
        if (p.confidence < FIRE_THRESHOLD) continue;
        const b = patternBehavior[p.patternId]!;
        for (let i = 0; i < 5; i++) {
          preds.push(pred(p.patternId, b.sig, b.tool, p.confidence, day * 1000 + i));
        }
      }
      const acts: YesterdayActualCall[] = [];
      for (let i = 0; i < 5; i++) {
        acts.push(act("sigA", TRUTH_TOOLS.sigA, day * 1000 + i));
        acts.push(act("sigB", TRUTH_TOOLS.sigB, day * 1000 + i + 100));
      }
      const report = runSleepCycle({
        yesterdayPredictions: preds,
        yesterdayActualCalls: acts,
        previousHitRate,
        cycleAt: day * 86400 * 1000,
        learningRate: 0.3,
        secret: SECRET,
      });
      const updated = applyWeightUpdates({ patterns, report });
      patterns = updated.updated;
      previousHitRate = report.hitRate;
      if (day === 1) hitRateDay1 = report.hitRate;
      if (day === 30) hitRateDay30 = report.hitRate;
    }
    // Day 1: 5 patterns fire (mix of correct + noise) -> mean jaccard ~0.2-0.4
    expect(hitRateDay1).toBeLessThan(0.5);
    // Day 30: noise patterns dropped below threshold; only correct patterns fire -> high jaccard
    expect(hitRateDay30).toBeGreaterThanOrEqual(0.7);
    // Trajectory grew
    expect(hitRateDay30).toBeGreaterThan(hitRateDay1);
  });
});

describe("v2.19.25 SLEEP TRAINING · morning digest + formatter", () => {
  it("morningDigest groups top improved + top regressed patterns", () => {
    const report = runSleepCycle({
      yesterdayPredictions: [
        pred("good", "sigA", "x", 0.2),  // delta positive
        pred("bad", "sigB", "wrong", 0.8), // delta negative
      ],
      yesterdayActualCalls: [
        act("sigA", "x"),
        act("sigB", "actual"),
      ],
      cycleAt: 0,
      learningRate: 1,
      secret: SECRET,
    });
    const d = morningDigest(report);
    expect(d.topImproved.length).toBe(1);
    expect(d.topImproved[0]!.patternId).toBe("good");
    expect(d.topRegressed.length).toBe(1);
    expect(d.topRegressed[0]!.patternId).toBe("bad");
    expect(d.oneLine).toContain("SLEEP");
  });

  it("formatSleepCycleLine renders single-line digest", () => {
    const r = runSleepCycle({
      yesterdayPredictions: [pred("p1", "sigA", "x", 0.5)],
      yesterdayActualCalls: [act("sigA", "x")],
      cycleAt: 0,
      previousHitRate: 0.5,
      secret: SECRET,
    });
    const line = formatSleepCycleLine(r);
    expect(line).toContain("SLEEP");
    expect(line).toContain("lr=");
  });
});
