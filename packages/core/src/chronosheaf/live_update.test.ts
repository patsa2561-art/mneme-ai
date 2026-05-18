/**
 * v2.19.48 — P3 base_space + P4 live_update test suite.
 *
 * Coverage targets:
 *   - base_space: CommitDag (ancestor cone, LCA, intersection), TimeInterval
 *     (contains, intersect), ScaleBand subset ordering, Presheaf
 *     (assign / sectionAt / restrict / null-safety).
 *   - live_update: empty cover early-exit, single-cycle happy path,
 *     H¹ alarm emission, persistence diagram birth/death, RG promotion,
 *     probe selection, Aczel self-inconsistency, preflight budget guard,
 *     event-cap memory bound, error-handler resilience.
 *
 * Total target: 30+ tests + cross-vector system test.
 */

import { describe, it, expect } from "vitest";
import {
  CommitDag, makeInterval, intervalContains, intervalIntersect,
  scaleIndex, scaleSubset, makeOpen, intersectOpens, openSetId,
  Presheaf, SCALE_BANDS, type OpenSet, type TimeInterval,
} from "./base_space.js";
import {
  chronoSheafUpdate, newUpdateState, chronoSlo, preflightBudget,
  buildSelfAuditCover,
  type UpdateInput, type ChronoEvent,
} from "./live_update.js";
import { quineAtom, liarHyperset } from "./aczel.js";
import { normalise } from "./free_energy.js";

// ─── base_space tests ──────────────────────────────────────────────────

describe("v2.19.48 CHRONOSHEAF P3 · CommitDag", () => {
  it("addCommit rejects invalid sha", () => {
    const d = new CommitDag();
    expect(() => d.addCommit("", [])).toThrow();
  });
  it("cone of a root commit contains only itself", () => {
    const d = new CommitDag();
    d.addCommit("root", []);
    const c = d.cone("root");
    expect(c.has("root")).toBe(true);
    expect(c.size).toBe(1);
  });
  it("cone of a child contains parents transitively", () => {
    const d = new CommitDag();
    d.addCommit("a", []);
    d.addCommit("b", ["a"]);
    d.addCommit("c", ["b"]);
    const c = d.cone("c");
    expect(c.has("a")).toBe(true);
    expect(c.has("b")).toBe(true);
    expect(c.has("c")).toBe(true);
  });
  it("isAncestorOf detects strict ancestry", () => {
    const d = new CommitDag();
    d.addCommit("a", []);
    d.addCommit("b", ["a"]);
    expect(d.isAncestorOf("a", "b")).toBe(true);
    expect(d.isAncestorOf("b", "a")).toBe(false);
  });
});

describe("v2.19.48 CHRONOSHEAF P3 · TimeInterval", () => {
  it("makeInterval rejects inverted bounds", () => {
    expect(() => makeInterval(10, 5)).toThrow();
  });
  it("makeInterval rejects non-finite bounds", () => {
    expect(() => makeInterval(NaN, 5)).toThrow();
    expect(() => makeInterval(0, Infinity)).toThrow();
  });
  it("intervalContains is half-open", () => {
    const iv = makeInterval(10, 20);
    expect(intervalContains(iv, 10)).toBe(true);
    expect(intervalContains(iv, 19.999)).toBe(true);
    expect(intervalContains(iv, 20)).toBe(false);
  });
  it("intervalIntersect returns null on disjoint", () => {
    const a = makeInterval(0, 5);
    const b = makeInterval(10, 15);
    expect(intervalIntersect(a, b)).toBeNull();
  });
  it("intervalIntersect returns overlap on overlap", () => {
    const a = makeInterval(0, 10);
    const b = makeInterval(5, 15);
    const r = intervalIntersect(a, b);
    expect(r).toEqual({ startMs: 5, endMs: 10 });
  });
});

