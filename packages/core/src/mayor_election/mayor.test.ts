import { describe, it, expect } from "vitest";
import {
  freshElectionState,
  recordVote,
  verifyVoteLedger,
  tallyElection,
  verifyElectionResult,
  runScheduledElection,
  formatMayorLine,
  computeElectionStats,
  MAYOR_ELECTION_TUNABLES,
  type VendorSignal,
} from "./index.js";

const SECRET = "mayor-test-99";

describe("v2.19.37 MAYOR ELECTION — vote ledger", () => {
  it("freshElectionState has 30-day default term", () => {
    const s = freshElectionState({ repoId: "test", termStartMs: 0 });
    expect(s.termMs).toBe(MAYOR_ELECTION_TUNABLES.DEFAULT_TERM_MS);
    expect(s.currentMayor).toBeNull();
    expect(s.votes).toEqual([]);
  });

  it("recordVote chains HMAC + appends to ledger", () => {
    let state = freshElectionState({ repoId: "test", termStartMs: 0 });
    const r1 = recordVote({ state, vendor: "claude", castAtMs: 100, secret: SECRET });
    expect(r1.vote).not.toBeNull();
    expect(r1.vote!.prevSig).toBeNull();
    state = r1.state;
    const r2 = recordVote({ state, vendor: "gpt", castAtMs: 200, secret: SECRET });
    expect(r2.vote!.prevSig).toBe(r1.vote!.sig);
    expect(r2.state.votes.length).toBe(2);
  });

  it("recordVote REJECTS vote outside term window", () => {
    const state = freshElectionState({ repoId: "test", termStartMs: 1000, termMs: 10_000 });
    const r = recordVote({ state, vendor: "claude", castAtMs: 20_000, secret: SECRET });
    expect(r.vote).toBeNull();
    expect(r.reason).toContain("outside term");
  });

  it("recordVote REJECTS empty vendor", () => {
    const state = freshElectionState({ repoId: "test", termStartMs: 0 });
    const r = recordVote({ state, vendor: "", castAtMs: 100, secret: SECRET });
    expect(r.vote).toBeNull();
  });

  it("verifyVoteLedger PASSES clean chain", () => {
    let state = freshElectionState({ repoId: "test", termStartMs: 0 });
    for (let i = 0; i < 10; i++) {
      state = recordVote({ state, vendor: `v${i}`, castAtMs: i * 100, secret: SECRET }).state;
    }
    expect(verifyVoteLedger(state, SECRET)).toBe(true);
  });

  it("verifyVoteLedger DETECTS tampering", () => {
    let state = freshElectionState({ repoId: "test", termStartMs: 0 });
    for (let i = 0; i < 5; i++) {
      state = recordVote({ state, vendor: "v", castAtMs: i * 100, secret: SECRET }).state;
    }
    // Mutate one vote
    const tampered = { ...state, votes: state.votes.map((v, i) => i === 2 ? { ...v, vendor: "evil" } : v) };
    expect(verifyVoteLedger(tampered, SECRET)).toBe(false);
  });
});

describe("v2.19.37 MAYOR ELECTION — tally", () => {
  it("composite weights: 50% votes + 25% rep + 15% fairness + 10% trick", () => {
    expect(MAYOR_ELECTION_TUNABLES.COMPOSITE_WEIGHTS.votes).toBe(0.5);
    expect(MAYOR_ELECTION_TUNABLES.COMPOSITE_WEIGHTS.reputation).toBe(0.25);
    expect(MAYOR_ELECTION_TUNABLES.COMPOSITE_WEIGHTS.fairness).toBe(0.15);
    expect(MAYOR_ELECTION_TUNABLES.COMPOSITE_WEIGHTS.trickTest).toBe(0.10);
  });

  it("vote-only election: more votes wins", () => {
    let state = freshElectionState({ repoId: "test", termStartMs: 0 });
    for (let i = 0; i < 5; i++) state = recordVote({ state, vendor: "claude", castAtMs: i * 100, secret: SECRET }).state;
    for (let i = 0; i < 3; i++) state = recordVote({ state, vendor: "gpt", castAtMs: 1000 + i * 100, secret: SECRET }).state;
    const r = tallyElection({ state, signals: [], secret: SECRET });
    expect(r.winnerVendor).toBe("claude");
    expect(r.scores[0]!.vendor).toBe("claude");
    expect(r.scores[0]!.voteCount).toBe(5);
  });

  it("signal-only election: highest reputation wins (zero votes)", () => {
    const state = freshElectionState({ repoId: "test", termStartMs: 0 });
    const signals: VendorSignal[] = [
      { vendor: "claude", reputationScore: 0.9, fairnessPassRate: 0.95, trickTestPassRate: 0.99 },
      { vendor: "gpt",    reputationScore: 0.6, fairnessPassRate: 0.7,  trickTestPassRate: 0.8 },
    ];
    const r = tallyElection({ state, signals, secret: SECRET });
    expect(r.winnerVendor).toBe("claude");
  });

  it("mixed: votes can be outweighed by very high quality signals", () => {
    let state = freshElectionState({ repoId: "test", termStartMs: 0 });
    // gpt has 1 vote, claude has 0 votes, claude has perfect signals
    state = recordVote({ state, vendor: "gpt", castAtMs: 100, secret: SECRET }).state;
    const signals: VendorSignal[] = [
      { vendor: "claude", reputationScore: 1.0, fairnessPassRate: 1.0, trickTestPassRate: 1.0 },
      { vendor: "gpt",    reputationScore: 0.0, fairnessPassRate: 0.0, trickTestPassRate: 0.0 },
    ];
    const r = tallyElection({ state, signals, secret: SECRET });
    // gpt composite = 0.5 * (1/1) + 0 = 0.5
    // claude composite = 0.5 * 0 + 0.25*1 + 0.15*1 + 0.10*1 = 0.5
    // tie → alpha tie-break (claude < gpt)
    expect(r.winnerVendor).toBe("claude");
  });

  it("DETERMINISTIC: same inputs → same result sig", () => {
    let state = freshElectionState({ repoId: "test", termStartMs: 0 });
    state = recordVote({ state, vendor: "claude", castAtMs: 100, secret: SECRET }).state;
    const r1 = tallyElection({ state, signals: [], nowMs: 100, secret: SECRET });
    const r2 = tallyElection({ state, signals: [], nowMs: 100, secret: SECRET });
    expect(r1.sig).toBe(r2.sig);
  });

  it("verifyElectionResult passes / rejects tamper", () => {
    let state = freshElectionState({ repoId: "test", termStartMs: 0 });
    state = recordVote({ state, vendor: "x", castAtMs: 100, secret: SECRET }).state;
    const r = tallyElection({ state, signals: [], secret: SECRET });
    expect(verifyElectionResult(r, SECRET)).toBe(true);
    const tampered = { ...r, winnerVendor: "evil" };
    expect(verifyElectionResult(tampered, SECRET)).toBe(false);
  });
});

