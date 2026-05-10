/**
 * Self-modifying NUCLEUS -- proposes patches to Mneme based on local
 * telemetry. Read-only on the source; writes proposals to
 * `.mneme/proposals/<id>.md`. NEVER auto-merges.
 *
 *   import * as evolve from "@mneme-ai/core/evolve";
 *
 *   const proposals = evolve.generateProposals(repoRoot);
 *   evolve.listProposals(repoRoot);
 *   evolve.viewProposal(repoRoot, id);
 *   evolve.evolveStats(repoRoot);
 *
 * Brand: this is the "self-modifying NUCLEUS" Phase 2 deliverable from
 * the v1.27 phase plan. Mneme reading its own bug reports and offering
 * a markdown PR back to the project. World-first for an AI dev tool.
 */

export * from "./types.js";
export {
  scanSignals, generateProposals, listProposals, viewProposal, evolveStats,
} from "./evolve.js";