describe("v2.19.48 CHRONOSHEAF P3 · ScaleBand", () => {
  it("file ⊆ org by subset relation", () => {
    expect(scaleSubset("file", "org")).toBe(true);
  });
  it("org ⊄ file", () => {
    expect(scaleSubset("org", "file")).toBe(false);
  });
  it("scaleIndex is monotonic across SCALE_BANDS", () => {
    for (let i = 0; i + 1 < SCALE_BANDS.length; i++) {
      expect(scaleIndex(SCALE_BANDS[i]!)).toBeLessThan(scaleIndex(SCALE_BANDS[i + 1]!));
    }
  });
});

describe("v2.19.48 CHRONOSHEAF P3 · intersectOpens", () => {
  it("intersects two opens at their LCA in the DAG", () => {
    const dag = new CommitDag();
    dag.addCommit("root", []);
    dag.addCommit("a", ["root"]);
    dag.addCommit("b", ["root"]);
    const t = makeInterval(0, 100);
    const oA = makeOpen("a", t, "repo");
    const oB = makeOpen("b", t, "repo");
    const inter = intersectOpens(dag, oA, oB);
    expect(inter).not.toBeNull();
    expect(inter!.commitConeRoot).toBe("root");
  });
  it("returns null when no common ancestor exists", () => {
    const dag = new CommitDag();
    dag.addCommit("x", []);
    dag.addCommit("y", []);
    const t = makeInterval(0, 100);
    const oA = makeOpen("x", t, "repo");
    const oB = makeOpen("y", t, "repo");
    expect(intersectOpens(dag, oA, oB)).toBeNull();
  });
  it("returns null when time intervals disjoint", () => {
    const dag = new CommitDag();
    dag.addCommit("r", []);
    dag.addCommit("a", ["r"]);
    const oA = makeOpen("a", makeInterval(0, 5), "repo");
    const oB = makeOpen("a", makeInterval(10, 15), "repo");
    expect(intersectOpens(dag, oA, oB)).toBeNull();
  });
});

describe("v2.19.48 CHRONOSHEAF P3 · Presheaf", () => {
  it("assignSection rejects length mismatch", () => {
    const p = new Presheaf();
    const o = makeOpen("c", makeInterval(0, 1), "repo");
    p.registerClaims(o, ["a", "b"]);
    expect(() => p.assignSection(o, [1, 2, 3])).toThrow();
  });
  it("assignSection rejects non-finite belief", () => {
    const p = new Presheaf();
    const o = makeOpen("c", makeInterval(0, 1), "repo");
    p.registerClaims(o, ["a"]);
    expect(() => p.assignSection(o, [NaN])).toThrow();
  });
  it("restrict projects shared claims correctly", () => {
    const p = new Presheaf();
    const u = makeOpen("c", makeInterval(0, 1), "repo");
    const v = makeOpen("c", makeInterval(0, 1), "package");
    p.registerClaims(u, ["a", "b", "c"]);
    p.registerClaims(v, ["b", "c"]);
    p.assignSection(u, [10, 20, 30]);
    const r = p.restrict(u, v);
    expect(r).toEqual([20, 30]);
  });
  it("sectionAt returns null for unassigned open", () => {
    const p = new Presheaf();
    const o = makeOpen("c", makeInterval(0, 1), "repo");
    expect(p.sectionAt(o)).toBeNull();
  });
});

// ─── live_update tests ─────────────────────────────────────────────────

function dummyOpen(id: string): OpenSet {
  const t: TimeInterval = makeInterval(0, 1000);
  const o = makeOpen("root", t, "repo");
  return { ...o, id };
}

