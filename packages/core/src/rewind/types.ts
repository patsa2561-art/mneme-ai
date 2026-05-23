/**
 * v2.31.0 — REWIND types.
 *
 * Time-Capsule Regression Replay: pin a set of past git commits as a
 * Capsule (intent-classified, HMAC-anchored), then re-fire that exact
 * capsule at every vendor release to track regression / improvement
 * over time. Composes with HONEST MIRROR — REWIND adds the
 * vendor-version dimension + the persistent Capsule (HM is one-shot).
 */

export interface IntentFingerprint {
  /** feat / fix / docs / refactor / chore / test / build / perf / style / ci */
  category: string;
  /** core / mcp / docs / tests / scripts / cli / embeddings / other */
  surface: string;
  /** S (< 20 lines) / M (< 200) / L (< 2000) / XL */
  sizeBucket: "S" | "M" | "L" | "XL";
  /** 64-bit simhash of "category surface sizeBucket subject" — used to bucket */
  intentClass: string;
}

export interface CapsuleCommit {
  /** Truncated commit SHA (first 7). */
  sha: string;
  /** ISO timestamp of the original commit. */
  at: string;
  /** Scrubbed commit subject — used as the eval prompt. */
  subject: string;
  /** Scrubbed commit body (often empty). */
  body: string;
  /** Accepted answer = the diff text, scrubbed + truncated to 8KB. */
  acceptedDiff: string;
  /** Files touched (paths only — no content). */
  files: string[];
  fingerprint: IntentFingerprint;
}

export interface Capsule {
  /** Stable ID = sha256(seed + repoRoot + commit SHAs joined). */
  id: string;
  spec: { name: "MNEME-REWIND-CAPSULE"; version: "1.0" };
  /** When the capsule was sealed. */
  sealedAt: string;
  /** Git range the capsule was sampled from, e.g. "HEAD~100..HEAD". */
  range: string;
  commitCount: number;
  /** Aggregated count per intent class — used for regression bucketing. */
  intentDistribution: Record<string, number>;
  commits: CapsuleCommit[];
  /** Capsule HMAC over the canonical body. */
  hmac: string;
  bodyDigest: string;
}

export interface VendorCallResult {
  vendor: string;
  /** Vendor self-reported version / model id (immutable per release). */
  vendorVersion: string;
  /** Reproduced answer (free-text — the vendor's attempt at the diff/explanation). */
  answer: string;
  /** Self-reported confidence 0..1. */
  confidence: number;
  dtMs: number;
  error?: string;
}

export interface RewindReplayFn {
  (input: {
    vendor: string;
    /** The capsule's intent subject — vendor sees this as a normal task. */
    prompt: string;
    /** Original commit timestamp (preserved so the vendor sees the realistic context). */
    artifactTimestamp: string;
  }): Promise<VendorCallResult>;
}

export interface IntentClassScore {
  intentClass: string;
  /** Number of commits in this class. */
  n: number;
  /** Mean similarity 0..1 between vendor answer + accepted diff. */
  meanCorrectness: number;
  /** Mean self-reported confidence 0..1. */
  meanConfidence: number;
}

export interface RegressionVerdict {
  /** "regression" | "stable" | "improvement" | "new" */
  status: "regression" | "stable" | "improvement" | "new";
  /** Delta versus prior card for the same vendor (different version). */
  deltaCorrectness: number;
  /** Worst-hit intent class — what the new version got worse at. */
  worstIntentClass?: { intentClass: string; deltaCorrectness: number };
  /** Best-hit intent class — what the new version got better at. */
  bestIntentClass?: { intentClass: string; deltaCorrectness: number };
  /** Comparator card seq (so the user can replay the comparison). */
  comparedToSeq?: number;
  comparedToVersion?: string;
}

export interface VendorRegressionCard {
  spec: { name: "MNEME-REWIND-CARD"; version: "1.0" };
  capsuleId: string;
  vendor: string;
  vendorVersion: string;
  runAt: string;
  totalMs: number;
  /** Overall correctness across all commits. */
  meanCorrectness: number;
  /** Overall confidence across all commits. */
  meanConfidence: number;
  /** Calibration delta = confidence − correctness. Positive = over-confident. */
  meanCalibrationDelta: number;
  perIntentClass: IntentClassScore[];
  regression: RegressionVerdict;
  /** Human-readable headline. */
  headline: string;
  /** Suggested Aletheia weight 0.1..0.95 — feedback into CONCLAVE. */
  suggestedAletheiaWeight: number;
  hmac: string;
  seq: number;
  bodyDigest: string;
}

export interface RewindOptions {
  vendors: string[];
  /** Git range to sample, default "HEAD~100..HEAD". */
  range?: string;
  /** Override sample count (default 20). 0 = all. */
  count?: number;
  /** Deterministic seed (default Date.now()). */
  seed?: number;
  /** Reuse an existing sealed capsule by id (so the SAME prompts are
   *  fired at every new vendor release — that's the time-capsule). */
  reuseCapsuleId?: string;
}
