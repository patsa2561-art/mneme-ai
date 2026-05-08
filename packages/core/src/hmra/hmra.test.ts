/**
 * HMRA — Holographic Memory Ranking Algorithm tests.
 *
 * The math has to be correct AND have the right qualitative behaviour:
 *   - recency: monotone decreasing with age
 *   - hebbian: monotone increasing with co-activations + similarity
 *   - pagerank: high-cited nodes score higher than leaves
 *   - entropy: random text > templated text
 *   - federation: zero below k-anonymity floor
 *   - composite: weighted sum + correctly ranks heterogeneous inputs
 *   - learning: weights drift toward components with positive feedback correlation
 */

import { describe, it, expect } from "vitest";
import {
  recencyComponent,
  hebbianComponent,
  pageRank,
  pageRankComponent,
  entropyComponent,
  federationComponent,
  hmraScore,
  hmraRank,
  tuneHmraWeights,
  DEFAULT_HMRA_WEIGHTS,
  type FeedbackSample,
  type HmraScore,
} from "./hmra.js";

describe("HMRA — recency component", () => {
  it("returns 1.0 at age 0", () => {
    expect(recencyComponent(0, "commit")).toBe(1);
  });

  it("returns ~0.5 at one half-life", () => {
    expect(recencyComponent(365, "commit")).toBeCloseTo(0.5, 2);
    expect(recencyComponent(90, "atrophy")).toBeCloseTo(0.5, 2);
    expect(recencyComponent(180, "regret")).toBeCloseTo(0.5, 2);
  });

  it("returns ~0.25 at two half-lives", () => {
    expect(recencyComponent(730, "commit")).toBeCloseTo(0.25, 2);
  });

  it("monotone decreasing with age", () => {
    const ages = [0, 30, 90, 180, 365, 730, 1095];
    for (let i = 1; i < ages.length; i++) {
      expect(recencyComponent(ages[i]!, "commit")).toBeLessThan(recencyComponent(ages[i - 1]!, "commit"));
    }
  });

  it("clamps negative ages to 1.0", () => {
    expect(recencyComponent(-100, "commit")).toBe(1);
  });

  it("atrophy decays faster than commits (90 vs 365 day half-life)", () => {
    const ageDays = 90;
    expect(recencyComponent(ageDays, "atrophy")).toBeLessThan(recencyComponent(ageDays, "commit"));
  });
});

describe("HMRA — Hebbian component", () => {
  it("zero similarity → zero score", () => {
    expect(hebbianComponent({ cosineSim: 0, coActivationCount: 5 })).toBeCloseTo(0, 2);
  });

  it("monotone increasing with cosine similarity (fixed co-count)", () => {
    const sims = [0, 0.2, 0.5, 0.8, 1.0];
    let prev = -1;
    for (const sim of sims) {
      const score = hebbianComponent({ cosineSim: sim, coActivationCount: 5 });
      expect(score).toBeGreaterThanOrEqual(prev);
      prev = score;
    }
  });

  it("monotone increasing with co-activation count (fixed similarity)", () => {
    const counts = [0, 1, 5, 20, 100];
    let prev = -1;
    for (const c of counts) {
      const score = hebbianComponent({ cosineSim: 0.5, coActivationCount: c });
      expect(score).toBeGreaterThanOrEqual(prev);
      prev = score;
    }
  });

  it("saturates within [0, 1]", () => {
    expect(hebbianComponent({ cosineSim: 1, coActivationCount: 10000 })).toBeLessThanOrEqual(1);
    expect(hebbianComponent({ cosineSim: 0, coActivationCount: 0 })).toBeGreaterThanOrEqual(0);
  });
});

describe("HMRA — PageRank", () => {
  it("equal-leaf graph: nodes with no edges all score equally", () => {
    // 3 nodes, no edges → uniform distribution
    const g = { edges: new Map<string, string[]>([
      ["a", []],
      ["b", []],
      ["c", []],
    ]) };
    const scores = pageRank(g);
    const vals = Array.from(scores.values());
    expect(vals[0]).toBeCloseTo(vals[1]!, 3);
    expect(vals[1]).toBeCloseTo(vals[2]!, 3);
  });

  it("hub gets higher score than leaves", () => {
    // Star graph: a, b, c all point to "hub"
    const g = { edges: new Map<string, string[]>([
      ["a", ["hub"]],
      ["b", ["hub"]],
      ["c", ["hub"]],
      ["hub", []],
    ]) };
    const scores = pageRank(g);
    expect(scores.get("hub")).toBeGreaterThan(scores.get("a")!);
    expect(scores.get("hub")).toBeGreaterThan(scores.get("b")!);
    expect(scores.get("hub")).toBeGreaterThan(scores.get("c")!);
  });

  it("converges in finite iterations", () => {
    const g = { edges: new Map<string, string[]>([
      ["a", ["b"]],
      ["b", ["c"]],
      ["c", ["a"]],
    ]) };
    const scores = pageRank(g, { iterations: 100 });
    // Cycle of 3 → should be roughly equal
    const vals = Array.from(scores.values());
    expect(vals[0]).toBeCloseTo(vals[1]!, 2);
  });

  it("empty graph returns empty map", () => {
    const scores = pageRank({ edges: new Map() });
    expect(scores.size).toBe(0);
  });

  it("pageRankComponent returns 0 for unknown node", () => {
    const scores = new Map<string, number>([["a", 0.5]]);
    expect(pageRankComponent(scores, "unknown")).toBe(0);
  });
});

