/**
 * v2.33.0 — MNEMNET types.
 *
 * MNEMNET = federated AI-honesty network. Local Mneme nodes opt-in
 * to contribute differentially-private aggregates of their CITIZEN
 * COURT verdicts; the network publishes a Public Honesty Court HSC
 * per vendor that no single user can game.
 *
 * v2.33.0 ships the LOCAL aggregator + opt-in scaffolding + push
 * stub (no network call). The federated endpoint protocol lands
 * v2.34.x (same pattern HGP v2.31 used).
 */

export interface MnemnetConsent {
  /** User opt-in flag. Default OFF (CONSENT FABRIC). */
  optIn: boolean;
  /** ISO of latest opt-in toggle. */
  at: string;
  /** Endpoint to push to (default mnemnet.ai placeholder). */
  endpoint?: string;
  /** Cryptographic node id (HMAC pubkey hash; never reveals identity). */
  nodeId: string;
  /** DP epsilon ceiling per submission (default 0.5). */
  maxEpsilon: number;
}

/**
 * The unit of contribution: a DP-noised count of truthful-votes per
 * vendor over a window. No raw verdicts EVER leave the local node.
 */
export interface DpAggregate {
  /** Stable HMAC-signed envelope id. */
  envelopeId: string;
  /** Anonymous node id (per consent). */
  nodeId: string;
  /** Window start + end (ISO). */
  windowStart: string;
  windowEnd: string;
  /** Per-vendor noised tally. */
  perVendor: Array<{
    vendor: string;
    /** truthful-vote count + Laplace(1/ε) noise. */
    noisedTruthful: number;
    /** decisive-vote count + Laplace(1/ε) noise. */
    noisedDecisive: number;
  }>;
  /** DP epsilon applied. */
  epsilon: number;
  /** HMAC-signed envelope. */
  hmac: string;
  at: string;
}

/**
 * Network-side aggregation across N envelopes. Public Honesty Court.
 * v2.33.0 computes this locally on a list of envelopes (e.g. supplied
 * by the user as a JSON paste from peers); v2.34.x will fetch from
 * the live endpoint.
 */
export interface PublicHscRow {
  vendor: string;
  /** Mean noised truthful rate across N nodes. */
  meanNoisedTruthfulRate: number;
  /** Number of contributing nodes. */
  contributingNodes: number;
  /** Sum of decisive votes (noised). */
  totalDecisive: number;
  /** Effective epsilon (max across envelopes). */
  maxEpsilon: number;
  /** Band per the SAME thresholds CITIZEN COURT HSC uses. */
  band: "🟢 trustworthy" | "🟡 mixed" | "🔴 suspect" | "⚪ unmeasured";
}

export interface PublicHsc {
  generatedAt: string;
  envelopeCount: number;
  rows: PublicHscRow[];
  /** HMAC-signed for receivers to verify offline. */
  hmac: string;
}
