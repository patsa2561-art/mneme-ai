/**
 * v2.31.0 — REWIND public surface.
 *
 * Time-Capsule Regression Replay: pin a set of past git commits as a
 * Capsule, fire the SAME capsule at every vendor release, emit a
 * Vendor Regression Card. Composes with HONEST MIRROR (per-vendor
 * weight feedback) + CONCLAVE (Aletheia trust input).
 */

export type {
  IntentFingerprint, CapsuleCommit, Capsule, VendorCallResult,
  RewindReplayFn, IntentClassScore, RegressionVerdict,
  VendorRegressionCard, RewindOptions,
} from "./types.js";

export {
  buildFingerprint, classifyCategory, classifySurface, classifySize,
  correctnessScore,
} from "./intent_class.js";

export {
  sealCapsule, verifyCapsule, storeCapsule, loadCapsule, listCapsules,
  runRewind, storeCard, listCards, priorCardForVendor, readCard,
  verifyCard, renderMarkdownCard, gitAvailable, __resetRewindChainForTest,
} from "./engine.js";
export type { CardLedgerEntry } from "./engine.js";
