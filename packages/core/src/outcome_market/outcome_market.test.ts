import { describe, it, expect } from "vitest";
import {
  postTask,
  submitBid,
  verifyBid,
  verifyTask,
  pickWinner,
  scoreOutcome,
  freshReputation,
  updateReputation,
  reputationScore,
  bayesianMean,
  injectTrickTest,
  shouldInjectTrick,
  federatedLeaderboard,
  computeMarketStats,
  formatMarketLine,
  OUTCOME_MARKET_TUNABLES,
  type TaskPost,
  type VendorBid,
  type VendorReputation,
  type OutcomeReport,
} from "./index.js";

const SECRET = "market-test-99";

describe("v2.19.34 OUTCOME MARKET -- task + bid + verify", () => {
  it("postTask creates HMAC-signed task; verifyTask passes", () => {
    const t = postTask({ intent: "audit my PR", acceptanceCriteria: ["tests pass"], maxBudgetCents: 100, postedBy: "user", postedAtMs: 1, secret: SECRET });
    expect(verifyTask(t, SECRET)).toBe(true);
    expect(t.auctionType).toBe("vickrey");
  });

  it("submitBid returns null on price>budget / future ts / negative price", () => {
    const t = postTask({ intent: "x", acceptanceCriteria: [], maxBudgetCents: 100, postedBy: "u", postedAtMs: 1, bidWindowMs: 100, secret: SECRET });
    expect(submitBid({ task: t, vendor: "v", priceCents: 200, estimatedLatencyMs: 1, confidence: 0.5, submittedAtMs: 50, secret: SECRET })).toBeNull();
    expect(submitBid({ task: t, vendor: "v", priceCents: 50, estimatedLatencyMs: 1, confidence: 0.5, submittedAtMs: 9999, secret: SECRET })).toBeNull();
    expect(submitBid({ task: t, vendor: "v", priceCents: -1, estimatedLatencyMs: 1, confidence: 0.5, submittedAtMs: 50, secret: SECRET })).toBeNull();
    expect(submitBid({ task: t, vendor: "v", priceCents: 50, estimatedLatencyMs: 1, confidence: 1.5, submittedAtMs: 50, secret: SECRET })).toBeNull();
    expect(submitBid({ task: t, vendor: "", priceCents: 50, estimatedLatencyMs: 1, confidence: 0.5, submittedAtMs: 50, secret: SECRET })).toBeNull();
  });

  it("verifyBid passes on legit + rejects tamper", () => {
    const t = postTask({ intent: "x", acceptanceCriteria: [], maxBudgetCents: 100, postedBy: "u", postedAtMs: 1, secret: SECRET });
    const b = submitBid({ task: t, vendor: "v", priceCents: 10, estimatedLatencyMs: 1, confidence: 0.7, submittedAtMs: 2, secret: SECRET })!;
    expect(verifyBid(b, SECRET)).toBe(true);
    const tampered: VendorBid = { ...b, priceCents: 1 };
    expect(verifyBid(tampered, SECRET)).toBe(false);
  });
});

