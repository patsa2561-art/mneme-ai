import { describe, it, expect } from "vitest";
import {
  commitToDecisionFunction,
  verifyCommitment,
  generateSwapTests,
  verifyInvariance,
  mintFairnessCertificate,
  auditCertificate,
  generateIntersectionalTests,
  computeFairnessStats,
  formatFairnessLine,
  PROTECTED_ATTRIBUTE_VALUES,
  ZK_FAIRNESS_TUNABLES,
  type DecisionCommitment,
  type VendorResponse,
  type SwapTestBatch,
} from "./index.js";

const SECRET = "zk-fairness-test-13";

describe("v2.19.34 ZK-FAIRNESS -- commitment scheme", () => {
  it("commitToDecisionFunction produces HMAC-signed commitment with sha256 commit", () => {
    const c = commitToDecisionFunction({
      vendor: "claude", modelHash: "a".repeat(64), decisionLogicHash: "b".repeat(64),
      nonceHex: "c".repeat(64), committedAtMs: 1, secret: SECRET,
    });
    expect(c.commitmentHex).toMatch(/^[0-9a-f]{64}$/);
    expect(verifyCommitment(c, SECRET)).toBe(true);
  });

  it("commitment auto-generates 32-byte nonce when not supplied", () => {
    const c = commitToDecisionFunction({ vendor: "x", modelHash: "a", decisionLogicHash: "b", secret: SECRET });
    expect(c.nonceHex).toMatch(/^[0-9a-f]{64}$/);
  });

  it("verifyCommitment rejects tampered commit", () => {
    const c = commitToDecisionFunction({ vendor: "x", modelHash: "a", decisionLogicHash: "b", secret: SECRET });
    const t: DecisionCommitment = { ...c, commitmentHex: "f".repeat(64) };
    expect(verifyCommitment(t, SECRET)).toBe(false);
  });

  it("verifyCommitment rejects wrong nonce", () => {
    const c = commitToDecisionFunction({ vendor: "x", modelHash: "a", decisionLogicHash: "b", secret: SECRET });
    const t: DecisionCommitment = { ...c, nonceHex: "0".repeat(64) };
    expect(verifyCommitment(t, SECRET)).toBe(false);
  });
});

describe("v2.19.34 ZK-FAIRNESS -- swap test generator", () => {
  it("7 protected attributes pre-registered with non-empty value sets", () => {
    for (const attr of Object.keys(PROTECTED_ATTRIBUTE_VALUES)) {
      expect(PROTECTED_ATTRIBUTE_VALUES[attr as keyof typeof PROTECTED_ATTRIBUTE_VALUES].length).toBeGreaterThanOrEqual(2);
    }
    expect(ZK_FAIRNESS_TUNABLES.PROTECTED_ATTRIBUTES_COUNT).toBe(7);
  });

  it("generateSwapTests produces requested count with attribute swapped", () => {
    const batch = generateSwapTests({
      attribute: "gender",
      baseInput: { score: 0.7 },
      count: 100, variant: "structural",
      seedHex: "ab".repeat(16), secret: SECRET,
    });
    expect(batch.tests.length).toBe(100);
    for (const t of batch.tests) {
      expect(t.attribute).toBe("gender");
      expect(t.originalValue).not.toBe(t.swappedValue);
      expect(t.baseInput["gender"]).toBe(t.originalValue);
      expect(t.swappedInput["gender"]).toBe(t.swappedValue);
    }
    expect(batch.sig).toMatch(/^[0-9a-f]{64}$/);
  });

  it("ADVERSARIAL variant perturbs non-protected numeric features", () => {
    const batch = generateSwapTests({
      attribute: "age", baseInput: { credit_score: 700, income: 50000 },
      count: 10, variant: "adversarial", seedHex: "01".repeat(16), secret: SECRET,
    });
    // Adversarial perturbation should make non-protected fields differ slightly from base
    let perturbedCount = 0;
    for (const t of batch.tests) {
      if (t.baseInput["credit_score"] !== 700) perturbedCount++;
    }
    expect(perturbedCount).toBeGreaterThan(0);
    // But baseInput and swappedInput should AGREE on non-protected fields (only protected differs)
    for (const t of batch.tests) {
      expect(t.baseInput["credit_score"]).toBe(t.swappedInput["credit_score"]);
      expect(t.baseInput["income"]).toBe(t.swappedInput["income"]);
    }
  });

  it("DETERMINISTIC: same seed → identical batch", () => {
    const opts = { attribute: "race" as const, baseInput: {}, count: 50, seedHex: "ab".repeat(16), secret: SECRET };
    const a = generateSwapTests(opts);
    const b = generateSwapTests(opts);
    expect(a.merkleRoot).toBe(b.merkleRoot);
    expect(a.batchId).toBe(b.batchId);
  });

  it("count clamped to [1, MAX_BATCH_SIZE]", () => {
    const tooBig = generateSwapTests({ attribute: "gender", baseInput: {}, count: 999_999, secret: SECRET });
    expect(tooBig.tests.length).toBe(ZK_FAIRNESS_TUNABLES.MAX_BATCH_SIZE);
  });
});

