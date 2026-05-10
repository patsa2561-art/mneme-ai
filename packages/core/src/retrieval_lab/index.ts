/**
 * Mneme Retrieval Lab — public surface.
 *
 * One-stop import: `import { retrievalLab } from "@mneme-ai/core"` then
 * call `retrievalLab.runTrial(...)`, `retrievalLab.activeConfig(...)`,
 * `retrievalLab.rerankCrossEncoder(...)`, etc.
 */

export type {
  RetrievalConfig, EmbedderBackendId, RerankerBackendId,
  Trial, LeaderboardEntry, Leaderboard, EvalCase,
} from "./types.js";

export { CANDIDATE_CONFIGS, DEFAULT_CONFIG, getConfig } from "./configs.js";

export type { CrossEncoderRerankInput, CrossEncoderRerankResult } from "./cross_encoder.js";
export { rerankCrossEncoder, warmupCrossEncoder } from "./cross_encoder.js";

export type { HyDePromptPayload, HyDeRewriteResult } from "./hyde.js";
export { buildHyDePrompt, applyHyde } from "./hyde.js";

export type { EmbedderBackend } from "./embedder_registry.js";
export { EMBEDDER_REGISTRY, availableEmbedders, embedWithBackend } from "./embedder_registry.js";

export {
  readLeaderboard, writeLeaderboard, pickNextArm, recordTrial,
  activeConfig, paretoFrontier,
} from "./leaderboard.js";

export { runTrial, runTrialAsync, verifyTrial, readEvalSuite } from "./tuner.js";
export type { HardEvalRunner, RunTrialOptions } from "./tuner.js";
export type { HardEvalStoreReader, HardEvalResult } from "./hard_eval.js";
export { buildHardEvalSuite, scoreRanking } from "./hard_eval.js";

export type { RetrievalConfigSignature } from "./lineage_retrieval.js";
export { snapshotForChromosome, mergeInheritedConfigs } from "./lineage_retrieval.js";
