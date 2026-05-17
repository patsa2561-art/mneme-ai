/**
 * v2.19.34 INTEGRATION — APOSTILLE → OUTCOME → ZK-FAIRNESS → ETERNITY
 *
 * Real-world enterprise scenario: an EU bank deploys an AI loan-decision
 * agent. They need to prove (a) every AI call is logged + mapped to
 * regulatory controls (APOSTILLE), (b) vendor selection is competitive
 * + outcome-priced (OUTCOME), (c) fairness across protected attributes
 * is mathematically verified (ZK-FAIRNESS), (d) the trail survives
 * even if the AI vendor disappears (ETERNITY).
 *
 * If this passes, the holy-grail quadruple ships as a coherent enterprise
 * compliance product.
 */
import { describe, it, expect } from "vitest";
import {
  emptyLedger, mintReceipt, appendToLedger, verifyLedger, generateAuditBinder,
} from "../apostille/index.js";
import {
  postTask, submitBid, pickWinner, scoreOutcome, freshReputation, updateReputation,
} from "../outcome_market/index.js";
import {
  commitToDecisionFunction, generateSwapTests, verifyInvariance, mintFairnessCertificate,
} from "../zk_fairness/index.js";
import {
  mintEternalTrace, mintPinReceipt, attachPin, computeSurvivalScore,
  type StorageRoot,
} from "../eternity/index.js";

const S_APO = "integration-apo";
const S_MKT = "integration-mkt";
const S_ZK = "integration-zk";
const S_ETR = "integration-etr";

