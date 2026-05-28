/**
 * v2.81.0 — HONESTY CREDIT SCORE pinned + QUAN tests.
 *   H1 Wilson-LB scoring: small sample penalized; perfect-large > perfect-small
 *   H2 band boundaries (PLATINUM/GOLD/SILVER/BRONZE/UNTRUSTED/UNMEASURED)
 *   H3 issue → verifyHonestyReceipt round trip (offline)
 *   H4 tamper / wrong-issuer / expiry rejected
 *   H5 shouldTrust band gating + expiry + issuer assertion
 *   QUAN:
 *   Q1 monotonic: more true (same total) ⇒ score never decreases
 *   Q2 score always in [0,100]; total+deterministic over fuzz; never throws
 *   Q3 a vendor cannot self-promote by forging the payload (signature catches it)
 */

import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  computeHonestyScore, bandFor, issueHonestyReceipt, verifyHonestyReceipt,
  shouldTrust, compareBands, MIN_SAMPLE, type HonestyBand,
} from "./index.js";
import { getIssuerKeyPair, type NotaryReceipt } from "../notary/index.js";

const repo = () => mkdtempSync(join(tmpdir(), "mneme-honesty-"));

describe("v2.81.0 H1 — Wilson-LB scoring (PINNED)", () => {
  it("H1.1 a small perfect sample scores LOWER than a large perfect sample", () => {
    const small = computeHonestyScore({ agent: "a", trueCount: 5, falseCount: 0 });
    const large = computeHonestyScore({ agent: "a", trueCount: 1000, falseCount: 0 });
    expect(small.score).toBeLessThan(large.score);
    expect(large.score).toBeGreaterThan(95);
  });
  it("H1.2 lies drag the score down", () => {
    const honest = computeHonestyScore({ agent: "a", trueCount: 90, falseCount: 10 });
    const liar = computeHonestyScore({ agent: "b", trueCount: 50, falseCount: 50 });
    expect(honest.score).toBeGreaterThan(liar.score);
  });
  it("H1.3 below MIN_SAMPLE decisive ⇒ UNMEASURED", () => {
    const s = computeHonestyScore({ agent: "a", trueCount: MIN_SAMPLE - 1, falseCount: 0 });
    expect(s.band).toBe("UNMEASURED");
  });
});

describe("v2.81.0 H2 — band boundaries (PINNED)", () => {
  it("H2.1 maps scores to bands (with enough samples)", () => {
    const n = 1000;
    expect(bandFor(95, n)).toBe("PLATINUM");
    expect(bandFor(80, n)).toBe("GOLD");
    expect(bandFor(65, n)).toBe("SILVER");
    expect(bandFor(45, n)).toBe("BRONZE");
    expect(bandFor(20, n)).toBe("UNTRUSTED");
    expect(bandFor(95, 1)).toBe("UNMEASURED");
  });
  it("H2.2 compareBands orders trust", () => {
    expect(compareBands("PLATINUM", "BRONZE")).toBeGreaterThan(0);
    expect(compareBands("UNTRUSTED", "SILVER")).toBeLessThan(0);
  });
});

describe("v2.81.0 H3+H4 — signed receipt round trip + tamper (PINNED)", () => {
  it("H3.1 issue → verify (offline) valid + carries the score", () => {
    const r = repo();
    const score = computeHonestyScore({ agent: "claude", trueCount: 200, falseCount: 5 });
    const receipt = issueHonestyReceipt(r, score);
    const v = verifyHonestyReceipt(JSON.parse(JSON.stringify(receipt)));
    expect(v.valid).toBe(true);
    expect(v.expired).toBe(false);
    expect(v.score!.agent).toBe("claude");
    expect(v.score!.band).toBe(score.band);
  });
  it("H4.1 tampering the score fails the signature", () => {
    const r = repo();
    const receipt = issueHonestyReceipt(r, computeHonestyScore({ agent: "a", trueCount: 10, falseCount: 10 }));
    const forged = { ...receipt, payload: { ...(receipt.payload as object), score: 100, band: "PLATINUM" } } as NotaryReceipt;
    expect(verifyHonestyReceipt(forged).valid).toBe(false);
  });
  it("H4.2 expired score: valid signature but flagged expired", () => {
    const r = repo();
    const score = computeHonestyScore({ agent: "a", trueCount: 100, falseCount: 1 }, 1000);
    const receipt = issueHonestyReceipt(r, score, { ttlDays: 1 });
    const later = 1000 + 2 * 24 * 60 * 60 * 1000;
    const v = verifyHonestyReceipt(receipt, { now: later });
    expect(v.valid).toBe(true);
    expect(v.expired).toBe(true);
  });
});

