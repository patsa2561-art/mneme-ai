/**
 * A7 — Tribal Voting (Federation-driven rerank).
 *
 * After local ranking is done, apply a federation-derived prior. The
 * federation hub publishes k-anonymous up/down votes per pattern signature
 * (e.g. "this regex for email validation has 1247 upvotes, 12 downvotes
 * across 200 contributing repos"). Local rank gets nudged by tribal
 * consensus.
 *
 * Pure function. Uses F4 (TBP) under the hood. NEVER amplifies or de-
 * amplifies outside [0..localLikelihood] (the federation prior is a
 * multiplier in [0,1]).
 */

import { tbp } from "./formulas.js";

export interface VotedCandidate {
  /** Stable id for the candidate result. */
  id: string;
  /** Local relevance score (e.g., from F2 HWC + F3 ADB pipeline). */
  localScore: number;
  /** Pattern signature key — federation upvotes are keyed by this. */
  patternSignature: string;
  /** Optional context. */
  meta?: Record<string, unknown>;
}

export interface FederationVotes {
  /** signature → { upvotes, downvotes } */
  [signature: string]: { upvotes: number; downvotes: number };
}

export interface TribalVotingInput {
  candidates: VotedCandidate[];
  federationVotes: FederationVotes;
  /** Minimum quorum (sum of votes) before federation can affect rank.
   *  Below quorum, the federation prior is treated as 0.5 (neutral). */
  quorumThreshold?: number;
}

export interface TribalVotedResult {
  id: string;
  finalScore: number;
  localScore: number;
  /** Federation-derived multiplier ∈ (0, 1). */
  federationPrior: number;
  /** Sum of votes for this signature (for quorum reasoning). */
  totalVotes: number;
  /** Was quorum met? */
  quorumMet: boolean;
  meta?: Record<string, unknown>;
}

const DEFAULT_QUORUM = 5;

export function applyTribalVoting(input: TribalVotingInput): TribalVotedResult[] {
  const quorum = input.quorumThreshold ?? DEFAULT_QUORUM;
  const out: TribalVotedResult[] = [];
  for (const c of input.candidates) {
    const votes = input.federationVotes[c.patternSignature];
    const up = votes?.upvotes ?? 0;
    const down = votes?.downvotes ?? 0;
    const total = up + down;
    const quorumMet = total >= quorum;

    let federationPrior: number;
    let finalScore: number;
    if (!quorumMet) {
      // Below quorum — federation prior is neutral (0.5)
      federationPrior = 0.5;
      finalScore = c.localScore * 0.5;
    } else {
      finalScore = tbp({
        localLikelihood: c.localScore,
        federationUpvotes: up,
        federationDownvotes: down,
      });
      // Compute the prior multiplier independently for transparency
      const a = up + 1;
      const b = down + 1;
      federationPrior = a / (a + b);
    }

    out.push({
      id: c.id,
      finalScore,
      localScore: c.localScore,
      federationPrior,
      totalVotes: total,
      quorumMet,
      meta: c.meta,
    });
  }
  out.sort((a, b) => b.finalScore - a.finalScore || a.id.localeCompare(b.id));
  return out;
}