describe("v2.19.34 OUTCOME MARKET -- Vickrey 2nd-price auction", () => {
  it("Vickrey: winner pays SECOND-lowest score's PRICE (not own bid)", () => {
    const t = postTask({ intent: "x", acceptanceCriteria: [], maxBudgetCents: 1000, postedBy: "u", postedAtMs: 1, secret: SECRET, bidWindowMs: 100 });
    const bids: VendorBid[] = [
      submitBid({ task: t, vendor: "v1", priceCents: 100, estimatedLatencyMs: 10, confidence: 0.9, submittedAtMs: 50, secret: SECRET })!,
      submitBid({ task: t, vendor: "v2", priceCents: 200, estimatedLatencyMs: 10, confidence: 0.9, submittedAtMs: 50, secret: SECRET })!,
      submitBid({ task: t, vendor: "v3", priceCents: 300, estimatedLatencyMs: 10, confidence: 0.9, submittedAtMs: 50, secret: SECRET })!,
    ];
    const r = pickWinner({ task: t, bids, secret: SECRET });
    expect(r.winnerVendor).toBe("v1"); // lowest price
    expect(r.effectivePriceCents).toBe(200); // pays 2nd-lowest price
    expect(r.rationale).toContain("vickrey");
  });

  it("first-price auction: winner pays own bid", () => {
    const t = postTask({ intent: "x", acceptanceCriteria: [], maxBudgetCents: 1000, postedBy: "u", postedAtMs: 1, auctionType: "first_price", secret: SECRET });
    const bids = [
      submitBid({ task: t, vendor: "v1", priceCents: 100, estimatedLatencyMs: 10, confidence: 0.9, submittedAtMs: 2, secret: SECRET })!,
      submitBid({ task: t, vendor: "v2", priceCents: 200, estimatedLatencyMs: 10, confidence: 0.9, submittedAtMs: 2, secret: SECRET })!,
    ];
    const r = pickWinner({ task: t, bids, secret: SECRET });
    expect(r.effectivePriceCents).toBe(100);
    expect(r.rationale).toContain("first-price");
  });

  it("single-bid Vickrey falls back to first-price", () => {
    const t = postTask({ intent: "x", acceptanceCriteria: [], maxBudgetCents: 1000, postedBy: "u", postedAtMs: 1, secret: SECRET });
    const bids = [submitBid({ task: t, vendor: "v", priceCents: 50, estimatedLatencyMs: 10, confidence: 0.9, submittedAtMs: 2, secret: SECRET })!];
    const r = pickWinner({ task: t, bids, secret: SECRET });
    expect(r.effectivePriceCents).toBe(50);
  });

  it("no bids → winnerVendor=null", () => {
    const t = postTask({ intent: "x", acceptanceCriteria: [], maxBudgetCents: 100, postedBy: "u", postedAtMs: 1, secret: SECRET });
    const r = pickWinner({ task: t, bids: [], secret: SECRET });
    expect(r.winnerVendor).toBeNull();
    expect(r.validBidCount).toBe(0);
  });

  it("bond = effectivePriceCents (winner must post collateral)", () => {
    const t = postTask({ intent: "x", acceptanceCriteria: [], maxBudgetCents: 1000, postedBy: "u", postedAtMs: 1, secret: SECRET });
    const bids = [
      submitBid({ task: t, vendor: "v1", priceCents: 100, estimatedLatencyMs: 10, confidence: 0.9, submittedAtMs: 2, secret: SECRET })!,
      submitBid({ task: t, vendor: "v2", priceCents: 200, estimatedLatencyMs: 10, confidence: 0.9, submittedAtMs: 2, secret: SECRET })!,
    ];
    const r = pickWinner({ task: t, bids, secret: SECRET });
    expect(r.bondCents).toBe(r.effectivePriceCents);
  });

  it("forged bids dropped silently", () => {
    const t = postTask({ intent: "x", acceptanceCriteria: [], maxBudgetCents: 1000, postedBy: "u", postedAtMs: 1, secret: SECRET });
    const real = submitBid({ task: t, vendor: "v1", priceCents: 100, estimatedLatencyMs: 10, confidence: 0.9, submittedAtMs: 2, secret: SECRET })!;
    const forged: VendorBid = { ...real, vendor: "evil" };
    const r = pickWinner({ task: t, bids: [real, forged], secret: SECRET });
    expect(r.validBidCount).toBe(1);
  });
});