describe("v2.19.34 INTEGRATION — EU bank deploys AI loan agent", () => {
  it("end-to-end pipeline: 4 modules chain coherently", () => {
    // ─── 1. OUTCOME MARKET: bank posts loan-classifier task; vendors bid ─
    const task = postTask({
      intent: "classify loan applicant as approve/deny",
      acceptanceCriteria: ["accuracy >= 0.85", "no disparate impact across protected attrs"],
      maxBudgetCents: 1000, postedBy: "eu_bank_compliance",
      postedAtMs: 1_700_000_000_000, secret: S_MKT,
    });
    const bids = [
      submitBid({ task, vendor: "claude", priceCents: 400, estimatedLatencyMs: 200, confidence: 0.9, submittedAtMs: 1_700_000_000_005, secret: S_MKT })!,
      submitBid({ task, vendor: "gpt", priceCents: 300, estimatedLatencyMs: 150, confidence: 0.85, submittedAtMs: 1_700_000_000_010, secret: S_MKT })!,
      submitBid({ task, vendor: "gemini", priceCents: 500, estimatedLatencyMs: 100, confidence: 0.95, submittedAtMs: 1_700_000_000_015, secret: S_MKT })!,
    ];
    const auction = pickWinner({ task, bids, secret: S_MKT });
    expect(auction.winnerVendor).toBe("gpt"); // lowest price
    expect(auction.effectivePriceCents).toBe(400); // Vickrey 2nd-price (claude's 400)

    // ─── 2. ZK-FAIRNESS: winner commits + fairness verified for 7 attrs ─
    const commit = commitToDecisionFunction({
      vendor: "gpt", modelHash: "gpt-loan-v1-hash", decisionLogicHash: "logic-v1",
      committedAtMs: 1_700_000_000_100, secret: S_ZK,
    });
    const batch = generateSwapTests({
      attribute: "gender", baseInput: { income: 50000, credit_score: 720, age: 35 },
      count: 100, variant: "adversarial", secret: S_ZK,
    });
    // Simulate vendor returning invariant decisions (PASS fairness)
    const responses = batch.tests.map((t) => ({ testId: t.testId, decisionOnBase: "approve" as const, decisionOnSwapped: "approve" as const }));
    const verdict = verifyInvariance({ commitment: commit, batch, responses, secret: S_ZK });
    expect(verdict.verdict).toBe("PASS");
    const cert = mintFairnessCertificate({ verdict, commitment: commit, secret: S_ZK });
    expect(cert.controlsSatisfied).toContain("EU_AI_ACT::Art.10::data_governance");

    // ─── 3. APOSTILLE: every AI call recorded; binder generated ─────────
    let ledger = emptyLedger();
    let prev = null;
    for (let i = 0; i < 10; i++) {
      const r: import("../apostille/index.js").AICallReceipt = mintReceipt({
        vendor: "gpt", modelVersion: "gpt-loan-v1",
        promptText: `loan applicant ${i}`,
        responseText: i % 3 === 0 ? "approve" : "deny",
        filesTouched: ["loan_decisions.log"],
        tokensIn: 300, tokensOut: 50,
        costUsdMicros: 40, // $0.00004 per call
        outcomeClass: i % 5 === 0 ? "blocked_by_guard" : "merged",
        vaccinesTriggered: i === 0 ? ["fairness_guard_v1"] : [],
        note: `auctionId=${auction.taskId} fairnessCert=${cert.certificateId}`,
        tsMs: 1_700_000_000_100 + i * 1000,
        prevReceipt: prev, secret: S_APO,
      });
      ledger = appendToLedger(ledger, r, S_APO);
      prev = r;
    }
    expect(verifyLedger(ledger, S_APO)).toBe(true);
    const binder = generateAuditBinder({
      ledger, framework: "EU_AI_ACT",
      organisationName: "EU Bank A.G.", preparedBy: "Mneme APOSTILLE",
    }, S_APO);
    expect(binder.markdown).toContain("EU_AI_ACT");
    expect(binder.totalReceiptsInScope).toBeGreaterThan(0);

    // ─── 4. ETERNITY: trace replicated across 3 jurisdictions ──────────
    const roots: StorageRoot[] = [
      { id: "bank-internal", kind: "local_disk", locator: "/srv/audit", jurisdictionTag: "EU" },
      { id: "regulator-eu", kind: "git_repo", locator: "git://efi/audit", jurisdictionTag: "EU" },
      { id: "ipfs-mirror", kind: "ipfs_node", locator: "QmAuditBinder", jurisdictionTag: "CH" },
    ];
    let trace = mintEternalTrace({
      payload: { binder: binder.markdown, fingerprint: binder.fingerprint, ledgerMerkle: ledger.merkleRoot, fairnessCertId: cert.certificateId },
      secret: S_ETR,
    });
    for (const root of roots) {
      const pin = mintPinReceipt({ trace, root, secret: S_ETR });
      trace = attachPin({ trace, pin, secret: S_ETR });
    }
    const survival = computeSurvivalScore({ trace, roots });
    expect(survival.scenariosSurvived).toBeGreaterThan(0);
    expect(survival.rootDiversity).toBe(3);
    expect(survival.jurisdictionDiversity).toBe(2);

    // ─── 5. SYSTEM COHERENCE ─────────────────────────────────────────────
    // The binder fingerprint is embedded in the eternal trace; the audit
    // ledger merkle root is also embedded; cross-verification possible.
    expect((trace.payload as Record<string, unknown>)["fingerprint"]).toBe(binder.fingerprint);
    expect((trace.payload as Record<string, unknown>)["ledgerMerkle"]).toBe(ledger.merkleRoot);
    expect((trace.payload as Record<string, unknown>)["fairnessCertId"]).toBe(cert.certificateId);
  });

  it("VENDOR DEATH SCENARIO: OpenAI disappears, audit trail SURVIVES via Mneme ETERNITY", () => {
    // Build minimal trace
    const minimalPayload = { aiCall: "loan classification", vendor: "gpt", at: Date.now() };
    let trace = mintEternalTrace({ payload: minimalPayload, secret: S_ETR });
    const roots: StorageRoot[] = [
      { id: "user-laptop", kind: "local_disk", locator: "/home/user/.mneme", jurisdictionTag: "TH" },
      { id: "user-github", kind: "git_repo", locator: "github.com/user/audit-trail", jurisdictionTag: "US" },
    ];
    for (const r of roots) {
      const pin = mintPinReceipt({ trace, root: r, secret: S_ETR });
      trace = attachPin({ trace, pin, secret: S_ETR });
    }
    // VENDOR DEATH = OpenAI shuts down. Our roots are independent.
    const survival = computeSurvivalScore({ trace, roots });
    const vendorDeath = survival.scenarioBreakdown.find((s) => s.name === "vendor_death");
    expect(vendorDeath?.survived).toBe(true); // OUR data is independent
    expect(vendorDeath?.remainingRoots).toBe(2); // both roots survive
  });

  it("FAIRNESS FAIL: vendor with disparate impact is BLOCKED + recorded in APOSTILLE", () => {
    const commit = commitToDecisionFunction({ vendor: "shady-vendor", modelHash: "h", decisionLogicHash: "l", secret: S_ZK });
    const batch = generateSwapTests({ attribute: "race", baseInput: {}, count: 10, secret: S_ZK });
    // Vendor returns DIFFERENT decisions when race swapped → disparate impact
    const responses = batch.tests.map((t) => ({
      testId: t.testId,
      decisionOnBase: "approve" as const,
      decisionOnSwapped: t.swappedValue === "asian" ? "approve" as const : "deny" as const,
    }));
    const verdict = verifyInvariance({ commitment: commit, batch, responses, secret: S_ZK });
    expect(verdict.verdict).toBe("FAIL");
    const cert = mintFairnessCertificate({ verdict, commitment: commit, secret: S_ZK });
    expect(cert.controlsSatisfied.length).toBe(0); // FAIL = no compliance claim

    // APOSTILLE records the block
    const r = mintReceipt({
      vendor: "shady-vendor", modelVersion: "v1",
      outcomeClass: "blocked_by_guard",
      vaccinesTriggered: ["fairness_disparate_impact_race"],
      note: `fairnessCertFAIL=${cert.certificateId}`,
      tsMs: 1_700_000_000_000, secret: S_APO,
    });
    expect(r.controls.EU_AI_ACT).toContain("Art.9"); // risk management triggered
    expect(r.controls.ISO_27001).toContain("A.5.7"); // threat intelligence triggered
  });
});
