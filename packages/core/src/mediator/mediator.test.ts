import { describe, it, expect } from "vitest";
import { mediate, adjustedWinner, verifyFairness, proportionalDivision, mediatorGauntlet, type Party } from "./index.js";

const A: Party = { name: "A", vals: { house: 50, car: 30, boat: 20 } };
const B: Party = { name: "B", vals: { house: 30, car: 30, boat: 40 } };

describe("mediator", () => {
  it("gauntlet is 100", () => expect(mediatorGauntlet().score).toBe(100));

  it("Adjusted Winner: high-bidder gets the item, contested item split, equal payoffs", () => {
    const r = mediate([A, B]);
    expect(r.method).toBe("adjusted-winner");
    expect(r.allocation.house.A).toBe(1);
    expect(r.allocation.boat.B).toBe(1);
    expect(Math.abs(r.proof.payoffs.A - r.proof.payoffs.B)).toBeLessThan(0.5);
    expect(r.proof.payoffs.A).toBeGreaterThanOrEqual(50);
  });

  it("the result is envy-free + equitable + proportional", () => {
    const p = verifyFairness([A, B], adjustedWinner(A, B));
    expect(p.envyFree).toBe(true);
    expect(p.equitable).toBe(true);
    expect(p.proportional).toBe(true);
  });

  it("neutrality re-check catches a biased allocation", () => {
    const biased = { house: { A: 1, B: 0 }, car: { A: 1, B: 0 }, boat: { A: 1, B: 0 } };
    const p = verifyFairness([A, B], biased);
    expect(p.envyFree && p.proportional).toBe(false);
  });

  it("N>2 → proportional, each ≥ a 1/N fair share", () => {
    const r = mediate([{ name: "X", vals: { a: 60, b: 30, c: 10 } }, { name: "Y", vals: { a: 10, b: 60, c: 30 } }, { name: "Z", vals: { a: 30, b: 10, c: 60 } }]);
    expect(r.method).toBe("proportional");
    expect(r.proof.proportional).toBe(true);
  });

  it("each item's shares sum to 1", () => {
    const alloc = adjustedWinner(A, B);
    for (const it of Object.keys(alloc)) expect(Object.values(alloc[it]).reduce((s, f) => s + f, 0)).toBeCloseTo(1, 4);
  });

  it("never throws on garbage", () => {
    expect(() => mediate(null as never)).not.toThrow();
    expect(() => adjustedWinner(null as never, null as never)).not.toThrow();
    expect(() => proportionalDivision([])).not.toThrow();
  });
});