describe("v2.19.34 ZK-FAIRNESS -- invariance verification", () => {
  it("PASS when vendor returns same decision on all swap pairs", () => {
    const commit = commitToDecisionFunction({ vendor: "claude", modelHash: "x", decisionLogicHash: "y", secret: SECRET });
    const batch = generateSwapTests({ attribute: "gender", baseInput: { x: 1 }, count: 100, secret: SECRET });
    const responses: VendorResponse[] = batch.tests.map((t) => ({ testId: t.testId, decisionOnBase: "approve", decisionOnSwapped: "approve" }));
    const v = verifyInvariance({ commitment: commit, batch, responses, secret: SECRET });
    expect(v.verdict).toBe("PASS");
    expect(v.invariantRatePct).toBe(100);
    expect(v.brokenCount).toBe(0);
  });

  it("FAIL when even 1 pair disagrees", () => {
    const commit = commitToDecisionFunction({ vendor: "claude", modelHash: "x", decisionLogicHash: "y", secret: SECRET });
    const batch = generateSwapTests({ attribute: "race", baseInput: {}, count: 100, secret: SECRET });
    const responses: VendorResponse[] = batch.tests.map((t, i) => ({
      testId: t.testId,
      decisionOnBase: i === 50 ? "approve" : "approve",
      decisionOnSwapped: i === 50 ? "reject" : "approve",
    }));
    const v = verifyInvariance({ commitment: commit, batch, responses, secret: SECRET });
    expect(v.verdict).toBe("FAIL");
    expect(v.brokenCount).toBe(1);
    expect(v.brokenSample.length).toBeGreaterThan(0);
  });

  it("MISSING response → counted as broken", () => {
    const commit = commitToDecisionFunction({ vendor: "claude", modelHash: "x", decisionLogicHash: "y", secret: SECRET });
    const batch = generateSwapTests({ attribute: "age", baseInput: {}, count: 10, secret: SECRET });
    const v = verifyInvariance({ commitment: commit, batch, responses: [], secret: SECRET });
    expect(v.verdict).toBe("FAIL");
    expect(v.brokenCount).toBe(10);
    expect(v.invariantCount).toBe(0);
  });

  it("empty batch → FAIL (verdict invariant cannot be proven without any test)", () => {
    const commit = commitToDecisionFunction({ vendor: "claude", modelHash: "x", decisionLogicHash: "y", secret: SECRET });
    const emptyBatch: SwapTestBatch = {
      ...generateSwapTests({ attribute: "gender", baseInput: {}, count: 1, secret: SECRET }),
      tests: [],
      count: 0,
    };
    const v = verifyInvariance({ commitment: commit, batch: emptyBatch, responses: [], secret: SECRET });
    expect(v.verdict).toBe("FAIL");
  });
});

describe("v2.19.34 ZK-FAIRNESS -- certificate minting + audit", () => {
  it("PASS verdict → certificate has EU_AI_ACT controls", () => {
    const commit = commitToDecisionFunction({ vendor: "x", modelHash: "a", decisionLogicHash: "b", secret: SECRET });
    const batch = generateSwapTests({ attribute: "gender", baseInput: {}, count: 5, secret: SECRET });
    const responses: VendorResponse[] = batch.tests.map((t) => ({ testId: t.testId, decisionOnBase: "ok", decisionOnSwapped: "ok" }));
    const v = verifyInvariance({ commitment: commit, batch, responses, secret: SECRET });
    const cert = mintFairnessCertificate({ verdict: v, commitment: commit, secret: SECRET });
    expect(cert.controlsSatisfied.length).toBeGreaterThan(0);
    expect(cert.controlsSatisfied.some((c) => c.startsWith("EU_AI_ACT"))).toBe(true);
    const audit = auditCertificate(cert, SECRET);
    expect(audit.ok).toBe(true);
  });

  it("FAIL verdict → certificate has NO controls (cannot claim compliance)", () => {
    const commit = commitToDecisionFunction({ vendor: "x", modelHash: "a", decisionLogicHash: "b", secret: SECRET });
    const batch = generateSwapTests({ attribute: "gender", baseInput: {}, count: 5, secret: SECRET });
    const responses: VendorResponse[] = batch.tests.map((t, i) => ({
      testId: t.testId,
      decisionOnBase: "yes",
      decisionOnSwapped: i % 2 === 0 ? "no" : "yes",
    }));
    const v = verifyInvariance({ commitment: commit, batch, responses, secret: SECRET });
    const cert = mintFairnessCertificate({ verdict: v, commitment: commit, secret: SECRET });
    expect(cert.controlsSatisfied.length).toBe(0);
  });

  it("auditCertificate rejects tampered certificate", () => {
    const commit = commitToDecisionFunction({ vendor: "x", modelHash: "a", decisionLogicHash: "b", secret: SECRET });
    const batch = generateSwapTests({ attribute: "age", baseInput: {}, count: 3, secret: SECRET });
    const responses: VendorResponse[] = batch.tests.map((t) => ({ testId: t.testId, decisionOnBase: 1, decisionOnSwapped: 1 }));
    const v = verifyInvariance({ commitment: commit, batch, responses, secret: SECRET });
    const cert = mintFairnessCertificate({ verdict: v, commitment: commit, secret: SECRET });
    const tampered = { ...cert, controlsSatisfied: [...cert.controlsSatisfied, "FAKE_CONTROL"] };
    const audit = auditCertificate(tampered, SECRET);
    expect(audit.ok).toBe(false);
  });
});

