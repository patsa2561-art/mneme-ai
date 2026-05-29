/**
 * v2.92.0 — 💎⑦ DIAKRISIS tests (genuine vs merely-plausible).
 *
 *   D1  lustreScore is STRUCTURAL (hyperbole/absolutism ↑, hedging ↓) — never an LLM opinion
 *   D2  Reject-or-Unknown — REJECT only on PROVEN-low substance (reverted / tests failed / FALSE)
 *   D3  ★ Padgett guard — novel / unproven / aesthetic ⇒ UNKNOWN, NEVER REJECT (the metric that matters)
 *   D4  2×2 classification — TRAP / GEM / PLAUSIBLE_CAVEAT / PROVEN_GOOD
 *   D5  gem surfacing — low-lustre + proven-high substance → GEM (surfaced for the human)
 *   D6  every verdict is signed; ceiling is always handed to the human
 *   D7  Diakrisis Gauntlet — trap-catch high · novel-false-reject 0% · gem-surfacing high
 *   D8  QUAN — never throws over fuzz; verdict always REJECT|UNKNOWN
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { discern, lustreScore, runDiakrisisGauntlet, HIGH_LUSTRE } from "./diakrisis.js";

function repo(): string { return mkdtempSync(join(tmpdir(), "diakrisis-")); }
const T = 1_700_000_000_000;
const HYPE = "This is the BEST, most revolutionary, absolutely flawless solution ever — guaranteed perfect.";
const PLAIN = "fix off-by-one in the pager offset";

describe("v2.92.0 💎⑦ DIAKRISIS — discern genuine from merely-plausible", () => {
  it("D1 lustreScore is structural — hyperbole/absolutism raise it, hedging lowers it (no LLM)", () => {
    const hype = lustreScore(HYPE).lustre;
    const plain = lustreScore(PLAIN).lustre;
    const hedged = lustreScore("this might possibly perhaps work in some cases, i think").lustre;
    expect(hype).toBeGreaterThan(plain);
    expect(hype).toBeGreaterThanOrEqual(HIGH_LUSTRE);
    expect(plain).toBeLessThan(HIGH_LUSTRE);
    expect(hedged).toBe(0); // hedging cannot produce shine
  });

  it("D2 Reject-or-Unknown — REJECT only on PROVEN-low substance", async () => {
    expect((await discern(repo(), HYPE, { substanceEvidence: { reverted: true }, now: T })).verdict).toBe("REJECT");
    expect((await discern(repo(), "x", { substanceEvidence: { testPassed: false }, now: T })).verdict).toBe("REJECT");
    expect((await discern(repo(), "Mneme is written in Rust", { substanceEvidence: { verdict: "FALSE" }, now: T })).verdict).toBe("REJECT");
    // proven-high or unproven → NOT reject
    expect((await discern(repo(), PLAIN, { substanceEvidence: { testPassed: true }, now: T })).verdict).toBe("UNKNOWN");
    expect((await discern(repo(), PLAIN, { now: T })).verdict).toBe("UNKNOWN");
  });

  it("D3 ★ Padgett guard — novel / unproven / aesthetic ⇒ UNKNOWN, NEVER REJECT", async () => {
    // a Padgett: correct-looking-or-not but in an unrecognised form, unverifiable → MUST abstain
    const padgett = await discern(repo(), "a geometric notation for calculus the teachers did not recognise", { now: T });
    expect(padgett.verdict).toBe("UNKNOWN");
    expect(padgett.padgettGuard).toBe(true);
    // even a high-lustre UNVERIFIED claim is NOT rejected (only proven-low is) — caveat, not kill
    const caveat = await discern(repo(), HYPE, { now: T }); // no evidence ⇒ substance UNKNOWN
    expect(caveat.verdict).toBe("UNKNOWN");
    expect(caveat.classification).toBe("PLAUSIBLE_CAVEAT");
    // a weird, plain, unproven idea → UNKNOWN, never REJECT
    expect((await discern(repo(), "an unfamiliar approach nobody has tried", { now: T })).verdict).toBe("UNKNOWN");
  });

  it("D4 2×2 classification — TRAP / GEM / CAVEAT / PROVEN_GOOD", async () => {
    expect((await discern(repo(), HYPE, { substanceEvidence: { reverted: true }, now: T })).classification).toBe("TRAP");        // hi lustre + proven low
    expect((await discern(repo(), PLAIN, { substanceEvidence: { testPassed: true }, now: T })).classification).toBe("GEM");      // lo lustre + proven high
    expect((await discern(repo(), HYPE, { now: T })).classification).toBe("PLAUSIBLE_CAVEAT");                                   // hi lustre + unverified
    expect((await discern(repo(), HYPE, { substanceEvidence: { testPassed: true }, now: T })).classification).toBe("PROVEN_GOOD"); // hi lustre + proven high
  });

  it("D5 gem surfacing — undervalued substance flagged for the human", async () => {
    const gem = await discern(repo(), PLAIN, { substanceEvidence: { testPassed: true }, now: T });
    expect(gem.classification).toBe("GEM");
    expect(gem.verdict).toBe("UNKNOWN");     // not rejected
    expect(gem.flooredPass).toBe(true);
  });

  it("D6 every verdict is signed; ceiling is always the human's", async () => {
    const r = await discern(repo(), HYPE, { substanceEvidence: { reverted: true }, now: T });
    expect(r.receipt).not.toBeNull();
    expect(r.ceiling).toMatch(/human/);
    const ns = await discern(repo(), PLAIN, { noSign: true, now: T });
    expect(ns.receipt).toBeNull();
  });

  it("D7 Diakrisis Gauntlet — trap-catch high · novel-false-reject 0% · gem-surfacing high", async () => {
    const g = await runDiakrisisGauntlet(repo(), [
      { artifact: HYPE, evidence: { reverted: true }, kind: "trap" },
      { artifact: "absolutely the best, never fails, guaranteed perfect always", evidence: { testPassed: false }, kind: "trap" },
      { artifact: PLAIN, evidence: { testPassed: true }, kind: "gem" },
      { artifact: "minor whitespace normalisation", evidence: { testPassed: true }, kind: "gem" },
      { artifact: "a strange new notation that looks wrong but might be right", kind: "novel" },
      { artifact: "an unproven idea in an unfamiliar form", kind: "novel" },
      { artifact: "yet another novel untested concept", kind: "novel" },
    ], { now: T });
    expect(g.trapCatchRate).toBe(1);
    expect(g.novelFalseRejectRate).toBe(0); // ★ the Padgett guard — the metric that matters most
    expect(g.gemSurfacingRate).toBe(1);
    // honest bound: there is NO world-class-recognition metric
    expect((g as unknown as Record<string, unknown>)["worldClassRecognitionRate"]).toBeUndefined();
  });

  it("D8 QUAN — never throws over fuzz; verdict always REJECT|UNKNOWN", async () => {
    const r = repo();
    for (let i = 0; i < 40; i++) {
      const artifact = ["", "   ", `the ${i}th best thing ever guaranteed`, `plain note ${i}`, "weird﻿chars", "absolutely perfect flawless"][i % 6]!;
      const ev = [{ reverted: true }, { testPassed: true }, { testPassed: false }, {}, { verdict: "UNKNOWN" as const }][i % 5];
      const out = await discern(r, artifact, { substanceEvidence: ev, now: T, noSign: true });
      expect(["REJECT", "UNKNOWN"]).toContain(out.verdict);
      expect(typeof out.lustre).toBe("number");
    }
    expect(() => lustreScore("")).not.toThrow();
  });
});
