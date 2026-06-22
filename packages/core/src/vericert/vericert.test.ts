import { describe, it, expect } from "vitest";
import { certify, verifyCertBody, vericertBench, vericertGauntlet, VERICERT_CORPUS } from "./index.js";

describe("v3.120 · VERICERT — Verified-by-Mneme certificate", () => {
  it("gauntlet is 100", () => {
    expect(vericertGauntlet().score).toBe(100);
  });

  // ── unit ──
  it("CERTIFIED only when every claim is clean", () => {
    expect(certify("The function returns the sum of two integers. Verify edge cases.").verdict).toBe("CERTIFIED");
  });
  it("REJECTED when a claim is a hard fault", () => {
    expect(certify("This always works and never fails on any input.").verdict).toBe("REJECTED");
  });
  it("CONDITIONAL when a claim only needs review", () => {
    expect(certify("Studies prove exactly 73.2% of users convert.").verdict).toBe("CONDITIONAL");
  });
  it("catches a fault that spans a sentence boundary (citation split from its 'proves')", () => {
    expect(certify("The method is sound. According to Smith et al. (2019) this definitively proves the approach works.").verdict).not.toBe("CERTIFIED");
  });

  // ── the measured guarantee (A/B) ──
  it("★ accuracy ≥98% AND CERTIFIED-precision = 1.0 (never certifies a hallucinated deliverable)", () => {
    const b = vericertBench();
    expect(b.accuracy).toBeGreaterThanOrEqual(0.98);
    expect(b.certifiedPrecision).toBe(1);
    expect(b.leaks).toEqual([]);
    expect(b.cleanRecall).toBeGreaterThanOrEqual(0.9);
  });
  it("A/B vs no-verification: the baseline (trust everything) certifies every dirty deliverable; VERICERT certifies none of them", () => {
    const dirty = VERICERT_CORPUS.filter((c) => !c.expectCertified);
    const baselineCertifiedDirty = dirty.length;                 // "trust everything" = all pass
    const vericertCertifiedDirty = dirty.filter((c) => certify(c.deliverable).verdict === "CERTIFIED").length;
    expect(baselineCertifiedDirty).toBeGreaterThan(0);
    expect(vericertCertifiedDirty).toBe(0);
  });

  // ── integration: certify → verify round-trip + tamper-evidence ──
  it("INTEGRATION: a genuine certificate verifies offline + binds the exact deliverable", () => {
    const d = "The database is PostgreSQL, confirmed in the compose file. Latency is about 40ms in staging.";
    const cert = certify(d);
    expect(verifyCertBody(cert).ok).toBe(true);
    expect(verifyCertBody(cert, d).ok).toBe(true);                 // matches the work
    expect(verifyCertBody(cert, "This always works and never fails.").ok).toBe(false); // work swapped → caught
  });
  it("INTEGRATION: tampering the certificate body is caught (certId re-derivation)", () => {
    const cert = certify("The function returns the sum of two integers.");
    const forged = { ...cert, verdict: "CERTIFIED" as const, blocked: 9 };
    expect(verifyCertBody(forged).ok).toBe(false);
  });

  it("is total on hostile input", () => {
    expect(() => certify(null as never)).not.toThrow();
    expect(() => verifyCertBody(null as never)).not.toThrow();
    expect(certify("").verdict).toBe("CERTIFIED");
  });
});
