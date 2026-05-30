import { describe, it, expect } from "vitest";
import {
  aggregate, mergeAggregates, emptyAggregate, normalizeEvent, parseLedger,
  genEvent, treasuryGauntlet, type SavingEvent,
} from "./index.js";

const E = (source: SavingEvent["source"], b: number, a: number, at = 0): SavingEvent => ({ source, tokensBefore: b, tokensAfter: a, at });

describe("v2.115 TOKEN TREASURY — signed, monoid token-savings ledger", () => {
  // ── SKELETON: the basic contract ──────────────────────────────────────
  describe("skeleton — basic aggregate contract", () => {
    it("sums measured savings exactly (no fabricated number)", () => {
      const r = aggregate([E("distill", 265, 41), E("loopguard", 50, 10)]);
      expect(r.tokensSaved).toBe((265 + 50) - (41 + 10)); // 264
      expect(r.tokensSaved).toBe(r.totalBefore - r.totalAfter);
      expect(r.events).toBe(2);
    });
    it("savedPct is the exact ratio of the totals", () => {
      const r = aggregate([E("distill", 100, 25)]);
      expect(r.savedPct).toBe(75);
    });
    it("USD only appears when YOU supply your vendor's price", () => {
      const noPrice = aggregate([E("distill", 1000, 0)]);
      expect(noPrice.usdSaved).toBeUndefined();
      const withPrice = aggregate([E("distill", 1000, 0)], { pricePer1kUSD: 0.003 });
      expect(withPrice.usdSaved).toBe(0.003); // 1000/1000 * 0.003
      expect(withPrice.pricePer1kUSD).toBe(0.003);
    });
    it("per-source breakdown is tracked", () => {
      const r = aggregate([E("distill", 100, 10), E("distill", 50, 5), E("nkl", 20, 0)]);
      expect(r.bySource["distill"]!.events).toBe(2);
      expect(r.bySource["distill"]!.tokensSaved).toBe(135);
      expect(r.bySource["nkl"]!.tokensSaved).toBe(20);
    });
    it("a non-reducing event contributes 0, never a negative saving", () => {
      expect(aggregate([E("nkl", 30, 30)]).tokensSaved).toBe(0);
      // after > before is clamped → 0 saved, never negative
      expect(normalizeEvent({ source: "other", tokensBefore: 10, tokensAfter: 999, at: 0 }).tokensAfter).toBe(10);
      expect(aggregate([{ source: "other", tokensBefore: 10, tokensAfter: 999, at: 0 }]).tokensSaved).toBe(0);
    });
  });

  // ── DISCRETE-MATH / PROPERTY: the monoid laws over a generated space ──
  describe("discrete-math — the aggregate is a commutative monoid (property-tested)", () => {
    // build a deterministic space of events from the generator
    const SPACE = Array.from({ length: 2000 }, (_, i) => genEvent(0xC0FFEE, i));

    it("IDENTITY: a ⊕ ∅ == a == ∅ ⊕ a (over the whole space)", () => {
      const a = aggregate(SPACE);
      const id = emptyAggregate();
      expect(mergeAggregates(a, id).tokensSaved).toBe(a.tokensSaved);
      expect(mergeAggregates(id, a).tokensSaved).toBe(a.tokensSaved);
      expect(mergeAggregates(a, id).events).toBe(a.events);
    });

    it("COMMUTATIVE / ORDER-INDEPENDENT: folding any permutation gives the same totals", () => {
      const base = aggregate(SPACE);
      // 25 deterministic rotations of the space — every fold must match
      for (let k = 1; k <= 25; k++) {
        const rotated = SPACE.slice(k).concat(SPACE.slice(0, k));
        const r = aggregate(rotated);
        expect(r.tokensSaved).toBe(base.tokensSaved);
        expect(r.totalBefore).toBe(base.totalBefore);
        expect(r.totalAfter).toBe(base.totalAfter);
        expect(r.events).toBe(base.events);
      }
    });

    it("ASSOCIATIVE: (a⊕b)⊕c == a⊕(b⊕c) across arbitrary partitions", () => {
      for (let p = 1; p <= 50; p++) {
        const cut1 = (p * 13) % SPACE.length;
        const cut2 = cut1 + ((p * 29) % Math.max(1, SPACE.length - cut1));
        const a = aggregate(SPACE.slice(0, cut1));
        const b = aggregate(SPACE.slice(cut1, cut2));
        const c = aggregate(SPACE.slice(cut2));
        const left = mergeAggregates(mergeAggregates(a, b), c);
        const right = mergeAggregates(a, mergeAggregates(b, c));
        expect(left.tokensSaved).toBe(right.tokensSaved);
        expect(left.totalAfter).toBe(right.totalAfter);
        expect(left.events).toBe(right.events);
        // and the partitioned fold equals the whole-space fold
        expect(left.tokensSaved).toBe(aggregate(SPACE).tokensSaved);
      }
    });

    it("HOMOMORPHISM: merging batch-aggregates equals aggregating the union", () => {
      const half = SPACE.length >> 1;
      const merged = mergeAggregates(aggregate(SPACE.slice(0, half)), aggregate(SPACE.slice(half)));
      const whole = aggregate(SPACE);
      expect(merged.tokensSaved).toBe(whole.tokensSaved);
      expect(merged.events).toBe(whole.events);
      for (const src of Object.keys(whole.bySource)) {
        expect(merged.bySource[src]!.tokensSaved).toBe(whole.bySource[src]!.tokensSaved);
      }
    });

    it("NON-NEGATIVITY + GENERATOR invariant holds for every generated case", () => {
      for (const e of SPACE) {
        expect(e.tokensAfter).toBeGreaterThanOrEqual(0);
        expect(e.tokensAfter).toBeLessThanOrEqual(e.tokensBefore);
      }
      expect(aggregate(SPACE).tokensSaved).toBeGreaterThanOrEqual(0);
    });

    it("genEvent is deterministic (same seed,i → same event)", () => {
      expect(genEvent(7, 42)).toEqual(genEvent(7, 42));
    });
  });

  // ── INTEGRATION: ledger round-trip + the 1,000,000-case gauntlet ──────
  describe("integration — ledger round-trip + million-case proof", () => {
    it("parseLedger round-trips JSONL + skips malformed lines", () => {
      const good = JSON.stringify(E("distill", 100, 10));
      const evs = parseLedger(`${good}\n{bad json\n${good}\n`);
      expect(evs.length).toBe(2);
      expect(aggregate(evs).tokensSaved).toBe(180);
    });

    it("the gauntlet proves all invariants over 1,000,000 generated cases", () => {
      const g = treasuryGauntlet();
      expect(g.measurementHonest).toBe(true);
      expect(g.orderIndependent).toBe(true);
      expect(g.identity).toBe(true);
      expect(g.associative).toBe(true);
      expect(g.nonNegative).toBe(true);
      expect(g.millionCaseProof).toBe(true);
      expect(g.casesProven).toBe(1_000_000);
      expect(g.score).toBe(100);
    });
  });

  it("STABILITY — total on garbage", () => {
    expect(() => aggregate(null as never)).not.toThrow();
    expect(aggregate(null as never).tokensSaved).toBe(0);
    expect(() => mergeAggregates(null as never, null as never)).not.toThrow();
    expect(() => normalizeEvent(null)).not.toThrow();
    expect(() => parseLedger(null as never)).not.toThrow();
    expect(() => genEvent(NaN, -1)).not.toThrow();
  });
});