describe("HMRA — entropy component", () => {
  it("empty string → 0", () => {
    expect(entropyComponent("")).toBe(0);
  });

  it("single repeated character → very low entropy", () => {
    expect(entropyComponent("aaaaaaaaa")).toBe(0);
  });

  it("diverse text → middle to high entropy", () => {
    const e = entropyComponent("The quick brown fox jumps over the lazy dog");
    expect(e).toBeGreaterThan(0.4);
    expect(e).toBeLessThanOrEqual(1);
  });

  it("highly random text → higher entropy than templated", () => {
    const random = "x7Q!9#@kP$z*&8mLn2v^GbF4hT";
    const templated = "TODO: implement this. TODO: fix bug. TODO: test.";
    expect(entropyComponent(random)).toBeGreaterThan(entropyComponent(templated));
  });

  it("clamped to [0, 1]", () => {
    const e = entropyComponent("a".repeat(1000));
    expect(e).toBeGreaterThanOrEqual(0);
    expect(e).toBeLessThanOrEqual(1);
  });
});

describe("HMRA — federation component", () => {
  it("null signal → 0", () => {
    expect(federationComponent(null)).toBe(0);
    expect(federationComponent(undefined)).toBe(0);
  });

  it("below k-anonymity floor → 0", () => {
    expect(
      federationComponent({ contributorCount: 10, kMin: 20, maxObserved: 100 }),
    ).toBe(0);
  });

  it("at k-anon floor → 0 (just touching the floor)", () => {
    expect(
      federationComponent({ contributorCount: 20, kMin: 20, maxObserved: 100 }),
    ).toBe(0);
  });

  it("scales 0 to 1 above floor", () => {
    const low = federationComponent({ contributorCount: 30, kMin: 20, maxObserved: 100 });
    const high = federationComponent({ contributorCount: 90, kMin: 20, maxObserved: 100 });
    expect(low).toBeGreaterThan(0);
    expect(high).toBeGreaterThan(low);
    expect(high).toBeLessThanOrEqual(1);
  });
});

describe("HMRA — composite hmraScore", () => {
  it("composite = α·R + β·H + γ·P + δ·E + ε·F", () => {
    const scores = new Map<string, number>([["mem-1", 0.8]]);
    const result = hmraScore(
      {
        id: "mem-1",
        kind: "commit",
        ageDays: 0,
        hebbian: { cosineSim: 1, coActivationCount: 0 },
        pageRankScores: scores,
        text: "abcdefghijklmnopqrstuvwxyz",
        federation: null,
      },
      DEFAULT_HMRA_WEIGHTS,
    );
    // Manual computation
    const R = 1; // age 0
    const H = result.components.hebbian;
    const P = 0.8;
    const E = result.components.entropy;
    const F = 0;
    const expected =
      DEFAULT_HMRA_WEIGHTS.alpha * R +
      DEFAULT_HMRA_WEIGHTS.beta * H +
      DEFAULT_HMRA_WEIGHTS.gamma * P +
      DEFAULT_HMRA_WEIGHTS.delta * E +
      DEFAULT_HMRA_WEIGHTS.epsilon * F;
    expect(result.composite).toBeCloseTo(expected, 5);
  });

  it("composite ∈ [0, 1] under default weights (sum = 1.0)", () => {
    expect(
      DEFAULT_HMRA_WEIGHTS.alpha +
        DEFAULT_HMRA_WEIGHTS.beta +
        DEFAULT_HMRA_WEIGHTS.gamma +
        DEFAULT_HMRA_WEIGHTS.delta +
        DEFAULT_HMRA_WEIGHTS.epsilon,
    ).toBeCloseTo(1, 5);
  });
});

