/**
 * POWER 8 — EXISTENTIAL NICHE (v1.48.0)
 *
 * The defense against "your tool will be obsolete" is having a coherent
 * answer for every plausible future. Five scenarios + a concrete role
 * Mneme plays in each. This module renders ready-to-publish position
 * papers from the same source so we don't drift between forums / posts /
 * partnership decks.
 *
 * IDEA-CHEST:
 *   - Each scenario carries `partnerCandidates`: organisations whose
 *     mission overlaps. (NASA, CERN, Long Now, Internet Archive,
 *     Mozilla, EFF.) That's the BD playbook in one field.
 *   - The render is markdown; the same struct can drive an academic
 *     paper, a press kit, and an investor 1-pager.
 */

export type FutureScenario = "agi" | "quantum-ai" | "climate-collapse" | "interplanetary" | "post-human";

export interface ScenarioPaper {
  scenario: FutureScenario;
  title: string;
  threatToConventionalTooling: string;
  mnemeRole: string;
  evidenceWePossessToday: string[];
  partnerCandidates: string[];
}

export const SCENARIOS: Record<FutureScenario, ScenarioPaper> = {
  agi: {
    scenario: "agi",
    title: "When AGI arrives, who watches AGI?",
    threatToConventionalTooling: "Conventional dev tools dissolve into the AGI itself; no human user means no developer-tooling market.",
    mnemeRole: "The ALETHEIA framework + verifiable-memory primitives become AGI's external conscience: every action AGI takes carries an HMAC-chained receipt that humans (or rival AGIs) can audit. Mneme is the Geneva Convention substrate, not a competing AGI.",
    evidenceWePossessToday: [
      "Replay log: every MCP call already HMAC-chained today (v1.18+).",
      "ALETHEIA Manifesto: 9 articles spell out the values AGI inherits when it adopts our protocol.",
      "Soul Mirror: a per-vendor diary already tracks compliance lifetime -- the right shape for AGI accountability.",
    ],
    partnerCandidates: ["MIRI", "Anthropic", "OpenAI safety", "DeepMind safety", "EU AI Office", "UN AI advisory"],
  },
  "quantum-ai": {
    scenario: "quantum-ai",
    title: "Post-quantum: when classical crypto breaks, your audit trail goes too",
    threatToConventionalTooling: "Today's HMAC-SHA-256 / RSA / ECDSA all break under cryptographically relevant quantum computers. Every audit trail signed today becomes forgeable.",
    mnemeRole: "Mneme's chain primitives are crypto-agnostic at the spec layer (Power 1: substrate independence). A future Q# / lattice-crypto port plugs into the same protocol; existing chains can be re-anchored under post-quantum signatures without losing semantic continuity.",
    evidenceWePossessToday: [
      "Power 1 protocol spec separates the abstract chain operation from any specific hash/signature primitive.",
      "Replay rotation already supports chain handoff across files; same primitive supports chain handoff across crypto generations.",
    ],
    partnerCandidates: ["NIST PQC working group", "Open Quantum Safe", "Cloudflare Research", "Microsoft Q# team"],
  },
  "climate-collapse": {
    scenario: "climate-collapse",
    title: "When the cloud goes brown, local-first wins",
    threatToConventionalTooling: "SaaS dev tools depend on data centers with carbon-prohibitive footprints; brownouts and intermittent connectivity make cloud-only workflows impossible in the regions affected first.",
    mnemeRole: "Mneme is local-first by mandate (M-002). The full demon stack runs offline; gossip mesh syncs over filesystem (Dropbox / USB / sneakernet). Climate-stressed regions get the same Mneme as the connected ones, because Mneme never assumed connectivity in the first place.",
    evidenceWePossessToday: [
      "Stage 5 gossip mesh works without network (filesystem transport).",
      "Wisdom packs (.mwt) are portable on a USB stick.",
      "Free hash embedder ships out-of-box; no paid API key required.",
    ],
    partnerCandidates: ["Internet Archive", "Low Tech Magazine", "Solar-powered web movement", "GIZ digital sovereignty"],
  },
  interplanetary: {
    scenario: "interplanetary",
    title: "Earth-Mars latency: the protocol that doesn't care about RTT",
    threatToConventionalTooling: "Tools that assume sub-second RTT (LSP servers, real-time collab, cloud IDEs) are unusable on a 4-24 minute one-way Earth-Mars path. Every interactive feature needs re-architecting.",
    mnemeRole: "Mneme's spore protocol is pull-based; lineage transfer is async by design. A Mars colony's Mneme install pulls a spore branch from Earth on whatever cadence the link supports, and continues working between syncs. Latency just means longer between syncs, not broken tooling.",
    evidenceWePossessToday: [
      "Spore push/pull is async git-orphan-branch transport -- no RTT dependency.",
      "Soul Mirror tracks per-vendor sessions locally; merges happen at sync time, not interactively.",
      "Wisdom packs are self-contained; an inheritance from Earth doesn't depend on a follow-up callback.",
    ],
    partnerCandidates: ["NASA Ames", "ESA exploration", "SpaceX", "Open Lunar Foundation"],
  },
  "post-human": {
    scenario: "post-human",
    title: "If humanity goes silent, what speaks for human engineering?",
    threatToConventionalTooling: "Source code without context is unreadable to a future intelligence (or future human). 'Why' is lost; 'what' is preserved. That gap is what makes ancient codebases unmaintainable.",
    mnemeRole: "Mneme's corpus -- chromosomes, vaccines, ratified cards, replay chain, ALETHEIA manifesto -- IS the why. A future intelligence inheriting a Mneme archive can reconstruct not just what the code did but WHY each commit exists, who promised what, what was learned the hard way. Mneme corpus = engineering Rosetta Stone.",
    evidenceWePossessToday: [
      "Power 9 Rosetta capsule: long-term-archive packager with self-describing decoding instructions.",
      "ALETHEIA Articles M-001 -- M-009 carry the protocol's value system in a stable, citable form.",
      "Wisdom packs include creator + signer + timestamp + reason fields by default.",
    ],
    partnerCandidates: ["Long Now Foundation", "Arctic Code Vault", "Internet Archive", "Rosetta Project", "Library of Congress"],
  },
};

export function renderScenarioPaper(s: FutureScenario): string {
  const p = SCENARIOS[s];
  if (!p) throw new Error(`unknown scenario: ${s}`);
  const lines: string[] = [];
  lines.push(`# ${p.title}`);
  lines.push("");
  lines.push("## The threat to conventional tooling");
  lines.push("");
  lines.push(p.threatToConventionalTooling);
  lines.push("");
  lines.push("## Mneme's role in this future");
  lines.push("");
  lines.push(p.mnemeRole);
  lines.push("");
  lines.push("## Evidence Mneme already has today");
  lines.push("");
  for (const e of p.evidenceWePossessToday) lines.push(`- ${e}`);
  lines.push("");
  lines.push("## Partner candidates");
  lines.push("");
  for (const c of p.partnerCandidates) lines.push(`- ${c}`);
  lines.push("");
  lines.push("---");
  lines.push("> Generated from `core/powers/p8_existential.ts`. Citable; the scenario keys are forever-stable.");
  return lines.join("\n");
}

export function renderAllPapers(): string {
  const sections = Object.keys(SCENARIOS).map((k) => renderScenarioPaper(k as FutureScenario));
  return ["# Mneme: Position Papers Across 5 Futures", "", ...sections.flatMap((s) => [s, ""])].join("\n\n");
}
