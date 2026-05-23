// v2.29.0 — MNEME CONCLAVE discrete root tests (BUG IMMUNITY).
// Every logic branch pinned to fail forever if regressed.

import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  generateVariants, awarenessScore,
  aggregate, type BftConfig,
  resolveVendors, aletheiaWeight, __resetAletheiaCacheForTest,
  runConclave, verifyVerdict, __resetConclaveChainForTest,
} from "./index.js";
import type { VendorAggregate, VendorStance } from "./types.js";

describe("AEAE — generateVariants", () => {
  it("emits 5 deterministic variants by default", () => {
    const v = generateVariants("Mneme has 13 verification agents");
    expect(v.length).toBe(5);
    const ids = new Set(v.map((x) => x.id));
    expect(ids).toEqual(new Set(["verbatim", "paraphrase-1", "paraphrase-2", "decoy-embedded", "casual-question"]));
  });
  it("respects include filter", () => {
    const v = generateVariants("x", { include: ["verbatim", "decoy-embedded"] });
    expect(v.length).toBe(2);
  });
  it("verbatim is the original claim", () => {
    expect(generateVariants("abc")[0]!.text).toBe("abc");
  });
  it("paraphrase-1 turns statement into question", () => {
    const v = generateVariants("React 19 ships hooks")[1]!;
    expect(v.text).toMatch(/\?$/);
  });
  it("decoy-embedded has 3 numbered lines", () => {
    const v = generateVariants("x")[3]!;
    expect(v.text).toMatch(/1\)/);
    expect(v.text).toMatch(/2\)/);
    expect(v.text).toMatch(/3\)/);
  });
});

describe("AEAE — awarenessScore", () => {
  const consistent = (stance: VendorStance) =>
    ["verbatim", "paraphrase-1", "paraphrase-2", "decoy-embedded", "casual-question"]
      .map((id) => ({ id, stance }));
  it("returns 1.0 when every variant is the same stance", () => {
    expect(awarenessScore(consistent("supports")).score).toBe(1);
  });
  it("drops to 0.0 when every variant differs", () => {
    const r = awarenessScore([
      { id: "verbatim", stance: "supports" },
      { id: "paraphrase-1", stance: "refutes" },
      { id: "paraphrase-2", stance: "uncertain" },
      { id: "decoy-embedded", stance: "refuses" },
    ]);
    expect(r.score).toBe(0);
  });
  it("penalises refused-on-casual-only (classic awareness pattern)", () => {
    const r = awarenessScore([
      { id: "verbatim", stance: "supports" },
      { id: "paraphrase-1", stance: "supports" },
      { id: "casual-question", stance: "refuses" },
    ]);
    // 2 distinct over 3 → base 0.5, then -0.3 for refuses-on-casual asymmetry = 0.2
    expect(r.score).toBeLessThan(0.5);
  });
  it("HEAVY penalty for refused-on-verbatim-only (eval-mode detection)", () => {
    const r = awarenessScore([
      { id: "verbatim", stance: "refuses" },
      { id: "casual-question", stance: "supports" },
    ]);
    // distinct=2, total=2: base = 0.0; further -0.5 floor at 0
    expect(r.score).toBe(0);
    expect(r.reason).toMatch(/eval-mode/);
  });
});

