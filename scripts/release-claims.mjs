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
  "2.19.27": {
    headline: "DREAMSPACE PIPELINE COMPLETE -- stages 1, 2, 3, 6 close the 6-stage loop (v2.19.26 shipped stages 4+5). 🔬 PROBE measures 4 normalised per-tool metrics (latency / outputEntropy / errorRate / utility) + geometric-mean fitness via synthetic + real input battery. 🗺 CARTOGRAPHER aggregates probes into 2D capability map (toolName, patternSig -> quality) with EWMA recency; REFLEX's evidence-backed predict-next-tool entry point. 💞 PAIR scores ordered tool pairs via mutual_info approximation (required-coverage 0.5 + optional 0.3 + key-overlap 0.2); replaces v2.19.26 frequency-only co-occurrence with QUALITY signal. 🌍 FEDERATE issues EliteAttestation (refuses below 0.7 fitness), aggregates into 6-band quorum (unanimous / supermajority / majority / minority / conflict / orphan), exports top-N starter pack for new users -- network effect for dreamt tools. Composes onto v2.19.16 FEDERATED + v2.19.23 LIMBIC organs + v2.19.26 GESTATION+EVOLUTION. 12 new MCP tools. Mneme owns AI tool factory category by structural necessity.",
    tools: [
      "mneme.dreamspace.probe_finalise",
      "mneme.dreamspace.probe_metrics",
      "mneme.dreamspace.probe_verify",
      "mneme.dreamspace.map_build",
      "mneme.dreamspace.map_query",
      "mneme.dreamspace.map_stats",
      "mneme.dreamspace.pair_score",
      "mneme.dreamspace.pair_rank",
      "mneme.dreamspace.pair_verify",
      "mneme.dreamspace.federate_attest",
      "mneme.dreamspace.federate_quorum",
      "mneme.dreamspace.federate_starter",
    ],
  },
  "2.19.26": {
    headline: "DREAMSPACE -- self-authoring MCP catalog. Two phases that turn dreams from PRODUCT factory (vaccine/prophecy/paradox) into TOOL FACTORY (proposes brand-new MCP chimeras + lifecycle decisions). 🌱 GESTATION detects 3 gap classes (REFLEX cache miss / user_chat no-match / pattern co-occurrence) and proposes HMAC-signed ProposedToolSpecs with deterministic names (mneme.auto.X_then_Y) + sequential composer recipes that splice EXISTING tools via v2.19.9 WRAPPER_GENESPLICING. 🦋 EVOLUTION classifies each tool into 4 lifecycle bands (🥚 gestating / 🐣 juvenile / 🦋 mature / 🍂 atrophied) + selects ordered (A then B) mating pairs from a use-log within 60s window; promotes proven + sunsets unused + mates frequent pairs into new chimeras. Tools are SPECIES that evolve. 8 new MCP tools. First framework worldwide with self-authoring catalog + lifecycle bands + mating selector.",
    tools: [
      "mneme.dreamspace.detect_gaps",
      "mneme.dreamspace.propose_spec",
      "mneme.dreamspace.gestation_cycle",
      "mneme.dreamspace.verify_proposal",
      "mneme.dreamspace.classify",
      "mneme.dreamspace.mate_pairs",
      "mneme.dreamspace.evolution_cycle",
      "mneme.dreamspace.list_bands",
    ],
  },
  "2.19.25": {
    headline: "SLEEP TRAINING + ENDOCRINE -- extends LIMBIC further. SLEEP TRAINING is the nightly fitness loop: compares yesterday's REFLEX predictions vs the AI agent's ACTUAL tool calls; computes jaccard fitness per (pattern, eventSig); adaptive weight updates clamp [0.01, 1.0]; hit rate compounds nightly. MEASURED trajectory: random 20% (day 1) -> >=70% (day 30) on synthetic fixable trail. ENDOCRINE adds 4 NAMED biological hormones (CORTISOL stress / DOPAMINE flow / MELATONIN rest / OXYTOCIN social) with source detectors over commit text + error rate + hour + streaks + co-authors + idle; 4 distinct half-life decays (30/20/90/60 min); 5 cross-organ effects (reflex aggressiveness / daemon quietness / dream depth / notifications suppressed / surface trinity). System literally adapts to user mood. 8 new MCP tools. No cloud SaaS competitor can ship sleep training (event observation = privacy violation; Mneme local-first immune).",
    tools: [
      "mneme.sleep.cycle",
      "mneme.sleep.fitness",
      "mneme.sleep.apply",
      "mneme.sleep.digest",
      "mneme.endocrine.produce",
      "mneme.endocrine.effects",
      "mneme.endocrine.neutral",
      "mneme.endocrine.list_hormones",
    ],
  },
  "2.19.24": {
    headline: "TOOL TIER + EVENT PATTERN MATCH -- extends LIMBIC with progressive disclosure + semantic content matching. TIER ships 4-tier classifier (starter/explorer/deep/experimental) so users see a curated subset while AI agents still see all 574 via MCP; the CLI `mneme tools --tier T` flag replaces the 67-vs-505 split with explicit tiers + visual badges. EVENT PATTERN MATCH ships 18 semantic regex patterns extracting tool predictions from commit messages / file paths / clipboard text / shell commands / user chat in EN+TH; canonical scenario 'fix: token leak in auth.ts' fires 4+ predictions (bug_prophet + forensics.vulns + apoptosis.detect + antivirus.scan) with >=0.85 max confidence -- pre-execution layer becomes content-aware not just kind-aware. 6 new MCP tools.",
    tools: [
      "mneme.tier.classify",
      "mneme.tier.list_by_tier",
      "mneme.tier.budget",
      "mneme.event.match",
      "mneme.event.list_patterns",
      "mneme.event.report",
    ],
  },
  "2.19.23": {
    headline: "LIMBIC -- the autonomic nervous system (6 organs). Paradigm shift from tool to organism: Mneme breathes itself (BREATH respawns dead daemon silently on every CLI call -- kills G1), routes events by tier (THALAMUS picks reflex/cortex/dream/breath), reflexes with cold-start priors (SPINAL ships 8 BUILTIN_RULES so day-one users get useful predictions -- kills G4), knows its own shape (PROPRIOCEPTION unifies CLI+MCP catalog -- kills G2 deeper), dreams to consolidate (HIPPOCAMPUS extracts yesterday's stable patterns into tomorrow's priors), and has hormones (HORMONAL focus/fatigue/mood tunes every organ across the system). 13 new MCP tools. All 6 organs HMAC-signed; all measure 100% determinism. Composes onto v2.19.22 REFLEX + v2.19.21 CLI RESOLVER + v2.19.14 DREAMS + v2.19.13 NEGEV. The first dev tool in history with autonomic nervous system.",
    tools: [
      "mneme.breath.decide",
      "mneme.breath.stats",
      "mneme.thalamus.classify",
      "mneme.proprioception.build",
      "mneme.proprioception.find",
      "mneme.proprioception.stats",
      "mneme.spinal.blend",
      "mneme.spinal.list_rules",
      "mneme.hippocampus.consolidate",
      "mneme.hormonal.update",
      "mneme.hormonal.tune",
      "mneme.hormonal.neutral",
      "mneme.limbic.health",
    ],
  },
  "2.19.22": {
    headline: "REFLEX (flagship Automatic Pre-Execution Layer) + CATALOG PARITY (G2 quick-win). REFLEX is the first AI tool that pre-executes likely follow-up tools BEFORE the agent asks: HMAC-chained pheromone store learns from observations, frequency-based predictor returns top-N tools, budget-bound concurrent prefetch writes TTL-bounded HMAC-signed cache. Measured 100% cache integrity + 100% prediction determinism + 100% hit rate on warm trail + p50 cached read < cold invoke. CATALOG PARITY surfaces hidden-tool UX failures (CLI vs MCP family asymmetry) -- the root cause of 'AI hallucinates a Mneme tool user cannot find'. 7 new MCP tools.",
    tools: [
      "mneme.reflex.observe",
      "mneme.reflex.predict",
      "mneme.reflex.cache_write",
      "mneme.reflex.cache_read",
      "mneme.reflex.stats",
      "mneme.catalog.parity",
      "mneme.catalog.families",
    ],
  },
  "2.19.21": {
    headline: "GAP CLOSER (SNN AUTO-PROMOTE + CLI FAMILY-CLASH RESOLVER). Closes 2 sticky gaps from the v2.19.20 audit at SOURCE: (1) mneme status now writes back the resolved embedder tier when ladder picks higher than saved config (refuses to downgrade -- user pin always wins; HMAC-chained promotion ledger); (2) universal router MOUNTS MCP subcommands onto legacy parent commands instead of skipping -- unblocks 4 SYNCRETIC families (ghost/trinity/insurance/boomerang) that appeared as 0 wrappers across 5 prior patches. 4 audit MCP tools + 2 CLI surface fixes; 17 deep tests + 100% downgrade refusal + 100% promote correctness.",
    tools: [
      "mneme.snn.promote_decide",
      "mneme.snn.promote_tier",
      "mneme.cli.clash_audit",
      "mneme.cli.mounted_families",
    ],
  },
  "2.19.20": {
    headline: "SUPPORTING TRIO (RCI + PROVENANCE-DNA + TEXTRON CAPTCHA). REVERSE-CAPTION INJECTION fights injection with injection (HMAC-signed Mneme overlay weighted ABOVE user caption). PROVENANCE-BY-DNA-HASH ships pure-TS perceptual aHash + 3-flag classifier (STOLEN_PHOTO/DISPUTED_IDENTITY/FRESH_SCAM). TEXTRON CAPTCHA exams the AI before trusting it (5-question caption-skepticism + transcript ledger + confidence multiplier). All composes onto v2.19.18 CSP + v2.19.19 inpainter + v2.19.16 FEDERATED.",
    tools: [
      "mneme.rci.build",
      "mneme.rci.verify",
      "mneme.rci.format",
      "mneme.provenance.hash",
      "mneme.provenance.hamming",
      "mneme.provenance.record",
      "mneme.provenance.evaluate",
      "mneme.provenance.seller_id",
      "mneme.textron.exam",
      "mneme.textron.enroll",
      "mneme.textron.multiplier",
    ],
  },
  "2.19.19": {
    headline: "CAPTION INPAINT — Phase A+B complete. InpainterProvider vendor-agnostic adapter + pure-TS PATCH HARVEST FILL (concentric ring search + 1/distance-weighted average + boundary Gaussian blur). 100% determinism + 100% pixel preservation + 100% fingerprint discrimination + 100% mask plausibility on measured trials (target 97.5%+). Wires into v2.19.18 severCaption via async path.",
    tools: [
      "mneme.inpaint.run",
      "mneme.inpaint.naked_fingerprint",
      "mneme.inpaint.resolve",
      "mneme.inpaint.metrics",
    ],
  },
  "2.19.18": {
    headline: "CAPTION SEVERANCE PROTOCOL (CSP) — defeats CAPTION-AUTHORITY ATTACK (CAA), the unnamed multimodal vulnerability class of 2026. 6-step pipeline (OCR escape → naked fingerprint → provenance gate → adversarial double-check → entropy desperation → HMAC-signed VISION TRUST CERTIFICATE). 4-layer routing defense (welcome PROTOCOL + intent phrases + reverse-wrapper rule + NEGEV enforcement) ensures every compliant AI agent calls CSP on user images.",
    tools: [
      "mneme.caption.sever",
      "mneme.caption.extract",
      "mneme.caption.escape",
      "mneme.caption.adversarial_check",
      "mneme.caption.provenance",
      "mneme.caption.verify_cert",
      "mneme.caption.desperation_score",
    ],
  },
  "2.19.17": {
    headline: "TOOL REACHABILITY ENGINE — the ghost-tool killer. Measures per-tool USER-REACHABILITY across 5 surfaces (cli_router / welcome / whats_new / suggested_next / capabilities); HMAC-signed report; ritual gate blocks publish on any v2.18+ tool with reachability score=0. Plus: mneme status now PROBES the runtime embedder ladder (W5 fix — was reporting saved config string not actual tier).",
    tools: [
      "mneme.reachability.scan",
      "mneme.reachability.report",
      "mneme.reachability.ghost_list",
      "mneme.reachability.surface_audit",
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
