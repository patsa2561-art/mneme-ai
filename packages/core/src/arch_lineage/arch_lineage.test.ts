import { describe, it, expect } from "vitest";
import { establishedIndex, archLineageGauntlet, ageBand, rankContracts } from "./index.js";

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

  it("ageBand thresholds", () => {
    expect(ageBand(400)).toBe("FOUNDATIONAL");
    expect(ageBand(120)).toBe("ESTABLISHED");
    expect(ageBand(20)).toBe("MATURING");
    expect(ageBand(3)).toBe("RECENT");
  });

  it("rankContracts: oldest-first, youngest are the fragile ones", () => {
    const m = rankContracts([
      { rule: "old", ageDays: 500, band: ageBand(500) },
      { rule: "mid", ageDays: 100, band: ageBand(100) },
      { rule: "young", ageDays: 2, band: ageBand(2) },
    ]);
    expect(m.contracts[0].rule).toBe("old");
    expect(m.contracts[2].rule).toBe("young");
    expect(m.foundational).toBe(1);
    expect(m.recent).toBe(1);
    expect(m.mostFragile[0]?.rule).toBe("young");
  });

  it("rankContracts never throws on garbage", () => {
    expect(() => rankContracts(null as never)).not.toThrow();
    expect(rankContracts(null as never).total).toBe(0);
  });
});