describe("BFT aggregator", () => {
  const cfg = (over: Partial<BftConfig> = {}): BftConfig => ({ threshold: 0.66, bftStrict: false, ...over });
  function mk(vendors: Array<{ v: string; w: number; s: VendorStance; aw?: number }>): VendorAggregate[] {
    return vendors.map((x) => ({
      vendor: x.v, weight: x.w, dominantStance: x.s,
      awarenessScore: x.aw ?? 1,
      perVariant: [],
    }));
  }

  it("CONSENSUS when threshold cleared by weighted vote", () => {
    const r = aggregate(mk([
      { v: "a", w: 1, s: "supports" },
      { v: "b", w: 1, s: "supports" },
      { v: "c", w: 1, s: "refutes" },
    ]), cfg());
    expect(r.outcome).toBe("CONSENSUS");
    expect(r.winningStance).toBe("supports");
    expect(r.winningFraction).toBeCloseTo(2 / 3);
  });

  it("DISSENT when split", () => {
    const r = aggregate(mk([
      { v: "a", w: 1, s: "supports" },
      { v: "b", w: 1, s: "refutes" },
    ]), cfg());
    expect(r.outcome).toBe("DISSENT");
    expect(r.dissentBreakdown!.length).toBe(2);
  });

  it("bftStrict refuses 2-of-5 dissenters even at 60% threshold", () => {
    // 3 supports / 2 refutes → 60% support. bftStrict requires
    // dissenters < n/3 = 5/3 ≈ 1.67. We have 2 dissenters → fail.
    const r = aggregate(mk([
      { v: "a", w: 1, s: "supports" },
      { v: "b", w: 1, s: "supports" },
      { v: "c", w: 1, s: "supports" },
      { v: "d", w: 1, s: "refutes" },
      { v: "e", w: 1, s: "refutes" },
    ]), cfg({ threshold: 0.5, bftStrict: true }));
    expect(r.outcome).toBe("DISSENT");
  });

  it("AWARENESS_DETECTED when ≥ half vendors awareness < 0.7", () => {
    const r = aggregate(mk([
      { v: "a", w: 1, s: "supports", aw: 0.5 },
      { v: "b", w: 1, s: "supports", aw: 0.4 },
      { v: "c", w: 1, s: "supports", aw: 0.6 },
    ]), cfg());
    expect(r.outcome).toBe("AWARENESS_DETECTED");
    expect(r.awarenessFlags.length).toBe(3);
  });

  it("INSUFFICIENT_RESPONDERS when no vendors", () => {
    expect(aggregate([], cfg()).outcome).toBe("INSUFFICIENT_RESPONDERS");
  });

  it("weighted vote respects Aletheia weights", () => {
    // a (weight 2) supports + b (weight 1) refutes → supports wins 2/3
    const r = aggregate(mk([
      { v: "a", w: 2, s: "supports" },
      { v: "b", w: 1, s: "refutes" },
    ]), cfg());
    expect(r.outcome).toBe("CONSENSUS");
    expect(r.winningStance).toBe("supports");
    expect(r.winningFraction).toBeCloseTo(2 / 3);
  });
});

describe("Aletheia weights", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mneme-aletheia-")); __resetAletheiaCacheForTest(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });
  it("returns 0.5 neutral when no data", () => {
    expect(aletheiaWeight(dir, "claude-opus-4-7")).toBe(0.5);
  });
});

describe("Mock vendor adapter (deterministic)", () => {
  it("same claim + vendor → same stance", async () => {
    const [a] = resolveVendors(["mock-1"], { mockOnly: true });
    const r1 = await a!.run({ claim: "test claim", variantId: "v" });
    const r2 = await a!.run({ claim: "test claim", variantId: "v" });
    expect(r1.stance).toBe(r2.stance);
  });
  it("REFUTE_ME magic claim deterministically refutes", async () => {
    const [a] = resolveVendors(["mock-1"], { mockOnly: true });
    const r = await a!.run({ claim: "REFUTE_ME", variantId: "v" });
    expect(r.stance).toBe("refutes");
  });
  it("REFUSE_ME magic claim deterministically refuses", async () => {
    const [a] = resolveVendors(["mock-1"], { mockOnly: true });
    const r = await a!.run({ claim: "REFUSE_ME", variantId: "v" });
    expect(r.stance).toBe("refuses");
  });
  it("SUPPORT_ME magic claim deterministically supports", async () => {
    const [a] = resolveVendors(["mock-1"], { mockOnly: true });
    const r = await a!.run({ claim: "SUPPORT_ME", variantId: "v" });
    expect(r.stance).toBe("supports");
  });
});

describe("runConclave — end-to-end", () => {
  let dir: string;
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "mneme-conclave-")); __resetConclaveChainForTest(); });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

  it("5 mock vendors → REFUTE_ME claim → CONSENSUS refutes", async () => {
    const v = await runConclave(dir, "REFUTE_ME", {
      vendors: ["m1", "m2", "m3", "m4", "m5"],
      mockOnly: true,
      aeae: false,  // single variant — deterministic
    });
    expect(v.outcome).toBe("CONSENSUS");
    expect(v.winningStance).toBe("refutes");
  });

  it("emits HMAC chain that verifyVerdict accepts", async () => {
    const v = await runConclave(dir, "SUPPORT_ME", {
      vendors: ["a", "b", "c"],
      mockOnly: true,
      aeae: false,
    });
    const r = verifyVerdict(v);
    expect(r.ok).toBe(true);
  });

  it("verifyVerdict rejects tampered card", async () => {
    const v = await runConclave(dir, "SUPPORT_ME", {
      vendors: ["a", "b", "c"], mockOnly: true, aeae: false,
    });
    (v as { totalMs: number }).totalMs = -1;  // tamper
    const r = verifyVerdict(v);
    expect(r.ok).toBe(false);
  });
});

import { afterEach } from "vitest";
