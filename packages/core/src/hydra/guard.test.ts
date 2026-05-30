import { describe, it, expect } from "vitest";
import { forgeCodebook, compress, sha256Hex } from "./index.js";
import { expandGuarded, rehydrate, guardedGauntlet, trustFromMap, trustByAtrophy, guardedPlaceholder } from "./guard.js";

const CORPUS = [
  "fresh module does the new thing. fresh module is current.",
  "legacy helper is ancient and stale. legacy helper has not changed in years.",
].join("\n").repeat(6);

function setup() {
  const { codebook } = forgeCodebook(CORPUS, { minHits: 2 });
  const encoded = compress(CORPUS, codebook);
  return { codebook, encoded };
}

describe("v2.97 HYDRA GUARD · Time-To-Trust", () => {
  it("all-fresh guarded expand is byte-identical to the original", () => {
    const { codebook, encoded } = setup();
    const out = expandGuarded(encoded, codebook, () => "fresh");
    expect(out).toBe(CORPUS);
  });

  it("a stale entry is redacted: raw phrase gone, sha present, fresh untouched", () => {
    const { codebook, encoded } = setup();
    const stale = codebook.entries[0]!;
    const map = { [stale.sym]: "stale" as const };
    const out = expandGuarded(encoded, codebook, trustFromMap(map));
    expect(out.includes(stale.phrase)).toBe(false);                      // raw content gone
    expect(out).toContain(sha256Hex(stale.phrase).slice(0, 16));         // identity still verifiable
    // fresh preserved: a fresh entry that lives OUTSIDE the stale region
    // still expands byte-exact.
    const other = codebook.entries.find((e) => e.sym !== stale.sym && !stale.phrase.includes(e.phrase) && CORPUS.split(stale.phrase).join("").includes(e.phrase));
    if (other) expect(out).toContain(other.phrase);                      // fresh preserved
  });

  it("re-hydration restores a redacted entry once approved", () => {
    const { codebook, encoded } = setup();
    const stale = codebook.entries[0]!;
    const map = { [stale.sym]: "stale" as const };
    const guarded = expandGuarded(encoded, codebook, trustFromMap(map));
    expect(guarded.includes(stale.phrase)).toBe(false);
    const restored = rehydrate(encoded, codebook, [stale.sym], trustFromMap(map));
    expect(restored).toContain(stale.phrase);                            // disclosed after approval
  });

  it("guarded gauntlet scores 100 on a sound trust assignment", () => {
    const { codebook, encoded } = setup();
    const map: Record<string, "fresh" | "stale" | "quarantined"> = {};
    if (codebook.entries[0]) map[codebook.entries[0].sym] = "stale";
    const g = guardedGauntlet(CORPUS, encoded, codebook, map);
    expect(g.freshLossless).toBe(true);
    expect(g.redactionSound).toBe(true);
    expect(g.freshPreserved).toBe(true);
    expect(g.deterministic).toBe(true);
    expect(g.score).toBe(100);
  });

  it("STABILITY — total functions never throw on malformed input", () => {
    const bad = { v: 1 as const, open: "", close: "", corpusHash: "", entries: [null as never, { sym: "x", phrase: "y" } as never] };
    expect(() => expandGuarded("anything", bad, () => { throw new Error("boom"); })).not.toThrow();
    expect(expandGuarded(null as never, bad, () => "fresh")).toBe("");
    expect(guardedGauntlet("", "", bad, {}).score).toBe(0);
    expect(rehydrate(undefined as never, bad, ["x"], () => "fresh")).toBe("");
  });

  it("ATROPHY composition — only PROVEN-old entries go stale (unknown ⇒ fresh)", () => {
    const { codebook } = setup();
    const halfLife = 1000;
    const old = codebook.entries[0]?.sym;
    const map = trustByAtrophy(codebook, (sym) => (sym === old ? halfLife * 10 : undefined), halfLife);
    if (old) expect(map[old]).toBe("stale");
    // unknown age → NOT in the map → treated fresh (we only redact proven-stale)
    const other = codebook.entries.find((e) => e.sym !== old);
    if (other) expect(map[other.sym]).toBeUndefined();
  });

  it("placeholder carries identity but not content", () => {
    const ph = guardedPlaceholder("super secret phrase", "stale");
    expect(ph).not.toContain("super secret phrase");
    expect(ph).toContain(sha256Hex("super secret phrase").slice(0, 16));
    expect(ph).toContain("trust=stale");
  });
});
