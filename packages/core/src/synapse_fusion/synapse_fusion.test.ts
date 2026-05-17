import { describe, it, expect } from "vitest";
import {
  detectAdjacentPairs,
  fuseSynapses,
  runFusionCycle,
  verifyFusionReport,
  formatFusedLine,
  formatFusionReportLine,
  FUSION_TUNABLES,
  type ObservedToolCall,
} from "./index.js";

const SECRET = "fusion-test-secret-997744";

function log(...entries: ObservedToolCall[]): ObservedToolCall[] {
  return entries;
}

describe("v2.19.29 SYNAPSE FUSION · detectAdjacentPairs", () => {
  it("zero log → empty result (defensive)", () => {
    expect(detectAdjacentPairs({ log: [] })).toEqual([]);
  });

  it("single entry → empty (no pair possible)", () => {
    expect(detectAdjacentPairs({ log: [{ toolName: "a", ts: 1 }] })).toEqual([]);
  });

  it("MEASURED canonical scenario: 4 (A,B) within 500ms + 5 total A → ratio 0.8", () => {
    const obs: ObservedToolCall[] = [];
    for (let i = 0; i < 5; i++) {
      obs.push({ toolName: "A", ts: i * 1000 });
      if (i < 4) obs.push({ toolName: "B", ts: i * 1000 + 100 }); // within 500ms gap
    }
    const pairs = detectAdjacentPairs({ log: obs, minCount: 1 });
    const ab = pairs.find((p) => p.toolA === "A" && p.toolB === "B");
    expect(ab).toBeDefined();
    expect(ab!.cooccurrenceRatio).toBeCloseTo(4 / 5, 5);
  });

  it("pairs outside temporalGapMs window are NOT counted", () => {
    const obs: ObservedToolCall[] = [];
    for (let i = 0; i < 5; i++) {
      obs.push({ toolName: "A", ts: i * 1000 });
      obs.push({ toolName: "B", ts: i * 1000 + 600 }); // beyond 500ms gap
    }
    const pairs = detectAdjacentPairs({ log: obs, temporalGapMs: 500, minCount: 1 });
    expect(pairs.find((p) => p.toolA === "A" && p.toolB === "B")).toBeUndefined();
  });

  it("self-pairs (A→A) excluded", () => {
    const obs: ObservedToolCall[] = [];
    for (let i = 0; i < 10; i++) obs.push({ toolName: "A", ts: i * 100 });
    const pairs = detectAdjacentPairs({ log: obs, minCount: 1 });
    expect(pairs.find((p) => p.toolA === p.toolB)).toBeUndefined();
  });

  it("A→B and B→A are DIFFERENT pairs (ordered direction matters)", () => {
    // 4 iterations of A → B → A — A appears 8 times; B appears 4 times.
    // A→B happens 4 times (4/8 ratio = 0.5); B→A happens 4 times (4/4 ratio = 1.0).
    // With cooccurrenceThreshold lowered to 0.3, BOTH must surface as distinct pairs.
    const obs: ObservedToolCall[] = [];
    for (let i = 0; i < 4; i++) {
      obs.push({ toolName: "A", ts: i * 1000 });
      obs.push({ toolName: "B", ts: i * 1000 + 100 });
      obs.push({ toolName: "A", ts: i * 1000 + 200 });
    }
    const pairs = detectAdjacentPairs({ log: obs, minCount: 1, cooccurrenceThreshold: 0.3 });
    const ab = pairs.find((p) => p.toolA === "A" && p.toolB === "B");
    const ba = pairs.find((p) => p.toolA === "B" && p.toolB === "A");
    expect(ab).toBeDefined();
    expect(ba).toBeDefined();
    expect(ab!.cooccurrenceRatio).not.toBe(ba!.cooccurrenceRatio); // distinct directions
  });

  it("cooccurrenceThreshold filters low-confidence pairs", () => {
    const obs: ObservedToolCall[] = [];
    for (let i = 0; i < 10; i++) {
      obs.push({ toolName: "A", ts: i * 1000 });
      if (i < 3) obs.push({ toolName: "B", ts: i * 1000 + 100 }); // 3/10 = 0.3 ratio
    }
    const strict = detectAdjacentPairs({ log: obs, cooccurrenceThreshold: 0.8, minCount: 1 });
    expect(strict.find((p) => p.toolA === "A" && p.toolB === "B")).toBeUndefined();
    const loose = detectAdjacentPairs({ log: obs, cooccurrenceThreshold: 0.1, minCount: 1 });
    expect(loose.find((p) => p.toolA === "A" && p.toolB === "B")).toBeDefined();
  });

  it("minCount filters infrequent pairs (anti-noise)", () => {
    const obs: ObservedToolCall[] = [
      { toolName: "A", ts: 0 }, { toolName: "B", ts: 100 },
      { toolName: "A", ts: 1000 }, { toolName: "B", ts: 1100 },
    ];
    const strict = detectAdjacentPairs({ log: obs, minCount: 5, cooccurrenceThreshold: 0 });
    expect(strict.length).toBe(0);
    const loose = detectAdjacentPairs({ log: obs, minCount: 1, cooccurrenceThreshold: 0 });
    expect(loose.length).toBeGreaterThan(0);
  });

  it("meanGapMs reflects actual temporal gaps", () => {
    const obs: ObservedToolCall[] = [];
    for (let i = 0; i < 4; i++) {
      obs.push({ toolName: "A", ts: i * 1000 });
      obs.push({ toolName: "B", ts: i * 1000 + 100 });
    }
    const pairs = detectAdjacentPairs({ log: obs, minCount: 1 });
    const ab = pairs.find((p) => p.toolA === "A" && p.toolB === "B")!;
    expect(ab.meanGapMs).toBeCloseTo(100, 0);
  });

  it("DEFENSIVE: NaN ts entries dropped silently", () => {
    const obs: ObservedToolCall[] = [
      { toolName: "A", ts: 0 }, { toolName: "B", ts: 100 },
      { toolName: "BAD", ts: NaN },
      { toolName: "A", ts: 1000 }, { toolName: "B", ts: 1100 },
    ];
    const pairs = detectAdjacentPairs({ log: obs, minCount: 1 });
    expect(pairs.find((p) => p.toolA === "BAD")).toBeUndefined();
    expect(pairs.find((p) => p.toolA === "A" && p.toolB === "B")).toBeDefined();
  });

  it("DEFENSIVE: empty toolName entries dropped silently", () => {
    const obs: ObservedToolCall[] = [
      { toolName: "", ts: 0 },
      { toolName: "B", ts: 100 },
    ];
    expect(detectAdjacentPairs({ log: obs, minCount: 1 })).toEqual([]);
  });
});