describe("v2.19.48 CHRONOSHEAF P4 · chronoSheafUpdate happy path", () => {
  it("empty cover early-exit returns clean summary", () => {
    const state = newUpdateState();
    const events: ChronoEvent[] = [];
    const r = chronoSheafUpdate(
      { commit: "x", nowMs: 1000, cover: [], claims: [], evidence: [] },
      state, (e) => events.push(e),
    );
    expect(r.contradictionDetected).toBe(false);
    expect(r.alarmsFired).toBe(0);
    expect(events.length).toBe(0);
  });

  it("cover with consistent claims → no H¹ alarm", () => {
    const state = newUpdateState();
    const events: ChronoEvent[] = [];
    const cover = [dummyOpen("A"), dummyOpen("B")];
    const input: UpdateInput = {
      commit: "c1", nowMs: 1000,
      cover,
      claims: [{ claimId: "tool_count", value: 100, sites: ["A", "B"] }],
      evidence: [
        { site: "A", confidence: 0.9, source: "registry" },
        { site: "B", confidence: 0.9, source: "cli" },
      ],
    };
    const r = chronoSheafUpdate(input, state, (e) => events.push(e));
    expect(r.h1).toBe(0);
    expect(r.alarmsFired).toBe(0);
  });

  it("cover with 3-cycle (no triple overlap) → H¹ = 1 alarm", () => {
    const state = newUpdateState();
    const events: ChronoEvent[] = [];
    const cover = [dummyOpen("A"), dummyOpen("B"), dummyOpen("C")];
    // Three claims, each pair-shared but no triple-shared.
    const input: UpdateInput = {
      commit: "c1", nowMs: 1000,
      cover,
      claims: [
        { claimId: "ab", value: 1, sites: ["A", "B"] },
        { claimId: "bc", value: 1, sites: ["B", "C"] },
        { claimId: "ac", value: 1, sites: ["A", "C"] },
      ],
      evidence: [
        { site: "A", confidence: 0.9, source: "v1" },
        { site: "B", confidence: 0.9, source: "v2" },
        { site: "C", confidence: 0.9, source: "v3" },
      ],
    };
    const r = chronoSheafUpdate(input, state, (e) => events.push(e));
    expect(r.h1).toBe(1);
    expect(r.alarmsFired).toBe(1);
    const alarm = events.find((e) => e.kind === "h1_alarm");
    expect(alarm).toBeTruthy();
  });
});

describe("v2.19.48 CHRONOSHEAF P4 · persistence diagram + RG promotion", () => {
  it("class birth then death produces a persistence pair", () => {
    const state = newUpdateState();
    const events: ChronoEvent[] = [];
    const cover = [dummyOpen("A"), dummyOpen("B"), dummyOpen("C")];
    const input1: UpdateInput = {
      commit: "c1", nowMs: 1000,
      cover,
      claims: [
        { claimId: "ab", value: 1, sites: ["A", "B"] },
        { claimId: "bc", value: 1, sites: ["B", "C"] },
        { claimId: "ac", value: 1, sites: ["A", "C"] },
      ],
      evidence: [
        { site: "A", confidence: 0.9, source: "v1" },
        { site: "B", confidence: 0.9, source: "v2" },
        { site: "C", confidence: 0.9, source: "v3" },
      ],
    };
    chronoSheafUpdate(input1, state, (e) => events.push(e));
    expect(state.activeClasses.size).toBeGreaterThan(0);
    // Cycle 2: cover with no triple → class persists OR dies depending on detection
    const input2: UpdateInput = {
      ...input1, nowMs: 2000,
      claims: [{ claimId: "tool_count", value: 100, sites: ["A", "B"] }],
    };
    chronoSheafUpdate(input2, state, (e) => events.push(e));
    // After second cycle, the old class should have died (not detected again).
    expect(events.some((e) => e.kind === "class_death")).toBe(true);
  });

  it("RG promotion fires after relevantThresholdMs elapses", () => {
    const state = newUpdateState();
    const events: ChronoEvent[] = [];
    const cover = [dummyOpen("A"), dummyOpen("B"), dummyOpen("C")];
    const claims = [
      { claimId: "ab", value: 1, sites: ["A", "B"] },
      { claimId: "bc", value: 1, sites: ["B", "C"] },
      { claimId: "ac", value: 1, sites: ["A", "C"] },
    ];
    const evidence = [
      { site: "A", confidence: 0.9, source: "v1" },
      { site: "B", confidence: 0.9, source: "v2" },
      { site: "C", confidence: 0.9, source: "v3" },
    ];
    chronoSheafUpdate({ commit: "c1", nowMs: 1000, cover, claims, evidence, relevantThresholdMs: 100 }, state, (e) => events.push(e));
    chronoSheafUpdate({ commit: "c1", nowMs: 2000, cover, claims, evidence, relevantThresholdMs: 100 }, state, (e) => events.push(e));
    expect(events.some((e) => e.kind === "promote_relevant")).toBe(true);
  });
});

