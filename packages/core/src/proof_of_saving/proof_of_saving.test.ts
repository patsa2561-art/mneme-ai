import { describe, it, expect } from "vitest";
import {
  mintSavingsCertificate,
  verifySavingsCertificate,
  formatCertificate,
  type GovernedDecisionShape,
} from "./index.js";

const SECRET = "proof-test-secret-77";

function makeDecisions(n: number, fixedSaving = 100, fixedActual = 50): GovernedDecisionShape[] {
  const out: GovernedDecisionShape[] = [];
  for (let i = 0; i < n; i++) {
    out.push({
      signature: `sig-${i}-${Math.random().toString(36).slice(2, 10)}`,
      tokensUsedActual: fixedActual,
      estTokensSavedVsDirect: fixedSaving,
      stage: ((i % 4) + 1),
    });
  }
  return out;
}

describe("v2.19.42 PROOF OF SAVING · mint + verify round trip", () => {
  it("mints a certificate with correct arithmetic", () => {
    const decisions = makeDecisions(10);
    const cert = mintSavingsCertificate({ decisions, windowStartMs: 0, windowEndMs: 1000, secret: SECRET });
    expect(cert.decisionCount).toBe(10);
    expect(cert.totalActualTokens).toBe(500);
    expect(cert.totalTokensSaved).toBe(1000);
    expect(cert.totalDirectTokens).toBe(1500);
    expect(cert.merkleLeafCount).toBe(10);
    expect(cert.hmac.length).toBe(64);
  });

  it("verify returns ok on a fresh cert", () => {
    const decisions = makeDecisions(5);
    const cert = mintSavingsCertificate({ decisions, windowStartMs: 0, windowEndMs: 1, secret: SECRET });
    expect(verifySavingsCertificate(cert, decisions, SECRET).ok).toBe(true);
  });

  it("verify detects tampered HMAC", () => {
    const decisions = makeDecisions(3);
    const cert = mintSavingsCertificate({ decisions, windowStartMs: 0, windowEndMs: 1, secret: SECRET });
    const tampered = { ...cert, totalTokensSaved: cert.totalTokensSaved + 100 };
    expect(verifySavingsCertificate(tampered, decisions, SECRET).ok).toBe(false);
  });

  it("verify detects swapped decisions (Merkle mismatch)", () => {
    const a = makeDecisions(3);
    const cert = mintSavingsCertificate({ decisions: a, windowStartMs: 0, windowEndMs: 1, secret: SECRET });
    const b = makeDecisions(3);
    const r = verifySavingsCertificate(cert, b, SECRET);
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Merkle");
  });

  it("verify detects wrong secret", () => {
    const decisions = makeDecisions(2);
    const cert = mintSavingsCertificate({ decisions, windowStartMs: 0, windowEndMs: 1, secret: SECRET });
    expect(verifySavingsCertificate(cert, decisions, "wrong-secret").ok).toBe(false);
  });

  it("empty decisions list still produces a valid cert (zero savings)", () => {
    const cert = mintSavingsCertificate({ decisions: [], windowStartMs: 0, windowEndMs: 1, secret: SECRET });
    expect(cert.decisionCount).toBe(0);
    expect(cert.totalTokensSaved).toBe(0);
    expect(verifySavingsCertificate(cert, [], SECRET).ok).toBe(true);
  });

  it("USD estimate uses caller-supplied usdPerToken", () => {
    const cert = mintSavingsCertificate({ decisions: makeDecisions(10, 1000, 0), windowStartMs: 0, windowEndMs: 1, usdPerToken: 0.00001, secret: SECRET });
    expect(cert.estUsdSaved).toBe(10000 * 0.00001);
  });
});

describe("v2.19.42 PROOF OF SAVING · stage breakdown + format", () => {
  it("stage breakdown counts calls and tokens per stage", () => {
    const decisions = makeDecisions(20);
    const cert = mintSavingsCertificate({ decisions, windowStartMs: 0, windowEndMs: 1, secret: SECRET });
    const total = Object.values(cert.stageBreakdown).reduce((s, b) => s + b.calls, 0);
    expect(total).toBe(20);
  });

  it("formatCertificate produces multi-line human-readable text", () => {
    const cert = mintSavingsCertificate({ decisions: makeDecisions(3), windowStartMs: 0, windowEndMs: 1, secret: SECRET });
    const txt = formatCertificate(cert);
    expect(txt).toContain("PROOF OF SAVING");
    expect(txt).toContain("Tokens saved");
    expect(txt).toContain("Merkle root");
  });
});

describe("v2.19.42 PROOF OF SAVING · 1000-iter fuzz", () => {
  it("mint + verify cycle never throws on random batches", () => {
    for (let i = 0; i < 1000; i++) {
      const n = Math.floor(Math.random() * 30);
      const decisions = makeDecisions(n, Math.floor(Math.random() * 1000), Math.floor(Math.random() * 500));
      const cert = mintSavingsCertificate({ decisions, windowStartMs: 0, windowEndMs: i, secret: SECRET, nowMs: i });
      expect(verifySavingsCertificate(cert, decisions, SECRET).ok).toBe(true);
    }
  });
});
