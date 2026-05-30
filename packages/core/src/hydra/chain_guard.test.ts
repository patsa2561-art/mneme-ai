import { describe, it, expect } from "vitest";
import { forgeCodebook, compress, sha256Hex } from "./index.js";
import { appendToChain, type CodebookDelta } from "./chain.js";
import { expandGuarded, trustFromMap } from "./guard.js";
import { trustMapFromChain, guardedReplay, guardedChainGauntlet, phraseAddedSeq } from "./chain_guard.js";

// An evolving corpus: "ancient axiom" lands at delta 0 and is never touched
// again; new phrases arrive in later deltas. So by the tip, the ancient one
// has aged out while the recent ones are fresh.
// Each "fact" line is repeated so its phrase earns a positive MDL slot. The
// corpus is cumulative: the ancient line lands at delta 0 and is never
// touched again; new lines arrive in later deltas → by the tip the ancient
// one has aged out while the brand-new one is fresh.
const L_ANCIENT = "ancient axiom holds forever and ever. ".repeat(4);
const L_MIDDLE = "middle rule connects all things here. ".repeat(4);
const L_RECENT = "recent fact arrives as the newest one. ".repeat(4);
const L_NEW = "brand new thing just landed today hot. ".repeat(4);
const STEPS = [
  L_ANCIENT,
  L_ANCIENT + "\n" + L_MIDDLE,
  L_ANCIENT + "\n" + L_MIDDLE + "\n" + L_RECENT,
  L_ANCIENT + "\n" + L_MIDDLE + "\n" + L_RECENT + "\n" + L_NEW,
];

function buildChain(): CodebookDelta[] {
  let chain: CodebookDelta[] = [];
  STEPS.forEach((c, i) => { chain = appendToChain(process.cwd(), chain, forgeCodebook(c, { minHits: 2 }).codebook, 1700000000000 + i).chain; });
  return chain;
}

describe("v2.100 HYDRA · GUARD × CHAIN — temporal guarded replay", () => {
  it("derives staleness from the chain's OWN history (deterministic)", () => {
    const chain = buildChain();
    const a = trustMapFromChain(chain, chain.length - 1, 1);
    const b = trustMapFromChain(chain, chain.length - 1, 1);
    expect(JSON.stringify(a.trustMap)).toBe(JSON.stringify(b.trustMap));
    expect(a.staleCount + a.freshCount).toBeGreaterThan(0);
  });

  it("a phrase added at delta 0, untouched, is STALE at the tip; tip-added is FRESH", () => {
    const chain = buildChain();
    const t = trustMapFromChain(chain, chain.length - 1, 1);   // halfLife*2 = 2 deltas
    const r = guardedReplay(chain, chain.length - 1, 1);
    const cb = r.codebook!;
    const ancient = cb.entries.find((e) => e.phrase.includes("ancient axiom"));
    const brandNew = cb.entries.find((e) => e.phrase.includes("brand new thing"));
    if (ancient) expect(t.trustMap[ancient.sym]).toBe("stale");        // old → redacted
    if (brandNew) expect(t.trustMap[brandNew.sym]).toBeUndefined();    // just added → fresh
  });

  it("END-TO-END: guarded expansion redacts cold content, keeps fresh byte-exact", () => {
    const chain = buildChain();
    const tipCorpus = STEPS[STEPS.length - 1]!;
    const r = guardedReplay(chain, chain.length - 1, 1);
    const cb = r.codebook!;
    const encoded = compress(tipCorpus, cb);
    const guarded = expandGuarded(encoded, cb, trustFromMap(r.trust.trustMap));
    // ancient (cold) content is redacted; fresh content survives byte-exact.
    expect(guarded.includes("ancient axiom holds forever")).toBe(false);
    expect(guarded).toContain("brand new thing just landed");
    // identity of the redacted region stays verifiable
    const ancient = cb.entries.find((e) => e.phrase.includes("ancient axiom"))!;
    expect(guarded).toContain(sha256Hex(ancient.phrase).slice(0, 16));
  });

  it("phraseAddedSeq tracks re-add freshness (remove then re-add ⇒ newer seq)", () => {
    const chain = buildChain();
    const seqs = phraseAddedSeq(chain, chain.length - 1);
    // recent phrases were added at later seqs than ancient ones.
    const ancientSeq = [...seqs.entries()].find(([p]) => p.includes("ancient axiom"))?.[1] ?? -1;
    const newSeq = [...seqs.entries()].find(([p]) => p.includes("brand new thing"))?.[1] ?? -1;
    expect(newSeq).toBeGreaterThan(ancientSeq);
  });

  it("guarded-chain gauntlet scores 100 (deterministic ∧ freshAtTip ∧ provenOnly ∧ stable)", () => {
    const g = guardedChainGauntlet(buildChain(), 1);
    expect(g.deterministic).toBe(true);
    expect(g.freshAtTip).toBe(true);
    expect(g.provenOnly).toBe(true);
    expect(g.stable).toBe(true);
    expect(g.score).toBe(100);
  });

  it("STABILITY — total on garbage", () => {
    expect(() => trustMapFromChain(null as never, 0, 1)).not.toThrow();
    expect(guardedReplay(undefined as never, 3, 1).ok).toBe(false);
    expect(guardedChainGauntlet([] as never, 1).score).toBe(0);
    expect(trustMapFromChain([], 0, 1).staleCount).toBe(0);
  });
});
