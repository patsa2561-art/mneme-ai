/**
 * Mendelian merge — golden + property-based tests.
 *
 * The merge is the BEDROCK of cross-machine lineage. If it isn't
 * deterministic + commutative + sound, the whole pedigree is unreliable.
 */

import { describe, expect, it } from "vitest";
import {
  mendelMerge,
  mergeAtomKarma,
  mergeMolecules,
  mergeVectorClock,
  intersectLethals,
  unionLethals,
} from "./mendel.js";
import type { AtomKarmaDelta, Chromosome } from "./types.js";

function chromo(over: Partial<Chromosome>): Chromosome {
  return {
    schemaVersion: 1,
    id: "test",
    createdAt: "2026-05-09T00:00:00Z",
    vendor: "test",
    machineId: "m1",
    parents: [],
    vectorClock: { m1: 1 },
    topic: "topic",
    atomKarmaDeltas: {},
    molecules: [],
    courtVerdicts: [],
    confessOutcomes: { verified: 0, partiallyVerified: 0, hallucination: 0, unverifiable: 0, avgSelfConfidence: 0 },
    voiceFingerprint: { avgSentenceLen: 0, topPhrases: [], topTopics: [] },
    constitutionCandidates: [],
    lethalRecessives: [],
    session: { startedAt: "", endedAt: "", totalCalls: 0, endReason: "manual" },
    signedBy: "",
    signature: "",
    contentHash: "",
    ...over,
  };
}

const k = (karma: number, inv = 1): AtomKarmaDelta => ({ karma, invocations: inv, verified: 0, hallucinations: 0 });

describe("mergeAtomKarma — sign rules", () => {
  it("both positive → max", () => {
    const out = mergeAtomKarma({ x: k(3) }, { x: k(7) }, new Set());
    expect(out["x"]?.karma).toBe(7);
  });
  it("both negative → min (deepens)", () => {
    const out = mergeAtomKarma({ x: k(-3) }, { x: k(-7) }, new Set());
    expect(out["x"]?.karma).toBe(-7);
  });
  it("mixed signs → mean", () => {
    const out = mergeAtomKarma({ x: k(4) }, { x: k(-2) }, new Set());
    expect(out["x"]?.karma).toBe(1);
  });
  it("one-sided → carry through", () => {
    const out = mergeAtomKarma({ x: k(5) }, {}, new Set());
    expect(out["x"]?.karma).toBe(5);
  });
  it("counters sum across both parents", () => {
    const out = mergeAtomKarma(
      { x: { karma: 1, invocations: 3, verified: 2, hallucinations: 0 } },
      { x: { karma: 2, invocations: 4, verified: 1, hallucinations: 1 } },
      new Set(),
    );
    expect(out["x"]?.invocations).toBe(7);
    expect(out["x"]?.verified).toBe(3);
    expect(out["x"]?.hallucinations).toBe(1);
  });
  it("lethal union strips atom from gene pool", () => {
    const out = mergeAtomKarma({ bad: k(-5), good: k(3) }, { bad: k(-2) }, new Set(["bad"]));
    expect(out["bad"]).toBeUndefined();
    expect(out["good"]).toBeDefined();
  });
});

describe("mergeMolecules", () => {
  it("dedupes by name; fireCount = max; karma = sum", () => {
    const a = [{ name: "X__Y", atoms: ["X", "Y"], fireCount: 3, karma: 5 }];
    const b = [{ name: "X__Y", atoms: ["X", "Y"], fireCount: 7, karma: 4 }];
    const out = mergeMolecules(a, b);
    expect(out).toHaveLength(1);
    expect(out[0]!.fireCount).toBe(7);
    expect(out[0]!.karma).toBe(9);
  });
  it("union of distinct molecules is preserved", () => {
    const a = [{ name: "A", atoms: [], fireCount: 1, karma: 0 }];
    const b = [{ name: "B", atoms: [], fireCount: 2, karma: 0 }];
    expect(mergeMolecules(a, b)).toHaveLength(2);
  });
});

describe("mergeVectorClock — Lamport-style max", () => {
  it("merges per-machine max", () => {
    const a = { laptop: 5, desktop: 3 };
    const b = { laptop: 2, desktop: 8, phone: 1 };
    expect(mergeVectorClock(a, b)).toEqual({ laptop: 5, desktop: 8, phone: 1 });
  });
});

describe("Lethal recessives", () => {
  it("intersect: only atoms in BOTH parents stay lethal in child", () => {
    expect(intersectLethals(["a", "b"], ["b", "c"])).toEqual(["b"]);
  });
  it("union: cull set is anything either parent flagged", () => {
    expect(unionLethals(["a"], ["b"])).toEqual(new Set(["a", "b"]));
  });
});

