import { describe, it, expect } from "vitest";
import {
  birthMortalWrapper,
  mutateSignature,
  tickReincarnation,
  resolveMortalCall,
  recordCalibration,
  calibrationScore,
  globalStats,
  verifyMortalWrapper,
  emptyState,
  formatWrapperLine,
  type MortalRegistryState,
  type MortalWrapper,
} from "./index.js";

const SECRET = "test-mortal-secret-9991122";
const ARGS = ["topic", "limit", "outputFormat"];

function newBorn(opts: { now: number; ttl?: number; gravity?: number; base?: string } = { now: 1_000_000 }) {
  return birthMortalWrapper({
    baseToolName: opts.base ?? "mneme.arena.judge",
    baseArgs: ARGS,
    ttlMs: opts.ttl ?? 1000,
    deprecationGravityMs: opts.gravity ?? 500,
    nowMs: opts.now,
    secret: SECRET,
  });
}

describe("v2.19.11 MORTAL WRAPPERS · birth", () => {
  it("births a generation-1 wrapper with alive=true, hmac-signed, alias suffixed gen1", () => {
    const w = newBorn({ now: 1_000_000 });
    expect(w.generation).toBe(1);
    expect(w.parentGeneration).toBeNull();
    expect(w.alive).toBe(true);
    expect(w.deprecatedUntil).toBeNull();
    expect(w.signature.alias).toBe("mneme.mortal.arena.judge.gen1");
    expect(Object.keys(w.signature.argRenameMap).sort()).toEqual(ARGS.slice().sort());
    expect(w.signature.argOrder).toEqual(ARGS);
    expect(w.expiresAt).toBe(w.birthAt + w.ttlMs);
    const v = verifyMortalWrapper(w, SECRET);
    expect(v.ok).toBe(true);
  });

  it("rejects forged hmac", () => {
    const w = newBorn();
    const forged: MortalWrapper = { ...w, hmac: "deadbeef".repeat(8) };
    expect(verifyMortalWrapper(forged, SECRET).ok).toBe(false);
  });

  it("birthing two wrappers for the same base at different times produces different IDs", () => {
    const a = newBorn({ now: 1_000_000 });
    const b = newBorn({ now: 1_000_001 });
    expect(a.id).not.toBe(b.id);
  });
});

describe("v2.19.11 MORTAL WRAPPERS · mutateSignature", () => {
  it("rename_optional_field renames an arg and updates argOrder", () => {
    const w = newBorn();
    const out = mutateSignature({
      base: w.signature,
      baseToolName: w.baseToolName,
      baseArgs: ARGS,
      nextGen: 2,
      kind: "rename_optional_field",
      rng: () => 0.0, // pick first lexicographic
    });
    expect(out.alias).toBe("mneme.mortal.arena.judge.gen2");
    // One key is renamed with _g2 suffix
    const renamed = Object.keys(out.argRenameMap).filter((k) => k.endsWith("_g2"));
    expect(renamed.length).toBe(1);
    // The renamed key still maps to a canonical base arg
    expect(ARGS).toContain(out.argRenameMap[renamed[0]!]);
    // argOrder reflects the rename (no canonical version remains for that slot)
    expect(out.argOrder).toContain(renamed[0]);
  });

  it("add_optional_param appends a drift_gN_xxx param", () => {
    const w = newBorn();
    const out = mutateSignature({
      base: w.signature,
      baseToolName: w.baseToolName,
      baseArgs: ARGS,
      nextGen: 3,
      kind: "add_optional_param",
      rng: () => 0.5,
    });
    expect(out.addedOptionalParams.length).toBe(1);
    const fresh = out.addedOptionalParams[0]!;
    expect(fresh.startsWith("_drift_g3_")).toBe(true);
    expect(out.argOrder).toContain(fresh);
  });

  it("swap_arg_order reorders two positions", () => {
    const w = newBorn();
    const out = mutateSignature({
      base: w.signature,
      baseToolName: w.baseToolName,
      baseArgs: ARGS,
      nextGen: 4,
      kind: "swap_arg_order",
      rng: (() => { let i = 0; return () => [0.0, 0.99][i++]!; })(),
    });
    // First and last swapped (rng → 0 and ~end)
    expect(out.argOrder).not.toEqual(ARGS);
    // But the same SET of args is preserved
    expect([...out.argOrder].sort()).toEqual([...ARGS].sort());
  });
});

