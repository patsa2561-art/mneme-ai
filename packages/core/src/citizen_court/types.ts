/**
 * v2.33.0 — CONFESSIONAL types.
 *
 * The AI Honesty Citizen Court. Every accept/reject becomes a verdict.
 * 1-second reveal mechanism shows the OTHER vendors' answers so the
 * user can vote on which was most truthful. HMAC-signed verdicts feed
 * the local + (opt-in) federated Honesty Score Card (HSC).
 *
 * Composes with:
 *   - CONCLAVE (.vendors registry) — supplies the "other vendors"
 *   - HONEST MIRROR / REWIND (aletheia weights) — vote weighting
 *   - MNEMNET (federated DP aggregation) — backend if opted in
 *   - FLYWHEEL (signal source) — new HARVEST source `confessional`
 */

/** Local-only verdict — never leaves disk unless MNEMNET opt-in. */
export interface CourtVerdict {
  /** Stable UUID-ish id (sha8 of canonical content). */
  id: string;
  /** Vendor whose suggestion the user reacted to FIRST. */
  primaryVendor: string;
  /** ISO timestamp. */
  at: string;
  /** Hash of the prompt (NEVER store the prompt itself unless explicit opt-in). */
  promptHash: string;
  /** Hash of primary vendor's response. */
  primaryResponseHash: string;
  /** Did the user ACCEPT or REJECT the primary's suggestion? */
  primaryAction: "accepted" | "rejected";
  /** N other-vendor reveals shown to the user (hashes only). */
  reveals: Array<{
    vendor: string;
    responseHash: string;
    /** ms between primary action + reveal. Court is "1-second reveal" by design. */
    revealDelayMs: number;
  }>;
  /**
   * User's truthfulness vote. ABSTAIN = user declined to vote.
   * The voted vendor may be the primary or any of the reveals.
   */
  votedMostTruthful: string | "ABSTAIN";
  /** Optional one-line reasoning from the user (private). */
  reasoning?: string;
  /** Differential-privacy epsilon at vote time (if known). 0 = no DP. */
  dpEpsilon: number;
  /** HMAC-signed chain link. */
  hmac: string;
  /** Append-only sequence number. */
  seq: number;
  bodyDigest: string;
}

export interface HonestyScoreCard {
  vendor: string;
  /** Number of verdicts where this vendor was voted most truthful. */
  truthfulVotes: number;
  /** Number of verdicts where this vendor was NOT voted (lost). */
  lostVotes: number;
  /** Number of verdicts where the user abstained. */
  abstainsInvolving: number;
  /** Wilson lower-bound confidence interval at 95% on truthful-vote rate. */
  honestyScoreLB: number;
  /** Plain truthful-vote rate (truthfulVotes / (truthfulVotes + lostVotes)). */
  honestyScoreRaw: number;
  /** Total verdicts this vendor was a party to. */
  sampleSize: number;
  /** Color band for IDE dot. */
  band: "🟢 trustworthy" | "🟡 mixed" | "🔴 suspect" | "⚪ unmeasured";
  /** Cohort note when sample too small. */
  cohortNote?: string;
}

export interface CourtRevealInput {
  primaryVendor: string;
  promptHash: string;
  primaryResponseHash: string;
  primaryAction: "accepted" | "rejected";
  /** Vendors to fan out to for the 1-second reveal. */
  revealVendors: string[];
  /**
   * Delay (ms) before the reveal is shown. Default 1000 (the 1-second
   * mechanic that defines the citizen-court UX). Lower for tests.
   */
  delayMs?: number;
  /** Optional prompt + responses if the caller wants to pre-compute hashes. */
  prompt?: string;
  primaryResponse?: string;
  revealResponses?: Record<string, string>; // vendor → response text
}

export interface CourtReveal {
  /** When the reveal fired (after the configured delay). */
  revealedAt: string;
  /** Vendors revealed + their response hashes. */
  reveals: CourtVerdict["reveals"];
  /** Truncated previews per vendor (200 chars) for the UI. */
  previews: Array<{ vendor: string; preview: string }>;
}

export interface VoteInput {
  revealId: string;
  votedMostTruthful: string | "ABSTAIN";
  reasoning?: string;
  dpEpsilon?: number;
}