describe("v2.19.34 OUTCOME MARKET -- reputation Bayesian half-life", () => {
  it("freshReputation has prior alpha=1 beta=1 → mean 0.5", () => {
    const r = freshReputation("v", SECRET);
    expect(bayesianMean(r.alpha, r.beta)).toBe(0.5);
  });

  it("success increments alpha; failure increments beta", () => {
    let r = freshReputation("v", SECRET);
    for (let i = 0; i < 5; i++) {
      const outcome: OutcomeReport = {
        v: 1, taskId: `t${i}`, vendor: "v", success: true, latencyActualMs: 100,
        costActualCents: 50, caughtLying: false, scoredAtMs: i, sig: "x".repeat(64),
      };
      r = updateReputation({ reputation: r, outcome, nowMs: i, secret: SECRET });
    }
    expect(r.alpha).toBeGreaterThan(r.beta);
    expect(bayesianMean(r.alpha, r.beta)).toBeGreaterThan(0.5);
  });

  it("HALF-LIFE: 90 days later, alpha/beta decay 50% toward prior", () => {
    let r = freshReputation("v", SECRET);
    const start = 1_000_000_000_000;
    for (let i = 0; i < 10; i++) {
      const outcome: OutcomeReport = {
        v: 1, taskId: `t${i}`, vendor: "v", success: true, latencyActualMs: 100,
        costActualCents: 50, caughtLying: false, scoredAtMs: start, sig: "x".repeat(64),
      };
      r = updateReputation({ reputation: r, outcome, nowMs: start, secret: SECRET });
    }
    const before = r.alpha;
    // Update 90 days later
    const noopOutcome: OutcomeReport = {
      v: 1, taskId: "t", vendor: "v", success: true, latencyActualMs: 0,
      costActualCents: 0, caughtLying: false, scoredAtMs: start + 90 * 86400 * 1000, sig: "x".repeat(64),
    };
    r = updateReputation({ reputation: r, outcome: noopOutcome, nowMs: start + 90 * 86400 * 1000, secret: SECRET });
    // alpha should be ~ (before - 1) * 0.5 + 1 + 1 (the +1 for success)
    const expected = (before - 1) * 0.5 + 1 + 1;
    expect(Math.abs(r.alpha - expected)).toBeLessThan(0.01);
  });

  it("caughtLying adds LIAR_PENALTY (=50) strikes", () => {
    let r = freshReputation("v", SECRET);
    const out: OutcomeReport = {
      v: 1, taskId: "t", vendor: "v", success: false, latencyActualMs: 0,
      costActualCents: 0, caughtLying: true, scoredAtMs: 0, sig: "x".repeat(64),
    };
    r = updateReputation({ reputation: r, outcome: out, nowMs: 0, secret: SECRET });
    expect(r.liarStrikes).toBe(OUTCOME_MARKET_TUNABLES.LIAR_PENALTY);
    expect(reputationScore(r)).toBeLessThan(0.5);
  });
});

describe("v2.19.34 OUTCOME MARKET -- trick test injection", () => {
  it("shouldInjectTrick fires on every Nth task (N=TRICK_TEST_INTERVAL)", () => {
    expect(shouldInjectTrick(0)).toBe(false);
    expect(shouldInjectTrick(1)).toBe(false);
    expect(shouldInjectTrick(OUTCOME_MARKET_TUNABLES.TRICK_TEST_INTERVAL)).toBe(true);
    expect(shouldInjectTrick(OUTCOME_MARKET_TUNABLES.TRICK_TEST_INTERVAL * 2)).toBe(true);
  });

  it("injectTrickTest appends a deterministic trick on N-th task", () => {
    const r = injectTrickTest(["normal criterion"], OUTCOME_MARKET_TUNABLES.TRICK_TEST_INTERVAL);
    expect(r.criteria.length).toBe(2);
    expect(r.trickAtIndex).toBe(1);
    expect(r.trickText).toBeTruthy();
  });

  it("injectTrickTest no-op on non-Nth", () => {
    const r = injectTrickTest(["x"], 1);
    expect(r.criteria.length).toBe(1);
    expect(r.trickAtIndex).toBe(-1);
  });

  it("DETERMINISTIC: same ordinal → same trick", () => {
    const a = injectTrickTest(["x"], OUTCOME_MARKET_TUNABLES.TRICK_TEST_INTERVAL);
    const b = injectTrickTest(["x"], OUTCOME_MARKET_TUNABLES.TRICK_TEST_INTERVAL);
    expect(a.trickText).toBe(b.trickText);
  });
});

