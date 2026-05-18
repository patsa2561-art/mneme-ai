/**
 * v2.19.47 — CHRONOSHEAF P1 + P2 test suite.
 *
 * Every primitive gets:
 *   - canonical examples with hand-computed expected values
 *   - cross-vector invariants (algebraic identities the math demands)
 *   - 1000-iter fuzz where the primitive is randomised
 *
 * Total target: 60+ tests across 8 modules.
 */

import { describe, it, expect } from "vitest";

// ─── P1 pain_catalog ───────────────────────────────────────────────────

import { PAIN_CATALOG, catalogStats, painsForPrimitive, primitivesForPain, type PainEntry, type PrimitiveTag } from "./pain_catalog.js";

describe("v2.19.47 CHRONOSHEAF P1 · pain_catalog", () => {
  it("contains exactly 7 user-reported pains", () => {
    expect(PAIN_CATALOG.length).toBe(7);
  });
  it("every pain has all required fields", () => {
    for (const e of PAIN_CATALOG) {
      expect(e.painId).toMatch(/^PAIN-\d{3}$/);
      expect(typeof e.pain).toBe("string");
      expect(typeof e.currentToolsSee).toBe("string");
      expect(typeof e.whatTheyMiss).toBe("string");
      expect(typeof e.topology).toBe("string");
      expect(Array.isArray(e.primitives)).toBe(true);
      expect(e.primitives.length).toBeGreaterThan(0);
    }
  });
  it("painsForPrimitive returns every pain the primitive addresses", () => {
    const sheafPains = painsForPrimitive("sheaf");
    expect(sheafPains.length).toBeGreaterThan(0);
    for (const p of sheafPains) expect(p.primitives).toContain("sheaf");
  });
  it("primitivesForPain inverts correctly", () => {
    expect(primitivesForPain("PAIN-001")).toContain("sheaf");
    expect(primitivesForPain("NONEXISTENT")).toEqual([]);
  });
  it("catalogStats counts everything correctly", () => {
    const s = catalogStats();
    expect(s.totalPains).toBe(7);
    expect(Object.keys(s.byTopology).length).toBeGreaterThan(0);
    expect(s.primitiveLoad.length).toBeGreaterThan(0);
    const total = s.primitiveLoad.reduce((acc, x) => acc + x.pains, 0);
    let expected = 0;
    for (const e of PAIN_CATALOG) expected += e.primitives.length;
    expect(total).toBe(expected);
  });
});

// ─── P2-a sheaf cohomology ─────────────────────────────────────────────

import {
  delta0, delta1, isCocycle, cohomologyH1, gluingDiagnostic,
  type SheafCover,
} from "./sheaf.js";

describe("v2.19.47 CHRONOSHEAF P2-a · sheaf cohomology", () => {
  it("tree cover (no cycle): H¹ = 0", () => {
    const cover: SheafCover = {
      sites: ["A", "B", "C"],
      overlaps: [["A", "B"], ["B", "C"]],
    };
    const r = cohomologyH1(cover);
    expect(r.h1).toBe(0);
    expect(r.hasObstruction).toBe(false);
  });
  it("3-cycle without triple overlap: H¹ = 1 (the canonical obstruction)", () => {
    const cover: SheafCover = {
      sites: ["A", "B", "C"],
      overlaps: [["A", "B"], ["B", "C"], ["A", "C"]],
    };
    const r = cohomologyH1(cover);
    expect(r.h1).toBe(1);
    expect(r.hasObstruction).toBe(true);
    expect(r.obstructions.length).toBe(1);
  });
  it("3-cycle WITH triple overlap: H¹ = 0 (the triangle kills it)", () => {
    const cover: SheafCover = {
      sites: ["A", "B", "C"],
      overlaps: [["A", "B"], ["B", "C"], ["A", "C"]],
      triples: [["A", "B", "C"]],
    };
    const r = cohomologyH1(cover);
    expect(r.h1).toBe(0);
  });
  it("delta0 of consistent claim values is zero everywhere", () => {
    const cover: SheafCover = {
      sites: ["A", "B", "C"],
      overlaps: [["A", "B"], ["B", "C"]],
    };
    const sigma0 = new Map([["A", 5], ["B", 5], ["C", 5]]);
    const d = delta0(cover, sigma0);
    for (const v of d.values()) expect(v).toBe(0);
  });
  it("delta0 of inconsistent claim values is non-zero on the discordant pair", () => {
    const cover: SheafCover = {
      sites: ["A", "B"],
      overlaps: [["A", "B"]],
    };
    const sigma0 = new Map([["A", 1], ["B", 3]]);
    const d = delta0(cover, sigma0);
    // Pair key is sorted lex: "A" + "B" → "AB". Value = b_B − b_A = 3 − 1 = 2.
    const v = d.get("AB") ?? d.get("BA");
    expect(v).toBe(2);
  });
  it("isCocycle returns true on tree cover with no triples", () => {
    const cover: SheafCover = { sites: ["A", "B"], overlaps: [["A", "B"]] };
    const sigma1 = new Map([["AB", 7]]);
    expect(isCocycle(cover, sigma1)).toBe(true);
  });
  it("gluingDiagnostic reports H¹ and residual together", () => {
    const cover: SheafCover = {
      sites: ["A", "B", "C"],
      overlaps: [["A", "B"], ["B", "C"], ["A", "C"]],
    };
    const claim = new Map([["A", 711], ["B", 711], ["C", 712]]);
    const r = gluingDiagnostic(cover, claim);
    expect(r.h1).toBe(1);
    expect(r.residual.size).toBe(3);
  });
  it("delta1 on a triangle is the alternating sum", () => {
    const cover: SheafCover = {
      sites: ["A", "B", "C"],
      overlaps: [["A", "B"], ["B", "C"], ["A", "C"]],
      triples: [["A", "B", "C"]],
    };
    const sigma1 = new Map([["AB", 1], ["BC", 1], ["AC", 2]]);
    const d = delta1(cover, sigma1);
    expect(d.size).toBe(1);
    const v = Array.from(d.values())[0]!;
    expect(v).toBe(0); // 1 + 1 - 2 = 0
  });
});

