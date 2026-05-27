/**
 * 🌀 GROK BRIDGE — public surface
 *
 * "Truth-Provider-as-a-Service" for xAI / Grok integration.
 * Mneme primitives composed into one drop-in layer that turns Grok into
 * "the AI that argues with itself before answering you."
 *
 * Usage:
 *   import { createTruthOracle } from "@mneme-ai/core/grok_bridge";
 *
 *   const oracle = createTruthOracle({ hmacKey: process.env.GROK_HMAC_KEY! });
 *
 *   // Pre-verify before flush
 *   const v = await oracle.preVerify({ text: draft, meta: { modelVersion, promptHash } });
 *   if (v.verdict === "REFUSED") return refuseResponse(v.suggestedEdit);
 *   if (v.verdict === "HEDGED")  draft = v.suggestedEdit ?? draft;
 *
 *   // Compliance run (regulator-grade)
 *   const c = await oracle.runCompliance(draft, { vendor: "grok" });
 *   if (!c.overallOk) bumpRiskMetric(c.reasons);
 */

export type {
  TruthVerdict, TruthOracleVerdict, DraftInput,
  BlackBoxStamp, BlackBoxStampInput,
  ContraRagCandidate, ContraRagResult,
  ElonChronostasisClaim,
  ColossusInferenceMeta,
  ConstitutionalCheck,
  ComplianceEditionReport,
  GrokBridgeConfig,
} from "./types.js";

// 💥 1. Black Box
export { GrokBlackBox } from "./black_box.js";

// 💥 2. Contra-RAG
export { contraRagSearch, contradictionScore } from "./contra_rag.js";
export type { ContraRagOptions } from "./contra_rag.js";

// 💥 3. Elon Chronostasis
export { ElonChronostasis } from "./elon_chronostasis.js";
export type { RecordClaimInput, GradeInput } from "./elon_chronostasis.js";

// 💥 4. Colossus Probe
export { wrapColossusInference, ColossusDriftWatcher } from "./colossus_probe.js";
export type { InferenceFn, ColossusProbeOptions } from "./colossus_probe.js";

// 💥 5. Constitutional Double
export { constitutionalCheck } from "./constitutional_double.js";
export type { ConstitutionalDoubleOptions } from "./constitutional_double.js";

// 💥 6. Starlink MNEMNET
export { StarlinkMnemnet } from "./starlink_mnemnet.js";
export type { VerificationProposal, PeerVerdict, FederatedConsensusResult } from "./starlink_mnemnet.js";

// 💥 7. Compliance Edition
export { runComplianceEdition } from "./compliance_edition.js";
export type { ComplianceEditionInput } from "./compliance_edition.js";

// 🌀 THE WILDEST — Truth Oracle (orchestrator)
export { TruthOracle, createTruthOracle } from "./truth_oracle.js";
export type { TruthOracleOptions } from "./truth_oracle.js";
