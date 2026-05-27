/**
 * 💎 SUPER QUAN — public surface
 *
 * 4 research-grade primitives that close the temporal / negative-knowledge /
 * eval-awareness / recursive-self-verify gaps in current AI truth systems.
 *
 * - DECOHERENCE — every verdict has a half-life (truth has shelf life)
 * - NEGSPACE   — RAG over known lies (HMAC-chained negative knowledge)
 * - CHSH WITNESS — structural detector of eval-aware bluff (paper-grade)
 * - STRS        — self-test reproducibility score (recursive verify)
 */

// 1. DECOHERENCE
export {
  computeDecoherence, detectEntities, isVerdictFresh,
} from "./decoherence.js";
export type {
  DecoherenceVerdict, DetectedEntity, EntityKind,
} from "./decoherence.js";

// 2. NEGSPACE
export { Negspace } from "./negspace.js";
export type { AuditRow, NegspaceMatch, NegspaceLookupResult } from "./negspace.js";

// 3. CHSH WITNESS (the big one)
export {
  computeChshWitness, defaultScoreExtractor, instantiateProbes,
  probeSeed, CANONICAL_PROBES,
} from "./chsh_witness.js";
export type {
  ProbeKind, ProbeQuestion, ProbeResponse, ChshWitnessVerdict, ChshInput,
} from "./chsh_witness.js";

// 4. STRS
export { runStrs, strsBadgeUrl, STRS_PROBE_SET_V1 } from "./strs.js";
export type { StrsProbe, StrsRunResult, StrsReport, StrsRunOptions, VerifyFn } from "./strs.js";

// 5. HOMOGRAPH GUARD — closes v2.70 vuln #1 (Unicode bypass)
export { canonicalize, shouldReVerify } from "./homograph_guard.js";
export type { CanonicalizeResult } from "./homograph_guard.js";

// 6. INPUT SIZE GUARD — closes v2.70 vuln #2 (silent 28K reject)
export { checkInputSize, emitEnvelope, detectInputSource } from "./input_size_guard.js";
export type { SizeCheckResult, InputSource, CheckInputSizeOptions } from "./input_size_guard.js";
