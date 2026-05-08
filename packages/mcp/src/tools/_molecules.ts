/**
 * Molecule recipes — pre-defined atom combinations that form named molecules.
 *
 * Architectural role:
 *   - Atoms = individual MCP tools (mneme.people.atrophy, mneme.audit.certify, …)
 *   - Molecules = named combinations of atoms that solve a higher-order question
 *   - Compounds = molecules promoted into the library via repeated use
 *
 * Each tool's `secondBrain.compose` field surfaces the molecules that include
 * its atom — so the AI sees "if you just ran X, the natural next is to compose
 * X+Y+Z = molecule M". This triggers the chain-reaction of wisdom.
 *
 * The 20 molecules below cover the most-asked higher-order questions in
 * software-engineering management, security review, and AI-session audit.
 */

import type { ComposeSuggestion } from "./_types.js";

/** All known molecules. Each lists the atoms that compose it + when to fire. */
export const MOLECULES: ComposeSuggestion[] = [
  // ─────── PEOPLE / KNOWLEDGE / TEAM HEALTH ───────
  {
    molecule: "succession_plan",
    atoms: ["mneme.people.atrophy", "mneme.people.bus_factor", "mneme.people.telepathy"],
    when:
      "User asks about org-risk, handover, what happens if X leaves, knowledge transfer, " +
      "single points of failure, or backup engineers.",
    example:
      "Atrophy says Alice's auth knowledge is 28/100 (fading). Bus-factor confirms she owns " +
      "78% of auth files. Telepathy suggests Bob writes auth-shaped code without co-authoring " +
      "Alice — recommended pair-onboarding target.",
  },
  {
    molecule: "knowledge_health_check",
    atoms: ["mneme.people.atrophy", "mneme.people.passport", "mneme.quality.repo_mri"],
    when: "Quarterly review, before a reorg, or when user asks 'how healthy is the team?'.",
    example: "Combine atrophy heatmap + per-engineer passport + 20-axis MRI into one dashboard.",
  },
  {
    molecule: "onboarding_dossier",
    atoms: ["mneme.insights.mirror", "mneme.people.who_knows", "mneme.insights.story", "mneme.people.passport"],
    when: "New hire arrives, or someone asks 'how do I get up to speed on X?'.",
  },
  {
    molecule: "team_friction_diagnosis",
    atoms: ["mneme.people.nemesis", "mneme.insights.regret", "mneme.people.lineage"],
    when: "User asks 'where is friction?', 'who's stepping on whom?', 'rewrite churn'.",
  },

  // ─────── AI COMMIT SAFETY / AUDIT ───────
  {
    molecule: "ai_commit_check",
    atoms: ["mneme.audit.trace", "mneme.audit.verify", "mneme.audit.certify"],
    when: "Before merging an AI-generated commit, before a CI gate, or at PR review time.",
    example:
      "Trace identifies the AI tool (Claude Code / Cursor / Codex). Verify catches narrative-vs-diff " +
      "drift. Certify gives 5-axis pass/warn/fail.",
  },
  {
    molecule: "compliance_evidence_pack",
    atoms: ["mneme.audit.report", "mneme.audit.ledger", "mneme.audit.deps", "mneme.forensics.vulns"],
    when: "EU AI Act 2026 evidence request, SOX/SOC2 quarterly, or external audit prep.",
  },

  // ─────── REFACTOR / SHIP SAFETY ───────
  {
    molecule: "refactor_safety_check",
    atoms: ["mneme.insights.premortem", "mneme.memory.blast", "mneme.people.atrophy"],
    when:
      "User proposes a refactor, asks 'is this safe?', 'has this been tried?', or wants to estimate " +
      "blast radius before merge.",
    example:
      "Premortem says 78% regret-risk based on 7 of 9 similar attempts. Blast names 3 incident-prone " +
      "files in the diff. Atrophy warns the file owner is 28/100 fresh — knowledge gap.",
  },
  {
    molecule: "regret_pattern_review",
    atoms: ["mneme.insights.regret", "mneme.insights.paradox", "mneme.insights.crystal_ball"],
    when: "Quarterly retro, post-mortem, or before deciding whether to attempt a contested refactor.",
  },
  {
    molecule: "deploy_gate",
    atoms: ["mneme.audit.certify", "mneme.forensics.vulns", "mneme.audit.deps", "mneme.insights.crystal_ball"],
    when: "CI gate before production deploy, release candidate review.",
  },

  // ─────── SECURITY / FORENSICS ───────
  {
    molecule: "security_review",
    atoms: ["mneme.forensics.vulns", "mneme.audit.deps", "mneme.forensics.anomaly"],
    when: "Security review of a feature, before pen-test, or after a suspected incident.",
  },
  {
    molecule: "incident_attribution",
    atoms: ["mneme.forensics.match", "mneme.forensics.attribute", "mneme.forensics.anomaly"],
    when: "After a suspicious commit lands, during incident response, or insider-threat review.",
  },
  {
    molecule: "vulnerability_triage",
    atoms: ["mneme.forensics.vulns", "mneme.forensics.show", "mneme.audit.conscience"],
    when: "Reviewing a fresh batch of vuln findings — score, inspect, suppress false positives.",
  },

  // ─────── STORY / NARRATIVE / DECISIONS ───────
  {
    molecule: "decision_archaeology",
    atoms: ["mneme.memory.ask", "mneme.insights.decisions", "mneme.insights.story"],
    when: "User asks 'why does X exist?', 'what was the rationale for Y?', or wants ADR-style narrative.",
    example: "Cited Q&A → ADR list → multi-act narrative arc.",
  },
  {
    molecule: "file_archaeology",
    atoms: ["mneme.memory.why", "mneme.insights.time_machine", "mneme.quality.palimpsest", "mneme.people.lineage"],
    when: "User wants the full life story of a file or a single line of code.",
  },
  {
    molecule: "expert_finder",
    atoms: ["mneme.people.who_knows", "mneme.people.passport", "mneme.people.atrophy"],
    when: "User asks 'who can help me with X?', 'who should review this PR?'.",
  },

  // ─────── QUALITY / DEBT ───────
  {
    molecule: "tech_debt_audit",
    atoms: ["mneme.quality.karma", "mneme.people.promise", "mneme.insights.ghost", "mneme.insights.fossil"],
    when: "Quarterly tech-debt review, sprint planning for cleanup, or before a major refactor.",
  },
  {
    molecule: "code_quality_dashboard",
    atoms: ["mneme.quality.repo_mri", "mneme.quality.heartbeat", "mneme.insights.runaway", "mneme.insights.drift"],
    when: "Engineering manager dashboard, monthly health check, or VP-of-eng update.",
  },

  // ─────── PREDICTION / FORESIGHT ───────
  {
    molecule: "release_readiness",
    atoms: ["mneme.audit.certify", "mneme.insights.crystal_ball", "mneme.memory.blast", "mneme.forensics.vulns"],
    when: "Final go/no-go before shipping a release.",
  },
  {
    molecule: "next_quarter_risk_map",
    atoms: ["mneme.people.atrophy", "mneme.insights.oracle", "mneme.quant.black_swan", "mneme.quality.heartbeat"],
    when: "Strategic planning — what's likely to break, who's at risk of forgetting, where are the tail risks?",
  },
  {
    molecule: "moneyball_review",
    atoms: ["mneme.quant.moneyball", "mneme.people.influence", "mneme.people.passport"],
    when: "Compensation review, promotion committee, identifying undervalued contributors.",
  },
];

/** Find all molecules whose atoms include the given tool name.
 *  Used by tools to populate their `secondBrain.compose` field. */
export function moleculesContaining(atomName: string): ComposeSuggestion[] {
  return MOLECULES.filter((m) => m.atoms.includes(atomName));
}
