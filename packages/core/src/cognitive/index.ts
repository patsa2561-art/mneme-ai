/**
 * v1.64.0 -- COGNITIVE LAYER (7-layer thinking demon).
 *
 * Public API for the seven cognitive sub-systems:
 *
 *   1. theoryOfMind     -- 9-axis behavioral profile per vendor
 *   2. treeOfThought    -- 3-level EV-scored decision tree
 *   3. curiosity        -- daemon-idle gap scanner
 *   4. consolidation    -- sleep-cycle compression of vaccines + lessons
 *   5. counterfactual   -- alternative-timeline simulation
 *   6. debate           -- skeptic / optimist / realist arbitration
 *   7. decisionAtom     -- fusion of layers 1-6 into a single verdict
 *
 * All seven are pure (no side effects) by default. Persistence is
 * opt-in via the `persist*` flags. Storage root is .mneme/cognitive/.
 */

export * as theoryOfMind from "./theory_of_mind.js";
export * as treeOfThought from "./tree_of_thought.js";
export * as curiosity from "./curiosity.js";
export * as consolidation from "./consolidation.js";
export * as counterfactual from "./counterfactual.js";
export * as debate from "./debate.js";
export * as decisionAtom from "./decision_atom.js";

// Re-export key types for convenience.
export type { VendorProfile } from "./theory_of_mind.js";
export type { ToTResult, TreeNode } from "./tree_of_thought.js";
export type { CuriosityGap, CuriosityScan } from "./curiosity.js";
export type { ConsolidationReport } from "./consolidation.js";
export type { CounterfactualResult, CounterfactualBranch, CounterfactualBias } from "./counterfactual.js";
export type { DebateResult, DebateTurn, Voice } from "./debate.js";
export type { DecisionAtom, DecisionAtomInput, AtomVerdict, AtomHistorySummary } from "./decision_atom.js";
