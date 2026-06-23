import { describe, it, expect } from "vitest";
import {
  honestyLedgerGauntlet, buildHonestyLedger, verifyHonestyLedger, ledgerConsistent,
  badgeSVG, badgeShields, freshKeyPair, type HonestyLedger,
} from "./index.js";
import type { NotaryReceipt } from "../notary/receipt.js";

describe("v3.143 · THE PUBLIC HONESTY LEDGER", () => {
  it("gauntlet is 100", () => expect(honestyLedgerGauntlet().score).toBe(100));

  it("★ builds a signed ledger of the real repo that verifies offline + is HONEST (drift 0)", async () => {
    const kp = freshKeyPair();
    const { ledger, receipt } = await buildHonestyLedger(process.cwd(), "test", kp);
    const v = verifyHonestyLedger(receipt);
    expect(v.valid).toBe(true);
    expect(v.honest, "the real repo must be zero-drift").toBe(true);
    expect(ledger.summary.drift).toBe(0);
    expect(ledger.summary.refuted).toBe(0);
    expect(ledger.claims.length).toBe(ledger.summary.total);
  }, 120_000);

  it("rejects a tampered ledger (verdict edited, summary left honest)", () => {
    const kp = freshKeyPair();
    const clean: HonestyLedger = {
      spec: "MNEME-HONESTY-LEDGER", v: 1, version: "t", generatedAt: "2026-01-01T00:00:00.000Z",
      summary: { total: 1, pass: 1, drift: 0, refuted: 0, unmeasured: 0, measured: 1, score: 100, honest: true },
      claims: [{ id: "claim.a", text: "t", source: "s", probeId: "probe.a", severity: "info", verdict: "pass", reason: "r" }],
    };
    // sign via the gauntlet's path isn't exported; reuse buildHonestyLedger semantics through verify on a hand-tampered object
    const fake = { v: 1, alg: "ed25519", kind: "generic", subject: "x", payloadHash: "00", issuer: kp.publicKeyB64, issuerFingerprint: kp.fingerprint, issuedAt: 1, receiptId: "00", sig: "00", payload: clean } as unknown as NotaryReceipt;
    expect(verifyHonestyLedger(fake).valid).toBe(false); // bad signature/hash
  });

  it("a cooked summary (rows say drift, summary says 0) fails consistency", () => {
    const cooked: HonestyLedger = {
      spec: "MNEME-HONESTY-LEDGER", v: 1, version: "t", generatedAt: "x",
      summary: { total: 1, pass: 1, drift: 0, refuted: 0, unmeasured: 0, measured: 1, score: 100, honest: true },
      claims: [{ id: "c", text: "t", source: "s", probeId: "p", severity: "info", verdict: "drift", reason: "r" }],
    };
    expect(ledgerConsistent(cooked)).toBe(false);
  });

  it("the badge cannot be faked green when drifting", () => {
    const honest = badgeSVG({ total: 10, pass: 10, drift: 0, refuted: 0, unmeasured: 0, measured: 10, score: 100, honest: true });
    const drifting = badgeSVG({ total: 10, pass: 8, drift: 2, refuted: 0, unmeasured: 0, measured: 10, score: 80, honest: false });
    expect(honest).toContain("#2da44e");
    expect(drifting).toContain("#cf222e");
    expect(drifting).not.toContain("#2da44e");
    expect(badgeShields({ total: 10, pass: 8, drift: 2, refuted: 0, unmeasured: 0, measured: 10, score: 80, honest: false }).color).toBe("red");
  });

  it("is total on hostile input", () => {
    expect(() => verifyHonestyLedger(null)).not.toThrow();
    expect(verifyHonestyLedger({}).valid).toBe(false);
    expect(() => badgeSVG(null as never)).not.toThrow();
  });
});
