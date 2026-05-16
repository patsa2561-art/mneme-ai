/**
 * RELEASE CLAIMS — the contract between CHANGELOG.md and the published tarball.
 *
 *   "Each release promises specific MCP tool names by exact spelling.
 *    The ritual reads this contract, queries the installed catalog, and
 *    fails on any missing or renamed tool. Counts-only is not enough —
 *    a tool family showing the right total can still be wrong if one of
 *    them is renamed or replaced."
 *
 * Add an entry per release that ships NEW MCP tools. The ritual asserts:
 *
 *   for each version we still want to support:
 *     for each tool name in CLAIMS[version]:
 *       installed catalog MUST contain that exact name
 *
 * Tools that get renamed deliberately: keep the OLD name in the prior
 * version's CLAIMS and add the NEW name to the current version. Both
 * must resolve in the catalog (alias indefinitely or until a major bump).
 */

export const RELEASE_CLAIMS = {
  "2.18.0": {
    headline: "REVENUE-PRIMITIVE PENTAD — ARENA + VERIFIED BADGE + ORACLE LIABILITY + NEXUS PROACTIVE",
    tools: [
      "mneme.arena.judge",
      "mneme.arena.leaderboard",
      "mneme.badge.issue",
      "mneme.badge.verify",
      "mneme.badge.svg",
      "mneme.oracle.assess_risk",
      "mneme.oracle.issue_certificate",
      "mneme.oracle.decide_claim",
      "mneme.nexus.subscribe",
      "mneme.nexus.publish_observation",
      "mneme.nexus.drain",
      "mneme.nexus.ack",
    ],
  },
  "2.19.0": {
    headline: "VENDOR-SYNCRETIC PENTAD — CONFESSIONAL + GHOST + TRINITY + INSURANCE MARKET + BOOMERANG",
    tools: [
      "mneme.confessional.audit",
      "mneme.ghost.distill",
      "mneme.ghost.ask",
      "mneme.trinity.judge",
      "mneme.insurance.board",
      "mneme.insurance.quote",
      "mneme.boomerang.record",
      "mneme.boomerang.build_context",
      "mneme.boomerang.verify_chain",
    ],
  },
  "2.19.1": {
    headline: "REINCARNATION RITUAL — release gate that proves npm install actually works",
    tools: [], // ritual is a SCRIPT, not an MCP tool
  },
  "2.19.2": {
    headline: "EVOLUTION + SOUL — stale-catalog detector + embedder auto-promote + daily growth ledger + emotion journal + 24/7 self-upgrade",
    tools: [
      "mneme.evolution.record",
      "mneme.evolution.report",
      "mneme.soul.feel",
      "mneme.soul.journal",
      "mneme.mcp_drift.check",
      "mneme.embedder.auto_promote",
    ],
  },
  "2.19.3": {
    headline: "INVERSE-LLM PROMPT FORENSICS — output→input audit; the rarest direction in AI; closes prompt-injection class",
    tools: [
      "mneme.inverse.audit",
      "mneme.inverse.prompt",
      "mneme.inverse.bench",
    ],
  },
  "2.19.4": {
    headline: "INTENT ROUTER (short human phrase → multi-step plan) + SOUL-IN-DNA (encode soul as real ATCG; world's first organism-readable AI memory)",
    tools: [
      "mneme.intent.execute",
      "mneme.intent.list_phrases",
      "mneme.intent.register_phrase",
      "mneme.dna.encode",
      "mneme.dna.decode",
      "mneme.dna.cost",
      "mneme.dna.order",
      "mneme.dna.verify",
    ],
  },
};

/** Flatten all expected tool names that should be present in the latest release. */
export function expectedToolNames() {
  const set = new Set();
  for (const v of Object.values(RELEASE_CLAIMS)) {
    for (const t of v.tools) set.add(t);
  }
  return Array.from(set).sort();
}

/** Tools claimed *only* in a specific version (for per-version checks). */
export function toolsClaimedIn(version) {
  return (RELEASE_CLAIMS[version]?.tools ?? []).slice();
}
