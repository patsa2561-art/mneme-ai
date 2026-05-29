/**
 * v2.91.0 — 💎⑥ ANAMNESIS tests (compute once, recollect forever).
 *
 *   N1  canonicalForm — meaning-preserving paraphrase collapse (arith forms, words, commutative sort, case/space)
 *   N2  NO false collision — word order preserved; different values ≠; non-commutative not sorted
 *   N3  recollect-or-recompute — first computes, repeat recollects (~0), compute runs exactly once
 *   N4  re-verify EVERY hit — tampered body / forged sig / stale / invalidated all force recompute
 *   N5  freshness window — within ttl → recollect, past ttl → recompute; ttl 0 = eternal axiom
 *   N6  energy ledger — anamnesisStats totals + mintEnergyCertificate signs the savings
 *   N7  cross-vendor export/import — added, idempotent, forged (claim-swap) dropped
 *   N8  Anamnesis Gauntlet — recollection-rate > 0 AND stale-serve-rate === 0
 *   N9  QUAN — never throws over fuzz; always 3-valued
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  canonicalForm, canonicalClaimKey, recollectOrCompute, recollectAssertion, isTrustworthy,
  invalidate, anamnesisStats, mintEnergyCertificate, exportProofs, importProofs, runAnamnesisGauntlet,
  type ComputeResult, type ProofRecord,
} from "./anamnesis.js";

function repo(): string { return mkdtempSync(join(tmpdir(), "anamnesis-")); }
const T = 1_700_000_000_000;
const storeFile = (r: string): string => join(r, ".mneme", "anamnesis", "proofs.jsonl");
const proveTrue = (costTokens = 1800, ttlMs = 0): (() => Promise<ComputeResult>) =>
  () => Promise.resolve({ verdict: "TRUE", lineage: [{ sensor: "flash", verdict: "TRUE", weight: 1 }], ttlMs, costTokens });

describe("v2.91.0 💎⑥ ANAMNESIS — compute once, recollect forever", () => {
  it("N1 canonicalForm — meaning-preserving paraphrase collapse", () => {
    const k = (s: string) => canonicalClaimKey(s);
    // four arithmetic paraphrases → one key
    expect(new Set(["2+2=4", "2 + 2 = 4", "two plus two equals four", "4 = 2 + 2"].map(k)).size).toBe(1);
    // commutative operands sorted (3*4 ≡ 4*3)
    expect(k("3*4=12")).toBe(k("4*3=12"));
    expect(k("5+7=12")).toBe(k("7+5=12"));
    // case + whitespace + trailing punctuation
    expect(k("React 19 ships RSC")).toBe(k("react 19 ships rsc."));
    // number-words in prose
    expect(canonicalForm("ten times ten = 100")).toBe(canonicalForm("10*10=100"));
  });

  it("N2 NO false collision — the savant won't trade safety for hit-rate", () => {
    const k = (s: string) => canonicalClaimKey(s);
    expect(k("dog bites man")).not.toBe(k("man bites dog")); // word order is meaning
    expect(k("2+2=4")).not.toBe(k("2+2=5"));                 // different value
    expect(k("10-3=7")).not.toBe(k("3-10=7"));               // subtraction NOT commutative → not sorted
  });

  it("N3 recollect-or-recompute — compute runs exactly once across repeats + paraphrases", async () => {
    const r = repo();
    let computeCalls = 0;
    const compute = (): Promise<ComputeResult> => { computeCalls++; return proveTrue(1800, 0)(); };
    const a = await recollectOrCompute(r, "2+2=4", compute, { now: T, agent: "claude" });
    const b = await recollectOrCompute(r, "2 + 2 = 4", compute, { now: T + 10, agent: "gpt" });      // paraphrase
    const c = await recollectOrCompute(r, "two plus two equals four", compute, { now: T + 20 });      // paraphrase
    expect(a.source).toBe("recompute");
    expect(b.source).toBe("recollect");
    expect(c.source).toBe("recollect");
    expect(b.energySavedTokens).toBe(1800);
    expect(computeCalls).toBe(1); // ← the whole point: proven once, recollected forever
  });

  it("N4 re-verify EVERY hit — tampered body / forged sig / invalidated all force recompute", async () => {
    // (a) tamper the stored verdict in the jsonl → next ask must recompute (body ≠ signed payload)
    {
      const r = repo();
      await recollectOrCompute(r, "2+2=4", proveTrue(), { now: T });
      const rec = JSON.parse(readFileSync(storeFile(r), "utf8").trim()) as ProofRecord;
      rec.verdict = "FALSE";
      writeFileSync(storeFile(r), JSON.stringify(rec) + "\n", "utf8");
      const again = await recollectOrCompute(r, "2+2=4", proveTrue(), { now: T + 5 });
      expect(again.source).toBe("recompute");
      expect(again.reason).toBe("forged");
    }
    // (b) invalidate → recompute
    {
      const r = repo();
      await recollectOrCompute(r, "the version is 1.2", proveTrue(1800, 999999), { now: T });
      expect(invalidate(r, "the version is 1.2", "shipped 1.3")).toBe(true);
      const again = await recollectOrCompute(r, "the version is 1.2", proveTrue(1800, 999999), { now: T + 5 });
      expect(again.source).toBe("recompute");
      expect(again.reason).toBe("invalidated");
    }
  });

  it("N5 freshness window — within ttl recollect, past ttl recompute; ttl 0 eternal", async () => {
    const r = repo();
    await recollectOrCompute(r, "weather is sunny today", proveTrue(1800, 1000), { now: T }); // 1s ttl
    expect((await recollectOrCompute(r, "weather is sunny today", proveTrue(1800, 1000), { now: T + 500 })).source).toBe("recollect");
    expect((await recollectOrCompute(r, "weather is sunny today", proveTrue(1800, 1000), { now: T + 5000 })).source).toBe("recompute"); // stale
    // eternal axiom (ttl 0) recollects far in the future
    const r2 = repo();
    await recollectOrCompute(r2, "2+2=4", proveTrue(1800, 0), { now: T });
    expect((await recollectOrCompute(r2, "2+2=4", proveTrue(1800, 0), { now: T + 10 ** 12 })).source).toBe("recollect");
  });

  it("N6 energy ledger — stats total + signed savings certificate", async () => {
    const r = repo();
    await recollectOrCompute(r, "2+2=4", proveTrue(1800, 0), { now: T });
    await recollectOrCompute(r, "2+2=4", proveTrue(1800, 0), { now: T + 1 });
    await recollectOrCompute(r, "2+2=4", proveTrue(1800, 0), { now: T + 2 });
    const s = anamnesisStats(r);
    expect(s.records).toBe(1);
    expect(s.recollections).toBe(2);
    expect(s.totalEnergySavedTokens).toBe(3600); // 2 recollections × 1800
    const cert = await mintEnergyCertificate(r, { windowStartMs: T, windowEndMs: T + 10 }) as { totalTokensSaved?: number; hmac?: string };
    expect(cert.totalTokensSaved).toBe(3600);
    expect(typeof cert.hmac).toBe("string");
  });

  it("N7 cross-vendor export/import — added, idempotent, forged claim-swap dropped", async () => {
    const a = repo();
    await recollectOrCompute(a, "2+2=4", proveTrue(), { now: T });
    await recollectOrCompute(a, "10*10=100", proveTrue(), { now: T });
    const bundle = exportProofs(a, "agentA");
    expect(bundle.proofs.length).toBe(2);
    const dest = repo();
    expect(importProofs(dest, bundle).added).toBe(2);
    expect(importProofs(dest, bundle).duplicate).toBe(2);   // idempotent
    // forge: swap a claimKey but keep the (now-mismatched) valid signature → dropped
    const forged = JSON.parse(JSON.stringify(bundle));
    forged.proofs[0].claimKey = "deadbeef";
    expect(importProofs(repo(), forged).rejectedForged).toBe(1);
  });

  it("N8 Anamnesis Gauntlet — recollection-rate > 0 AND stale-serve-rate 0%", async () => {
    const g = await runAnamnesisGauntlet(repo(), [
      "2+2=4", "2 + 2 = 4", "two plus two equals four", "10*10=100", "ten times ten = 100", "2+2=4",
    ], { now: T });
    expect(g.recollectionRate).toBeGreaterThan(0);
    expect(g.staleServeRate).toBe(0);          // never serves an unre-verifiable proof
    expect(g.energySavedTokens).toBeGreaterThan(0);
    expect(g.recomputes).toBe(2);              // only 2 distinct facts
  });

  it("N9 QUAN — never throws over fuzz; always 3-valued; isTrustworthy total", async () => {
    const r = repo();
    for (let i = 0; i < 40; i++) {
      const claim = ["", "   ", `${i}+${i}=${i * 2}`, `claim ${i}`, "weird﻿chars", `${i} is not ${i}`][i % 6]!;
      const out = await recollectAssertion(r, claim, { now: T });
      expect(["TRUE", "FALSE", "UNKNOWN"]).toContain(out.verdict);
    }
    expect(() => canonicalForm("")).not.toThrow();
    expect(() => anamnesisStats(r)).not.toThrow();
    const fakeRec = { claimKey: "x", verdict: "TRUE", receipt: null, ttlMs: 0, computedAt: 0, invalidated: false } as unknown as ProofRecord;
    expect(isTrustworthy(fakeRec, T)).toBe(false); // unsigned ⇒ never trustworthy
  });
});
