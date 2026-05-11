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
