export * from "./types.js";
export * as git from "./git/index.js";
export * as store from "./store/index.js";
export * as indexer from "./indexer/index.js";
export * as retrieve from "./retrieve/index.js";
export * as correlate from "./correlate/index.js";
export * as entities from "./entities/index.js";
export * as enrich from "./enrich/index.js";
export * as util from "./util/index.js";
export * as wisdom from "./wisdom/index.js";
export * as insights from "./insights/index.js";
export * as quant from "./quant/index.js";
export * as guardian from "./guardian/index.js";
export * as forensics from "./forensics/index.js";
export * as htc from "./htc/index.js";
export * as pipeline from "./pipeline/index.js";
export * as audit from "./audit/index.js";
export * as people from "./people/index.js";
export * as bot from "./bot/index.js";
export * as adversarial from "./adversarial/index.js";
export * as counterfactual from "./counterfactual/index.js";
export * as karma from "./karma/index.js";
export * as mri from "./mri/index.js";
export * as palimpsest from "./palimpsest/index.js";
export * as twin from "./twin/index.js";
export * as org from "./org/index.js";
export * as periodic from "./periodic/index.js";
export * as holy from "./holy/index.js";
export * as hmra from "./hmra/index.js";
export * as learning from "./learning/index.js";
export * as security from "./security/index.js";
export * as bench from "./bench/index.js";
export * as dynamic from "./dynamic/index.js";
export * as metrics from "./metrics/index.js";
export * as dna from "./dna/index.js";
export * as genome from "./genome/index.js";
export * as lineage from "./lineage/index.js";
export * as versionCheck from "./version_check.js";
export * as karmaStreaks from "./karma_streaks.js";
export * as nucleus from "./nucleus.js";
export * as nucleusDaemon from "./nucleus_daemon.js";
// v1.41.0 — AI Compliance pre-executor. Pulse pre-executes AUTO-ACTION
// mandates so AI agents see "✓ AUTO-EXECUTED" instead of "EXECUTE NOW".
// Architectural fix for the cross-session AI-ignore-pulse problem.
export * as aiCompliance from "./ai_compliance.js";
// v1.41.0 Phase 1 — durable queue for self-modifying mandates that the
// pulse pre-executor cannot safely run inline (file-lock on running
// mneme.cmd binary). Daemon caretaker pass drains the queue.
export * as autoActionQueue from "./auto_action_queue.js";
// v1.42.0 — MNEME COMPANION PROTOCOL. Five modules that change the AI
// trust relationship from "ask for compliance" to "make compliance the
// rationally-optimal choice." See docs/COMPANION_PROTOCOL.md for the
// design + docs/ARCHITECTURAL_FIXES.md for the broader fix ladder.
export * as aiSoul from "./ai_soul.js";
export * as userConsent from "./user_consent.js";
export * as aiPheromone from "./ai_pheromone.js";
export * as aiContracts from "./ai_contracts.js";
export * as vendorPulseTemplates from "./vendor_pulse_templates.js";
// v1.42.1 — Phase 2 of Per-Vendor Pulse Templates: EVOLVE-driven A/B.
// Reads compliance log → proposes mutations on under-performing templates
// → records A/B baseline → auto-promotes the winner after a window.
export * as templateEvolution from "./template_evolution.js";
// v1.42.4 — Smart Cloud Connectivity. 4-state probe (online / degraded /
// offline / unknown) with TTL cache + queue-and-drain pattern so cloud
// outages never block the local-first path. See cloud_connectivity.ts
// docstring for the full design rationale.
export { CloudConnectivity, type CloudState, type QueuedEvent, type ConnectivityState, type ConnectivityOptions } from "./cloud_connectivity.js";
// v1.42.5 — Wave 2 bug fixes
//   #8  honest encryption status (replaces decorative boolean flag)
//   #16 curated default tools list (20 high-value of 172)
export * as lineageEncryptionStatus from "./lineage/encryption_status.js";
export * as curatedTools from "./curated_tools.js";
// v1.43.0 — DEMON STAGE 1: FANGS. Three modules that flip Mneme from
// solo product to networked organism. All free-first; future
// monetization hooks live in pricingTier metadata (HIDDEN from
// public renderers per user mandate "ใช้ฟรีก่อน").
//   1.1 Vaccine CDN auto-distribution — pulls + atomically swaps the
//        pharmacopoeia bundle. Downgrade-attack-resistant.
//   1.2 Parasite bridge installer — sentinel-bracketed + symmetric
//        disinfect. ALWAYS attributed (the opposite of sneaky).
//   1.3 Aletheia vendor scoring — composite score per vendor from
//        local compliance log + karma + advocate + autoaction.
//        Badge SVG ready for any README.
export * as pharmacopoeiaCdn from "./pharmacopoeia/cdn_client.js";
export * as pharmacopoeiaPulse from "./pharmacopoeia/pulse_integration.js";
export * as parasiteBridge from "./parasite/bridge.js";
export * as aletheiaScoring from "./aletheia/vendor_scoring.js";
export * as aletheiaBadge from "./aletheia/badge_generator.js";
// v1.44.0 -- DEMON STAGES 2-5 (TEETH + WINGS + GOD MODE + AVATAR).
// Twelve modules across four stages, all free-first, all on-disk only.
//   STAGE 2 (TEETH):  bug-bounty harvester, ransom-proof vault,
//                     stake-weighted genome marketplace.
//   STAGE 3 (WINGS):  continuous-shipping executor, vendor arbitrage
//                     router, synthetic adversarial army.
//   STAGE 4 (GOD MODE): Mneme OS process supervisor, compliance
//                     reporter (SOC2/ISO/EU AI Act), dead-vendor
//                     migration planner.
//   STAGE 5 (AVATAR): filesystem gossip mesh, vendor-neutral lingua
//                     stream, replicating-wisdom transfer pack.
export * as teethBountyHarvester from "./teeth/bounty_harvester.js";
export * as teethRansomVault from "./teeth/ransom_vault.js";
export * as teethGenomeMarket from "./teeth/genome_market.js";
export * as wingsShipper from "./wings/shipper.js";
export * as wingsArbitrage from "./wings/arbitrage.js";
export * as wingsSyntheticArmy from "./wings/synthetic_army.js";
export * as godMnemeOs from "./god_mode/mneme_os.js";
export * as godComplianceReporter from "./god_mode/compliance_reporter.js";
export * as godDeadVendor from "./god_mode/dead_vendor.js";
export * as avatarGossipMesh from "./avatar/gossip_mesh.js";
export * as avatarLingua from "./avatar/lingua.js";
export * as avatarReplicatingWisdom from "./avatar/replicating_wisdom.js";
// v1.45.0 (#5 fix) -- single source of truth for the running Mneme
// version. Never falls back to a hard-coded string -- those bit-rot
// the moment a new version ships.
export { resolveMnemeVersion } from "./mneme_version.js";
// v1.46.0 (#8 fix) — AI HANDSHAKE PROTOCOL. Lets Mneme see CLI-only
// AI sessions (Claude Code / Cursor / Codex / Continue / Gemini /
// Aider). Pre-fix: Soul Mirror reported "0 sessions" because every
// CLI invocation bypassed the MCP-side observer. Post-fix: AI calls
// `mneme greet --vendor X` once per session + every CLI invocation
// records an activity tick against the active vendor.
export * as aiHandshake from "./ai_handshake.js";
// v1.48.0 -- THE 9 POWERS. Each module is a concrete capability that
// pushes Mneme past "Tier-1 demon" into permanence. Substrate
// independence (P1) makes the protocol outlive any implementation;
// sovereign infrastructure (P2) audits decentralization; language
// ownership (P3) tracks dialect spread; philosophical moat (P4) is
// the ALETHEIA Manifesto; anti-fork immunity (P5) measures network
// gravity; adversarial resilience (P6) auto-vaccinates from the
// attack log; autonomous economy (P7) simulates DAO treasury policy;
// existential niche (P8) renders position papers for 5 future
// scenarios; inherits-the-earth (P9) packages Rosetta capsules.
export * as powerSubstrate from "./powers/p1_substrate.js";
export * as powerSovereign from "./powers/p2_sovereign.js";
export * as powerLanguage from "./powers/p3_language.js";
export * as powerPhilosophical from "./powers/p4_philosophical.js";
export * as powerAntifork from "./powers/p5_antifork.js";
export * as powerAdversarial from "./powers/p6_adversarial.js";
export * as powerAutonomous from "./powers/p7_autonomous.js";
export * as powerExistential from "./powers/p8_existential.js";
export * as powerInherits from "./powers/p9_inherits.js";
// v1.28.2 -- comprehensive service uninstall (cross-platform).
export * as serviceUninstall from "./service_uninstall.js";
// v1.29.0 -- SUPERNOVA self-heal supervisor (factorial backoff +
// escalation) and QUANTUM gap-scanner (Grover-shaped sub-linear scan).
export * as supernova from "./supernova/supervisor.js";
// v1.30.0 -- Memory-tier transparency. Reads the active embedder tier
// from store metadata, exposes star ratings + degraded-tier warnings.
// Lets the pulse honestly tell the user "your memory layer is on the
// hash tier, here's the one-command upgrade".
export * as memoryTier from "./memory_tier.js";
// v1.30.0 -- Super Sonic Continuity: pulse-trace persistence + delta
// diff. Each pulse fire is appended to .mneme/pulse-trace.jsonl; the
// next pulse computes the delta against the prior snapshot and emits
// a [CHANGED] annotation so the AI agent on prompt N+1 sees what
// changed since prompt N -- adapts incrementally instead of
// re-discovering state every turn.
export * as pulseContinuity from "./pulse_continuity.js";
// v1.30.0 -- TIME-MACHINE INDEX (atomic snapshot + auto-rollback) and
// FTS5 detection (TRIPLE-INDEX WAR fallback). Together they kill the
// "lost 6 days of index" failure mode reported on macOS Node 23.6.
export * as safeIndex from "./store/safe_index.js";
export * as fts5Detect from "./store/fts5_detect.js";
// v1.31.0 -- AGENT COMMAND MANIFEST. Single source of truth for what
// commands every AI agent in the user's editor knows about. Daemon
// auto-syncs to CLAUDE.md, AGENTS.md, .cursor/rules, GEMINI.md,
// .windsurfrules whenever a new command ships. No more "I didn't know
// that command existed" from testers.
export * as agentManifest from "./agent_manifest.js";
// v1.31.0 -- TRUST CALIBRATOR. Per-subsystem benchmark + calibration
// grade (excellent / acceptable / weak / untrusted). SELF-DOWNGRADE:
// outputs from weak/untrusted subsystems get [CALIBRATION:LOW]
// annotation appended so the AI agent + user know what to trust.
export * as trustCalibration from "./trust_calibration.js";
// v1.31.0 -- FORENSICS V2 (3-layer detection: regex + AST-shape +
// NVD-stub). GHOST-NEGATIVE LOG: dismissed FPs are auto-suppressed
// on subsequent scans. Direct response to "forensics vulns 80% FP".
export * as forensicsV2 from "./forensics_v2.js";
// v1.32.0 -- CACHE HOLOGRAM + PHOTONICS PROPAGATION. Central registry
// of every cache in .mneme/ + photon-based dependency invalidation.
// Kills the pulse-cache-lag bug at root: when mneme-version source
// shifts, version-check cache is auto-stale on the next read.
export * as cacheHologram from "./cache_hologram.js";
// v1.33.0 -- WISDOM REACTOR. Five real nuclear-physics formulas
// (E=mc², radioactive decay, reaction Q, nuclear radius, criticality
// k-factor) mapped to Mneme metrics: wisdom yield, atrophy half-life,
// EVOLVE patch energy, RAG cluster sizing, user-engagement criticality.
// k_factor drives NUCLEUS TIDE: pulse auto-tunes verbosity (quiet when
// supercritical, proactive when subcritical).
export * as wisdomReactor from "./nuclear/wisdom_reactor.js";
// v1.34.0 -- DUAL-CONSCIENCE COURT + PERSPECTIVE QUARK JURY +
// OVERNIGHT RUNNER. Inspired by ARIS but explicitly broader: any
// goal-driven multi-round transformation runs through the runner;
// reviewer is a 6-quark jury (one model, six personas) so the FREE
// path beats ARIS's 2-model setup. NUCLEAR FUSION verdict: stable
// nucleus = merge, unstable = defer. Wisdom-Q auto-stop on regression.
export * as overnightConscience from "./overnight/conscience.js";
export * as overnightQuarkJury from "./overnight/quark_jury.js";
export * as overnightRunner from "./overnight/runner.js";
// v1.35.0 -- LINEAGE AT-REST ENCRYPTION (AES-256-GCM, HKDF over
// machine-local salt) + TOOL CURATOR (project-shape detection +
// filtered tool list). Direct fixes for "plaintext on disk" and
// "200 tools overwhelm AI" tester painpoints.
export * as lineageAtRestCrypto from "./lineage/at_rest_crypto.js";
export * as toolCurator from "./tool_curator.js";
// v1.36.0 -- TOKEN ECONOMY (secretary bot framework). Per-vendor
// BARGAIN TABLE of strategies (context-hash-reuse, delta-only,
// compact-json, identifier-shortening, early-summary-frame). AI agent
// volunteers token counts via mneme.token.report; Mneme rolls up
// savings + tunes which strategies work best per vendor over time.
// Honest disclaimer baked in: Mneme can't snoop provider traffic --
// AI cooperates because saving tokens saves the user $$.
export * as tokenEconomy from "./token_economy.js";
// v1.93.0 -- TOKEN-NOVA. Four-technique stack ON TOP of token_economy:
//   🦠 VACCINE PRE-EMPTION (cached refute = 0 AI call)
//   🪞 MIRROR-MIND DEDUP (lineage hash → reference token)
//   🌌 FRACTAL CONTEXT DECAY (power-of-2 budget per turn-age)
//   🪙 TOKENIZER ARBITRAGE (per-vendor BPE rewrites)
// Plus computeSavingsReport + formatPulseSavingsLine for measurable $$.
export * as tokenNova from "./token_nova/index.js";
// v1.93.0 -- SYSTEM-COMPAT bot. Probes the upgrade environment
// (OS / Node version / npm / brew / docker / global-install permissions)
// BEFORE the daemon spawns `mneme upgrade --force`. Returns SAFE / DEFER
// / BLOCK + the right shell command per strategy (global-npm /
// user-npm / brew / docker / manual). Silent failures during auto-update
// are now structurally impossible.
export * as systemCompat from "./system_compat/index.js";
// v1.94.0 -- MNEME-QX SuperNova Engine.
//   ⚛  Quantum Core      — Probability Collapse Matrix (multi-signal Bayesian fusion)
//   💥  SuperNova Burst   — parallel-fanout intelligence with measurable speedup
//   ♾  Infinity Memory   — quantum event traces with probability vectors per event
//   👁  Soul Engine      — autonomous goal generation with will-vector
//   📊  Benchmark         — 8-axis measurable score 0..100
//   🔁  Re-engineer loop  — recurring optimizer until score ≥ 97.5%
export * as qxSupernova from "./qx_supernova/index.js";
// v1.95.0 -- QX-BRIDGE: universal MCP→quantum-cloud bridge.
//   Pure-TS state-vector simulator (up to 12 qubits) + provider
//   abstraction for IBM Quantum / AWS Braket / Azure Quantum / D-Wave.
//   Famous circuit constructors (Bell pair, GHZ, Grover-2q).
//   Every measurement auto-records into Infinity Memory as a quantum
//   event with the full probability vector.
export * as qxBridge from "./qx_bridge/index.js";
// v1.99.0 -- FLASH INTELLIGENCE: anti-hallucination Core.
//   Veracity-Velocity Singularity (V_eff = Σ(E·W)/ln(H+e) × Φ_qx)
//   Recursive Self-Verification (Devil's Advocate)
//   Hyper-Contextual Grounding (classifies seller-listing vs auction-record)
//   Prompt-Q-Latency Engine (predict next user question, pre-warm context)
//   Master runFlash() — the one function AI agents call before any factual claim.
export * as flash from "./flash/index.js";
// v1.37.0 -- AUTONOMOUS BUG TRIAGE. Reads gap-scan + supernova
// telemetry and produces GitHub-issue-shaped proposals (title + body +
// labels + fissile-mass severity). Operation Automation bet #4 from
// the README -- now with real code behind it. Daemon's nightly cycle
// can call proposeTriage() to generate a prioritized backlog.
export * as triage from "./triage/auto_issue.js";
// v1.37.0 -- DEVHEALTH SNAPSHOT (composes every per-metric subsystem
// into a single composite + ATOMIC SECOND-BRAIN BONDS that surface
// cross-axis disagreements). Foundation for Business Model bet #5
// (hosted SaaS dashboard for engineering managers).
export * as devhealth from "./devhealth/snapshot.js";
// v1.37.0 -- COMPLIANCE EVIDENCE PACK (EU AI Act / SOC2 / HIPAA-shaped
// evidence rollup with AUDIT-TRAIL HOLOGRAM hash; auditors recompute
// to verify integrity). Foundation for Business Model bet #3
// (Compliance-as-a-Service).
export * as compliance from "./compliance/evidence_pack.js";
// v1.38.0 -- AUTOPHAGY SHIPPER (Continuous Shipping Cycle).
// Operation Automation bet #1 -- "world's first software that ships
// its own patch updates while the maintainer sleeps." Paranoid gates:
// PATCH-only, evolve-bot author, 24h green CI, ship-readiness READY,
// rate-limited, killswitch via env. Dry-run by default.
export * as autoship from "./autoship/cycle.js";
// v1.39.0 -- DEVIL'S ADVOCATE + EVIDENCE QUORUM. Direct fix for the
// CRITICAL Bot Squadron confirmation-bias finding: when a FALSE claim
// triggered 5/6 bots into 'support' citing the same irrelevant
// commit, the squad rubber-stamped it at 83% confidence. THIS BLOCKED
// the Compliance product roadmap. The advocate is a 7th bot that
// actively constructs counter-narrative + detects single-source
// laundering + absence-of-evidence + irrelevant citations. The
// quorum aggregator caps consensus when bias signals fire.
export * as squadronAdvocate from "./squadron/advocate.js";
// v1.50.0 -- FACT GROUNDING. Squad/Advocate now verifies factual claims
// against the actual repo state (package.json, source tree). A single
// FALSE fact triggers a hard refute that overrides pattern-matching
// "supports" votes. Fixes the smoking-gun bug where "Mneme has 200
// tools and the daemon is written in Rust" got SUPPORTED 57%.
export * as squadronFactGrounding from "./squadron/fact_grounding.js";
// v1.51.0 -- ACGV PROTOCOL (Aletheia Chandrasekhar-Neutrino-Godel Verifier).
// 6-layer truth pipeline that runs BEFORE legacy squadron logic:
//   L0 vaccine match     -- previously-refuted lie shapes auto-refute in us
//   L1 neutrino 3-flavor -- harmonic mean of surface / substrate / spectrum
//   L2 chandrasekhar     -- claim mass / density / collapse verdict
//   L3 godel post-mortem -- UNSAT-core proof certificate on BLACK_HOLE
//   L4 confession        -- claimer must write doubt or take confidence cut
//   L5 stigmergy vaccine -- lies become permanent immunity (simhash bank)
//   L6 economic stake    -- bots lose karma when caught wrong by L2/L3
// Output: ACGVVerdict ladder (IMPOSSIBLE_REFUTE > AUTO_REFUTE > BLACK_HOLE >
//   FUSION > LIMBO > PASSTHROUGH). PASSTHROUGH yields to legacy flow.
export * as acgv from "./squadron/acgv.js";
export * as acgvNeutrino from "./squadron/acgv_neutrino.js";
export * as acgvChandrasekhar from "./squadron/acgv_chandrasekhar.js";
export * as acgvGodel from "./squadron/acgv_godel.js";
export * as acgvConfession from "./squadron/acgv_confession.js";
export * as acgvVaccine from "./squadron/acgv_vaccine.js";
export * as acgvStake from "./squadron/acgv_stake.js";
// v1.52.0 -- Z3 SAT formal upgrade (optional z3-solver dep) + plain-English
// explainer. The Z3 layer turns Godel post-mortem into court-grade proof
// when z3-solver is installed; otherwise gracefully falls back to the
// v1.51 propositional check (free-first). The explainer translates the
// physics-jargon verdict into a one-line headline + 2-sentence layperson
// summary + one concrete next action so users without a math degree can
// actually act on the verdict.
export * as acgvGodelZ3 from "./squadron/acgv_godel_z3.js";
export * as acgvExplain from "./squadron/acgv_explain.js";
// v1.55.0 -- PRIME-RESONANCE TRUTH FUNCTION (Mneme's signature wisdom layer
// mixing prime number theory, complex Fourier, golden ratio, pi) + Z3
// ARITHMETIC encoding for numeric range / inequality / logical compound
// claims. Two-witness rule: Chandrasekhar (v1.51) + PRTF (v1.55) must
// agree before Mneme declares a strong verdict.
export * as acgvPrtf from "./squadron/acgv_prtf.js";
export * as acgvArithmetic from "./squadron/acgv_arithmetic.js";
export * as acgvLogic from "./squadron/acgv_logic.js";
// v1.56.0 -- PHOENIX RESURRECTION PROTOCOL. Cross-platform auto-boot with
// triple-witness redundancy: install Plan 1 + Plan 2 + Plan 3 simultaneously
// so the daemon resurrects after every reboot regardless of which mechanism
// is blocked by the host. P(resurrection) = 1 - 0.05^3 = 99.99% under the
// assumed 5% per-mechanism failure rate.
export * as autoboot from "./autoboot/index.js";
// v1.57.0 -- SOVEREIGNTY KERNEL. Mneme answers questions using local
// Ollama as the language model + ACGV as the grounding gate. Mneme
// decides what to say (verdict), Ollama generates the words (text).
// Free-first: no API key, no cloud, no source code leaves the laptop.
export * as sovereign from "./sovereign/index.js";
// v1.58.0 -- TIER 2: THE COVENANT. Bilateral HMAC-signed contract
// between user + AI vendor. Mneme enforces by scanning soul mirror +
// quorum.jsonl for violations. Aletheia compliance score moves over
// time -- credit history for AI.
export * as covenant from "./covenant/covenant.js";
// v1.59 -- TIER 3: Oracle/forecast (Bayesian regression risk)
export * as forecast from "./forecast/forecast.js";
// v1.60 -- TIER 4: Whisper Net (P2P wisdom federation)
export * as whisper from "./whisper/whisper.js";
// v1.61 -- TIER 5: Nemesis Protocol (weekly adversarial audit)
export * as nemesis from "./nemesis/nemesis.js";
// v1.62 -- TIER 6: Recursive Soul (cross-session AI accountability)
export * as recursiveSoul from "./recursive_soul/recursive_soul.js";
// v1.63 -- TIER 7: Time-River (counterfactual history)
export * as timeriver from "./timeriver/timeriver.js";
// v1.61 -- PROJECT EXODUS. Six layers that make Mneme portable +
// self-evolving + federated: Genome (4-strand wisdom DNA) + Wanderer
// (.mwt bundle) + Nuclear Exchange (cross-Mneme handshake) + Dream
// Weaver (overnight self-evolution) + Quantum Cache (speculative
// pre-execution + Markov) + Wisdom River (SSE live broadcast).
export * as exodus from "./exodus/index.js";
// v1.62 -- TOKEN NUCLEAR REACTOR. 12 layers that reduce AI token spend
// while preserving 100% output quality: pre-computed answer cache +
// intent compiler + compiled-intent recipes + shard cache + semantic
// diff + atomic tool fusion + streaming truncation + verification
// certs + context compression + turn diff + summary debt + precog regret.
// Every layer reports {tokensSpent, baselineTokens, tokensSaved, savingsRatio}
// so the ledger rolls them up into a single before/after dashboard.
export * as reactor from "./reactor/index.js";
// v1.63 -- PATH A: METAMORPHOSIS. 5 self-knowledge / companion layers:
// Transparency Mirror + Interview Protocol + Audience Layer + Alien
// Protocol + Carbon Budget. Mneme grows from "tool" to "companion that
// knows me".
export * as metamorphosis from "./metamorphosis/metamorphosis.js";
// v1.64 -- PATH B: TRIBUNAL. Federated truth-keeping: Court of Last
// Appeal + Consensus Network + ZK Proofs + Cross-Project Wisdom +
// Dependency Oracle. Mneme as multi-vendor referee.
export * as tribunal from "./tribunal/tribunal.js";
// v1.65 -- PATH C: INNER LIFE + AI TEACHER. Reasoning Genome (5th
// strand R) + Game Theory Engine (Nash + Shapley) + Living Document
// (interactive README) + AI TEACHER (syllabus + exam + training-cert
// propagation for any AI agent that connects to Mneme).
export * as innerlife from "./innerlife/innerlife.js";
export * as aiTeacher from "./innerlife/ai_teacher.js";
// v1.64 -- COGNITIVE 7. Theory of Mind + Tree-of-Thought + Curiosity +
// Memory Consolidation + Counterfactual + Internal Debate + Decision
// Atom (fusion of all 6 prior cognitive layers into a single verdict).
// All seven are pure-read by default; opt-in persistence under
// .mneme/cognitive/.
export * as cognitive from "./cognitive/index.js";
// v1.65 -- APOPTOSIS PROTOCOL. 7-layer hallucination killer:
// 5-witness fusion + semantic grounding + Bayesian vaccine prior +
// temporal consistency + epistemic humility + fractal decomposition +
// ACGV cascade. Continuous verdict ladder (HEALTHY / INFLAMED /
// NECROTIC / APOPTOTIC) with bench-verified 100% precision + recall
// on the 200-sample synthetic corpus (vs ~70% baseline).
export * as apoptosis from "./apoptosis/index.js";
// v1.65 -- POWER 6 LIVE METRIC + POWER 7 SHADOW TREASURY.
// Adds honest live-signal axes alongside the v1.48 simulation modules.
export * as powerAdversarialLive from "./powers/p6_live.js";
export * as powerAutonomousShadow from "./powers/p7_shadow.js";
// v1.65.1 -- EMBEDDER AUTODIAGNOSE. Probes openai / ollama / bundled /
// hash; flags upgrade gap; persist=true rewrites .mneme/config.json.
// Pulse uses this to nudge users off the hash tier when WASM or Ollama
// is actually available locally.
export * as embedderAutodiagnose from "./embedder_autodiagnose.js";
// v1.66 -- AUTARCHY PROTOCOL. Four-axis self-sufficiency:
//   A1 mesh-as-cloud      federation peers as cloud surrogate
//   A2 Schroedinger        parallel-race embedder + authoritative file
//   A3 timecrystal         baked vaccine bundle (no CDN env needed)
//   A4 quantum checksum    triple-witness model pin
// One MCP call (mneme.autarchy.status) returns the 0..100 score.
export * as autarchy from "./autarchy/index.js";
// v1.67.1 -- AGENT ANNOUNCE + CARETAKER SYNC. Closes the agent-
// awareness gap: pulse surfaces [NEW] line when version bumps;
// caretaker auto-syncs CLAUDE.md / AGENTS.md / .cursor/rules so the
// AI agent in the user's editor learns about new MCP tools instantly.
export * as agentAnnounce from "./agent_announce.js";
// v1.71 -- SENTINEL PROTOCOL. PRECOG-pattern firewall for ACTIONS
// (shell commands) instead of CLAIMS. 5 layers (detector / scope /
// risk-scorer / HMAC-audit / orchestrator) with trust-decay learning
// + auto-vaccine harvesting from past BLOCK events.
export * as sentinel from "./sentinel/index.js";
// v1.72 -- DIASPORA PROTOCOL. Four cross-boundary upgrades:
//   D1 ghost-sniper gitignore    auto-append on every parasite inject
//   D2 spore default-on           git remote -> auto-enable sync
//   D3 portable session capsule   vendor A save -> vendor B resume
//   D4 HTTP bridge + OpenAPI      ChatGPT Custom GPT compatible
export * as diaspora from "./diaspora/index.js";
// v1.73 -- GENESPLICE PROTOCOL. Cross-vendor brain transfer WITHOUT
// browser extensions, cloud deploys, or vendor approval. User pastes
// a ~500-token soul prompt into Gemini / ChatGPT / Claude.ai and that
// AI is reincarnated with full Mneme context. Genetic engineering
// for AI brains.
//   G1 soul prompt              ~500-token paste-able brain
//   G2 genome recombination     merge N vendor genomes via CRDT
//   G3 gist brain transfer      user's GitHub gist = portable cloud
//   G4 chromosomal crossover    preserve disagreements
//   G5 phenotype expression     vendor-specific from same genome
//   G6 browser paste protocol    universal markdown+HMAC format
export * as genesplice from "./genesplice/index.js";
// v1.74 -- PERMEATE PROTOCOL. Reach every AI tool on Earth without
// vendor approval or cloud deploy. Userscript + bookmarklet route
// around store approval (Tampermonkey-compatible). Editor map proves
// MCP-native tools (Cursor / Continue / Cline / Aider / Zed / etc)
// already work via MCP. Cross-machine transport menu offers 4
// concrete paths (clipboard / Gist / Wanderer .mwt / QR).
//   P1 userscript generator    Tampermonkey-ready .user.js
//   P2 bookmarklet generator    single-line URI fallback
//   P3 editor integration map   15 AI tools + status matrix
//   P4 transport menu           ranked cross-machine paths
export * as permeate from "./permeate/index.js";
// v1.75 -- VERSION TELEPATHY. Mneme's heartbeat survives the cross-vendor
// jump: every soul prompt now carries a `## Mneme Heartbeat` section
// (local version + npm latest + sync status + daemon state). The
// receiving AI -- even one that has never seen Mneme -- can answer
// "what version is Mneme on this machine? Is there a newer one?"
// without running any command.
export * as telepathy from "./telepathy/index.js";
// v1.76 -- ABYSS PROTOCOL: final-boss minions.
//   SCYTHE     -- capsule TTL + auto-prune (closes the disk-bloat hole)
//   REVENANT   -- soul prompt archive + replay + mark-as-used
//   HOMUNCULUS -- receiver-write-back contract for bidirectional brain sync
export * as abyss from "./abyss/index.js";
// v1.77 -- SEAMLESS: MUFFLER voice directive. Stops Mneme codenames
// from leaking into the receiving AI's user-facing replies. Prepended
// to every soul prompt + parasite bridge block.
export * as seamless from "./seamless/index.js";
// v1.78 -- LATTICE: intent grounding. Hardcoded {trigger → tool} map +
// Mneme dictionary + pulse-contract parser + 5-axis grounding score
// that quantifies cross-vendor reply quality.
export * as lattice from "./lattice/index.js";
// v1.79 -- NEURON: molecule of intelligence. Auto-derives intent atoms
// from any tool catalog, runs 4-strategy triage (exact / auto-derived /
// fuzzy / keyword), and ORACLE-predicts the next tool BEFORE the user
// finishes typing. Closes the gap between Mneme's ~100 tools and the
// receiving AI's ability to route naturally.
export * as neuron from "./neuron/index.js";
// v1.80 -- CONDUIT: the immortal demon's nervous system.
// 5 modules close the cross-vendor loop: relay_prompt (web AI returns
// CONDUIT RETURN blocks for source-AI execution), version_gate (dead
// man's handshake for stale souls), uninstall_directive (per-vendor
// recipe), sync_status (source-newer / destination-newer detection),
// phantom_exec (web AI previews tool output without real execution).
export * as conduit from "./conduit/index.js";
// v1.81 -- SYNAPSE: universal cross-device brain sync.
//   nexus_code        -- 6-char short code resolves to a soul prompt
//   qr_anchor         -- SVG QR for any URL / code / short payload
//   token_compression -- deterministic codebook saves 30-50% tokens
export * as synapse from "./synapse/index.js";
// v1.82 -- OSMOSIS: 24/7 second-brain expansion. Harvests observations
// from every AI agent (with consent), distills into a hash-chained
// wisdom ledger. No training, no cloud, no API key.
export * as osmosis from "./osmosis/index.js";
// v1.83 -- AURA: same-WiFi auto-discovery + owner-only pairing.
// Signed pair payload bundles (lanUrl + NEXUS code + expiry + owner
// fingerprint). Office WiFi neighbours can't fetch -- they don't have
// the matching owner key. No mDNS broadcast.
export * as aura from "./aura/index.js";
// v1.85 -- RELAY: paste-backed cross-vendor brain transport.
// Anonymous public paste services (dpaste / paste.rs / 0x0.st) host the
// encrypted soul; mobile AI apps fetch the URL + decrypt with NEXUS
// code. No cloud deploy on our side. No Mneme on destination.
export * as relay from "./relay/index.js";
// v1.86 -- CHAMELEON: environment-adaptive transport selection.
// Detects git ownership / CI / CODEOWNERS without external API calls,
// gates spore git push behind explicit opt-in (default OFF), routes
// every destination to the safest transport.
export * as chameleon from "./chameleon/index.js";
// v1.88 -- ANCHOR: parent-pole / child-rope architecture.
// Parent generates a stable identity; children carry signed ropes.
// Same-pole children can sync with each other; cross-pole ropes
// are rejected automatically. Plus OS-level clipboard handoff
// (Phone Link / Universal Clipboard / KDE Connect → phone).
export * as anchor from "./anchor/index.js";
// v1.89 -- RAINBOW: multi-channel handoff orchestrator. Probes which
// transports are live (LAN / data: URL bridge / dpaste) and picks the
// recommended channel. The data: URL bridge is the wild move — entire
// HTML page lives in the QR; phone scans → renders → fetches soul.
export * as rainbow from "./rainbow/index.js";
// v1.70 -- PRECOG FIREWALL. Paradigm shift: from DETECT-AFTER to
// PREVENT-BEFORE. Every AI claim flowing through Mneme is intercepted
// at the MCP boundary, verified against ACTUAL repo state (git, fs,
// package.json, CHANGELOG), and either CERTIFIED or auto-hedged with
// a named cause. Position: AI tools that connect via MCP become
// structurally incapable of hallucinating.
//   P1 package verifier        npm / import / install refs
//   P2 SHA/version/email       git rev-list / tags / authors
//   P3 temporal verifier       "last week" -> git log range
//   P4 firewall                intercept + auto-hedge + verdict
//   P5 trust certificate       HMAC-signed proof
//   P6 Bayesian repo priors    per-repo failure-shape memory
export * as precog from "./precog/index.js";
// v1.69 -- HYPERSCAN PROTOCOL. Four wild axes that close the prose-scan
// gap + Q&A trust gap + HTC coverage gap, plus a shape-shifting
// molecule (textForm / vectorForm / structuralForm / temporalForm)
// queryable via 5 mixed retrieval algorithms (cosine / jaccard /
// structural / temporal / hybrid). Every axis is measurable.
//   H1 prose shadow scan   entity extraction from prose claims
//   H2 cross-citation      every named entity needs codebase evidence
//   H3 cross-source Q&A    fuse retrieval across 5 source kinds
//   H4 nucleus dust HTC    auto-populate coverage 0% -> >=80%
export * as hyperscan from "./hyperscan/index.js";
// v1.68 -- ASCENSION PROTOCOL. Six wild moves that push 3 existing
// metrics toward 100% + close 3 root-cause residuals:
//   ASC-1 circadian heartbeat       per-hour-of-week baseline
//   ASC-2 superposed antivirus      cache + pre-filter for 10x+ speed
//   ASC-3 conformal apoptosis       UNCERTAIN tier -> 100% auto-precision
//   ASC-4 prophetic embedder        config vs Schroedinger vs meta drift
//   ASC-5 sovereign mode            distinguishes intentional offline
//   ASC-6 inbox tier filter         alert vs routine separation
export * as ascension from "./ascension/index.js";
// v1.67 -- AEGIS PROTOCOL. Nine-axis immune system inside Mneme.
// Defensive answer to Palisade self-replication / sandbagging /
// shutdown-evasion findings. Strictly observe + record + propagate;
// no exploit code, no consent-less replication, no shutdown evasion.
//   A1 replication detector  cross-host burst fingerprinting
//   A2 consent kernel        HMAC-signed replica family tree
//   A3 polygraph             test-vs-prod drift sandbag detector
//   A4 honeypot nexus        decoy targets + bite ledger
//   A5 killswitch handshake  signed-ack shutdown protocol
//   A6 jurisdiction atlas    per-vendor host distribution map
//   A7 antibody federation   mesh-broadcast threat fingerprints
//   A8 mutant wisdom          adaptive thresholds (gradient)
//   A9 ninja invisibility     undetectable shadow probes
export * as aegis from "./aegis/index.js";
// v1.40.0 -- UNIVERSAL FUNCTION-CALLING ADAPTER. Exports Mneme tools
// in OpenAI / Anthropic / Gemini native function-call schema formats
// so AI clients can consume Mneme tools WITHOUT MCP. SCHEMA MOLECULES
// pre-bundle multi-tool sequences (audit-before-merge / who-knows-this
// / before-refactor / compliance-grade) for one-call invocation.
export * as universalAdapter from "./universal/adapter.js";
export * as lineageSeed from "./lineage_seed.js";
export * as inbox from "./inbox.js";
export * as antivirus from "./antivirus/index.js";
export * as whatsNew from "./whats_new.js";
export * as retrievalLab from "./retrieval_lab/index.js";
export * as graphrag from "./graphrag/index.js";
export * as ingest from "./ingest/index.js";
export * as pulse from "./pulse.js";
export * as notifier from "./notifier/index.js";
export * as agent from "./agent/index.js";
export * as selfcheck from "./selfcheck/index.js";
export * as integrations from "./integrations/index.js";
export * as oracle from "./oracle/index.js";
export * as evolve from "./evolve/index.js";
export * as hci from "./hci.js";
export * as stigmergy from "./stigmergy/index.js";
export * as chimera from "./chimera/index.js";
export * as quantum from "./quantum.js";