describe("v2.19.29 SYNAPSE FUSION · fuseSynapses", () => {
  it("equal latencies → ~50% speedup", () => {
    const f = fuseSynapses({
      pair: { toolA: "A", toolB: "B", cooccurrenceCount: 5, totalACount: 5, cooccurrenceRatio: 1, meanGapMs: 100 },
      estimatedLatencyA: 100,
      estimatedLatencyB: 100,
    });
    expect(f.estimatedSpeedup).toBeCloseTo(0.5, 2);
    expect(f.parallel).toEqual(["A", "B"]);
  });

  it("very different latencies → speedup approaches min(A,B)/sum", () => {
    const f = fuseSynapses({
      pair: { toolA: "fast", toolB: "slow", cooccurrenceCount: 5, totalACount: 5, cooccurrenceRatio: 1, meanGapMs: 100 },
      estimatedLatencyA: 10,
      estimatedLatencyB: 1000,
    });
    // seq=1010, par=1000, speedup = 10/1010 ≈ 0.01
    expect(f.estimatedSpeedup).toBeCloseTo(10 / 1010, 3);
  });

  it("deterministic id from (toolA, toolB)", () => {
    const f1 = fuseSynapses({ pair: { toolA: "x", toolB: "y", cooccurrenceCount: 1, totalACount: 1, cooccurrenceRatio: 1, meanGapMs: 0 } });
    const f2 = fuseSynapses({ pair: { toolA: "x", toolB: "y", cooccurrenceCount: 99, totalACount: 100, cooccurrenceRatio: 0.99, meanGapMs: 50 } });
    expect(f1.id).toBe(f2.id);
  });
});

