/**
 * v1.45.0 (#17 fix) — verb.noun aliases for metaphor tool names.
 *
 * Mneme's tool names are biology / antiquity-flavored ("aletheia",
 * "stigmergy", "chimera", "mneMeiosis"). Memorable, but hard for an AI
 * agent to scan. This file maps verb.noun aliases to the canonical
 * metaphor names so callers can use the friendlier form OR the
 * internal one — both route to the same handler.
 *
 * Two aliases per metaphor name max — keeps the registry small.
 *
 * NEW aliases ADD without renaming. Removing or repurposing an existing
 * alias is a breaking change.
 */

export const TOOL_ALIASES: Record<string, string> = {
  // ALETHEIA — vendor reputation + immune system
  "mneme.security.detect_tool_anomaly": "mneme.aletheia.immune.scan",
  "mneme.security.scan_tools":          "mneme.aletheia.immune.scan",
  "mneme.security.lint_tools":          "mneme.aletheia.lint",

  // STIGMERGY — pheromone trails + colony cooperation
  "mneme.signals.list":                 "mneme.stigmergy.list",
  "mneme.signals.deposit":              "mneme.stigmergy.deposit",
  "mneme.signals.evaporate":            "mneme.stigmergy.evaporate",

  // CHIMERA — solo-repo synthesizer
  "mneme.synthesize.repo":              "mneme.chimera.synthesize",

  // ANTIVIRUS — vaccines + cures
  "mneme.security.scan_text":           "mneme.antivirus.scan",
  "mneme.security.cure_text":           "mneme.antivirus.cure",

  // FORENSICS — STR / vulns / anomaly
  "mneme.security.attribute_commit":    "mneme.forensics.attribute",
  "mneme.security.scan_vulns":          "mneme.forensics.vulns",

  // MNEMEIOSIS / LINEAGE — chromosome inheritance
  "mneme.lineage.list_chromosomes":     "mneme.lineage.list",
  "mneme.lineage.export":               "mneme.lineage.export",

  // SQUADRON — devil's advocate + evidence quorum
  "mneme.review.run":                   "mneme.squadron.run",

  // KARMA — per-tool reputation
  "mneme.reputation.scores":            "mneme.karma.scores",

  // ORACLE / GHOST — insights
  "mneme.insights.predict":             "mneme.insights.oracle",
  "mneme.insights.detect_dormant":      "mneme.insights.ghost",

  // PHARMACOPOEIA / PARASITE / ALETHEIA (v1.43)
  "mneme.security.refresh_vaccines":    "mneme.pharmacopoeia.refresh",
  "mneme.security.bridge_install":      "mneme.parasite.inject",
  "mneme.security.bridge_uninstall":    "mneme.parasite.disinfect",

  // TEETH (v1.44)
  "mneme.security.bug_bounty_scan":     "mneme.teeth.bounty.scan",
  "mneme.security.vault_snapshot":      "mneme.teeth.vault.snapshot",
  "mneme.security.vault_verify":        "mneme.teeth.vault.verify",

  // WINGS (v1.44)
  "mneme.routing.recommend_vendor":     "mneme.wings.arbitrage.recommend",
  "mneme.testing.adversarial_army":     "mneme.wings.army.generate",

  // GOD MODE (v1.44)
  "mneme.compliance.report":            "mneme.godmode.compliance_report",
  "mneme.routing.dead_vendor_scan":     "mneme.godmode.dead_vendor.scan",
  "mneme.routing.dead_vendor_plan":     "mneme.godmode.dead_vendor.plan",

  // AVATAR (v1.44)
  "mneme.knowledge.gossip_seen":        "mneme.avatar.mesh.seen",
  "mneme.knowledge.universal_stream":   "mneme.avatar.lingua.stream",
  "mneme.knowledge.pack_create":        "mneme.avatar.pack.create",
};

/** Resolve an alias to its canonical tool name. Returns the input as-is
 *  if it's already canonical (or not a known alias). */
export function resolveAlias(name: string): string {
  return TOOL_ALIASES[name] ?? name;
}

/** List all aliases as { alias, canonical } pairs, sorted by alias. */
export function listAliases(): { alias: string; canonical: string }[] {
  return Object.entries(TOOL_ALIASES)
    .map(([alias, canonical]) => ({ alias, canonical }))
    .sort((a, b) => a.alias.localeCompare(b.alias));
}
