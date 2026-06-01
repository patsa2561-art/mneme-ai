import { describe, it, expect } from "vitest";
import { recordTx, buildLedger, verifyChain, settlementStatement, normalizeTx, settlementGauntlet } from "./index.js";

const TXS = [
  { kind: "outline" as const, namesHidden: 0, secretsRemoved: 0, localVerified: "na" as const, tokensSent: 290, tokensSaved: 13400 },
  { kind: "blind" as const, namesHidden: 7, secretsRemoved: 1, localVerified: "na" as const, tokensSent: 120, tokensSaved: 0 },
  { kind: "channel-op" as const, namesHidden: 3, secretsRemoved: 0, localVerified: "pass" as const, tokensSent: 40, tokensSaved: 600 },
  { kind: "channel-commit" as const, localVerified: "fail" as const, tokensSent: 30, tokensSaved: 500 },
];

describe("v2.129 SETTLEMENT — chain", () => {
  it("builds a linked chain that verifies offline", () => {
    const l = buildLedger(TXS);
    expect(l.length).toBe(4);
    expect(verifyChain(l).ok).toBe(true);
    expect(l[0]!.prevHash).toMatch(/^0{64}$/);
    expect(l[1]!.prevHash).toBe(l[0]!.chainHash);
  });
  it("detects an edited transaction at the exact seq", () => {
    const l = buildLedger(TXS);
    const tampered = l.map((r, i) => i === 2 ? { ...r, tx: { ...r.tx, tokensSaved: 999999 } } : r);
    const v = verifyChain(tampered);
    expect(v.ok).toBe(false);
    expect(v.firstBrokenSeq).toBe(3);
  });
  it("detects reorder / insertion / removal", () => {
    const l = buildLedger(TXS);
    expect(verifyChain([l[1]!, l[0]!, l[2]!, l[3]!]).ok).toBe(false); // swap
    expect(verifyChain([l[0]!, l[2]!, l[3]!]).ok).toBe(false);        // removal
  });
  it("recordTx falls back to GENESIS on a bad prevHash", () => {
    expect(recordTx("not-a-hash", { kind: "raw" }).prevHash).toMatch(/^0{64}$/);
  });
});

describe("v2.129 SETTLEMENT — statement", () => {
  it("sums tokens, % blinded, % locally-verified", () => {
    const s = settlementStatement(buildLedger(TXS));
    expect(s.totalTokensSaved).toBe(14500);
    expect(s.totalTokensSent).toBe(480);
    expect(s.pctBlinded).toBe(50);          // 2 of 4 had names/secrets hidden
    expect(s.pctLocallyVerified).toBe(50);  // 2 gated, 1 passed
    expect(s.integrity.ok).toBe(true);
  });
  it("USD + fee ONLY from the user-supplied rate (never invented)", () => {
    const withRate = settlementStatement(buildLedger(TXS), { pricePer1kUSD: 0.003, feePct: 0.10 });
    expect(withRate.usdSaved).toBeCloseTo((14500 / 1000) * 0.003, 4);
    expect(withRate.feeUSD).toBe(Math.round(withRate.usdSaved! * 0.10 * 1e4) / 1e4); // matches impl rounding
    expect(settlementStatement(buildLedger(TXS)).usdSaved).toBeUndefined();
  });
});

describe("v2.129 SETTLEMENT — normalize + totality + gauntlet", () => {
  it("normalizeTx clamps + defaults garbage", () => {
    const tx = normalizeTx(-5, { kind: "nope" as never, tokensSent: -10, localVerified: "weird" as never });
    expect(tx.seq).toBe(0); expect(tx.kind).toBe("raw"); expect(tx.tokensSent).toBe(0); expect(tx.localVerified).toBe("na");
    expect(tx.sentHash).toMatch(/^[0-9a-f]{64}$/);
  });
  it("is TOTAL on garbage", () => {
    expect(() => recordTx(null as never, null as never)).not.toThrow();
    expect(() => verifyChain(null as never)).not.toThrow();
    expect(() => settlementStatement(null as never)).not.toThrow();
  });
  it("settlementGauntlet() = 100", () => {
    const g = settlementGauntlet();
    expect(g.score).toBe(100);
    expect(g.chainVerifiesOffline).toBe(true);
    expect(g.tamperLocalized).toBe(true);
    expect(g.reorderDetected).toBe(true);
    expect(g.statementSums).toBe(true);
    expect(g.feedMatchesUserRate).toBe(true);
    expect(g.deterministic).toBe(true);
    expect(g.stable).toBe(true);
  });
});
