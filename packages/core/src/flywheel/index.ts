/**
 * v2.32.0 — FLYWHEEL public surface.
 *
 * Self-reflective release organ that closes 4 historic Mneme
 * weakness loops: tool sprawl + solo-dev asymmetry + wiring lag +
 * marketing drift. 5-stage controller HARVEST → FUSE → PRESCRIBE
 * → EXECUTE → RECIPROCITY. Composes with TRUTH GATE + PEAK GAUNTLET
 * + HONEST MIRROR + REWIND + HGP via the SAME
 * .mneme/aletheia/honest_mirror_weights.json feedback file.
 */

export type {
  Severity, SignalSource, RawFinding, FusedFinding, ActionKind,
  PrescribedAction, ReciprocityEntry, FlywheelReport, FlywheelOptions,
} from "./types.js";

export {
  harvestTruthGate, harvestGauntlet, harvestHonestMirror,
  harvestRewind, harvestHgp, harvestCommandHistory,
  harvestMarketing, harvestLiveness,
} from "./harvest.js";
export type { MarketingClaim } from "./harvest.js";

export { fuse, distinctClusterCount } from "./fuse.js";
export { prescribe } from "./prescribe.js";

export {
  computeCheatsheet, recordCommand, readHistory, renderCheatsheetMarkdown,
} from "./personal_cheatsheet.js";
export type { CheatsheetEntry, CheatsheetSnapshot } from "./personal_cheatsheet.js";

export {
  heartbeat, readHeartbeats, lastSeenMap,
} from "./liveness.js";
export type { PrimitiveSnapshot } from "./liveness.js";

export {
  gatherBulletinData, renderBulletinMarkdown,
} from "./vendor_bulletin.js";
export type { BulletinData } from "./vendor_bulletin.js";

export {
  computeTrustDelta, recordResponse, readLedger as readReciprocityLedger,
  applyToAletheiaWeights,
} from "./reciprocity.js";
export type { RecordResponseParams } from "./reciprocity.js";

export {
  runFlywheel, listReports, readLatestReport, verifyReport, blockingActions,
  __resetFlywheelChainForTest,
} from "./controller.js";
export type { RunInput, ReportLedgerEntry } from "./controller.js";