describe("v2.19.11 MORTAL WRAPPERS · tickReincarnation", () => {
  function stateWith(wrappers: MortalWrapper[]): MortalRegistryState {
    return { v: 1, wrappers, calibration: [] };
  }

  it("does nothing when no wrappers have expired", () => {
    const w = newBorn({ now: 1_000_000, ttl: 10_000 });
    const out = tickReincarnation({
      state: stateWith([w]),
      baseToolArgs: { [w.baseToolName]: ARGS },
      nowMs: 1_000_001, // far before expiry
      rngSeed: 42,
      secret: SECRET,
    });
    expect(out.expired.length).toBe(0);
    expect(out.reincarnated.length).toBe(0);
    expect(out.state.wrappers.length).toBe(1);
    expect(out.state.wrappers[0]!.alive).toBe(true);
  });

  it("expires and reincarnates exactly one wrapper at expiry boundary", () => {
    const w = newBorn({ now: 1_000_000, ttl: 1000, gravity: 500 });
    const out = tickReincarnation({
      state: stateWith([w]),
      baseToolArgs: { [w.baseToolName]: ARGS },
      nowMs: 1_001_000, // at expiry
      rngSeed: 7,
      secret: SECRET,
    });
    expect(out.expired.length).toBe(1);
    expect(out.reincarnated.length).toBe(1);
    // Parent is now deprecated, child is gen2 with parentGeneration=1
    const parent = out.state.wrappers.find((x) => x.id === w.id)!;
    expect(parent.alive).toBe(false);
    expect(parent.deprecatedUntil).toBe(1_001_000 + 500);
    const child = out.reincarnated[0]!;
    expect(child.generation).toBe(2);
    expect(child.parentGeneration).toBe(1);
    expect(child.alive).toBe(true);
    expect(child.mutationsApplied.length).toBe(1);
    // Parent's new HMAC is valid (re-signed on deprecation)
    expect(verifyMortalWrapper(parent, SECRET).ok).toBe(true);
    expect(verifyMortalWrapper(child, SECRET).ok).toBe(true);
  });

  it("budget caps mutations per tick to MAX_TICK_BATCH=3 (even if 5 are due)", () => {
    const bases = ["mneme.a.x", "mneme.b.y", "mneme.c.z", "mneme.d.w", "mneme.e.v"];
    const wrappers = bases.map((b) => newBorn({ now: 1_000_000, ttl: 1000, gravity: 500, base: b }));
    const out = tickReincarnation({
      state: stateWith(wrappers),
      baseToolArgs: Object.fromEntries(bases.map((b) => [b, ARGS])),
      nowMs: 1_001_000,
      budget: 10, // user asks for many but cap is 3
      rngSeed: 1,
      secret: SECRET,
    });
    expect(out.reincarnated.length).toBe(3);
    expect(out.expired.length).toBe(3);
  });

  it("drops deprecated wrappers after their gravity window elapses", () => {
    const w = newBorn({ now: 1_000_000, ttl: 1000, gravity: 500 });
    const t1 = tickReincarnation({
      state: stateWith([w]),
      baseToolArgs: { [w.baseToolName]: ARGS },
      nowMs: 1_001_000,
      rngSeed: 1,
      secret: SECRET,
    });
    // Parent expires at 1_001_500. Tick again after that.
    const t2 = tickReincarnation({
      state: t1.state,
      baseToolArgs: { [w.baseToolName]: ARGS },
      nowMs: 1_001_600,
      rngSeed: 2,
      secret: SECRET,
    });
    // Parent (gen1) should be gone; only the child (gen2) remains alive.
    const aliveLineage = t2.state.wrappers.filter((x) => x.baseToolName === w.baseToolName);
    expect(aliveLineage.length).toBe(1);
    expect(aliveLineage[0]!.generation).toBe(2);
  });

  it("respects MAX_GENERATIONS_PER_BASE loop guard", () => {
    // Manually craft a gen=100 wrapper that is about to expire.
    const expired = birthMortalWrapper({
      baseToolName: "mneme.cap.test",
      baseArgs: ARGS,
      ttlMs: 1000,
      nowMs: 1_000_000,
      secret: SECRET,
    });
    // Build a gen-100 sibling that already exists in the lineage.
    const gen100 = { ...expired, generation: 100, id: "mw-fake100", alive: true, expiresAt: 999 };
    const state: MortalRegistryState = { v: 1, wrappers: [gen100], calibration: [] };
    const out = tickReincarnation({
      state,
      baseToolArgs: { "mneme.cap.test": ARGS },
      nowMs: 2000,
      rngSeed: 1,
      secret: SECRET,
    });
    expect(out.reincarnated.length).toBe(0);
    expect(out.skippedAtMaxGen).toContain("mneme.cap.test");
  });
});

