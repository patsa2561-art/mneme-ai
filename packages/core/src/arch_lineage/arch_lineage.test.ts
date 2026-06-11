import { describe, it, expect } from "vitest";
import { establishedIndex, archLineageGauntlet } from "./index.js";

describe("arch_lineage", () => {
  it("gauntlet is 100", () => expect(archLineageGauntlet().score).toBe(100));

  it("finds the commit where a contract was established (false→true)", () => {
    const hist = [false, false, false, true, true, true];
    const r = establishedIndex(hist.length, (i) => hist[i]);
    expect(r.establishedAt).toBe(3);
    expect(r.sinceBeforeRange).toBe(false);
  });

  it("binary search — logarithmic evals", () => {
    const hist = Array.from({ length: 17 }, (_, i) => i >= 11);
    const r = establishedIndex(hist.length, (i) => hist[i]);
    expect(r.establishedAt).toBe(11);
    expect(new Set(r.evaluated).size).toBeLessThanOrEqual(6);
  });

  it("no lineage when the invariant does not hold at HEAD", () => {
    expect(establishedIndex(5, (i) => [false, true, true, true, false][i]).establishedAt).toBe(null);
  });

  it("a contract already holding at the earliest commit → established at/before baseline", () => {
    const r = establishedIndex(4, () => true);
    expect(r.establishedAt).toBe(0);
    expect(r.sinceBeforeRange).toBe(true);
  });

  it("never throws on empty/negative n", () => {
    expect(() => establishedIndex(0, () => false)).not.toThrow();
    expect(() => establishedIndex(-3, () => true)).not.toThrow();
    expect(establishedIndex(0, () => false).establishedAt).toBe(null);
  });
});
