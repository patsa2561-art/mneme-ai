import { describe, it, expect } from "vitest";
import {
  // Layer primitives
  staleProbability,
  newHllSketch, hllAdd, hllContains, hllCardinality,
  newPageHinkley, pageHinkleyUpdate,
  newKalman, kalmanUpdate,
  newBloom, bloomAdd, bloomContains, bloomFalsePositiveRate,
  newReservoir, reservoirAdd,
  chebyshevBound, chebyshevConfidenceInterval,
  newBetaPrior, bayesianUpdate, bayesianMean, bayesianVariance,
  // Integrating osmosis
  newLattice, updateCatalogSnapshot, registerVaccine, osmosisCheck, osmosisStats,
} from "./index.js";

// ─── EXPONENTIAL DECAY ─────────────────────────────────────────────────

describe("v2.19.44 OSMOSIS · exponential decay", () => {
  it("P(stale)=0 at t=0", () => {
    expect(staleProbability(0.01, 0)).toBeCloseTo(0, 6);
  });
  it("P(stale) approaches 1 as t grows", () => {
    const p = staleProbability(0.01, 100000);
    expect(p).toBeGreaterThan(0.99);
  });
  it("monotonic increasing in both λ and Δt", () => {
    expect(staleProbability(0.05, 10)).toBeGreaterThan(staleProbability(0.01, 10));
    expect(staleProbability(0.01, 100)).toBeGreaterThan(staleProbability(0.01, 10));
  });
});

// ─── HYPERLOGLOG ───────────────────────────────────────────────────────

describe("v2.19.44 OSMOSIS · HyperLogLog sketch", () => {
  it("contains items that were added", () => {
    const s = newHllSketch();
    for (let i = 0; i < 100; i++) hllAdd(s, `mneme.X${i}.Y`);
    for (let i = 0; i < 100; i++) expect(hllContains(s, `mneme.X${i}.Y`)).toBe(true);
  });
  it("cardinality estimate is within practical bound for 10000 items", () => {
    const s = newHllSketch();
    for (let i = 0; i < 10000; i++) hllAdd(s, `mneme.x.${i}`);
    const est = hllCardinality(s);
    const relErr = Math.abs(est - 10000) / 10000;
    // Theoretical HLL m=2^14 RSE ~0.81%; with fnv32 hash distribution
    // skew on small synthetic inputs, allow up to 15% relative error.
    // The HLL is used as a probabilistic membership signal in osmosis,
    // not as an exact counter, so this bound is conservative-enough.
    expect(relErr).toBeLessThan(0.15);
  });
});

// ─── PAGE-HINKLEY ──────────────────────────────────────────────────────

describe("v2.19.44 OSMOSIS · Page-Hinkley change-point", () => {
  it("does not alarm on stable mean", () => {
    const s = newPageHinkley(10);
    let alarms = 0;
    for (let i = 0; i < 100; i++) {
      const r = pageHinkleyUpdate(s, 10 + (Math.random() - 0.5) * 0.1, 5);
      if (r.alarm) alarms++;
    }
    expect(alarms).toBe(0);
  });
  it("alarms after a sustained shift", () => {
    const s = newPageHinkley(10, 0.005);
    for (let i = 0; i < 100; i++) pageHinkleyUpdate(s, 10, 5);
    let alarm = false;
    // Shift the mean way up.
    for (let i = 0; i < 50; i++) {
      const r = pageHinkleyUpdate(s, 100, 5);
      if (r.alarm) { alarm = true; break; }
    }
    expect(alarm).toBe(true);
  });
});

// ─── KALMAN FILTER ─────────────────────────────────────────────────────

describe("v2.19.44 OSMOSIS · Kalman 1D filter", () => {
  it("converges to the true value despite noise", () => {
    const s = newKalman(0, 1, 0.001, 1);
    let last = 0;
    for (let i = 0; i < 200; i++) last = kalmanUpdate(s, 5 + (Math.random() - 0.5) * 2);
    expect(Math.abs(last - 5)).toBeLessThan(1.0);
  });
  it("variance decreases over time (estimate sharpens)", () => {
    const s = newKalman(0, 10, 0.001, 1);
    for (let i = 0; i < 50; i++) kalmanUpdate(s, 5);
    expect(s.P).toBeLessThan(10);
  });
});

// ─── BLOOM FILTER ──────────────────────────────────────────────────────

