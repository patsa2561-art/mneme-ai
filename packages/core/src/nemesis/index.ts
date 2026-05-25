/**
 * v2.46.0 — NEMESIS public surface.
 *
 * The world's first Anti-Identity-Lie Engine for AI Coding Agents.
 *
 *   ORGAN 1 FINGERPRINTER     — features.ts + env_scan.ts (41-axis vector + env markers)
 *   ORGAN 2 LIE DETECTOR      — classifier.ts + identity_verifier.ts (claim vs detected; HMAC verdict)
 *   ORGAN 3 ARTICLE 50 STAMP  — eu_ai_act_stamp.ts + watermark.ts + git_hook_installer.ts
 *   ORGAN 4 DRIFT TIMELINE    — drift_timeline.ts (per-vendor fingerprint history + σ-based drift)
 *   ORGAN 5 REPLAY DETECTOR   — replay_attack.ts (stealth-upgrade/downgrade/swap)
 *
 * Composes: arxiv 2601.17406 fingerprinting + Mneme HMAC chain +
 * EU AI Act Article 50 (Aug 2026 deadline) + HONEST MIRROR + ARGUS.
 */

export type {
  VendorId, Fixture, Fingerprint, AgentVerdict,
  IdentityClaimInput, IdentityVerdict, IdentityVerdictKind,
  Article50StampInput, Article50Stamp, StampResult, VerifyStampResult,
} from "./types.js";

export { extractFingerprint } from "./features.js";
export { scanEnv, type EnvScanResult } from "./env_scan.js";
export { classifyAgent, SIGNATURES } from "./classifier.js";
export { verifyIdentityClaim, verifyIdentityHmac } from "./identity_verifier.js";
export { stampArticle50, verifyStamp } from "./eu_ai_act_stamp.js";
export { encodeWatermark, decodeWatermark } from "./watermark.js";
export { installPreCommitHook, type InstallHookInput, type InstallHookResult } from "./git_hook_installer.js";
export { recordFingerprint, readTimeline, computeVariance, type DriftEntry, type VarianceResult } from "./drift_timeline.js";
export { detectReplayAttack, type ReplayResult } from "./replay_attack.js";

// v2.47.0 — CALIBRATED CLASSIFIER + SELF-CALIBRATING LEARNING LOOP +
// production-grade HMAC key management.
export {
  buildSeedCorpus, computeStats, seedStats,
  type CorpusEntry, type VendorStats,
} from "./calibration_corpus.js";
export {
  classifyAgentCalibrated, evaluateSeedAccuracy,
  type AccuracyReport,
} from "./classifier_calibrated.js";
export {
  appendCalibrationEntry, readCalibrationLedger, recomputeStats, calibrationStatus,
  type CalibrationStatus, type AppendResult,
} from "./learning_loop.js";
export {
  resolveHmacKey, generateProductionKey,
  type KeyResolution, type KeySource,
} from "./key_management.js";

// v1.61 NEMESIS PROTOCOL (Tier 5 — weekly adversarial audit) lives in
// nemesis.ts alongside the new v2.46.0 ANTI-IDENTITY-LIE ENGINE. Both
// export through this barrel so downstream consumers (MCP `nemesis.generate`
// / `nemesis.grade` / `nemesis.trend` Tier 5 tools) continue to work
// unchanged. Two distinct primitives sharing one namespace by design.
export {
  generateProbes,
  gradeRun,
  recordRun,
  readRuns,
  trendFor,
  type Probe,
  type ProbeFamily,
  type NemesisRun,
  type TrendSeries,
} from "./nemesis.js";
