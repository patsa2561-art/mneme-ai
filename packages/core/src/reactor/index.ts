/**
 * v1.62.0 -- TOKEN NUCLEAR REACTOR public API.
 *
 * 12 layers ship together. Every layer returns ReactorMetrics so the
 * ledger rolls them up into a single before/after dashboard.
 */

// Measurement primitives
export {
  estimateTokens, metricsOf, recordSavings, totalSavings,
  type ReactorMetrics, type LedgerSummary,
} from "./measure.js";

// Layer 1: Pre-computed answer cache
export {
  lookupAnswer, storeAnswer, cacheStats, readAllEntries,
  type QAEntry, type LookupResult, type CacheStats,
} from "./cache.js";

// Layer 2: Intent compiler
export { refineIntent, type IntentRefinement, type Vagueness } from "./intent.js";

// Layer 5: Semantic diff / targeted slice
export { sliceFile, type SliceResult } from "./semantic_diff.js";

// Layers 3, 4, 6, 7, 8, 9, 10, 11, 12: smaller modules grouped
export {
  // Layer 3
  tryRecipe, type Recipe, type RecipeMatch,
  // Layer 4
  stampShard, shardEnvelope, type PromptShard, type ShardEnvelope,
  // Layer 6
  fuseToolCalls, type ToolCall, type FusionResult,
  // Layer 7
  shouldTruncate, type CertaintyCheck,
  // Layer 8
  issueCert, verifyCert, type VerificationCert,
  // Layer 9
  compressContext, type ContextCompression,
  // Layer 10
  startConversation, recordTurn, turnDiff, type Conversation, type ConversationTurn, type TurnDiffResult,
  // Layer 11
  summarize, persistSummary, recallSummary, type Summary,
  // Layer 12
  precogConstraints, type PrecogResult,
} from "./reactor_modules.js";