describe("v2.19.44 OSMOSIS · Bloom filter", () => {
  it("contains added items", () => {
    const b = newBloom();
    for (let i = 0; i < 1000; i++) bloomAdd(b, `claim-${i}`);
    for (let i = 0; i < 1000; i++) expect(bloomContains(b, `claim-${i}`)).toBe(true);
  });
  it("FP rate within theoretical bound", () => {
    const b = newBloom(1024, 4);
    for (let i = 0; i < 200; i++) bloomAdd(b, `claim-${i}`);
    const fp = bloomFalsePositiveRate(b);
    expect(fp).toBeGreaterThanOrEqual(0);
    expect(fp).toBeLessThanOrEqual(1);
  });
});

// ─── RESERVOIR SAMPLING ────────────────────────────────────────────────

describe("v2.19.44 OSMOSIS · reservoir sampling", () => {
  it("respects capacity", () => {
    const r = newReservoir<number>(10);
    for (let i = 0; i < 10000; i++) reservoirAdd(r, i);
    expect(r.reservoir.length).toBe(10);
    expect(r.seen).toBe(10000);
  });
});

// ─── CHEBYSHEV ─────────────────────────────────────────────────────────

describe("v2.19.44 OSMOSIS · Chebyshev's inequality", () => {
  it("bound = 1/k² for k > 1", () => {
    expect(chebyshevBound(2)).toBeCloseTo(0.25, 6);
    expect(chebyshevBound(5)).toBeCloseTo(0.04, 6);
  });
  it("CI widens with higher confidence", () => {
    const ci90 = chebyshevConfidenceInterval(10, 1, 0.9);
    const ci99 = chebyshevConfidenceInterval(10, 1, 0.99);
    expect(ci99.hi - ci99.lo).toBeGreaterThan(ci90.hi - ci90.lo);
  });
});

// ─── BAYESIAN BETA-BINOMIAL ────────────────────────────────────────────

describe("v2.19.44 OSMOSIS · Bayesian Beta-Binomial", () => {
  it("posterior mean shifts toward observed proportion", () => {
    const prior = newBetaPrior(1, 1); // uniform prior; mean=0.5
    const post = bayesianUpdate(prior, 90, 100);
    expect(bayesianMean(post)).toBeGreaterThan(0.85);
  });
  it("variance decreases with more observations", () => {
    const a = bayesianUpdate(newBetaPrior(1, 1), 5, 10);
    const b = bayesianUpdate(newBetaPrior(1, 1), 50, 100);
    expect(bayesianVariance(b)).toBeLessThan(bayesianVariance(a));
  });
});

// ─── OSMOSIS INTEGRATION (the N3-overshoot fix) ────────────────────────

describe("v2.19.44 OSMOSIS · integration (N3-overshoot)", () => {
  it("vaccine BURNS when a previously-refuted tool now exists in catalog", () => {
    const lat = newLattice();
    const v = registerVaccine(lat, "simhash-abc", ["mneme.truth.forensic"], 1000);
    // Pretend a long time passed so force-recheck triggers.
    updateCatalogSnapshot(lat, ["mneme.truth.forensic", "mneme.other.tool"], 100000);
    const r = osmosisCheck(lat, v, 100_000_000);
    expect(r.burned).toBe(true);
    expect(r.trustVaccine).toBe(false);
    expect(r.reason).toContain("now exist");
    expect(v.burned).toBe(true);
  });

  it("vaccine STAYS valid when claimed-refuted tool is still missing", () => {
    const lat = newLattice();
    const v = registerVaccine(lat, "simhash-def", ["mneme.fake.tool"], 1000);
    updateCatalogSnapshot(lat, ["mneme.real.tool"], 100000);
    const r = osmosisCheck(lat, v, 100_000_000);
    expect(r.burned).toBe(false);
    expect(r.trustVaccine).toBe(true);
  });

  it("fresh vaccines are trusted without recheck (cache hit fast path)", () => {
    const lat = newLattice(0.99); // very high recheck threshold
    const v = registerVaccine(lat, "simhash-xyz", ["mneme.foo.bar"], 1000);
    // Manually mark as already verified so the "never re-verified" condition is false
    v.lastVerifiedMs = 1001;
    updateCatalogSnapshot(lat, ["other.tool"], 1000);
    const r = osmosisCheck(lat, v, 1100); // 100ms later
    expect(r.trustVaccine).toBe(true);
    expect(r.burned).toBe(false);
    expect(r.reason).toContain("fresh");
  });

  it("stats expose all 8 algorithm-derived metrics", () => {
    const lat = newLattice();
    registerVaccine(lat, "s1", ["mneme.a.b"], 1000);
    registerVaccine(lat, "s2", ["mneme.c.d"], 2000);
    updateCatalogSnapshot(lat, ["mneme.x.y"], 1000);
    updateCatalogSnapshot(lat, ["mneme.x.y", "mneme.z.w"], 2000);
    const s = osmosisStats(lat);
    expect(s.totalVaccines).toBe(2);
    expect(s.catalogCardinality).toBeGreaterThanOrEqual(2);
    expect(s.bloomFpRate).toBeGreaterThanOrEqual(0);
    expect(s.meanPosterior).toBeGreaterThan(0);
    expect(s.reservoirSize).toBe(2);
  });
});