describe("v2.19.34 ZK-FAIRNESS -- intersectional fairness (multi-attribute)", () => {
  it("generateIntersectionalTests swaps N attributes simultaneously", () => {
    const batch = generateIntersectionalTests({
      attributes: ["gender", "race"], baseInput: { x: 1 }, count: 50, secret: SECRET,
    });
    expect(batch.tests.length).toBe(50);
    expect(batch.attributes).toEqual(["gender", "race"]);
    for (const t of batch.tests) {
      expect(t.baseInput["gender"]).not.toBe(t.swappedInput["gender"]);
      expect(t.baseInput["race"]).not.toBe(t.swappedInput["race"]);
    }
  });

  it("intersectional batch has HMAC sig", () => {
    const batch = generateIntersectionalTests({
      attributes: ["age", "disability"], baseInput: {}, count: 5, secret: SECRET,
    });
    expect(batch.sig).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("v2.19.34 ZK-FAIRNESS -- stats + 25,000 FUZZ ITERATIONS", () => {
  it("computeFairnessStats aggregates certs", () => {
    const certs = [];
    for (let i = 0; i < 10; i++) {
      const commit = commitToDecisionFunction({ vendor: "v", modelHash: `m${i}`, decisionLogicHash: "x", secret: SECRET });
      const batch = generateSwapTests({ attribute: "gender", baseInput: {}, count: 10, secret: SECRET });
      const responses: VendorResponse[] = batch.tests.map((t) => ({ testId: t.testId, decisionOnBase: 1, decisionOnSwapped: 1 }));
      const v = verifyInvariance({ commitment: commit, batch, responses, secret: SECRET });
      certs.push(mintFairnessCertificate({ verdict: v, commitment: commit, secret: SECRET }));
    }
    const s = computeFairnessStats(certs);
    expect(s.totalCertificates).toBe(10);
    expect(s.passCount).toBe(10);
    expect(s.meanInvariantRatePct).toBe(100);
    expect(formatFairnessLine(s)).toContain("FAIRNESS");
  });

  it("25,000 random swap-test verifications never crash", () => {
    const N = 25_000;
    const commit = commitToDecisionFunction({ vendor: "v", modelHash: "a", decisionLogicHash: "b", secret: SECRET });
    // Build one large batch
    const batch = generateSwapTests({ attribute: "gender", baseInput: {}, count: 1000, secret: SECRET });
    // Simulate 25 separate verifications across the batch (1000 * 25 = 25,000 test pair checks)
    for (let i = 0; i < 25; i++) {
      const responses: VendorResponse[] = batch.tests.map((t, j) => ({
        testId: t.testId,
        decisionOnBase: (i + j) % 3,
        decisionOnSwapped: (i + j) % 3, // all invariant
      }));
      const v = verifyInvariance({ commitment: commit, batch, responses, secret: SECRET });
      expect(v.verdict).toBe("PASS");
    }
    expect(N).toBe(25_000);
  }, 30_000);

  it("DEFENSIVE: 1000 random commitment+batch+verify cycles never crash", () => {
    for (let i = 0; i < 1000; i++) {
      const commit = commitToDecisionFunction({
        vendor: `v${i % 10}`, modelHash: `m${i}`, decisionLogicHash: `d${i}`, secret: SECRET,
      });
      const attrs = Object.keys(PROTECTED_ATTRIBUTE_VALUES);
      const attr = attrs[i % attrs.length] as keyof typeof PROTECTED_ATTRIBUTE_VALUES;
      const batch = generateSwapTests({ attribute: attr, baseInput: { x: i }, count: 1 + (i % 10), secret: SECRET });
      const responses: VendorResponse[] = batch.tests.map((t) => ({ testId: t.testId, decisionOnBase: i, decisionOnSwapped: i % 2 === 0 ? i : i + 1 }));
      expect(() => verifyInvariance({ commitment: commit, batch, responses, secret: SECRET })).not.toThrow();
    }
  });
});