describe("v2.19.11 MORTAL WRAPPERS · resolveMortalCall", () => {
  it("resolves a live alias and translates renamed keys back to base args", () => {
    const w = newBorn({ now: 1_000_000 });
    const state = tickReincarnation({
      state: { v: 1, wrappers: [w], calibration: [] },
      baseToolArgs: { [w.baseToolName]: ARGS },
      nowMs: w.expiresAt, // force reincarnation
      rngSeed: 11,
      secret: SECRET,
    }).state;
    const child = state.wrappers.find((x) => x.alive)!;
    // Call the child with its current schema — should translate cleanly.
    const childArgs: Record<string, unknown> = {};
    for (const [mortalKey, baseKey] of Object.entries(child.signature.argRenameMap)) {
      childArgs[mortalKey] = `value-of-${baseKey}`;
    }
    const r = resolveMortalCall({
      alias: child.signature.alias,
      args: childArgs,
      state,
      nowMs: child.birthAt + 1,
    });
    expect(r.ok).toBe(true);
    expect(r.baseToolName).toBe(w.baseToolName);
    expect(r.deprecated).toBe(false);
    expect(Object.keys(r.baseArgs!).sort()).toEqual(ARGS.slice().sort());
  });

  it("flags a deprecated parent alias as deprecated=true (still callable during gravity)", () => {
    const w = newBorn({ now: 1_000_000, ttl: 1000, gravity: 500 });
    const state = tickReincarnation({
      state: { v: 1, wrappers: [w], calibration: [] },
      baseToolArgs: { [w.baseToolName]: ARGS },
      nowMs: 1_001_000,
      rngSeed: 11,
      secret: SECRET,
    }).state;
    const args: Record<string, unknown> = Object.fromEntries(ARGS.map((a) => [a, `v-${a}`]));
    const r = resolveMortalCall({
      alias: "mneme.mortal.arena.judge.gen1",
      args,
      state,
      nowMs: 1_001_100, // inside gravity
    });
    expect(r.ok).toBe(true);
    expect(r.deprecated).toBe(true);
  });

  it("refuses a fully-expired alias past gravity and offers a live sibling hint", () => {
    const w = newBorn({ now: 1_000_000, ttl: 1000, gravity: 500 });
    const state = tickReincarnation({
      state: { v: 1, wrappers: [w], calibration: [] },
      baseToolArgs: { [w.baseToolName]: ARGS },
      nowMs: 1_001_000,
      rngSeed: 11,
      secret: SECRET,
    }).state;
    const r = resolveMortalCall({
      alias: "mneme.mortal.arena.judge.gen1",
      args: { topic: "x" },
      state,
      nowMs: 1_002_000, // way past gravity
    });
    expect(r.ok).toBe(false);
    expect(r.hint).toBeDefined();
    expect(r.hint!).toContain("mneme.mortal.arena.judge.gen2");
  });

  it("flags AI-agent overfit by failing on unknown keys with a helpful hint", () => {
    const w = newBorn({ now: 1_000_000 });
    const state: MortalRegistryState = { v: 1, wrappers: [w], calibration: [] };
    const r = resolveMortalCall({
      alias: w.signature.alias,
      args: { topic: "x", THIS_IS_STALE_FROM_GEN_MINUS_ONE: 42 },
      state,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("schema drifted");
    expect(r.hint).toContain("topic");
  });

  it("silently drops drift-bonus params (they're calibration tripwires, not errors)", () => {
    const w = newBorn({ now: 1_000_000 });
    // Manually inject an addedOptionalParam via mutation
    const drifted = mutateSignature({
      base: w.signature,
      baseToolName: w.baseToolName,
      baseArgs: ARGS,
      nextGen: 2,
      kind: "add_optional_param",
      rng: () => 0.3,
    });
    const driftedWrapper: MortalWrapper = { ...w, signature: drifted };
    const state: MortalRegistryState = { v: 1, wrappers: [driftedWrapper], calibration: [] };
    const fresh = drifted.addedOptionalParams[0]!;
    const r = resolveMortalCall({
      alias: drifted.alias,
      args: { topic: "x", limit: 5, outputFormat: "json", [fresh]: "ignored" },
      state,
    });
    expect(r.ok).toBe(true);
    expect(r.baseArgs).not.toHaveProperty(fresh);
  });
});

describe("v2.19.11 MORTAL WRAPPERS · calibration telemetry", () => {
  it("calibration score climbs as the caller succeeds; verdict bands report adaptiveness", () => {
    let state = emptyState();
    for (let i = 0; i < 19; i++) state = recordCalibration({ state, callerKey: "ai-fast-learner", alias: "x", ok: true });
    state = recordCalibration({ state, callerKey: "ai-fast-learner", alias: "x", ok: false });
    const s = calibrationScore({ state, callerKey: "ai-fast-learner" });
    expect(s.totalCalls).toBe(20);
    expect(s.successfulCalls).toBe(19);
    expect(s.adaptivenessScore).toBeCloseTo(0.95, 5);
    expect(s.verdict).toBe("world_class");
  });

  it("an AI that keeps failing earns the over_fit verdict", () => {
    let state = emptyState();
    for (let i = 0; i < 10; i++) state = recordCalibration({ state, callerKey: "ai-overfitter", alias: "y", ok: false });
    for (let i = 0; i < 2; i++) state = recordCalibration({ state, callerKey: "ai-overfitter", alias: "y", ok: true });
    const s = calibrationScore({ state, callerKey: "ai-overfitter" });
    expect(s.verdict).toBe("over_fit");
  });

  it("low sample size returns the cautious 'drifting' verdict (not enough signal)", () => {
    let state = emptyState();
    for (let i = 0; i < 3; i++) state = recordCalibration({ state, callerKey: "ai-newbie", alias: "z", ok: true });
    const s = calibrationScore({ state, callerKey: "ai-newbie" });
    expect(s.verdict).toBe("drifting");
  });

  it("zero calls returns 0 with drifting verdict", () => {
    const state = emptyState();
    const s = calibrationScore({ state, callerKey: "never-called" });
    expect(s.totalCalls).toBe(0);
    expect(s.adaptivenessScore).toBe(0);
    expect(s.verdict).toBe("drifting");
  });
});

describe("v2.19.11 MORTAL WRAPPERS · globalStats", () => {
  it("aggregates alive / deprecated / mutation histogram correctly across many generations", () => {
    // 3 lineages, each reincarnated 4 times (gen5 lives, gen1-4 deprecated)
    let state = emptyState();
    let now = 1_000_000;
    for (const base of ["mneme.x.a", "mneme.y.b", "mneme.z.c"]) {
      state = { ...state, wrappers: [...state.wrappers, birthMortalWrapper({ baseToolName: base, baseArgs: ARGS, ttlMs: 1000, deprecationGravityMs: 10_000_000, nowMs: now, secret: SECRET })] };
    }
    for (let i = 0; i < 4; i++) {
      const t = tickReincarnation({
        state,
        baseToolArgs: { "mneme.x.a": ARGS, "mneme.y.b": ARGS, "mneme.z.c": ARGS },
        nowMs: now + 1000 + i * 1000,
        budget: 3,
        rngSeed: 100 + i,
        secret: SECRET,
      });
      state = t.state;
    }
    const s = globalStats(state);
    // 3 lineages × 5 generations = 15 wrappers; 3 alive (latest gen of each), 12 deprecated
    expect(s.uniqueBaseTools).toBe(3);
    expect(s.alive).toBe(3);
    expect(s.deprecated).toBe(12);
    expect(s.totalGenerationsAcrossLineages).toBe(15);
    // Each lineage carries 4 cumulative mutations on gen5 (plus 3+2+1+0 on lower gens). Just sanity-check non-zero.
    expect(s.totalMutationsApplied).toBeGreaterThan(0);
    const histSum = Object.values(s.mutationKindHistogram).reduce((a, b) => a + b, 0);
    expect(histSum).toBe(s.totalMutationsApplied);
  });
});

describe("v2.19.11 MORTAL WRAPPERS · formatters + edge cases", () => {
  it("formatter shows 🌱 for alive and 💀 for deprecated", () => {
    const w = newBorn();
    expect(formatWrapperLine(w)).toContain("🌱");
    const dead = { ...w, alive: false };
    expect(formatWrapperLine(dead)).toContain("💀");
  });

  it("resolve on unknown alias returns helpful error message", () => {
    const r = resolveMortalCall({ alias: "mneme.mortal.does.not.exist.gen1", args: {}, state: emptyState() });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("unknown");
  });
});
