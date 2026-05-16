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
  "2.19.5": {
    headline: "CHRONOSTASIS · FLAGSHIP · Time-Locked Provable Memory (the first AI memory primitive that automatically unsays its past on adversarial refutation)",
    tools: [
      "mneme.chronostasis.propose",
      "mneme.chronostasis.witness_prompt",
      "mneme.chronostasis.record_verdict",
      "mneme.chronostasis.tick",
      "mneme.chronostasis.axioms_relevant",
      "mneme.chronostasis.summarize",
    ],
  },
  "2.19.6": {
    headline: "CONVERSATION COMPILER — chat → deterministic, HMAC-pair-locked, callable Agreement artifact (drift becomes impossible; pre-commit hooks generated)",
    tools: [
      "mneme.agreement.compile",
      "mneme.agreement.run",
      "mneme.agreement.verify_pair",
      "mneme.agreement.list",
      "mneme.agreement.pre_commit_hook",
    ],
  },
  "2.19.7": {
    headline: "MEGAPACK — 6 wild mutations (RETROCAUSAL · DREAM CONSOLIDATION · COLONY MIND · HONEY DECISION · RETROACTIVE COMPILE · GENETIC PATCH) + 4 tech-debt repairs (intent persistence · agreement uninstall · embedded gravity · WASM self-test)",
    tools: [
      "mneme.intent.save",
      "mneme.intent.load",
      "mneme.agreement.uninstall",
      "mneme.chronostasis.lineage",
      "mneme.chronostasis.axioms_relevant_embedded",
      "mneme.dream.run",
      "mneme.dream.review",
      "mneme.colony.broadcast",
      "mneme.colony.drain",
      "mneme.honey.generate",
      "mneme.honey.score_vendor",
      "mneme.retroactive.mine_history",
      "mneme.genetic.propose",
    ],
  },
  "2.19.8": {
    headline: "WIRING SPRINT — AUTO-GENESIS WRAPPER FACTORY (orphan-detection gate) + universal MCP→CLI auto-router + W2 fix (verify numerical-claim sniff) + 5 orphan-closure MCP tools (zero v2.18+ orphans)",
    tools: [
      "mneme.agreement.extract_decisions",
      "mneme.embedder.decide_promote",
      "mneme.jackpot.publish",
      "mneme.jackpot.leaderboard",
      "mneme.jackpot.render_jackpot_card",
    ],
  },
  "2.19.9": {
    headline: "WRAPPER GENESPLICING — runtime chimera composition (Lego for MCP tools); first MCP server in the field to break the static-catalog assumption",
    tools: [
      "mneme.genome.splice",
      "mneme.genome.execute_chimera",
      "mneme.genome.list",
      "mneme.genome.promote",
      "mneme.genome.gc",
      "mneme.genome.stats",
    ],
  },
  "2.19.10": {
    headline: "PROOF-CARRYING WRAPPER (zero-trust tool chain; HMAC chain-of-custody between tools) + REVERSE-WRAPPER (tool suggests next tool; loop-detected; follow-through telemetry)",
    tools: [
      "mneme.proof.attach",
      "mneme.proof.verify",
      "mneme.proof.verify_chain",
      "mneme.proof.fingerprint",
      "mneme.suggest.next",
      "mneme.suggest.attach",
      "mneme.suggest.record_call",
      "mneme.suggest.stats",
    ],
  },
  "2.19.11": {
    headline: "LIVING MCP — MORTAL + REINCARNATING WRAPPERS (the first MCP layer where wrappers are born, mutate, deprecate, and die on a TTL; AI agents must re-discover or break)",
    tools: [
      "mneme.mortal.birth",
      "mneme.mortal.list",
      "mneme.mortal.tick",
      "mneme.mortal.resolve",
      "mneme.mortal.invoke",
      "mneme.mortal.calibration",
      "mneme.mortal.stats",
      "mneme.mortal.verify",
    ],
  },
  "2.19.12": {
    headline: "LIVING CLI · Pillar 1 — CLI EVOLUTION: MUSCLE MEMORY (persistent daemon dispatch, cold→warm speedup) + DIALECT (per-user phrase intent map) + BRAIN BRANCHES (counterfactual selves of knowledge) + MODEL CHRYSALIS (future-model-proof vendor ABI adapter)",
    tools: [
      "mneme.muscle.benchmark",
      "mneme.muscle.status",
      "mneme.muscle.socket_path",
      "mneme.dialect.learn",
      "mneme.dialect.resolve",
      "mneme.dialect.export",
      "mneme.brain.branch",
      "mneme.brain.diff",
      "mneme.brain.merge",
      "mneme.brain.list",
      "mneme.chrysalis.probe",
      "mneme.chrysalis.translate",
      "mneme.chrysalis.list",
    ],
  },
  "2.19.13": {
    headline: "LIVING CLI · Pillars 2 + 3 — NEUROMORPHIC SPIKING EMBEDDER (2048-dim sparse SNN: no transformer, no ONNX bridge, gradient-free adversarial finetune) + NEGATIVE-EVIDENCE FIREWALL (inverts burden of proof: claim ACCEPTED only when every refutation is searched and NOT found; HMAC certificate + token-tax routing)",
    tools: [
      "mneme.snn.embed",
      "mneme.snn.similarity",
      "mneme.snn.finetune",
      "mneme.snn.stats",
      "mneme.snn.config",
      "mneme.negev.gate",
      "mneme.negev.verify_certificate",
      "mneme.negev.tax_init",
      "mneme.negev.tax_charge",
      "mneme.negev.tax_status",
    ],
  },
  "2.19.16": {
    headline: "FEDERATED TRUTH GRAVITY — the network-effect moat (cross-instance crypto-attestation; verify pipeline strengthens with every install) + SNN EMBEDDER ADAPTER (auto-promote on bundled WASM failure; never fall to hash again).",
    tools: [
      "mneme.federated.identity",
      "mneme.federated.attest",
      "mneme.federated.verify",
      "mneme.federated.quorum",
      "mneme.federated.gravity",
    ],
  },
  "2.19.15": {
    headline: "TRUTH FORENSIC PIPELINE — the verify command that calls its own bluff. Sniffs verifiable assertions (mneme.X.Y exists, 'N mneme.X.* tools', version, file paths) and checks them against Mneme's own live MCP catalog + version + filesystem. Negative-evidence rule: ANY refuted assertion is fatal → REJECTED. HMAC-signed certificate per verdict. Replaces v2.19.8's regex-string-mutation W2 fix at SOURCE root cause. Wired into the `mneme verify` CLI surface.",
    tools: [
      "mneme.truth.forensic",
      "mneme.truth.sniff",
      "mneme.truth.verify_cert",
      "mneme.truth.classify",
      "mneme.truth.explain",
    ],
  },
  "2.19.14": {
    headline: "LIVING CLI · BONUS TRIO — CLI DREAMS (idle-time insight generation with crystallisation ratio) + CHIMERA EMBEDDER (5 domain-specialised SNNs + keyword classifier + ambiguity signal) + CONSEQUENCE LEDGER (causal-aware CLI: 'what does my own cmd cause in 24h')",
    tools: [
      "mneme.dreams.enqueue",
      "mneme.dreams.resolve",
      "mneme.dreams.digest",
      "mneme.dreams.pending",
      "mneme.chimera.classify",
      "mneme.chimera.embed",
      "mneme.chimera.disagree",
      "mneme.chimera.list_domains",
      "mneme.consequence.record",
      "mneme.consequence.record_delta",
      "mneme.consequence.query",
      "mneme.consequence.list_recent",
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