describe("v2.19.48 CHRONOSHEAF P4 · free-energy probe + Aczel self-check", () => {
  it("selects probe with minimum G", () => {
    const state = newUpdateState();
    const events: ChronoEvent[] = [];
    const cover = [dummyOpen("A")];
    const input: UpdateInput = {
      commit: "c1", nowMs: 1000,
      cover, claims: [], evidence: [{ site: "A", confidence: 0.9, source: "v" }],
      probeCandidates: [
        { id: "good", predictedObs: normalise([0.9, 0.1]), predictedQz: normalise([0.7, 0.3]) },
        { id: "bad", predictedObs: normalise([0.1, 0.9]), predictedQz: normalise([0.5, 0.5]) },
      ],
      probeScoring: { preferredObs: normalise([0.9, 0.1]), priorZ: normalise([0.5, 0.5]) },
    };
    const r = chronoSheafUpdate(input, state, (e) => events.push(e));
    expect(r.probeSelected).toBe("good");
  });

  it("emits self_inconsistency for LIAR atoms", () => {
    const state = newUpdateState();
    const events: ChronoEvent[] = [];
    const input: UpdateInput = {
      commit: "c1", nowMs: 1000,
      cover: [dummyOpen("A")], claims: [],
      evidence: [{ site: "A", confidence: 0.9, source: "v" }],
      reflexiveStalks: [{ id: "honesty-gate", current: liarHyperset("L") }],
    };
    const r = chronoSheafUpdate(input, state, (e) => events.push(e));
    expect(r.selfInconsistencies).toBe(1);
    expect(events.some((e) => e.kind === "self_inconsistency")).toBe(true);
  });

  it("trustworthy Quine atom does NOT trigger self-inconsistency", () => {
    const state = newUpdateState();
    const events: ChronoEvent[] = [];
    chronoSheafUpdate({
      commit: "c1", nowMs: 1000,
      cover: [dummyOpen("A")], claims: [],
      evidence: [{ site: "A", confidence: 0.9, source: "v" }],
      reflexiveStalks: [{ id: "trust-stalk", current: quineAtom() }],
    }, state, (e) => events.push(e));
    expect(events.some((e) => e.kind === "self_inconsistency")).toBe(false);
  });
});

describe("v2.19.48 CHRONOSHEAF P4 · safety + budget + memory", () => {
  it("preflightBudget rejects cover > 64", () => {
    const cover = Array.from({ length: 100 }, (_, i) => dummyOpen(`S${i}`));
    const r = preflightBudget({ commit: "c", nowMs: 0, cover, claims: [], evidence: [] });
    expect(r.ok).toBe(false);
  });
  it("preflightBudget rejects claims > 1000", () => {
    const cover = [dummyOpen("A")];
    const claims = Array.from({ length: 2000 }, (_, i) => ({ claimId: `c${i}`, value: 0, sites: ["A"] }));
    const r = preflightBudget({ commit: "c", nowMs: 0, cover, claims, evidence: [] });
    expect(r.ok).toBe(false);
  });
  it("preflightBudget accepts realistic input", () => {
    const cover = Array.from({ length: 20 }, (_, i) => dummyOpen(`S${i}`));
    const claims = Array.from({ length: 100 }, (_, i) => ({ claimId: `c${i}`, value: 0, sites: ["S0"] }));
    expect(preflightBudget({ commit: "c", nowMs: 0, cover, claims, evidence: [] }).ok).toBe(true);
  });
  it("event log capped at 10000 entries", () => {
    const state = newUpdateState();
    const cover = [dummyOpen("A")];
    for (let i = 0; i < 10500; i++) {
      chronoSheafUpdate({
        commit: "c", nowMs: i, cover, claims: [],
        evidence: [],
      }, state, () => { /* noop */ });
    }
    expect(state.events.length).toBeLessThanOrEqual(10_000);
  });
  it("emitter throws are swallowed (resilience)", () => {
    const state = newUpdateState();
    const cover = [dummyOpen("A"), dummyOpen("B"), dummyOpen("C")];
    const r = chronoSheafUpdate({
      commit: "c", nowMs: 1000, cover,
      claims: [
        { claimId: "ab", value: 1, sites: ["A", "B"] },
        { claimId: "bc", value: 1, sites: ["B", "C"] },
        { claimId: "ac", value: 1, sites: ["A", "C"] },
      ],
      evidence: [
        { site: "A", confidence: 0.9, source: "v" },
        { site: "B", confidence: 0.9, source: "v" },
        { site: "C", confidence: 0.9, source: "v" },
      ],
    }, state, () => { throw new Error("emitter explodes"); });
    expect(r.alarmsFired).toBe(1);
  });
});