describe("v2.81.0 H5 — shouldTrust (PINNED)", () => {
  it("H5.1 gates on band, expiry, and issuer", () => {
    const r = repo();
    const high = issueHonestyReceipt(r, computeHonestyScore({ agent: "good", trueCount: 500, falseCount: 2 }));
    const low = issueHonestyReceipt(r, computeHonestyScore({ agent: "bad", trueCount: 30, falseCount: 70 }));
    expect(shouldTrust(high, "GOLD").trust).toBe(true);
    expect(shouldTrust(low, "GOLD").trust).toBe(false);
    // issuer assertion
    const fp = getIssuerKeyPair(r).fingerprint;
    expect(shouldTrust(high, "SILVER", { expectedIssuerFingerprint: fp }).trust).toBe(true);
    expect(shouldTrust(high, "SILVER", { expectedIssuerFingerprint: "deadbeefdeadbeef" }).trust).toBe(false);
    // expiry
    const old = issueHonestyReceipt(r, computeHonestyScore({ agent: "x", trueCount: 500, falseCount: 1 }, 1000), { ttlDays: 1 });
    expect(shouldTrust(old, "BRONZE", { now: 1000 + 5 * 86400000 }).trust).toBe(false);
  });
});

// ─────────────────────────── QUAN (property/fuzz) ───────────────────────────

describe("v2.81.0 Q — honesty score invariants (QUAN)", () => {
  it("Q1 monotonic: adding TRUE claims (same total via swapping a false→true) never lowers the score", () => {
    const total = 60;
    let prev = -1;
    for (let t = 0; t <= total; t++) {
      const s = computeHonestyScore({ agent: "a", trueCount: t, falseCount: total - t });
      expect(s.score).toBeGreaterThanOrEqual(prev);
      prev = s.score;
    }
  });
  it("Q2 score ∈ [0,100], total + deterministic over fuzz, never throws", () => {
    for (let i = 0; i < 300; i++) {
      const t = (i * 7) % 250;
      const f = (i * 13) % 130;
      const p = (i * 5) % 40;
      const s1 = computeHonestyScore({ agent: `a${i}`, trueCount: t, falseCount: f, partialCount: p });
      const s2 = computeHonestyScore({ agent: `a${i}`, trueCount: t, falseCount: f, partialCount: p }, s1.computedAt);
      expect(s1.score).toBeGreaterThanOrEqual(0);
      expect(s1.score).toBeLessThanOrEqual(100);
      expect(["PLATINUM", "GOLD", "SILVER", "BRONZE", "UNTRUSTED", "UNMEASURED"] as HonestyBand[]).toContain(s1.band);
      expect(s2.score).toBe(s1.score);
    }
    // garbage inputs never throw
    expect(() => computeHonestyScore({ agent: "x", trueCount: -5 as number, falseCount: NaN as number })).not.toThrow();
  });
  it("Q3 a vendor cannot self-promote: forging band/score in the payload breaks verify", () => {
    const r = repo();
    for (let i = 0; i < 20; i++) {
      const receipt = issueHonestyReceipt(r, computeHonestyScore({ agent: `v${i}`, trueCount: i, falseCount: 50 - i }));
      const forged = { ...receipt, payload: { ...(receipt.payload as object), score: 99, band: "PLATINUM" } } as NotaryReceipt;
      expect(verifyHonestyReceipt(forged).valid, `forge ${i} must fail`).toBe(false);
    }
  });
});
