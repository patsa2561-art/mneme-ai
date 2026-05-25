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

// v2.48.0 — bug extinction protocol additions.
export {
  reconcileVendor, type ReconcileInput, type ReconcileVerdict,
} from "./vendor_reconcile.js";
export {
  computeWeightDelta, applyToConclave,
  type VerdictInput, type WeightDelta, type ApplyResult,
} from "./nemesis_to_conclave.js";

// v2.49.0 — B4 actual wire: write-path canonical record.
export {
  recordActivityReconciled,
  type RecordActivityInput, type RecordActivityResult,
} from "./activity_writer.js";

// v2.52.0 — STEALTH SCORE (Million Dollar Secret diamond #1) — inverse
// of fingerprint confidence + anonymity-credit HMAC ledger.
export {
  computeStealthScore,
  earnAnonymityCredits, spendAnonymityCredits,
  stealthCreditStatus, verifyStealthLedger,
  type StealthVerdict,
} from "./stealth_score.js";

// v2.52.0 — CAPILLARY (Million Dollar Secret diamond #2) — micro-tell
// fingerprinter at whitespace/quote/naming/comma level + ANTI-CAPILLARY
// style-rewrite suggestion engine (the first AI-coding-agent micro-fingerprinter).
export {
  extractMicroProfile, microDistance,
  suggestAntiCapillary, listCapillaryFeatures,
  type MicroProfile, type AntiCapillaryHint,
} from "./capillary.js";

// v2.52.0 — COLOSSEUM (Million Dollar Secret diamond #3) — auto-tournament
// of N contenders × M disguise targets + 3-axis HMAC-signed ELO leaderboard
// (deception / detectability / mimicry) + spectator replay.
export {
  runTournament,
  readColosseumLeaderboard, verifyColosseumChain, spectatorReplay,
  type ContenderFixture, type MatchEvent, type VendorScore, type TournamentResult,
} from "./colosseum.js";

// v2.52.0 — MOLT (Million Dollar Secret diamond #4) — silent model-rotation
// detector. Per-feature Welch-style comparison of pre/post fingerprint
// distributions; HMAC-signed forensic verdict + optional webhook emit.
export {
  detectMolt, verifyMoltVerdict, emitMoltWebhook,
  type FeatureShift, type MoltVerdict,
} from "./molt.js";

// v2.52.0 — THEMIS (Million Dollar Secret diamond #5) — alibi verifier
// ("I am NOT vendor X") + star-rated evidence + compliance bundle pairing.
export {
  verifyAlibi, verifyAlibiSignature,
  buildComplianceBundle, verifyComplianceBundle,
  type AlibiEvidenceItem, type AlibiVerdict, type ThemisResult,
  type ThemisInput, type ComplianceBundle,
} from "./themis.js";

// v2.52.0 — SIBYL (Million Dollar Secret diamond #6) — ZK-style identity
// commitment: commit at session-start (sealed), reveal at end. Hash-commitment
// branch (SHA-256(identity || nonce || sessionId)) — locks identity against
// mid-session switching. Supports nested commitments (vendor/model/version mask).
export {
  commitIdentity, revealIdentity, verifySibylChain,
  verifyCommitmentReveal, listOpenCommitments,
  type SibylIdentity, type SibylCommitment, type SibylReveal,
  type CommitOpts, type CommitResult, type RevealOpts, type RevealResult,
} from "./sibyl.js";

// v2.53.0 — Open-wound patches (P0/P1).
//   P0-1 HMAC key setup wizard + STRICT mode
//   P1-2 CORPUS AUGMENTER (header-less / naturalistic 5x perturbation)
//   P1-3 JANUS organ (cross-cluster identity-swap detector)
export {
  runKeyWizard, checkKeyPermissions, strictKeyCheck,
  type KeyWizardResult, type KeyWizardOpts,
} from "./key_setup.js";
export {
  applyAugmentation, buildAugmentedCorpus,
  evaluateAugmentedAccuracy, computeAugmentedStats,
  type AugmentedEntry, type AugmentationKind, type AugmentedAccuracyReport,
} from "./corpus_augmenter.js";
export {
  locateBasin, observe, detectIdentitySwap, verifyJanusResult,
  type ClusterDistance, type JanusBasin, type JanusObservation,
  type JanusTransition, type JanusSessionResult,
} from "./janus.js";

// v2.50.0 — VENDOR ALLOWLIST GUARD: kills EMBEDDER-LEAK class structurally.
// Central allowlist of real agent vendors; backend/embedder names (ollama,
// openai-gpt, gemini, etc) coerced to "unknown" + logged to
// `.mneme/embedder_leak.jsonl` for forensic audit.
export {
  AGENT_VENDOR_ALLOWLIST, EMBEDDER_LEAK_SIGNATURES,
  guardVendor, fullGuard, logEmbedderLeak, cleanseLedger,
  type VendorGuardResult, type FullGuardInput, type FullGuardResult,
  type CleanseLedgerInput, type CleanseLedgerResult,
} from "./vendor_allowlist.js";

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