describe("v2.19.48 CHRONOSHEAF P4 · SLO + cover helpers", () => {
  it("chronoSlo summarises detected contradictions", () => {
    const state = newUpdateState();
    const cover = [dummyOpen("A"), dummyOpen("B"), dummyOpen("C")];
    chronoSheafUpdate({
      commit: "c", nowMs: 1000, cover,
      claims: [
        { claimId: "ab", value: 1, sites: ["A", "B"] },
        { claimId: "bc", value: 1, sites: ["B", "C"] },
        { claimId: "ac", value: 1, sites: ["A", "C"] },
      ],
      evidence: [
        { site: "A", confidence: 0.9, source: "v" },
        { site: "B", confidence: 0.9, source: "v" },
        { site: "C", confidence: 0.9, source: "v" },
      ],
    }, state, () => { /* noop */ });
    const s = chronoSlo(state);
    expect(s.totalCycles).toBe(1);
    expect(s.contradictionsDetected).toBe(1);
    expect(s.activeContradictions).toBe(1);
  });
  it("buildSelfAuditCover creates one open per site", () => {
    const dag = new CommitDag();
    dag.addCommit("root", []);
    const cover = buildSelfAuditCover(dag, "root", ["registry", "cli", "release_manifest"], 1000);
    expect(cover.length).toBe(3);
    expect(new Set(cover.map((o) => o.id)).size).toBe(3);
  });
});

// ─── system test: the v2.19.40 honesty.audit_whats_new bug class ───────

describe("v2.19.48 CHRONOSHEAF · SYSTEM TEST (the v2.19.40 honesty bug class)", () => {
  it("catches the v2.19.40 N1 case: registry says 712 but CLI says 711 (no triple kills H¹)", () => {
    const state = newUpdateState();
    const events: ChronoEvent[] = [];
    const cover = [dummyOpen("registry"), dummyOpen("cli"), dummyOpen("release_manifest")];
    const input: UpdateInput = {
      commit: "c1", nowMs: 1000,
      cover,
      // Three claim sites with pairwise shared but no triple overlap.
      claims: [
        { claimId: "count", value: 712, sites: ["registry", "cli"] },
        { claimId: "count2", value: 711, sites: ["cli", "release_manifest"] },
        { claimId: "count3", value: 712, sites: ["registry", "release_manifest"] },
      ],
      evidence: [
        { site: "registry", confidence: 0.95, source: "registry-scan" },
        { site: "cli", confidence: 0.95, source: "cli-introspect" },
        { site: "release_manifest", confidence: 0.95, source: "manifest-parse" },
      ],
    };
    const r = chronoSheafUpdate(input, state, (e) => events.push(e));
    // 3-cycle pairwise without triple → H¹ ≥ 1 → alarm.
    expect(r.h1).toBeGreaterThanOrEqual(1);
    expect(r.alarmsFired).toBeGreaterThanOrEqual(1);
    const alarm = events.find((e) => e.kind === "h1_alarm");
    expect(alarm).toBeTruthy();
  });
});