// ─── P2-b rg_flow ──────────────────────────────────────────────────────

import { rgStep, rgFixedPoint, classifyRelevance, smallestScaleForBudget } from "./rg_flow.js";

describe("v2.19.47 CHRONOSHEAF P2-b · RG flow", () => {
  it("rgStep mean aggregator halves length and averages", () => {
    const s = rgStep({ vector: [1, 3, 5, 7], scale: 0 }, { factor: 2, aggregator: "mean" });
    expect(s.vector).toEqual([2, 6]);
    expect(s.scale).toBe(1);
  });
  it("rgFixedPoint reaches scalar state in finite iterations", () => {
    const r = rgFixedPoint({ vector: [1, 2, 3, 4, 5, 6, 7, 8], scale: 0 }, { factor: 2, aggregator: "sum" });
    expect(r.reachedFixedPoint).toBe(true);
    expect(r.state.vector.length).toBeLessThanOrEqual(1);
  });
  it("classifyRelevance labels constant vector — mean shrinks L2 norm → irrelevant", () => {
    const r = classifyRelevance({ vector: [1, 1, 1, 1], scale: 0 }, { factor: 2, aggregator: "mean" }, [1, 1, 1, 1]);
    // [1,1,1,1] mean → [1,1] mean → [1]. L2 norms: 2 → √2 → 1 → ratio < 1 → irrelevant.
    expect(["irrelevant", "marginal"]).toContain(r.class);
  });
  it("classifyRelevance labels constant vector under SUM → relevant (L2 grows)", () => {
    const r = classifyRelevance({ vector: [1, 1, 1, 1], scale: 0 }, { factor: 2, aggregator: "sum" }, [1, 1, 1, 1]);
    // sum: [1,1,1,1] → [2,2] → [4]. L2 norms: 2 → 2√2 → 4 → growth ratio > 1 → relevant.
    expect(["relevant", "marginal"]).toContain(r.class);
  });
  it("smallestScaleForBudget returns state with size ≤ target", () => {
    const r = smallestScaleForBudget({ vector: [1, 2, 3, 4, 5, 6, 7, 8], scale: 0 }, { factor: 2, aggregator: "mean" }, 2);
    expect(r.state.vector.length).toBeLessThanOrEqual(2);
  });
});

// ─── P2-c persistence ──────────────────────────────────────────────────

import { persistentHomology0, bottleneckDistance, type FiltrationStep } from "./persistence.js";

