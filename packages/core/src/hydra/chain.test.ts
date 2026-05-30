import { describe, it, expect } from "vitest";
import { forgeCodebook, sha256Hex } from "./index.js";
import { canonicalizeCodebook } from "./attest.js";
import { appendToChain, replayChain, verifyChain, chainGauntlet, applyDelta, type CodebookDelta } from "./chain.js";

// Three evolving corpora → three codebooks → a 3-link chain.
const C1 = "alpha module is here. alpha module works.".repeat(5);
const C2 = C1 + "\nbeta helper arrives. beta helper is new.".repeat(5);
const C3 = C2 + "\ngamma engine lands. gamma engine is fast.".repeat(5);

function buildChain(): CodebookDelta[] {
  const cb1 = forgeCodebook(C1, { minHits: 2 }).codebook;
  const cb2 = forgeCodebook(C2, { minHits: 2 }).codebook;
  const cb3 = forgeCodebook(C3, { minHits: 2 }).codebook;
  let chain: CodebookDelta[] = [];
  chain = appendToChain(process.cwd(), chain, cb1, 1700000000000).chain;
  chain = appendToChain(process.cwd(), chain, cb2, 1700000000001).chain;
  chain = appendToChain(process.cwd(), chain, cb3, 1700000000002).chain;
  return chain;
}

describe("v2.98 HYDRA PROVENANCE CHAIN", () => {
  it("replays to EVERY index byte-exact (canonical hash matches)", () => {
    const cb1 = forgeCodebook(C1, { minHits: 2 }).codebook;
    const cb3 = forgeCodebook(C3, { minHits: 2 }).codebook;
    const chain = buildChain();
    const r0 = replayChain(chain, 0);
    const r2 = replayChain(chain, 2);
    expect(r0.ok).toBe(true);
    expect(sha256Hex(canonicalizeCodebook(r0.codebook!))).toBe(sha256Hex(canonicalizeCodebook(cb1)));
    expect(sha256Hex(canonicalizeCodebook(r2.codebook!))).toBe(sha256Hex(canonicalizeCodebook(cb3)));
  });

  it("verifies OFFLINE — sigs + links + replay intact", () => {
    const chain = buildChain();
    const v = verifyChain(chain);
    expect(v.ok).toBe(true);
    expect(v.brokenAt).toBe(-1);
    expect(v.length).toBe(3);
  });

  it("catches tampering with a localized break", () => {
    const chain = buildChain();
    const clone: CodebookDelta[] = JSON.parse(JSON.stringify(chain));
    clone[1]!.resultHash = sha256Hex("forged");
    const v = verifyChain(clone);
    expect(v.ok).toBe(false);
    expect(v.brokenAt).toBe(1);
  });

  it("catches a forged added-phrase (replay hash diverges)", () => {
    const chain = buildChain();
    const clone: CodebookDelta[] = JSON.parse(JSON.stringify(chain));
    clone[2]!.added.push({ phrase: "INJECTED EVIL", hits: 9, gain: 9 });
    expect(verifyChain(clone).ok).toBe(false);
  });

  it("chain gauntlet scores 100 (verified ∧ replayExact ∧ tamperCaught)", () => {
    const g = chainGauntlet(buildChain());
    expect(g.verified).toBe(true);
    expect(g.replayExact).toBe(true);
    expect(g.tamperCaught).toBe(true);
    expect(g.score).toBe(100);
  });

  it("STABILITY — total functions never throw on garbage", () => {
    expect(() => verifyChain(null as never)).not.toThrow();
    expect(verifyChain(null as never).ok).toBe(false);
    expect(applyDelta(null, { v: 99 } as never).ok).toBe(false);
    expect(replayChain([{ bad: true } as never], 0).ok).toBe(false);
    expect(chainGauntlet(undefined as never).score).toBe(0);
  });
});