describe("v2.19.29 SYNAPSE FUSION · runFusionCycle (full loop)", () => {
  it("empty log → zero fused synapses", () => {
    const r = runFusionCycle({ log: [], builtAt: 0, secret: SECRET });
    expect(r.fusedSynapses).toEqual([]);
    expect(r.totalObservations).toBe(0);
  });

  it("HMAC sig verifies; rejects tamper", () => {
    const obs: ObservedToolCall[] = [];
    for (let i = 0; i < 4; i++) {
      obs.push({ toolName: "A", ts: i * 1000 });
      obs.push({ toolName: "B", ts: i * 1000 + 100 });
    }
    const r = runFusionCycle({ log: obs, minCount: 1, builtAt: 0, secret: SECRET });
    expect(verifyFusionReport(r, SECRET)).toBe(true);
    expect(verifyFusionReport({ ...r, totalObservations: 999 }, SECRET)).toBe(false);
  });

  it("MEASURED 100% determinism: same log → same sig (30 trials)", () => {
    const obs: ObservedToolCall[] = [];
    for (let i = 0; i < 5; i++) {
      obs.push({ toolName: "A", ts: i * 1000 });
      obs.push({ toolName: "B", ts: i * 1000 + 100 });
    }
    const first = runFusionCycle({ log: obs, minCount: 1, builtAt: 1_000_000, secret: SECRET }).sig;
    let allEqual = true;
    for (let i = 0; i < 30; i++) {
      if (runFusionCycle({ log: obs, minCount: 1, builtAt: 1_000_000, secret: SECRET }).sig !== first) { allEqual = false; break; }
    }
    expect(allEqual).toBe(true);
  });

  it("real-world scenario: truth.forensic → bug_prophet → apoptosis.detect chain", () => {
    const obs: ObservedToolCall[] = [];
    // Simulate 5 commits each triggering the 3-tool chain
    for (let i = 0; i < 5; i++) {
      const base = i * 10_000;
      obs.push({ toolName: "mneme.truth.forensic", ts: base });
      obs.push({ toolName: "mneme.bug_prophet.prophesy", ts: base + 50 });
      obs.push({ toolName: "mneme.apoptosis.detect", ts: base + 200 });
    }
    const r = runFusionCycle({ log: obs, minCount: 1, builtAt: 0, secret: SECRET });
    // We expect 2 ordered pairs to fuse: forensic→prophesy, prophesy→detect
    const fp = r.fusedSynapses.find((f) => f.toolA === "mneme.truth.forensic" && f.toolB === "mneme.bug_prophet.prophesy");
    const pa = r.fusedSynapses.find((f) => f.toolA === "mneme.bug_prophet.prophesy" && f.toolB === "mneme.apoptosis.detect");
    expect(fp).toBeDefined();
    expect(pa).toBeDefined();
    expect(fp!.cooccurrenceRatio).toBe(1.0);
    expect(pa!.cooccurrenceRatio).toBe(1.0);
  });
});

describe("v2.19.29 SYNAPSE FUSION · formatters + tunables", () => {
  it("formatFusedLine + formatFusionReportLine produce one-line digests", () => {
    const pair = { toolA: "A", toolB: "B", cooccurrenceCount: 5, totalACount: 5, cooccurrenceRatio: 1, meanGapMs: 100 };
    const f = fuseSynapses({ pair });
    expect(formatFusedLine(f)).toContain("FUSED");
    const r = runFusionCycle({ log: [], builtAt: 0, secret: SECRET });
    expect(formatFusionReportLine(r)).toContain("FUSION");
  });

  it("FUSION_TUNABLES exposed for AI introspection (frozen)", () => {
    expect(Object.isFrozen(FUSION_TUNABLES)).toBe(true);
    expect(FUSION_TUNABLES.DEFAULT_TEMPORAL_GAP_MS).toBe(500);
    expect(FUSION_TUNABLES.DEFAULT_COOCCURRENCE_THRESHOLD).toBe(0.8);
  });
});

describe("v2.19.29 SYNAPSE FUSION · 24/7 invariants", () => {
  it("MEASURED never crashes on 500 random observations", () => {
    const obs: ObservedToolCall[] = [];
    for (let i = 0; i < 500; i++) {
      obs.push({ toolName: `tool_${i % 7}`, ts: i * 100 });
    }
    let crashed = false;
    try {
      runFusionCycle({ log: obs, minCount: 2, builtAt: 0, secret: SECRET });
    } catch {
      crashed = true;
    }
    expect(crashed).toBe(false);
  });
});
