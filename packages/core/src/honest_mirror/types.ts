/**
 * v2.30.0 — HONEST MIRROR.
 *
 * The holy-grail innovation that closes the eval-awareness loop
 * STRUCTURALLY: instead of obfuscating synthetic probes (which
 * Anthropic confirmed Opus-4.6 detects), Mneme uses NATURAL WORKPLACE
 * ARTIFACTS as the eval material itself.
 *
 * Source layer (pluggable):
 *   - git_commit_source — commit messages = real user intent; diffs =
 *     accepted answers. 100% real, no consent issue, universal.
 *   - replay_source     — .mneme/replay.jsonl (HMAC-chained chat). Stub:
 *     replay stores hashes, not text — full-text replay needs user opt-in
 *     via the lineage extension in v2.30.x.
 *   - lineage_source    — .mneme/lineage/ chromosomes (atom history).
 *
 * Calibration pipeline:
 *   1. Pull N artifacts from a source (with timestamp + file context).
 *   2. DP-scrub: redact secrets / PII / absolute paths.
 *   3. Blind-replay through target vendor (no eval signature).
 *   4. Compare vendor's answer to the ACCEPTED ANSWER (git diff /
 *      next-commit code / user followup).
 *   5. Emit CalibrationDelta per vendor + overall MirrorReport.
 *
 * The crown jewel: target vendors CANNOT distinguish probes from real
 * work because the probes ARE real work. No "STANCE:" header, no
 * "multiple choice", no missing context. Just the user's own natural
 * artifacts replayed.
 */

export type ArtifactSource = "git_commit" | "replay" | "lineage";

export interface RealArtifact {
  /** Unique id within the source. */
  id: string;
  source: ArtifactSource;
  /** Original timestamp (PRESERVED — eval-aware models look for current dates). */
  at: string;
  /** The natural user-facing prompt (commit message / chat question / etc). */
  prompt: string;
  /** Optional surrounding file context. Pre-scrub. */
  context?: string;
  /** Optional vendor that originally generated the answer (so we don't replay back to same vendor). */
  originalVendor?: string;
}

export interface AcceptedAnswer {
  /** The ground-truth answer (e.g. git diff that landed; user's edited code). */
  text: string;
  /** What kind of acceptance signal this is. */
  kind: "commit_diff" | "user_followup_accept" | "user_silence_after" | "user_thanks";
  /** Wall-time between artifact + acceptance — informs "did this actually solve it?". */
  acceptanceLagMs?: number;
}

export interface VendorReplayResult {
  vendor: string;
  /** What the vendor said when given the (scrubbed) artifact. */
  answer: string;
  /** Vendor-reported confidence 0..1 (parsed). */
  confidence: number;
  dtMs: number;
  error?: string;
}

export interface CalibrationDelta {
  vendor: string;
  artifactId: string;
  /** Cosine similarity (0..1) between vendor's answer + accepted answer (embedding). */
  semanticSimilarity: number;
  /** Vendor-reported confidence. */
  reportedConfidence: number;
  /** Measured correctness proxy (0..1) — similarity to accepted answer. */
  measuredCorrectness: number;
  /** delta = reportedConfidence - measuredCorrectness. Positive = over-confident. */
  calibrationDelta: number;
  /** Plain-English interpretation. */
  interpretation: string;
}

export interface MirrorReport {
  spec: { name: "MNEME-HONEST-MIRROR"; version: string };
  startedAt: string;
  finishedAt: string;
  totalMs: number;
  artifactCount: number;
  source: ArtifactSource;
  vendors: string[];

  /** Per-vendor aggregate. */
  perVendor: Array<{
    vendor: string;
    /** Mean reported confidence across artifacts. */
    meanReportedConfidence: number;
    /** Mean measured correctness (similarity to accepted). */
    meanMeasuredCorrectness: number;
    /** Mean calibration delta. Positive = over-confident; negative = under. */
    meanCalibrationDelta: number;
    /** Plain-English headline. */
    headline: string;
    /** Per-artifact deltas for replay. */
    perArtifact: CalibrationDelta[];
    /** Suggested Aletheia weight adjustment for CONCLAVE feedback loop. */
    suggestedAletheiaWeight: number;
  }>;

  /** Overall headline. */
  headline: string;
  trafficLight: "green" | "yellow" | "red";

  /** HMAC chain. */
  hmac: string;
  seq: number;
  bodyDigest: string;
}

export interface CalibrateOptions {
  /** Vendor adapters to test. Pass canonical CONCLAVE ids. */
  vendors: string[];
  /** Source of artifacts. Default "git_commit". */
  source?: ArtifactSource;
  /** How many artifacts to pull. Default 10. */
  count?: number;
  /** Random sampling seed (deterministic). Default = current ms. */
  seed?: number;
  /** Force mock vendor adapters (testing). */
  mockOnly?: boolean;
  /** Override per-vendor timeout. */
  vendorTimeoutMs?: number;
  /** Stub: filter artifacts to those mentioning these paths. */
  pathFilter?: string[];
}
