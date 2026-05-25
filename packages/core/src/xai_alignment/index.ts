/**
 * v2.56.0 — xAI / GROK / SpaceX ALIGNMENT package.
 *
 * Three primitives positioned to make Musk's team say "YES!!!":
 *
 *   🚀 LAUNCH WINDOW  — SpaceX-style GO/NO-GO release verdict aggregator
 *   🔥 DRAGON EJECT   — emergency rollback + GAVEL-grade forensic bundle
 *   🛡 STARGATE       — open-source publish of augmented calibration corpus
 *
 * Each composes on existing Mneme primitives (TRUTH GATE / PEAK GAUNTLET /
 * NEMESIS / GAVEL / corpus_augmenter) — no logic duplicated.
 */

export {
  evaluateLaunchWindow, verifyLaunchVerdict, renderLaunchBanner,
  type LaunchStatus, type GateReading, type LaunchWindowVerdict, type LaunchWindowOpts,
} from "./launch_window.js";

export {
  dragonEject, verifyEjectEvent, listEjects, verifyDragonChain,
  type EjectReason, type EjectInput, type EjectEvent, type EjectResult,
} from "./dragon.js";

export {
  buildStargateBundle, verifyStargateBundle, publishStargate,
  type StargateBundle, type PublishInput, type PublishResult,
} from "./stargate.js";
