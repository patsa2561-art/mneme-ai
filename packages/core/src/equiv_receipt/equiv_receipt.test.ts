import { describe, it, expect } from "vitest";
import { genInputs, differential, outputsEqual, buildReceipt, checkEquivalence, equivReceiptGauntlet } from "./index.js";

const spec = [{ name: "price", type: "number" as const }, { name: "qty", type: "int" as const }];
const v1 = (p: number, q: number) => q >= 10 ? p * q * 0.8 : q >= 5 ? p * q * 0.9 : p * q;
const v2 = (p: number, q: number) => { const r = q >= 10 ? 0.8 : q >= 5 ? 0.9 : 1.0; return p * q * r; };
const vBad = (p: number, q: number) => { const r = q > 10 ? 0.8 : q > 5 ? 0.9 : 1.0; return p * q * r; };

describe("equiv_receipt", () => {
  it("gauntlet is 100", () => expect(equivReceiptGauntlet().score).toBe(100));

  it("an equivalent refactor verifies over many inputs", () => {
    const r = checkEquivalence(v1 as never, v2 as never, spec);
    expect(r.equivalent).toBe(true);
    expect(r.inputsTested).toBeGreaterThan(100);
    expect(r.counterexample).toBeNull();
  });

  it("a boundary bug (>= → >) is caught at a threshold", () => {
    const r = checkEquivalence(v1 as never, vBad as never, spec);
    expect(r.equivalent).toBe(false);
    expect([5, 6, 10, 11]).toContain(r.counterexample!.input[1]);
  });

  it("genInputs is deterministic", () => {
    expect(JSON.stringify(genInputs(spec))).toBe(JSON.stringify(genInputs(spec)));
  });

  it("outputsEqual: epsilon numbers, deep objects", () => {
    expect(outputsEqual(0.1 + 0.2, 0.3)).toBe(true);
    expect(outputsEqual({ a: [1, 2] }, { a: [1, 2] })).toBe(true);
    expect(outputsEqual(1, 2)).toBe(false);
  });

  it("differing throw behavior is a counterexample", () => {
    const ok = (x: number) => x;
    const boom = (x: number) => { if (x === 0) throw new Error("x"); return x; };
    const r = checkEquivalence(ok as never, boom as never, [{ name: "x", type: "int" }]);
    expect(r.equivalent).toBe(false);
  });

  it("buildReceipt hashes source + carries the verdict", () => {
    const r = buildReceipt("f", "a", "b", { equivalent: true, inputsTested: 5, counterexample: null, errored: 0 });
    expect(r.claim).toBe("BEHAVIORAL-EQUIVALENCE");
    expect(r.oldHash).not.toBe(r.newHash);
  });

  it("never throws on garbage", () => {
    expect(() => differential(null as never, null as never, [])).not.toThrow();
    expect(() => genInputs(null as never)).not.toThrow();
  });
});
