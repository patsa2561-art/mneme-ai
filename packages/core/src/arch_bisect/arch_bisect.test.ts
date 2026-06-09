import { describe, it, expect } from "vitest";
import { bisectIndex, invariantHoldsAt, archBisectGauntlet } from "./index.js";

describe("arch_bisect", () => {
  it("gauntlet is 100", () => expect(archBisectGauntlet().score).toBe(100));

  it("finds the exact commit where the invariant first broke", () => {
    const r = bisectIndex(6, (i) => [true, true, true, false, false, false][i]);
    expect(r.breakAt).toBe(3);
  });

  it("bisects in log(n), not linearly", () => {
    const arr = [true, true, true, true, true, true, true, false]; // 8 commits
    const r = bisectIndex(arr.length, (i) => arr[i]);
    expect(r.breakAt).toBe(7);
    expect(new Set(r.evaluated).size).toBeLessThanOrEqual(5);
  });

  it("reports no break when it still holds at HEAD", () => {
    expect(bisectIndex(4, () => true).breakAt).toBeNull();
  });

  it("reports a pre-existing break (violated at the oldest)", () => {
    expect(bisectIndex(3, () => false).breakAt).toBe(0);
  });

  it("predicate: single-writer holds for 1 writer, fails for 2", () => {
    const one = [{ path: "s.prisma", content: "model T { id Int @id }" }, { path: "a.ts", content: "export function w(){ return prisma.t.create({data:{}}); }" }];
    const two = [...one, { path: "b.ts", content: "export function w2(){ return prisma.t.update({where:{}}); }" }];
    expect(invariantHoldsAt(one, "table T single-writer")).toBe(true);
    expect(invariantHoldsAt(two, "table T single-writer")).toBe(false);
  });

  it("never throws on garbage", () => {
    expect(() => bisectIndex(0, () => true)).not.toThrow();
    expect(() => invariantHoldsAt(null as never, "x")).not.toThrow();
  });
});
