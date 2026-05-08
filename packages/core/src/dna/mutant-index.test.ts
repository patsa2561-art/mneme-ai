import { describe, it, expect } from "vitest";
import {
  evolveGeneration,
  seedPopulation,
  fitness,
  normalize,
  INDEX_KINDS,
  type Strategy,
} from "./mutant-index.js";

describe("A1. Mutant Index — normalize", () => {
  it("normalizes weights to sum=1", () => {
    const w = normalize({ trigram: 2, symbol: 3, ast: 5, graph: 0, vector: 0, type: 0 });
    const sum = INDEX_KINDS.reduce((s, k) => s + w[k], 0);
    expect(sum).toBeCloseTo(1);
  });

  it("all-zero → uniform fallback", () => {
    const w = normalize({ trigram: 0, symbol: 0, ast: 0, graph: 0, vector: 0, type: 0 });
    for (const k of INDEX_KINDS) expect(w[k]).toBeCloseTo(1 / 6);
  });

  it("clamps negative weights to 0 before normalizing", () => {
    const w = normalize({ trigram: -5, symbol: 1, ast: 0, graph: 0, vector: 0, type: 0 });
    expect(w.trigram).toBe(0);
    expect(w.symbol).toBe(1);
  });
});

describe("A1. Mutant Index — seed population", () => {
  it("produces N strategies of the requested size", () => {
    const pop = seedPopulation(10, 42);
    expect(pop).toHaveLength(10);
    for (const s of pop) {
      expect(s.generation).toBe(0);
      expect(s.samples).toEqual([]);
      const sum = INDEX_KINDS.reduce((acc, k) => acc + s.weights[k], 0);
      expect(sum).toBeCloseTo(1);
    }
  });

  it("deterministic for the same seed", () => {
    const a = seedPopulation(10, 42);
    const b = seedPopulation(10, 42);
    expect(a.map((s) => s.weights)).toEqual(b.map((s) => s.weights));
  });

  it("different seeds → different populations", () => {
    const a = seedPopulation(10, 1);
    const b = seedPopulation(10, 2);
    expect(JSON.stringify(a)).not.toEqual(JSON.stringify(b));
  });
});

describe("A1. Mutant Index — fitness", () => {
  it("strategy with no samples → fitness 0", () => {
    const s: Strategy = {
      id: "x",
      weights: normalize({ trigram: 1, symbol: 0, ast: 0, graph: 0, vector: 0, type: 0 }),
      samples: [],
      generation: 0,
    };
    expect(fitness(s)).toBe(0);
  });

  it("higher CTR + lower TTUR = higher fitness", () => {
    const slow: Strategy = {
      id: "s",
      weights: normalize({ trigram: 1, symbol: 0, ast: 0, graph: 0, vector: 0, type: 0 }),
      samples: [{ ctr: 0.5, ttur: 5 }],
      generation: 0,
    };
    const fast: Strategy = { ...slow, id: "f", samples: [{ ctr: 0.5, ttur: 0.5 }] };
    expect(fitness(fast)).toBeGreaterThan(fitness(slow));
  });
});

describe("A1. Mutant Index — evolve", () => {
  it("preserves elite count from prior generation", () => {
    const pop: Strategy[] = [
      { id: "best", weights: normalize({ trigram: 1, symbol: 0, ast: 0, graph: 0, vector: 0, type: 0 }), samples: [{ ctr: 1, ttur: 0.1 }], generation: 0 },
      { id: "second", weights: normalize({ trigram: 0, symbol: 1, ast: 0, graph: 0, vector: 0, type: 0 }), samples: [{ ctr: 0.5, ttur: 0.5 }], generation: 0 },
      { id: "worst", weights: normalize({ trigram: 0, symbol: 0, ast: 1, graph: 0, vector: 0, type: 0 }), samples: [{ ctr: 0.1, ttur: 5 }], generation: 0 },
    ];
    const next = evolveGeneration(pop, { populationSize: 5, eliteCount: 2 });
    expect(next).toHaveLength(5);
    // Two elites should carry over (generation incremented)
    const eliteIds = next.slice(0, 2).map((s) => s.id);
    expect(eliteIds).toContain("best");
    expect(eliteIds).toContain("second");
  });

  it("evolution is deterministic for the same seed", () => {
    const pop = seedPopulation(8, 123);
    // Add some samples so fitness differs
    pop[0]!.samples = [{ ctr: 0.9, ttur: 0.5 }];
    pop[1]!.samples = [{ ctr: 0.3, ttur: 1 }];
    const a = evolveGeneration(pop, { seed: 7, populationSize: 8, eliteCount: 2 });
    const b = evolveGeneration(pop, { seed: 7, populationSize: 8, eliteCount: 2 });
    expect(a.map((s) => s.weights)).toEqual(b.map((s) => s.weights));
  });

  it("non-elite children have generation = parent + 1", () => {
    const pop = seedPopulation(4, 11);
    pop[0]!.samples = [{ ctr: 0.9, ttur: 0.1 }];
    const next = evolveGeneration(pop, { populationSize: 4, eliteCount: 1 });
    // Elite preserved; rest are children of generation 1
    const newChildren = next.filter((s) => s.id.startsWith("g1-c"));
    expect(newChildren.length).toBeGreaterThan(0);
    for (const c of newChildren) {
      expect(c.generation).toBe(1);
      expect(c.samples).toEqual([]);
    }
  });

  it("population size respected", () => {
    const pop = seedPopulation(5, 99);
    const next = evolveGeneration(pop, { populationSize: 12, eliteCount: 1 });
    expect(next).toHaveLength(12);
  });

  it("empty population → empty result (no throw)", () => {
    expect(evolveGeneration([])).toEqual([]);
  });

  it("all weights stay normalized after mutation", () => {
    const pop = seedPopulation(4, 7);
    pop[0]!.samples = [{ ctr: 0.5, ttur: 0.5 }];
    const next = evolveGeneration(pop, { populationSize: 4, mutationRate: 1, mutationSigma: 0.5 });
    for (const s of next) {
      const sum = INDEX_KINDS.reduce((acc, k) => acc + s.weights[k], 0);
      expect(sum).toBeCloseTo(1, 5);
    }
  });
});
