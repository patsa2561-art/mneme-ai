import { describe, it, expect } from "vitest";
import { randomBytes } from "node:crypto";
import { createLedger, appendShard, balanceOf, verifyChain, formatLedgerPulseLine } from "./index.js";

describe("v2.1 WISDOM SHARDS · proof-of-truth ledger", () => {
  const secret = randomBytes(32);

  it("createLedger starts empty + has keyFingerprint", () => {
    const l = createLedger(secret);
    expect(l.entries.length).toBe(0);
    expect(l.keyFingerprint.length).toBeGreaterThan(0);
  });

  it("appendShard mint adds value to balance", () => {
    let l = createLedger(secret);
    ({ ledger: l } = appendShard({ ledger: l, kind: "mint", value: 5, reason: "verified grounding", secret }));
    ({ ledger: l } = appendShard({ ledger: l, kind: "mint", value: 3, reason: "another verification", secret }));
    const b = balanceOf(l);
    expect(b.totalMinted).toBe(8);
    expect(b.balance).toBe(8);
  });

  it("burn subtracts from balance", () => {
    let l = createLedger(secret);
    ({ ledger: l } = appendShard({ ledger: l, kind: "mint", value: 10, reason: "ok", secret }));
    ({ ledger: l } = appendShard({ ledger: l, kind: "burn", value: 3, reason: "hallucination caught", secret }));
    const b = balanceOf(l);
    expect(b.balance).toBe(7);
  });

  it("rejects non-positive integer value", () => {
    const l = createLedger(secret);
    expect(() => appendShard({ ledger: l, kind: "mint", value: 0, reason: "x", secret })).toThrow(/positive integer/);
    expect(() => appendShard({ ledger: l, kind: "mint", value: 1.5, reason: "x", secret })).toThrow(/positive integer/);
    expect(() => appendShard({ ledger: l, kind: "mint", value: -1, reason: "x", secret })).toThrow(/positive integer/);
  });

  it("chain verifies VALID after correct appends", () => {
    let l = createLedger(secret);
    for (let i = 0; i < 5; i++) {
      ({ ledger: l } = appendShard({ ledger: l, kind: "mint", value: 1, reason: `entry-${i}`, secret }));
    }
    expect(verifyChain(l, secret).verdict).toBe("VALID");
  });

  it("chain detects BROKEN entry tampering", () => {
    let l = createLedger(secret);
    ({ ledger: l } = appendShard({ ledger: l, kind: "mint", value: 1, reason: "a", secret }));
    ({ ledger: l } = appendShard({ ledger: l, kind: "mint", value: 1, reason: "b", secret }));
    // Tamper with the oldest entry
    l.entries[1]!.value = 99;
    const r = verifyChain(l, secret);
    expect(r.verdict).toBe("BROKEN");
    expect(r.firstBrokenIndex).toBeDefined();
  });

  it("chain returns WRONG_KEY on wrong secret", () => {
    let l = createLedger(secret);
    ({ ledger: l } = appendShard({ ledger: l, kind: "mint", value: 1, reason: "a", secret }));
    const wrong = randomBytes(32);
    expect(verifyChain(l, wrong).verdict).toBe("WRONG_KEY");
  });

  it("newest-first ordering: entries[0] is the latest", () => {
    let l = createLedger(secret);
    ({ ledger: l } = appendShard({ ledger: l, kind: "mint", value: 1, reason: "first", secret }));
    ({ ledger: l } = appendShard({ ledger: l, kind: "mint", value: 1, reason: "second", secret }));
    expect(l.entries[0]!.reason).toBe("second");
    expect(l.entries[1]!.reason).toBe("first");
  });

  it("formatLedgerPulseLine summarises", () => {
    let l = createLedger(secret);
    ({ ledger: l } = appendShard({ ledger: l, kind: "mint", value: 3, reason: "x", secret }));
    expect(formatLedgerPulseLine(l)).toContain("WISDOM-SHARDS");
    expect(formatLedgerPulseLine(l)).toContain("balance=3");
  });
});
