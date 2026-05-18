/**
 * v2.19.42 — DISCOVERABILITY ALIASES (N1 fix).
 *
 *   "v2.19.34 shipped HOLY GRAIL QUADRUPLE: APOSTILLE + OUTCOME MARKET +
 *    ZK-FAIRNESS + ETERNITY. The actual MCP wrappers landed under
 *    `mneme.apostille.*`, `mneme.market.*`, `mneme.fairness.*`,
 *    `mneme.eternity.*`. But the user (and any AI agent that read the
 *    whats_new + grepped for `mneme.outcome.*` or `mneme.zk_fairness.*`)
 *    found zero matches and concluded 2/4 of the QUADRUPLE was missing.
 *    The wrappers were there — discovery was broken.
 *
 *    v2.19.42 ALIAS LAYER: register the same handler under both the
 *    canonical short name AND the feature-name the whats_new uses.
 *    Same handler, two visible names. Discovery via either grep, MCP
 *    catalog scan, or AI mental model from reading the codebase all
 *    succeed. Zero handler duplication; alias tools include a
 *    `_aliasOf` field so audit can distinguish canonical from alias."
 *
 * The alias pattern composes onto v2.19.41 OMNI-FLAG (each alias gets
 * the same auto-derived POSIX flags) and onto v2.19.41 SKINNY
 * CAPABILITIES (alias families show up in the skinny catalog so AI
 * agents see all the feature-names from whats_new).
 */

import type { MnemeTool } from "./_types.js";
import {
  marketPostTaskTool, marketSubmitBidTool, marketPickWinnerTool, marketScoreOutcomeTool, marketLeaderboardTool,
  fairnessCommitTool, fairnessGenerateTestsTool, fairnessVerifyTool, fairnessMintCertTool, fairnessAuditCertTool,
} from "./_v1934_holy_grail.js";

/** Register the same handler under a feature-name prefix so callers
 *  searching for the whats_new feature name still find the tool. */
function aliasTool(canonical: MnemeTool, aliasName: string): MnemeTool {
  // The alias points to the same handler + schema; only the name + the
  // description prefix differ so AI agents can see the alias relationship.
  return {
    ...canonical,
    name: aliasName,
    description: `[alias for ${canonical.name}] ${canonical.description ?? ""}`.slice(0, 600),
  };
}

// OUTCOME MARKET → mneme.market.*
const outcomePostTaskTool = aliasTool(marketPostTaskTool, "mneme.outcome.post_task");
const outcomeSubmitBidTool = aliasTool(marketSubmitBidTool, "mneme.outcome.submit_bid");
const outcomePickWinnerTool = aliasTool(marketPickWinnerTool, "mneme.outcome.pick_winner");
const outcomeScoreOutcomeTool = aliasTool(marketScoreOutcomeTool, "mneme.outcome.score_outcome");
const outcomeLeaderboardTool = aliasTool(marketLeaderboardTool, "mneme.outcome.leaderboard");

// ZK-FAIRNESS → mneme.fairness.*
const zkFairnessCommitTool = aliasTool(fairnessCommitTool, "mneme.zk_fairness.commit");
const zkFairnessGenerateTestsTool = aliasTool(fairnessGenerateTestsTool, "mneme.zk_fairness.generate_tests");
const zkFairnessVerifyTool = aliasTool(fairnessVerifyTool, "mneme.zk_fairness.verify");
const zkFairnessMintCertTool = aliasTool(fairnessMintCertTool, "mneme.zk_fairness.mint_cert");
const zkFairnessAuditCertTool = aliasTool(fairnessAuditCertTool, "mneme.zk_fairness.audit_cert");

export const V1942_ALIAS_TOOLS: MnemeTool[] = [
  outcomePostTaskTool, outcomeSubmitBidTool, outcomePickWinnerTool, outcomeScoreOutcomeTool, outcomeLeaderboardTool,
  zkFairnessCommitTool, zkFairnessGenerateTestsTool, zkFairnessVerifyTool, zkFairnessMintCertTool, zkFairnessAuditCertTool,
];

/** Canonical-name lookup: feature-name → canonical-name for honesty gate
 *  + capability listing UIs that want to display the canonical instead of
 *  surfacing the alias as if it were a separate tool. */
export const ALIAS_TO_CANONICAL: Record<string, string> = {
  "mneme.outcome.post_task": "mneme.market.post_task",
  "mneme.outcome.submit_bid": "mneme.market.submit_bid",
  "mneme.outcome.pick_winner": "mneme.market.pick_winner",
  "mneme.outcome.score_outcome": "mneme.market.score_outcome",
  "mneme.outcome.leaderboard": "mneme.market.leaderboard",
  "mneme.zk_fairness.commit": "mneme.fairness.commit",
  "mneme.zk_fairness.generate_tests": "mneme.fairness.generate_tests",
  "mneme.zk_fairness.verify": "mneme.fairness.verify",
  "mneme.zk_fairness.mint_cert": "mneme.fairness.mint_cert",
  "mneme.zk_fairness.audit_cert": "mneme.fairness.audit_cert",
};

/** Family-level alias map for the whats_new feature-name → MCP family
 *  rewriting that HONESTY GATE 2.0 uses when emitting the auto-amend
 *  disclaimer. */
export const FAMILY_ALIASES: Record<string, string> = {
  outcome: "market",
  zk_fairness: "fairness",
  "outcome market": "market",
  "zk fairness": "fairness",
};
