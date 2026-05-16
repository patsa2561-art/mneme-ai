import { describe, it, expect } from "vitest";
import {
  createEmbedder,
  embed,
  cosine,
  sparsity,
  populationStats,
  adversarialFinetune,
  adversarialBatch,
  tokenize,
  formatEmbedderLine,
} from "./index.js";

describe("v2.19.13 NEUROMORPHIC EMBEDDER · createEmbedder + tokenize", () => {
  it("createEmbedder ships defaults: 32 pops × 64 neurons = 2048-dim embedding", () => {
    const e = createEmbedder();
    expect(e.config.populations).toBe(32);
    expect(e.config.neuronsPerPop).toBe(64);
    expect(e.weights.length).toBe(32 * 64 * 128);
    expect(e.thresholds.length).toBe(32 * 64);
  });

  it("seed determinism: same seed → same weights + thresholds", () => {
    const a = createEmbedder({ seed: 42 });
    const b = createEmbedder({ seed: 42 });
    expect(Array.from(a.weights.slice(0, 100))).toEqual(Array.from(b.weights.slice(0, 100)));
    expect(Array.from(a.thresholds)).toEqual(Array.from(b.thresholds));
  });

  it("different seeds → different weight initialisations", () => {
    const a = createEmbedder({ seed: 1 });
    const b = createEmbedder({ seed: 2 });
    expect(Array.from(a.weights.slice(0, 100))).not.toEqual(Array.from(b.weights.slice(0, 100)));
  });

  it("tokenize handles English, Thai, mixed alphanumerics deterministically", () => {
    expect(tokenize("Hello World 42")).toEqual(["hello", "world", "42"]);
    const thai = tokenize("ลูก mneme ดีมาก");
    expect(thai).toContain("mneme");
    expect(thai.length).toBeGreaterThanOrEqual(3);
    expect(tokenize("Hello World 42")).toEqual(tokenize("hello world 42"));
  });
});

describe("v2.19.13 NEUROMORPHIC EMBEDDER · embed", () => {
  it("embedding has dimension = populations × neuronsPerPop", () => {
    const e = createEmbedder({ populations: 8, neuronsPerPop: 16, seed: 7 });
    const r = embed(e, "the quick brown fox jumps over the lazy dog");
    expect(r.vector.length).toBe(8 * 16);
    expect(r.steps).toBe(50);
  });

  it("embedding is deterministic: same text + same embedder → same vector", () => {
    const e = createEmbedder({ seed: 11 });
    const a = embed(e, "Mneme is a memory layer for AI agents.");
    const b = embed(e, "Mneme is a memory layer for AI agents.");
    expect(Array.from(a.vector)).toEqual(Array.from(b.vector));
  });

  it("empty string produces a zero (or near-zero) vector without throwing", () => {
    const e = createEmbedder({ seed: 9 });
    const r = embed(e, "");
    expect(r.vector.length).toBe(2048);
    // With no tokens, no spikes fire
    expect(r.totalSpikes).toBe(0);
  });

  it("very long text remains bounded (firing rate <= 1)", () => {
    const e = createEmbedder({ seed: 9 });
    const long = "word ".repeat(2000);
    const r = embed(e, long);
    for (let i = 0; i < r.vector.length; i++) {
      expect(r.vector[i]).toBeGreaterThanOrEqual(0);
      expect(r.vector[i]).toBeLessThanOrEqual(1);
    }
  });

  it("different texts produce DIFFERENT vectors (no collisions on basic English)", () => {
    const e = createEmbedder({ seed: 21 });
    const a = embed(e, "the cat sat on the mat");
    const b = embed(e, "machine learning gradient descent backpropagation");
    expect(Array.from(a.vector)).not.toEqual(Array.from(b.vector));
  });
});

describe("v2.19.13 NEUROMORPHIC EMBEDDER · cosine + sparsity", () => {
  it("cosine of a vector with itself = 1 (or ~0 if vector is all-zero)", () => {
    const e = createEmbedder({ seed: 3 });
    const r = embed(e, "test text for cosine");
    const c = cosine(r.vector, r.vector);
    if (r.totalSpikes > 0) {
      expect(c).toBeCloseTo(1.0, 5);
    } else {
      expect(c).toBe(0);
    }
  });

  it("cosine throws on length mismatch", () => {
    expect(() => cosine(new Float32Array(10), new Float32Array(20))).toThrow();
  });

  it("sparsity: SNN produces sparse vectors (most neurons silent)", () => {
    const e = createEmbedder({ seed: 5 });
    const r = embed(e, "the quick brown fox");
    const s = sparsity(r.vector);
    expect(s).toBeGreaterThan(0.3); // at least 30% silent — sparse model is the goal
  });

  it("sparsity = 1 for all-zero vector (empty input)", () => {
    const e = createEmbedder({ seed: 5 });
    const r = embed(e, "");
    expect(sparsity(r.vector)).toBe(1);
  });
});

describe("v2.19.13 NEUROMORPHIC EMBEDDER · populationStats", () => {
  it("reports active vs silent neurons, populations touched, sparsity", () => {
    const e = createEmbedder({ seed: 13 });
    const r = embed(e, "neural network spike train rate code");
    const s = populationStats(e, r.vector);
    expect(s.totalNeurons).toBe(2048);
    expect(s.activeNeurons + s.silentNeurons).toBe(2048);
    expect(s.populationsTouched).toBeGreaterThan(0);
    expect(s.populationsTouched).toBeLessThanOrEqual(32);
    expect(s.maxFiringRate).toBeGreaterThanOrEqual(0);
    expect(s.maxFiringRate).toBeLessThanOrEqual(1);
  });
});