describe("mendelMerge — properties", () => {
  it("commutative: f(A,B).atomKarmaDeltas === f(B,A).atomKarmaDeltas (modulo order)", () => {
    const a = chromo({ id: "A", atomKarmaDeltas: { x: k(3), y: k(-2) } });
    const b = chromo({ id: "B", atomKarmaDeltas: { x: k(7), y: k(4) } });
    const ab = mendelMerge(a, b);
    const ba = mendelMerge(b, a);
    expect(ab.atomKarmaDeltas).toEqual(ba.atomKarmaDeltas);
  });

  it("invocations are additive (no double-count, no loss)", () => {
    const a = chromo({ id: "A", atomKarmaDeltas: { x: k(1, 5) } });
    const b = chromo({ id: "B", atomKarmaDeltas: { x: k(2, 3) } });
    const child = mendelMerge(a, b);
    expect(child.atomKarmaDeltas["x"]?.invocations).toBe(8);
  });

  it("lethal in BOTH parents stays lethal in child + culled from karma", () => {
    const a = chromo({ id: "A", atomKarmaDeltas: { bad: k(-3), good: k(2) }, lethalRecessives: ["bad"] });
    const b = chromo({ id: "B", atomKarmaDeltas: { bad: k(-4), good: k(5) }, lethalRecessives: ["bad"] });
    const child = mendelMerge(a, b);
    expect(child.lethalRecessives).toContain("bad");
    expect(child.atomKarmaDeltas["bad"]).toBeUndefined();
    expect(child.atomKarmaDeltas["good"]).toBeDefined();
  });

  it("lethal in ONLY ONE parent → atom dropped from karma but NOT inherited as lethal", () => {
    const a = chromo({ id: "A", atomKarmaDeltas: { bad: k(-3) }, lethalRecessives: ["bad"] });
    const b = chromo({ id: "B", atomKarmaDeltas: { bad: k(2) }, lethalRecessives: [] });
    const child = mendelMerge(a, b);
    expect(child.lethalRecessives).not.toContain("bad");
    expect(child.atomKarmaDeltas["bad"]).toBeUndefined(); // culled because UNION lethal
  });

  it("vector clock merges as Lamport max", () => {
    const a = chromo({ vectorClock: { laptop: 5 } });
    const b = chromo({ vectorClock: { laptop: 3, desktop: 8 } });
    const child = mendelMerge(a, b);
    expect(child.vectorClock).toEqual({ laptop: 5, desktop: 8 });
  });

  it("parents IDs are sorted (deterministic regardless of call order)", () => {
    const a = chromo({ id: "alpha" });
    const b = chromo({ id: "beta" });
    expect(mendelMerge(a, b).parents).toEqual(["alpha", "beta"]);
    expect(mendelMerge(b, a).parents).toEqual(["alpha", "beta"]);
  });

  it("topic = longest of the two parents (richer description wins)", () => {
    const a = chromo({ topic: "auth" });
    const b = chromo({ topic: "auth refactor part 2 with token rotation" });
    expect(mendelMerge(a, b).topic).toBe(b.topic);
  });

  it("court verdicts dedupe by claim", () => {
    const a = chromo({ courtVerdicts: [{ claim: "X is dead", verdict: "motion_to_dismiss", evidenceBalance: -0.7, topWitnesses: [] }] });
    const b = chromo({ courtVerdicts: [{ claim: "X is dead", verdict: "verdict_for_plaintiff", evidenceBalance: 0.6, topWitnesses: [] }] });
    const child = mendelMerge(a, b);
    expect(child.courtVerdicts).toHaveLength(1);
  });

  it("confess outcomes sum + recompute weighted-average self confidence", () => {
    const a = chromo({ confessOutcomes: { verified: 4, partiallyVerified: 1, hallucination: 0, unverifiable: 0, avgSelfConfidence: 0.6 } });
    const b = chromo({ confessOutcomes: { verified: 6, partiallyVerified: 0, hallucination: 0, unverifiable: 0, avgSelfConfidence: 0.8 } });
    const child = mendelMerge(a, b);
    expect(child.confessOutcomes.verified).toBe(10);
    // Weighted: (5*0.6 + 6*0.8) / 11 ≈ 0.709
    expect(child.confessOutcomes.avgSelfConfidence).toBeCloseTo(0.709, 2);
  });
});

describe("mendelMerge — golden file", () => {
  it("matches the reference output for a known pair", () => {
    const a = chromo({
      id: "A",
      vectorClock: { m1: 5 },
      topic: "auth",
      atomKarmaDeltas: {
        "mneme.memory.ask": { karma: 4, invocations: 6, verified: 4, hallucinations: 0 },
        "mneme.bad": { karma: -3, invocations: 2, verified: 0, hallucinations: 2 },
      },
      molecules: [{ name: "ask__certify", atoms: ["mneme.memory.ask", "mneme.audit.certify"], fireCount: 3, karma: 5 }],
      lethalRecessives: ["mneme.bad"],
    });
    const b = chromo({
      id: "B",
      vectorClock: { m1: 2, m2: 7 },
      topic: "authentication refactor (longer)",
      atomKarmaDeltas: {
        "mneme.memory.ask": { karma: 6, invocations: 4, verified: 3, hallucinations: 0 },
        "mneme.audit.certify": { karma: 5, invocations: 5, verified: 4, hallucinations: 0 },
        "mneme.bad": { karma: -2, invocations: 1, verified: 0, hallucinations: 1 },
      },
      molecules: [{ name: "ask__certify", atoms: ["mneme.memory.ask", "mneme.audit.certify"], fireCount: 5, karma: 4 }],
      lethalRecessives: ["mneme.bad"],
    });
    const child = mendelMerge(a, b);
    // Atoms: ask is both-positive → max=6; certify one-sided → 5; bad culled.
    expect(child.atomKarmaDeltas["mneme.memory.ask"]?.karma).toBe(6);
    expect(child.atomKarmaDeltas["mneme.memory.ask"]?.invocations).toBe(10);
    expect(child.atomKarmaDeltas["mneme.audit.certify"]?.karma).toBe(5);
    expect(child.atomKarmaDeltas["mneme.bad"]).toBeUndefined();
    // Molecules: same name → fireCount=max=5, karma=sum=9
    expect(child.molecules[0]!.fireCount).toBe(5);
    expect(child.molecules[0]!.karma).toBe(9);
    // Vector clock: max per machine
    expect(child.vectorClock).toEqual({ m1: 5, m2: 7 });
    // Topic: longer wins
    expect(child.topic).toBe("authentication refactor (longer)");
    // Lethal: intersection
    expect(child.lethalRecessives).toEqual(["mneme.bad"]);
    // Parents sorted
    expect(child.parents).toEqual(["A", "B"]);
  });
});