describe("HMRA — hmraRank ordering", () => {
  it("ranks fresher commits higher than older ones (all else equal)", () => {
    const scores = new Map<string, number>();
    const ranking = hmraRank([
      {
        id: "fresh",
        kind: "commit",
        ageDays: 1,
        hebbian: { cosineSim: 0.5, coActivationCount: 0 },
        pageRankScores: scores,
        text: "abc def ghi",
        federation: null,
      },
      {
        id: "old",
        kind: "commit",
        ageDays: 1000,
        hebbian: { cosineSim: 0.5, coActivationCount: 0 },
        pageRankScores: scores,
        text: "abc def ghi",
        federation: null,
      },
    ]);
    expect(ranking[0]?.id).toBe("fresh");
    expect(ranking[1]?.id).toBe("old");
  });

  it("ranks high-pagerank commits higher than no-pagerank (all else equal)", () => {
    const scores = new Map<string, number>([["important", 1.0]]);
    const ranking = hmraRank([
      {
        id: "important",
        kind: "commit",
        ageDays: 100,
        hebbian: { cosineSim: 0.5, coActivationCount: 0 },
        pageRankScores: scores,
        text: "abc def ghi",
      },
      {
        id: "leaf",
        kind: "commit",
        ageDays: 100,
        hebbian: { cosineSim: 0.5, coActivationCount: 0 },
        pageRankScores: scores,
        text: "abc def ghi",
      },
    ]);
    expect(ranking[0]?.id).toBe("important");
  });
});

describe("HMRA — weight tuning (self-learning)", () => {
  function makeSample(memoryId: string, components: HmraScore["components"], feedback: 1 | -1 | 0): FeedbackSample {
    return {
      memoryId,
      feedback,
      scoreAtRetrieval: { id: memoryId, composite: 0, components, weights: DEFAULT_HMRA_WEIGHTS },
    };
  }

  it("returns input weights unchanged when fewer than 10 samples", () => {
    const samples: FeedbackSample[] = [
      makeSample("a", { recency: 1, hebbian: 0, pageRank: 0, entropy: 0, federation: 0 }, 1),
      makeSample("b", { recency: 0, hebbian: 1, pageRank: 0, entropy: 0, federation: 0 }, -1),
    ];
    const out = tuneHmraWeights(samples);
    expect(out).toEqual(DEFAULT_HMRA_WEIGHTS);
  });

  it("bumps weight of component that correlates with positive feedback", () => {
    // 12 samples — recency strongly correlates with positive feedback
    const samples: FeedbackSample[] = [];
    for (let i = 0; i < 6; i++) {
      samples.push(
        makeSample(`hi-${i}`, { recency: 1, hebbian: 0, pageRank: 0, entropy: 0, federation: 0 }, 1),
      );
    }
    for (let i = 0; i < 6; i++) {
      samples.push(
        makeSample(`lo-${i}`, { recency: 0, hebbian: 0, pageRank: 0, entropy: 0, federation: 0 }, -1),
      );
    }
    const out = tuneHmraWeights(samples);
    expect(out.alpha).toBeGreaterThan(DEFAULT_HMRA_WEIGHTS.alpha);
    // weights should still sum to 1
    const sum = out.alpha + out.beta + out.gamma + out.delta + out.epsilon;
    expect(sum).toBeCloseTo(1, 4);
  });

  it("renormalizes weights to sum = 1", () => {
    const samples: FeedbackSample[] = [];
    for (let i = 0; i < 12; i++) {
      samples.push(
        makeSample(`s-${i}`, { recency: Math.random(), hebbian: Math.random(), pageRank: Math.random(), entropy: Math.random(), federation: Math.random() }, i % 2 === 0 ? 1 : -1),
      );
    }
    const out = tuneHmraWeights(samples);
    const sum = out.alpha + out.beta + out.gamma + out.delta + out.epsilon;
    expect(sum).toBeCloseTo(1, 4);
  });

  it("never produces negative weights", () => {
    const samples: FeedbackSample[] = [];
    for (let i = 0; i < 30; i++) {
      // Strong negative correlation on every component → would push all weights down
      samples.push(
        makeSample(
          `s-${i}`,
          { recency: 1, hebbian: 1, pageRank: 1, entropy: 1, federation: 1 },
          -1,
        ),
      );
    }
    const out = tuneHmraWeights(samples, DEFAULT_HMRA_WEIGHTS, 0.5);
    expect(out.alpha).toBeGreaterThanOrEqual(0);
    expect(out.beta).toBeGreaterThanOrEqual(0);
    expect(out.gamma).toBeGreaterThanOrEqual(0);
    expect(out.delta).toBeGreaterThanOrEqual(0);
    expect(out.epsilon).toBeGreaterThanOrEqual(0);
  });
});
