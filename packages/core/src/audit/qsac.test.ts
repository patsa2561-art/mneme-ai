import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { composeQsacCertificate, renderWisdom } from "./qsac.js";
import { distribution } from "./superposition.js";

let tmp: string;
beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "mneme-qsac-"));
});
afterEach(() => {
  try { rmSync(tmp, { recursive: true, force: true }); } catch {}
});

const cleanPass = distribution({ pass: 0.95, warn: 0.04, fail: 0.005, skipped: 0.005 });
const cleanFail = distribution({ pass: 0.05, warn: 0.10, fail: 0.83, skipped: 0.02 });

const allPassInput = {
  commitHash: "a1b2c3d4e5f6",
  axes: {
    behavioralParity: cleanPass,
    apiContractDrift: cleanPass,
    testPassRate: cleanPass,
    perfRegression: cleanPass,
    aiNarrative: cleanPass,
  },
  issuedBy: "mneme-test",
};

describe("composeQsacCertificate — happy path", () => {
  it("produces a cert with all techs composed", async () => {
    const cert = await composeQsacCertificate(allPassInput);
    expect(cert.commitHash).toBe("a1b2c3d4e5f6");
    expect(cert.priors.behavioralParity.collapsed).toBe("pass");
    expect(cert.posteriors.behavioralParity.collapsed).toBe("pass");
    expect(cert.consensus.consensus.collapsed).toBe("pass");
    expect(cert.overall.collapsed).toBe("pass");
    expect(cert.graphConvergence.converged).toBe(true);
  });

  it("includes stylometric vote when stylometry input given", async () => {
    const cert = await composeQsacCertificate({
      ...allPassInput,
      stylometry: {
        addedLines: Array.from({ length: 30 }, (_, i) => `  const value${i} = "x";`),
        removedLines: [],
      },
    });
    const verifierIds = cert.consensus.votes.map((v) => v.verifier);
    expect(verifierIds).toContain("stylometric");
  });

  it("includes entropy vote when entropy input given", async () => {
    const cert = await composeQsacCertificate({
      ...allPassInput,
      entropy: { totalChangedLines: 50, narrativeClaimCount: 3, narrativeLength: 200 },
    });
    const verifierIds = cert.consensus.votes.map((v) => v.verifier);
    expect(verifierIds).toContain("entropy");
  });
});

describe("composeQsacCertificate — failure detection", () => {
  it("api fail propagates through claim graph", async () => {
    const cert = await composeQsacCertificate({
      ...allPassInput,
      axes: { ...allPassInput.axes, apiContractDrift: cleanFail },
    });
    expect(cert.posteriors.apiContractDrift.collapsed).toBe("fail");
    // overall confidence should drop
    expect(cert.overall.confidence).toBeLessThan(0.95);
  });

  it("narrative-vs-axes contradiction visible in posteriors", async () => {
    const cert = await composeQsacCertificate({
      ...allPassInput,
      axes: { ...allPassInput.axes, apiContractDrift: cleanFail },
      narrative: {
        claimsNoApiChange: cleanPass, // AI lied: said "no API change" but axis says fail
      },
    });
    // The narrative claim's posterior should drop after propagation
    // (we don't expose narrative posteriors in the cert, but the
    // aiNarrative axis posterior captures the spillover)
    expect(cert.posteriors.aiNarrative.confidence).toBeLessThan(cleanPass.confidence);
  });

  it("mutation score factored into overall when supplied", async () => {
    const weakMutation = distribution({ pass: 0.05, warn: 0.20, fail: 0.70, skipped: 0.05 });
    const cert = await composeQsacCertificate({
      ...allPassInput,
      mutationScore: weakMutation,
    });
    // Overall confidence drops because weak tests pull pass mass down
    expect(cert.overall.confidence).toBeLessThan(0.95);
  });

  it("skipped mutation score does not affect overall", async () => {
    const skipped = distribution({ pass: 0, warn: 0, fail: 0, skipped: 1 });
    const certWith = await composeQsacCertificate({ ...allPassInput, mutationScore: skipped });
    const certWithout = await composeQsacCertificate(allPassInput);
    expect(certWith.overall.confidence).toBeCloseTo(certWithout.overall.confidence, 2);
  });
});

describe("composeQsacCertificate — chain integration", () => {
  it("appends to chain when chain config given", async () => {
    const cert = await composeQsacCertificate({
      ...allPassInput,
      chain: { rootPath: tmp },
    });
    expect(cert.chained).toBeDefined();
    expect(cert.chained!.index).toBe(0);
    expect(cert.chained!.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("subsequent certs link via prevHash", async () => {
    const c1 = await composeQsacCertificate({ ...allPassInput, commitHash: "a", chain: { rootPath: tmp } });
    const c2 = await composeQsacCertificate({ ...allPassInput, commitHash: "b", chain: { rootPath: tmp } });
    expect(c2.chained!.prevHash).toBe(c1.chained!.hash);
  });

  it("HMAC-signs when key provided", async () => {
    const cert = await composeQsacCertificate({
      ...allPassInput,
      chain: { rootPath: tmp, hmacKey: "0".repeat(64) },
    });
    expect(cert.chained!.signature).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("renderWisdom — drill-through output", () => {
  it("produces multi-line readable output", async () => {
    const cert = await composeQsacCertificate(allPassInput);
    const text = renderWisdom(cert);
    expect(text).toContain("QSAC Certificate");
    expect(text).toContain("PASS");
    expect(text).toContain("Per-axis posterior");
    expect(text).toContain("Multi-verifier consensus");
  });

  it("flags disagreement in output", async () => {
    // Force a split consensus by giving conflicting stylometric input
    const cert = await composeQsacCertificate({
      ...allPassInput,
      axes: { ...allPassInput.axes, apiContractDrift: cleanFail },
      stylometry: {
        addedLines: Array.from({ length: 30 }, (_, i) => `  const x${i} = "x";`),
        removedLines: [],
      },
    });
    const text = renderWisdom(cert);
    if (cert.consensus.disagreement) {
      expect(text).toMatch(/DISAGREEMENT|split/i);
    }
    expect(text).toContain("Multi-verifier consensus");
  });

  it("shows chain info when chained", async () => {
    const cert = await composeQsacCertificate({
      ...allPassInput,
      chain: { rootPath: tmp },
    });
    const text = renderWisdom(cert);
    expect(text).toContain("chain index");
    expect(text).toContain("hash");
  });
});