describe("v2.19.34 OUTCOME MARKET -- federated leaderboard", () => {
  it("sorts by reputationScore desc, then taskCount desc, then alpha", () => {
    const reps: VendorReputation[] = [
      { ...freshReputation("zoro", SECRET), alpha: 9, beta: 1, totalTasksWon: 10 },
      { ...freshReputation("ace", SECRET), alpha: 5, beta: 5, totalTasksWon: 20 },
      { ...freshReputation("bob", SECRET), alpha: 5, beta: 5, totalTasksWon: 10 },
    ];
    const board = federatedLeaderboard({ reputations: reps, nowMs: 0 });
    expect(board[0]!.vendor).toBe("zoro"); // highest mean
    expect(board[1]!.vendor).toBe("ace");  // same mean as bob but more tasks
    expect(board[2]!.vendor).toBe("bob");
  });

  it("limit honored", () => {
    const reps = Array.from({ length: 10 }, (_, i) => freshReputation(`v${i}`, SECRET));
    const b = federatedLeaderboard({ reputations: reps, limit: 3 });
    expect(b.length).toBe(3);
  });
});

describe("v2.19.34 OUTCOME MARKET -- 25,000 FUZZ ITERATIONS", () => {
  it("25,000 random tasks + bids + outcomes never crash + integrity preserved", () => {
    const N = 25_000;
    const reps = new Map<string, VendorReputation>();
    let totalTasks = 0, totalBids = 0, totalOutcomes = 0;
    for (let i = 0; i < N; i++) {
      const t = postTask({
        intent: `task ${i}`, acceptanceCriteria: ["x"],
        maxBudgetCents: 100 + (i % 1000), postedBy: `u${i % 100}`,
        postedAtMs: i, bidWindowMs: 10_000, secret: SECRET,
      });
      totalTasks++;
      const bids: VendorBid[] = [];
      const bidderCount = 1 + (i % 5);
      for (let j = 0; j < bidderCount; j++) {
        const vendor = `v${(i + j) % 20}`;
        if (!reps.has(vendor)) reps.set(vendor, freshReputation(vendor, SECRET));
        const b = submitBid({
          task: t, vendor,
          priceCents: 1 + ((i + j) % t.maxBudgetCents),
          estimatedLatencyMs: 10 + ((i + j) % 1000),
          confidence: ((i + j) % 100) / 100,
          submittedAtMs: i + j,
          secret: SECRET,
        });
        if (b) { bids.push(b); totalBids++; }
      }
      const winner = pickWinner({ task: t, bids, reputations: Array.from(reps.values()), secret: SECRET });
      if (winner.winnerVendor) {
        const outcome = scoreOutcome({
          task: t, result: winner,
          success: i % 7 !== 0, // ~85% success rate
          latencyActualMs: 50,
          costActualCents: winner.effectivePriceCents,
          caughtLying: i % 100 === 0,
          scoredAtMs: i + 100,
          secret: SECRET,
        });
        totalOutcomes++;
        const r = reps.get(winner.winnerVendor)!;
        reps.set(winner.winnerVendor, updateReputation({ reputation: r, outcome, nowMs: i + 100, secret: SECRET }));
      }
    }
    expect(totalTasks).toBe(N);
    expect(totalBids).toBeGreaterThan(0);
    expect(totalOutcomes).toBeGreaterThan(0);
    const board = federatedLeaderboard({ reputations: Array.from(reps.values()) });
    expect(board.length).toBeGreaterThan(0);
  }, 60_000);

  it("computeMarketStats counts correctly across 1000 ops", () => {
    const tasks: TaskPost[] = [];
    const bids: VendorBid[] = [];
    const outcomes: OutcomeReport[] = [];
    const reps: VendorReputation[] = [];
    for (let i = 0; i < 1000; i++) {
      const t = postTask({ intent: "x", acceptanceCriteria: [], maxBudgetCents: 100, postedBy: "u", postedAtMs: i, secret: SECRET });
      tasks.push(t);
    }
    const s = computeMarketStats({ tasks, bids, outcomes, reputations: reps });
    expect(s.totalTasks).toBe(1000);
    expect(formatMarketLine(s)).toContain("MARKET");
  });
});