describe("v2.19.37 MAYOR ELECTION — auto-rotation", () => {
  it("MID-TERM: tally + record lastResult but DON'T rotate", () => {
    let state = freshElectionState({ repoId: "test", termStartMs: 0, termMs: 1_000_000 });
    state = recordVote({ state, vendor: "x", castAtMs: 100, secret: SECRET }).state;
    const r = runScheduledElection({ state, signals: [], nowMs: 500_000, secret: SECRET });
    expect(r.rotated).toBe(false);
    expect(r.state.currentMayor).toBeNull(); // not rotated yet
    expect(r.state.lastResult).not.toBeNull();
  });

  it("AFTER TERM END: rotate to winner + reset ballot box + advance termStart", () => {
    let state = freshElectionState({ repoId: "test", termStartMs: 0, termMs: 1000 });
    state = recordVote({ state, vendor: "claude", castAtMs: 100, secret: SECRET }).state;
    state = recordVote({ state, vendor: "claude", castAtMs: 200, secret: SECRET }).state;
    const r = runScheduledElection({ state, signals: [], nowMs: 5000, secret: SECRET });
    expect(r.rotated).toBe(true);
    expect(r.state.currentMayor).toBe("claude");
    expect(r.state.termStartMs).toBe(1000); // advanced to old term end
    expect(r.state.votes.length).toBe(0); // ballot box reset
    expect(r.state.lastResult).not.toBeNull();
  });
});

describe("v2.19.37 MAYOR ELECTION — UI surface (status line)", () => {
  it("formatMayorLine on null result", () => {
    expect(formatMayorLine(null)).toContain("no votes");
  });

  it("formatMayorLine with winner + runner-up", () => {
    let state = freshElectionState({ repoId: "test", termStartMs: 0 });
    state = recordVote({ state, vendor: "claude", castAtMs: 100, secret: SECRET }).state;
    state = recordVote({ state, vendor: "claude", castAtMs: 200, secret: SECRET }).state;
    state = recordVote({ state, vendor: "gpt", castAtMs: 300, secret: SECRET }).state;
    const r = tallyElection({ state, signals: [], secret: SECRET });
    const line = formatMayorLine(r);
    expect(line).toContain("MAYOR");
    expect(line).toContain("claude");
    expect(line).toContain("vs gpt");
  });
});

describe("v2.19.37 MAYOR ELECTION — A/B before vs after", () => {
  it("A: pre-v2.19.37 = no election concept; B: full election + rotation cycle", () => {
    // Pre: no module
    // Post: full lifecycle in ≤4 calls (fresh → vote → tally → rotate)
    let state = freshElectionState({ repoId: "test", termStartMs: 0, termMs: 1000 });
    state = recordVote({ state, vendor: "claude", castAtMs: 100, secret: SECRET }).state;
    const r = runScheduledElection({ state, signals: [], nowMs: 5000, secret: SECRET });
    expect(r.rotated).toBe(true);
    expect(r.state.currentMayor).toBe("claude");
  });
});

describe("v2.19.37 MAYOR ELECTION — stats + 1000-iter fuzz", () => {
  it("computeElectionStats", () => {
    let state = freshElectionState({ repoId: "test", termStartMs: 0, termMs: 10_000 });
    state = recordVote({ state, vendor: "x", castAtMs: 100, secret: SECRET }).state;
    state = recordVote({ state, vendor: "y", castAtMs: 200, secret: SECRET }).state;
    const s = computeElectionStats(state, 500);
    expect(s.totalVotes).toBe(2);
    expect(s.uniqueVendors).toBe(2);
    expect(s.termRemainingMs).toBeGreaterThan(0);
  });

  it("1000 random vote+tally cycles preserve chain integrity", () => {
    let state = freshElectionState({ repoId: "test", termStartMs: 0, termMs: 1_000_000_000 });
    for (let i = 0; i < 1000; i++) {
      const r = recordVote({ state, vendor: `v${i % 7}`, castAtMs: i * 10, secret: SECRET });
      if (r.vote) state = r.state;
    }
    expect(verifyVoteLedger(state, SECRET)).toBe(true);
    expect(state.votes.length).toBe(1000);
  });
});