describe("v2.19.13 NEUROMORPHIC EMBEDDER · adversarialFinetune", () => {
  it("a single triplet finetune returns NEW embedder + measurable margin delta", () => {
    const e = createEmbedder({ seed: 17 });
    const r = adversarialFinetune({
      embedder: e,
      triplet: {
        anchor: "machine learning gradient descent",
        positive: "neural network backpropagation training",
        negative: "the cat sat on the mat lazily",
      },
      learningRate: 0.05,
    });
    expect(r.embedder).not.toBe(e); // new object, not mutated
    expect(r.embedder.thresholds).not.toBe(e.thresholds); // new array
    expect(typeof r.marginImprovement).toBe("number");
    expect(typeof r.afterCosPos).toBe("number");
    expect(typeof r.afterCosNeg).toBe("number");
  });

  it("repeated finetune on the SAME triplet eventually improves the margin (or plateaus)", () => {
    let e = createEmbedder({ seed: 19 });
    const triplet = {
      anchor: "code refactor naming convention",
      positive: "rename variables for clarity",
      negative: "yesterday I ate pizza for lunch",
    };
    const first = embed(e, triplet.anchor);
    const initialPos = cosine(first.vector, embed(e, triplet.positive).vector);
    const initialNeg = cosine(first.vector, embed(e, triplet.negative).vector);
    const initialMargin = initialPos - initialNeg;
    for (let i = 0; i < 10; i++) {
      const r = adversarialFinetune({ embedder: e, triplet, learningRate: 0.05 });
      e = r.embedder;
    }
    const finalPos = cosine(embed(e, triplet.anchor).vector, embed(e, triplet.positive).vector);
    const finalNeg = cosine(embed(e, triplet.anchor).vector, embed(e, triplet.negative).vector);
    const finalMargin = finalPos - finalNeg;
    // Either the margin improved OR it plateaued near the initial value (no regression).
    expect(finalMargin).toBeGreaterThanOrEqual(initialMargin - 0.05);
  });

  it("adversarialBatch over many triplets reports average improvement + adjustments count", () => {
    const e = createEmbedder({ seed: 29 });
    const triplets = [
      { anchor: "react components hooks", positive: "useState useEffect render", negative: "stir-fry vegetables wok" },
      { anchor: "git commit message", positive: "feat fix refactor", negative: "weather rainy tomorrow" },
      { anchor: "sql index query", positive: "btree primary key lookup", negative: "dog park afternoon walk" },
    ];
    const r = adversarialBatch({ embedder: e, triplets, learningRate: 0.03 });
    expect(r.embedder.thresholds).not.toBe(e.thresholds);
    expect(typeof r.averageMarginImprovement).toBe("number");
    expect(r.totalAdjustments).toBeGreaterThan(0);
    expect(r.improvedCount).toBeGreaterThanOrEqual(0);
    expect(r.improvedCount).toBeLessThanOrEqual(triplets.length);
  });

  it("adversarial finetune determinism: same triplet+lr+embedder → same result", () => {
    const e = createEmbedder({ seed: 33 });
    const t = { anchor: "alpha", positive: "alphabet", negative: "zoology" };
    const r1 = adversarialFinetune({ embedder: e, triplet: t, learningRate: 0.04 });
    const r2 = adversarialFinetune({ embedder: e, triplet: t, learningRate: 0.04 });
    expect(Array.from(r1.embedder.thresholds)).toEqual(Array.from(r2.embedder.thresholds));
    expect(r1.marginImprovement).toBe(r2.marginImprovement);
  });

  it("thresholds stay bounded in [0.1, 2.0] even after many extreme finetunes", () => {
    let e = createEmbedder({ seed: 51 });
    const t = { anchor: "x", positive: "x", negative: "x" }; // pathological triplet
    for (let i = 0; i < 50; i++) {
      e = adversarialFinetune({ embedder: e, triplet: t, learningRate: 0.5 }).embedder;
    }
    for (let i = 0; i < e.thresholds.length; i++) {
      expect(e.thresholds[i]).toBeGreaterThanOrEqual(0.1);
      expect(e.thresholds[i]).toBeLessThanOrEqual(2.0);
    }
  });
});

describe("v2.19.13 NEUROMORPHIC EMBEDDER · formatter + smoke", () => {
  it("formatter line reflects config", () => {
    const e = createEmbedder({ populations: 8, neuronsPerPop: 16, steps: 30, featureDim: 64, seed: 99 });
    const line = formatEmbedderLine(e);
    expect(line).toContain("SNN");
    expect(line).toContain("pops=8");
    expect(line).toContain("seed=99");
  });

  it("small SNN config still produces a deterministic non-trivial embedding", () => {
    const e = createEmbedder({ populations: 4, neuronsPerPop: 8, steps: 20, featureDim: 32, seed: 1 });
    const r = embed(e, "small footprint embedder");
    expect(r.vector.length).toBe(32);
    expect(r.vector.some((v) => v > 0)).toBe(true);
  });
});