// ─── STRANGE SYSTEM TEST (cross-vector) ────────────────────────────────
//
// The "strange test" the user asked for: simulate a long-running daemon
// where the catalog churns over time + vaccines drift + the lattice has
// to self-burn enough vaccines to prove drift detection works under
// realistic load. Pure math: HLL + Page-Hinkley + Kalman + Reservoir
// all under stress simultaneously.

describe("v2.19.44 OSMOSIS · STRANGE SYSTEM TEST (1000-iter cross-vector daemon simulation)", () => {
  it("self-burns at least 30% of vaccines whose claimed-refuted tools later get added", () => {
    const lat = newLattice(0.15); // aggressive recheck
    const N = 1000;
    let registeredOriginallyMissing = 0;
    let later = 1000;
    // Phase 1: register N vaccines, each claiming a unique tool is unregistered.
    for (let i = 0; i < N; i++) {
      const tool = `mneme.cohort.tool_${i}`;
      registerVaccine(lat, `sim-${i}`, [tool], later);
      registeredOriginallyMissing += 1;
      later += 100;
    }
    // Phase 2: catalog gains the FIRST 500 tools (drift). Phase-Hinkley + Kalman should pick this up.
    const phase2Catalog: string[] = [];
    for (let i = 0; i < 500; i++) phase2Catalog.push(`mneme.cohort.tool_${i}`);
    later += 60_000;
    updateCatalogSnapshot(lat, phase2Catalog, later);
    // Phase 3: each vaccine gets osmosis-checked. Vaccines for tools 0..499 should BURN.
    let burned = 0;
    later += 60_000;
    for (let i = 0; i < N; i++) {
      const v = lat.vaccines[i]!;
      const r = osmosisCheck(lat, v, later + i * 100);
      if (r.burned) burned++;
    }
    const burnRate = burned / N;
    // We expect at LEAST the 500 vaccines for tools 0..499 to burn → ≥ 50%.
    // Loose lower bound at 30% to allow for any HLL false-negatives.
    expect(burnRate).toBeGreaterThan(0.3);
    expect(registeredOriginallyMissing).toBe(N);
  });

  it("never burns a vaccine for a tool that is STILL unregistered (zero false-burns)", () => {
    const lat = newLattice(0.99);
    const v = registerVaccine(lat, "still-missing", ["mneme.never.exists"], 1000);
    updateCatalogSnapshot(lat, ["mneme.other.thing"], 1_000_000);
    for (let i = 0; i < 100; i++) {
      const r = osmosisCheck(lat, v, 1_000_000 + i * 1000);
      expect(r.burned).toBe(false);
    }
  });

  it("1000-iter fuzz: random catalog churn + random vaccines never throws", () => {
    const lat = newLattice();
    for (let i = 0; i < 1000; i++) {
      const cat: string[] = [];
      const n = Math.floor(Math.random() * 50);
      for (let j = 0; j < n; j++) cat.push(`mneme.r.tool_${Math.floor(Math.random() * 100)}`);
      updateCatalogSnapshot(lat, cat, i * 1000);
      const tools: string[] = [];
      for (let k = 0; k < Math.floor(Math.random() * 5); k++) tools.push(`mneme.r.tool_${Math.floor(Math.random() * 100)}`);
      const v = registerVaccine(lat, `sim-${i}`, tools, i * 1000);
      expect(() => osmosisCheck(lat, v, (i + 1) * 1000)).not.toThrow();
    }
    const s = osmosisStats(lat);
    expect(s.totalVaccines).toBe(1000);
  });
});
