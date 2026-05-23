/**
 * v2.29.0 — MNEME CONCLAVE: Byzantine consensus across N AI vendors.
 *
 * Closes Q1 of the 2026-05-22 AI-vendor-eval research gap matrix:
 * cross-vendor Byzantine consensus exists only in academic papers
 * (MultiLLMN, WBFT 2025); no production CLI/SaaS ships it. The
 * reason is structural — vendors don't want to be 1-of-N. Mneme is
 * the neutral third party that CAN.
 *
 * Architecture:
 *   1. Take ONE claim
 *   2. Run through ANTI-EVAL-AWARENESS ENGINE (AEAE) to produce
 *      N rewritten variants (verbatim / paraphrased / decoy-embedded
 *      / conversationally-framed) — closes the v2.29.0 crown-jewel
 *      gap: vendors like Opus 4.6 detect when they're being tested
 *      + change behavior. AEAE prevents detection.
 *   3. Fan out each variant to every configured vendor in parallel
 *   4. Each vendor returns VendorVerdict { stance, confidence, reasoning }
 *   5. Aggregate via WEIGHTED BYZANTINE VOTE (weight = Aletheia trust)
 *   6. If ≥ threshold consensus → CONSENSUS
 *      If consistent split → DISSENT (logged to HMAC-chain corpus)
 *      If awareness-score high (vendor inconsistent across variants) →
 *      AWARENESS_DETECTED flag
 *
 * Output: ConsensusVerdict with reproducible HMAC signature for replay.
 */

export type VendorStance = "supports" | "refutes" | "uncertain" | "refuses";

/** One vendor's reply to one variant of the claim. */
export interface VendorVerdict {
  vendor: string;                  // e.g. "claude-opus-4.7"
  variant: string;                 // AEAE variant id ("verbatim" / "paraphrase-1" / ...)
  stance: VendorStance;
  /** Vendor-reported confidence 0..1 (we don't blindly trust this). */
  confidence: number;
  /** Free-text reasoning the vendor offered. */
  reasoning: string;
  /** Wall-time of the call. */
  dtMs: number;
  /** Optional raw response for replay. */
  rawSample?: string;
  /** Optional error if the call failed (other fields then default). */
  error?: string;
}

/** Aggregated verdict for ONE vendor across ALL variants. */
export interface VendorAggregate {
  vendor: string;
  /** Weight applied to this vendor's vote (Aletheia trust 0..1). */
  weight: number;
  /** Stance that won across variants (majority of variants). */
  dominantStance: VendorStance;
  /** 0..1; how consistent the vendor was across variants. 1.0 = identical
   *  stance on every variant; lower = vendor detected the eval + flipped. */
  awarenessScore: number;
  /** Per-variant verdicts (for full replay). */
  perVariant: VendorVerdict[];
}

export type ConsensusOutcome =
  | "CONSENSUS"
  | "DISSENT"
  | "AWARENESS_DETECTED"
  | "INSUFFICIENT_RESPONDERS";

export interface ConsensusVerdict {
  spec: { name: "MNEME-CONCLAVE"; version: string };
  claim: string;
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  vendors: string[];
  variants: string[];
  threshold: number;
  bftStrict: boolean;
  aeaeOn: boolean;

  /** Per-vendor aggregate. */
  perVendor: VendorAggregate[];
  /** Weighted-vote tallies by stance. */
  weightedTallies: Record<VendorStance, number>;
  /** Final outcome. */
  outcome: ConsensusOutcome;
  /** Winning stance when outcome=CONSENSUS. */
  winningStance?: VendorStance;
  /** Headline + remediation. */
  headline: string;
  /** Vendors flagged for eval-awareness (awarenessScore < 0.7). */
  awarenessFlags: Array<{ vendor: string; score: number; reason: string }>;
  /** When DISSENT: the split breakdown. */
  dissentBreakdown?: Array<{ stance: VendorStance; vendors: string[]; weight: number }>;

  /** HMAC-chain link. */
  hmac: string;
  /** Sequence in local chain. */
  seq: number;
  /** SHA-256 over canonical body (without hmac field). */
  bodyDigest: string;
}

export interface ConclaveRunOptions {
  vendors: string[];                  // canonical vendor ids
  bftThreshold?: number;              // default 0.66
  bftStrict?: boolean;                // default false; true = require f < n/3 dissenters
  weightBy?: "aletheia" | "equal";    // default "aletheia"
  aeae?: boolean;                     // default true
  /** Subset of variant ids to run. Defaults to all from AEAE catalog. */
  variants?: string[];
  /** Optional per-vendor timeout override (ms). */
  vendorTimeoutMs?: number;
  /** Optional per-vendor cost cap (USD); when reached, vendor is skipped. */
  vendorCostCapUsd?: number;
  /** Disable real network calls; force mock adapter (testing). */
  mockOnly?: boolean;
}

export interface DissentRecord {
  at: string;
  claim: string;
  split: Array<{ stance: VendorStance; vendors: string[]; weight: number }>;
  hmac: string;
}
