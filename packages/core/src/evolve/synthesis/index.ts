/**
 * MNEME EVOLVE Phase 3 -- Code Synthesis (v1.27.0)
 *
 *   import * as synthesis from "@mneme-ai/core/evolve/synthesis";
 *
 *   synthesis.synthesize(repo, proposalId);  // template -> patch -> verify
 *   synthesis.applyPatch(repo, proposalId);  // git apply (only if verified)
 *   synthesis.autoPr(repo, proposalId);      // gh pr create
 *   synthesis.evolutionPass(repo);           // Phase 5 -- daemon nightly tick
 *
 * Templates live in `templates.ts`; gates in `verify.ts`. To add a new
 * template, follow the recipe in `templates.ts`.
 */

export * from "./types.js";
export { ALL_TEMPLATES, matchTemplate } from "./templates.js";
export { applyAndVerify } from "./verify.js";
export {
  synthesize, verifySignature, applyPatch, evolutionPass, autoPr,
} from "./synthesize.js";
export {
  readLineage, recordApply, verifyChain, trackRecordFor, lineageStats,
} from "./lineage.js";
export type { LineageEntry, TemplateTrackRecord } from "./lineage.js";
