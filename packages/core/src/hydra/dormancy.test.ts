import { describe, it, expect } from "vitest";
import { forgeCodebook, sha256Hex } from "./index.js";
import { canonicalizeCodebook } from "./attest.js";
import { methylate, demethylate, dormancyGauntlet } from "./dormancy.js";

const CORPUS = "alpha beta gamma delta epsilon. alpha beta gamma delta epsilon. zeta eta theta iota kappa. zeta eta theta iota kappa. ".repeat(8);

function setup() {
  const cb = forgeCodebook(CORPUS, { minHits: 2 }).codebook;
  // mark half the entries stale (cold).
  const trustMap: Record<string, "fresh" | "stale" | "quarantined"> = {};
  cb.entries.forEach((e, i) => { if (i % 2 === 0) trustMap[e.sym] = "stale"; });
  return { cb, trustMap };
}

describe("v2.102 HYDRA EPIGENETIC DORMANCY — sleep state + JIT revival", () => {
  it("methylate shrinks the active set; full demethylate is BYTE-EXACT", () => {
    const { cb, trustMap } = setup();
    const m = methylate(process.cwd(), cb, trustMap, 1700000000000);
    expect(m.dormant.length).toBeGreaterThan(0);
    expect(m.activeBytes).toBeLessThan(m.fullBytes);                 // working set shrank
    const rev = demethylate(m);                                     // full wake
    expect(rev.exact).toBe(true);
    expect(sha256Hex(canonicalizeCodebook(rev.codebook!))).toBe(m.originalHash);
  });

  it("partial demethylate revives only the requested dormant entries", () => {
    const { cb, trustMap } = setup();
    const m = methylate(process.cwd(), cb, trustMap, 1700000000000);
    const one = m.dormant[0]!.phrase;
    const rev = demethylate(m, [one]);
    expect(rev.ok).toBe(true);
    expect(rev.exact).toBe(false);                                  // not a full revive
    expect(rev.codebook!.entries.some((e) => e.phrase === one)).toBe(true);
    // a still-dormant phrase is NOT in the partial revive
    const stillAsleep = m.dormant[1]?.phrase;
    if (stillAsleep) expect(rev.codebook!.entries.some((e) => e.phrase === stillAsleep)).toBe(false);
  });

  it("the split is Ed25519-signed and binds the original/dormant counts", () => {
    const { cb, trustMap } = setup();
    const g = dormancyGauntlet(process.cwd(), cb, trustMap, 1700000000000);
    expect(g.signedBinds).toBe(true);
  });

  it("dormancy gauntlet scores 100 (reviveExact ∧ shrinks ∧ signedBinds ∧ deterministic)", () => {
    const { cb, trustMap } = setup();
    const g = dormancyGauntlet(process.cwd(), cb, trustMap, 1700000000000);
    expect(g.reviveExact).toBe(true);
    expect(g.shrinks).toBe(true);
    expect(g.signedBinds).toBe(true);
    expect(g.deterministic).toBe(true);
    expect(g.stable).toBe(true);
    expect(g.score).toBe(100);
  });

  it("nothing dormant ⇒ active == full, still byte-exact (no over-claim)", () => {
    const { cb } = setup();
    const m = methylate(process.cwd(), cb, {}, 1700000000000);      // nothing stale
    expect(m.dormant.length).toBe(0);
    expect(m.activeBytes).toBe(m.fullBytes);
    expect(demethylate(m).exact).toBe(true);
  });

  it("STABILITY — total on garbage", () => {
    expect(() => methylate(process.cwd(), null as never, {}, 0)).not.toThrow();
    expect(demethylate(null as never).ok).toBe(false);
    expect(demethylate({ v: 99 } as never).ok).toBe(false);
    expect(dormancyGauntlet(process.cwd(), null as never, {}, 0).score).toBe(0);
  });
});
