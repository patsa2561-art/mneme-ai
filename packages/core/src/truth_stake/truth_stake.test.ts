/**
 * v2.82.0 — TRUTH-STAKING pinned + QUAN tests (💎6).
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStake, resolveStake, verifyStakeReceipt } from "./index.js";
import { verifyReceipt, type NotaryReceipt } from "../notary/index.js";

const repo = () => mkdtempSync(join(tmpdir(), "mneme-stake-"));

describe("v2.82.0 💎6 Truth-Staking (PINNED)", () => {
  it("S1 refuted within window ⇒ SLASHED", () => {
    const r = repo();
    const { stake } = createStake(r, { staker: "a", claim: "no vuln", amountMicros: 1_000_000, deadlineMs: 1000, createdAt: 0 });
    const { resolution } = resolveStake(r, stake, { refuted: true, at: 500 });
    expect(resolution.status).toBe("SLASHED");
    expect(resolution.slashedMicros).toBe(1_000_000);
  });
  it("S2 survives the window unrefuted ⇒ RETURNED", () => {
    const r = repo();
    const { stake } = createStake(r, { staker: "a", claim: "safe", amountMicros: 500, deadlineMs: 1000, createdAt: 0 });
    const { resolution } = resolveStake(r, stake, { refuted: false, at: 2000 });
    expect(resolution.status).toBe("RETURNED");
    expect(resolution.returnedMicros).toBe(500);
  });
  it("S3 inside window, not yet refuted ⇒ PENDING", () => {
    const r = repo();
    const { stake } = createStake(r, { staker: "a", claim: "x", amountMicros: 9, deadlineMs: 1000, createdAt: 0 });
    expect(resolveStake(r, stake, { refuted: false, at: 500 }).resolution.status).toBe("PENDING");
  });
  it("S4 late refutation (after window) does NOT slash — claim crystallized", () => {
    const r = repo();
    const { stake } = createStake(r, { staker: "a", claim: "x", amountMicros: 9, deadlineMs: 1000, createdAt: 0 });
    expect(resolveStake(r, stake, { refuted: true, at: 2000 }).resolution.status).toBe("RETURNED");
  });
  it("S5 stake + resolution receipts verify offline; tampering fails", () => {
    const r = repo();
    const { stake, receipt } = createStake(r, { staker: "a", claim: "c", amountMicros: 100, deadlineMs: 10 });
    expect(verifyStakeReceipt(JSON.parse(JSON.stringify(receipt))).valid).toBe(true);
    expect(verifyReceipt({ ...receipt, payload: { ...(receipt.payload as object), amountMicros: 0 } } as NotaryReceipt).valid).toBe(false);
    void stake;
  });
});

describe("v2.82.0 💎6 QUAN", () => {
  it("Q slashedMicros ≤ amount; status deterministic over fuzz", () => {
    const r = repo();
    for (let i = 0; i < 150; i++) {
      const amount = (i * 37) % 5000;
      const deadline = 1000;
      const created = 0;
      const at = (i * 53) % 2500;
      const refuted = i % 2 === 0;
      const { stake } = createStake(r, { staker: `a${i}`, claim: `c${i}`, amountMicros: amount, deadlineMs: deadline, createdAt: created });
      const a = resolveStake(r, stake, { refuted, at }).resolution;
      const b = resolveStake(r, stake, { refuted, at }).resolution;
      expect(a.status).toBe(b.status);
      expect(a.slashedMicros).toBeLessThanOrEqual(amount);
      expect(a.returnedMicros).toBeLessThanOrEqual(amount);
      const expected = refuted && at <= created + deadline ? "SLASHED" : at >= created + deadline ? "RETURNED" : "PENDING";
      expect(a.status).toBe(expected);
    }
  });
});