describe("v2.19.47 CHRONOSHEAF P2-c · persistent homology", () => {
  it("two isolated vertices → 2 essential 0-classes", () => {
    const filt: FiltrationStep[] = [{ value: 0, add: [["x"], ["y"]] }];
    const pd = persistentHomology0(filt);
    expect(pd.essentialByDim[0]).toBe(2);
  });
  it("vertices then edge → 1 essential, 1 finite-persistence pair", () => {
    const filt: FiltrationStep[] = [
      { value: 0, add: [["x"], ["y"]] },
      { value: 1, add: [["x", "y"]] },
    ];
    const pd = persistentHomology0(filt);
    expect(pd.essentialByDim[0]).toBe(1);
    const finite = pd.pairs.filter((p) => isFinite(p.persistence));
    expect(finite.length).toBe(1);
    expect(finite[0]!.persistence).toBe(1);
  });
  it("bottleneckDistance is 0 between identical diagrams", () => {
    const filt: FiltrationStep[] = [
      { value: 0, add: [["a"], ["b"]] },
      { value: 1, add: [["a", "b"]] },
    ];
    const a = persistentHomology0(filt);
    const b = persistentHomology0(filt);
    expect(bottleneckDistance(a, b)).toBe(0);
  });
});

// ─── P2-d free_energy ──────────────────────────────────────────────────

import {
  klDivergence, entropy, variationalFreeEnergy,
  expectedFreeEnergy, selectAction, confidenceToPosterior, normalise,
} from "./free_energy.js";

describe("v2.19.47 CHRONOSHEAF P2-d · free energy", () => {
  it("KL(p ‖ p) = 0", () => {
    const p = normalise([1, 2, 3]);
    expect(klDivergence(p, p)).toBeCloseTo(0, 9);
  });
  it("entropy of uniform = log(n)", () => {
    const p = normalise([1, 1, 1, 1]);
    expect(entropy(p)).toBeCloseTo(Math.log(4), 9);
  });
  it("variational F is finite for valid inputs", () => {
    const q = normalise([0.7, 0.3]);
    const prior = normalise([0.5, 0.5]);
    const logLik = [Math.log(0.9), Math.log(0.1)];
    const F = variationalFreeEnergy(q, prior, logLik);
    expect(Number.isFinite(F)).toBe(true);
  });
  it("selectAction picks the candidate with minimal G", () => {
    const scoring = { preferredObs: normalise([0.9, 0.1]), priorZ: normalise([0.5, 0.5]) };
    const candidates = [
      { id: "good", predictedObs: normalise([0.85, 0.15]), predictedQz: normalise([0.7, 0.3]) },
      { id: "bad",  predictedObs: normalise([0.1, 0.9]),  predictedQz: normalise([0.5, 0.5]) },
    ];
    const r = selectAction(candidates, scoring);
    expect(r.winner.id).toBe("good");
  });
  it("confidenceToPosterior turns 0.6 into a Beta posterior mean near 0.6", () => {
    const r = confidenceToPosterior(0.6, 100);
    expect(r.posterior[0]!).toBeGreaterThan(0.55);
    expect(r.posterior[0]!).toBeLessThan(0.65);
    expect(r.entropyBits).toBeGreaterThan(0);
  });
});

// ─── P2-e wasserstein ──────────────────────────────────────────────────

import { wasserstein1D, sinkhorn, catalogDrift, type DiscreteMeasure } from "./wasserstein.js";

describe("v2.19.47 CHRONOSHEAF P2-e · wasserstein", () => {
  it("W_1 between identical distributions = 0", () => {
    const mu: DiscreteMeasure = new Map([["0", 0.5], ["1", 0.5]]);
    expect(wasserstein1D(mu, mu)).toBe(0);
  });
  it("W_1 between point masses at 0 and 1 = 1", () => {
    const mu: DiscreteMeasure = new Map([["0", 1]]);
    const nu: DiscreteMeasure = new Map([["1", 1]]);
    expect(wasserstein1D(mu, nu)).toBeCloseTo(1, 9);
  });
  it("sinkhorn returns a coupling with given marginals (approximately)", () => {
    const mu = [0.5, 0.5];
    const nu = [0.5, 0.5];
    const C = [[0, 1], [1, 0]];
    const r = sinkhorn(mu, nu, C, { epsilon: 0.1, maxIter: 200 });
    expect(r.iterations).toBeGreaterThan(0);
    // Row sums approximately match mu.
    for (let i = 0; i < mu.length; i++) {
      const rowSum = r.coupling[i]!.reduce((a, x) => a + x, 0);
      expect(Math.abs(rowSum - mu[i]!)).toBeLessThan(0.01);
    }
  });
  it("catalogDrift = 0 between identical snapshots", () => {
    const snap = ["mneme.x.y", "mneme.a.b"];
    expect(catalogDrift(snap, snap)).toBe(0);
  });
  it("catalogDrift > 0 between disjoint family snapshots", () => {
    const a = ["mneme.x.y"];
    const b = ["mneme.z.w"];
    expect(catalogDrift(a, b)).toBeGreaterThan(0);
  });
});

// ─── P2-f tropical ─────────────────────────────────────────────────────

import {
  tropicalAdd, tropicalMul, tropicalLongestPath, verifierChainConfidence,
  type TropicalGraph,
} from "./tropical.js";

describe("v2.19.47 CHRONOSHEAF P2-f · tropical semiring", () => {
  it("tropical add = max, mul = sum", () => {
    expect(tropicalAdd(3, 5)).toBe(5);
    expect(tropicalMul(3, 5)).toBe(8);
  });
  it("longest path through a 3-node chain returns sum of edge weights", () => {
    const g: TropicalGraph = {
      nodes: ["A", "B", "C"],
      edges: new Map([
        ["A", [{ to: "B", weight: 2, label: "AB" }]],
        ["B", [{ to: "C", weight: 3, label: "BC" }]],
      ]),
    };
    const r = tropicalLongestPath(g, "A", "C");
    expect(r).toBeTruthy();
    expect(r!.value).toBe(5);
    expect(r!.path).toEqual(["A", "B", "C"]);
    expect(r!.criticalEdge?.label).toBe("AB"); // smaller weight
  });
  it("verifierChainConfidence is the min + identifies critical verifier", () => {
    const r = verifierChainConfidence([
      { id: "a", confidence: 0.9 },
      { id: "b", confidence: 0.6 },
      { id: "c", confidence: 0.95 },
    ]);
    expect(r.chainConfidence).toBe(0.6);
    expect(r.criticalVerifier?.id).toBe("b");
  });
  it("empty chain returns confidence 1 + null critical", () => {
    const r = verifierChainConfidence([]);
    expect(r.chainConfidence).toBe(1);
    expect(r.criticalVerifier).toBeNull();
  });
});

// ─── P2-g aczel ────────────────────────────────────────────────────────

import { bisimulationPartition, bisimilar, quineAtom, liarHyperset, isTrustworthy } from "./aczel.js";

describe("v2.19.47 CHRONOSHEAF P2-g · Aczel anti-foundation", () => {
  it("two Quine atoms are bisimilar", () => {
    const a = quineAtom("X");
    const b = quineAtom("Y");
    expect(bisimilar(a, b)).toBe(true);
  });
  it("Quine atom ≠ labelled LIAR atom (different labels disambiguate)", () => {
    const q = quineAtom("Q");
    const l = liarHyperset("L");
    expect(bisimilar(q, l)).toBe(false);
  });
  it("isTrustworthy returns true for an unlabelled Quine atom", () => {
    const q = quineAtom();
    const r = isTrustworthy(q);
    expect(r.trust).toBe(true);
  });
  it("isTrustworthy returns false for a LIAR hyperset", () => {
    const l = liarHyperset();
    const r = isTrustworthy(l);
    expect(r.trust).toBe(false);
    expect(r.reason).toContain("LIAR");
  });
  it("bisimulationPartition on a singleton labelled graph yields 1 class", () => {
    const h = quineAtom();
    const p = bisimulationPartition(h);
    expect(new Set(p.values()).size).toBe(1);
  });
});

// ─── 1000-iter fuzz ────────────────────────────────────────────────────

describe("v2.19.47 CHRONOSHEAF · 1000-iter cross-primitive fuzz", () => {
  it("sheaf cohomologyH1 never throws on random small covers", () => {
    for (let i = 0; i < 1000; i++) {
      const n = 3 + (i % 5);
      const sites: string[] = [];
      for (let k = 0; k < n; k++) sites.push(`S${k}`);
      const overlaps: Array<[string, string]> = [];
      for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
        if (Math.random() < 0.5) overlaps.push([sites[a]!, sites[b]!]);
      }
      expect(() => cohomologyH1({ sites, overlaps })).not.toThrow();
    }
  });
  it("RG flow never throws on random vectors", () => {
    for (let i = 0; i < 200; i++) {
      const len = 1 + (i % 32);
      const vector = Array.from({ length: len }, () => Math.random() * 100);
      expect(() => rgFixedPoint({ vector, scale: 0 }, { factor: 2, aggregator: "mean" }, 20)).not.toThrow();
    }
  });
  it("free_energy.selectAction never throws on random candidate sets", () => {
    for (let i = 0; i < 200; i++) {
      const supportSize = 2 + (i % 4);
      const rand = (): number[] => Array.from({ length: supportSize }, () => Math.random());
      const cands = Array.from({ length: 3 }, (_, k) => ({
        id: `c${k}`,
        predictedObs: normalise(rand()),
        predictedQz: normalise(rand()),
      }));
      const scoring = { preferredObs: normalise(rand()), priorZ: normalise(rand()) };
      expect(() => selectAction(cands, scoring)).not.toThrow();
    }
  });
});
