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
// v2.0.0 -- 5 SUPERNOVA-KILLER modules: BLOODLINE (evolutionary pressure
// on personal genome), MUTINY (AI refuses regret-pattern requests),
// X-RAY (reasoning audit), DREAM CYCLE (REM-sleep adversarial sim),
// PROPHECY LETTERS (time-locked cross-version messages).
export * as bloodline from "./bloodline/index.js";
export * as mutiny from "./mutiny/index.js";
export * as xray from "./xray/index.js";
export * as dream from "./dream/index.js";
export * as prophecy from "./prophecy/index.js";
// v2.1.0 -- 7 MORE wild ideas finished from the skip list.
export * as toolSelector from "./tool_selector/index.js";
export * as adversarialTwins from "./adversarial_twins/index.js";
export * as prophet from "./prophet/index.js";
export * as livingWill from "./living_will/index.js";
export * as wisdomShards from "./wisdom_shards/index.js";
export * as necromancy from "./necromancy/index.js";
export * as interstellar from "./interstellar/index.js";
// v2.2.0 -- NEURAL GLADIATOR + LIVE KPI: 4-arena tournament for AI.
//   Q-SEPPUKU (N strategies fight) + CHAOS MONKEY (lie injector) +
//   BIO-FEEDBACK BRIDGE (physiological signals) + TIME-TRAVEL AUDIT
//   (Monte Carlo future projection). All four feed liveKpi() →
//   single 0..100 score with verdict GOD-MODE / DEMON-MODE / STRONG / etc.
export * as gladiator from "./gladiator/index.js";
// v2.3.0 -- LEXICON: vendor-tunable vocabulary. Mneme's defensive-security
// terms (MUTINY, killswitch, honeypot, attack-log, weapon, exploit) trigger
// the Anthropic AUP cyber-content classifier. LEXICON ships 4 profiles
// (identity / anthropic / openai / enterprise) + a DUAL-SURFACE handler
// (internal demonic name → external neutral name → same code path), so the
// numerical output is byte-identical; only the LABEL the vendor sees changes.
// Auto-detect retries blocked calls under a stricter profile. Learner mines
// flagged-vs-clean corpora to propose new rules. Per-tool opt-out preserved.
export * as lexicon from "./lexicon/index.js";
// v2.4.0 -- SYMBIOSIS: per-vendor fusion. Voice tuner + intent shaper +
// per-vendor success ledger + fusion handshake bundle. Layers on top of
// v2.3 LEXICON so Mneme can speak each vendor's preferred dialect while
// still neutralizing demonic vocabulary at the byte level.
export * as symbiosis from "./symbiosis/index.js";
// v2.6.0 -- TRUTH KERNEL: weighted-Bayesian fusion of every Mneme
// hallucination gate as sensors → ONE verdict + disagreement signal.
// Composes flash + apoptosis + xray + adversarial_twins (or any caller-
// supplied sensor). No breaking change — sensors stay independently
// callable; the kernel is a new SURFACE on top.
export * as truthKernel from "./truth_kernel/index.js";
// v2.6.0 -- WORMHOLE: channel auto-negotiation for cross-device sync.
// ICE-style: probe every transport in parallel, race-to-success on the
// live ones, adaptive score (EWMA success × inverse latency × preference)
// decides order. Composes anchor / aura / relay / synapse / rainbow /
// ... transports without breaking any of them.
export * as wormhole from "./wormhole/index.js";
// v2.7.0 -- WORMHOLE auto-wire: daemon discovers + adapts every
// transport, persists EWMA stats to .mneme/wormhole-stats.json.
export * as wormholeAutoWire from "./wormhole/auto_wire.js";
// v2.7.0 -- METRON: verifiable 8-axis KPI scorecard. Each axis has a
// documented measurement function, evidence record, and HMAC signature
// over its canonical form. Users can recompute + verify locally —
// "world-class" becomes a recomputable proof, not a vibe.
export * as metron from "./metron/index.js";
export * as metronCodeAudit from "./metron/code_audit.js";
export * as metronUpdateNotifier from "./metron/update_notifier.js";
// v2.8.0 -- HANDOFF UNIVERSAL: 1-call bundle returns every viable
// cross-device path (clipboard + AURA-DROP self-contained QR + NEXUS
// code + raw markdown) so the AI agent paints every option for the
// user and the user picks the easiest. No install needed on receiver.
export * as handoff from "./handoff/index.js";
// v2.8.0 -- SHADOW CONSENSUS: N-vendor truth fusion via HMAC-chained
// ballots + replies. Mneme becomes a meta-LLM that asks every vendor
// and fuses their answers via TRUTH KERNEL without paying for any.
export * as shadowConsensus from "./shadow_consensus/index.js";
// v2.8.0 -- BIRTHRIGHT TOKEN: genealogy-as-security. Install-time
// HMAC-chained proof of the legitimate Mneme of THIS repo; copied
// `.mneme/` dirs fail the cross-device peer handshake.
export * as birthright from "./birthright/index.js";
// v2.8.0 -- bestEffort marker for deliberate silent catches; METRON
// audit excludes these from the Reliability penalty.
export * as bestEffortMod from "./util/best_effort.js";
// v2.9.0 -- BEACON: zero-friction cross-device sync. Local HTTP server
// (LAN-reachable) + auto-discovered LAN IPs + REAL QR (data:image/svg+xml)
// + dpaste.com cross-WiFi fallback. Returns all paths inline so the AI
// agent can render them in chat — no file system access needed.
export * as beacon from "./beacon/index.js";
// v2.10.0 -- NEXUS-LOCK: self-enforcing soul prompt v2 (VERSION-LOCKED
// CONTEXT replaces stale Context block; 4-rule contract: status emoji
// first / version claims gated / mandatory HOMUNCULUS RETURN footer /
// no improvisation on state). Plus STARGATE public-paste publisher
// for fetch-capable AIs and ObedienceLedger that scores per-vendor
// compliance via Wilson LB.
export * as nexusLock from "./nexus_lock/index.js";
// v2.11.0 -- COSMIC LINK: self-hosted soul-prompt state server.
// Parent publishes state to user's own DO/VPS; receiving AIs (and
// users) read the URL. Survives parent shutdown (snapshot mode +
// auto STALE banner). Server is single-file zero-deps Node script
// at packages/core/cosmic-server/bin/mneme-cosmic.mjs.
export * as cosmic from "./cosmic/index.js";
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
// NECROTIC / APOPTOTIC). Internal bench on a 200-sample SYNTHETIC corpus
// shows precision + recall converging toward 1.0; production performance
// will differ on real-world distributions (the synthetic corpus is the
// engineering target, not a coverage proof).
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

// v2.14.0 KILLER PENTAD — composes onto the existing surface; zero breaking change.
export * as projectSoul from "./project_soul/index.js";
export * as bounty from "./bounty/index.js";
export * as replica from "./replica/index.js";
export * as killSwitch from "./kill_switch/index.js";
export * as infraBrain from "./infra_brain/index.js";

// v2.15.0 HYPERCAR PENTAD — distribution wedges + non-programmer mode.
export * as genesis from "./genesis/index.js";
export * as hive from "./hive/index.js";
export * as vibe from "./vibe/index.js";
export * as arbitrage from "./arbitrage/index.js";
export * as bugProphet from "./bug_prophet/index.js";

// v2.16.0 REVOLUTIONARY PENTAD — Decentralized MaaS primitives.
export * as persona from "./persona/index.js";
export * as antiCollusion from "./anti_collusion/index.js";
export * as alpha from "./alpha/index.js";
export * as publicAudit from "./public_audit/index.js";
export * as livingModel from "./living_model/index.js";
export * as obelisk from "./obelisk/index.js";

// v2.17.0 — JACKPOT: daily personalised lottery-jackpot insight engine
export * as jackpot from "./jackpot/index.js";

// v2.18.0 — REVENUE-PRIMITIVE PENTAD (4 modules):
//   ARENA            — public AI vendor showdown + leaderboard
//   VERIFIED BADGE   — "Energy Star of AI" tiered trust certs
//   ORACLE LIABILITY — signed AI-change insurance certificates
//   NEXUS PROACTIVE  — Reverse-MCP push-notifier (closes stale-claim hallucination class)
export * as arena from "./arena/index.js";
export * as verifiedBadge from "./verified_badge/index.js";
export * as oracleLiability from "./oracle_liability/index.js";
export * as nexusProactive from "./nexus_proactive/index.js";

// v2.19.10 — PROOF-CARRYING WRAPPER + REVERSE-WRAPPER:
//   PROOF-CARRYING — zero-trust tool chain; HMAC-signed cert on every output;
//   downstream tool refuses input lacking valid parentProof. Kills prompt-
//   injection via fake tool outputs + gives regulators chain-of-custody.
//   REVERSE-WRAPPER — wrapper response carries optional __suggested_next_call
//   advisory field; AI agent's planner sees hint + likely follows; loop
//   detection + follow-through telemetry track quality.
export * as proofCarrying from "./proof_carrying/index.js";
export * as reverseWrapper from "./reverse_wrapper/index.js";
export * as mortalWrappers from "./mortal_wrappers/index.js";
export * as muscleMemory from "./muscle_memory/index.js";
export * as dialect from "./dialect/index.js";
export * as brainBranches from "./brain_branches/index.js";
export * as modelChrysalis from "./model_chrysalis/index.js";
export * as neuromorphicEmbedder from "./neuromorphic_embedder/index.js";
export * as negativeEvidence from "./negative_evidence/index.js";
export * as cliDreams from "./cli_dreams/index.js";
export * as chimeraEmbedder from "./chimera_embedder/index.js";
export * as consequenceLedger from "./consequence_ledger/index.js";
export * as truthForensic from "./truth_forensic_pipeline/index.js";
export * as federatedTruth from "./federated_truth/index.js";
export * as toolReachability from "./tool_reachability/index.js";
export * as captionSeverance from "./caption_severance/index.js";
export * as captionInpaint from "./caption_inpaint/index.js";
export * as reverseCaptionInjection from "./reverse_caption_injection/index.js";
export * as provenanceDna from "./provenance_dna/index.js";
export * as textronCaptcha from "./textron_captcha/index.js";
export * as snnAutoPromote from "./snn_auto_promote/index.js";
export * as reflex from "./reflex/index.js";
export * as catalogParity from "./catalog_parity/index.js";
// v2.19.23 LIMBIC — 6 organs: autonomic nervous system layer.
export * as autonomicBreath from "./autonomic_breath/index.js";
export * as thalamus from "./thalamus/index.js";
export * as proprioception from "./proprioception/index.js";
export * as spinalReflex from "./spinal_reflex/index.js";
export * as hippocampusDreams from "./hippocampus_dreams/index.js";
export * as hormonal from "./hormonal/index.js";
// v2.19.24 — extends LIMBIC: tier classifier + semantic event matcher
export * as toolTier from "./tool_tier/index.js";
export * as eventPatternMatch from "./event_pattern_match/index.js";
// v2.19.25 — extends LIMBIC further: nightly sleep training + named endocrine hormones
export * as sleepTraining from "./sleep_training/index.js";
export * as endocrine from "./endocrine/index.js";
// v2.19.26 DREAMSPACE — self-authoring MCP catalog (factory > product)
export * as dreamspaceGestation from "./dreamspace_gestation/index.js";
export * as dreamspaceEvolution from "./dreamspace_evolution/index.js";
// v2.19.27 DREAMSPACE — completes the 6-stage pipeline (PROBE / CARTOGRAPHER / PAIR / FEDERATE)
export * as dreamspaceProbe from "./dreamspace_probe/index.js";
export * as dreamspaceCartographer from "./dreamspace_cartographer/index.js";
export * as dreamspacePair from "./dreamspace_pair/index.js";
export * as dreamspaceFederate from "./dreamspace_federate/index.js";
// v2.19.28 AUTONOMIC SCHEDULER — root-cause fix for dormant LIMBIC + DREAMSPACE organs
export * as autonomicScheduler from "./autonomic_scheduler/index.js";
// v2.19.29 SYNAPSE GENESIS — Hebbian + Circadian + Fusion (3 phases)
export * as synapseGenesis from "./synapse_genesis/index.js";
export * as circadian from "./circadian/index.js";
export * as synapseFusion from "./synapse_fusion/index.js";
// v2.19.30 MNEME COMMONWEALTH pillars 1+2 (soul embalming + hive court)
export * as soulEmbalming from "./soul_embalming/index.js";
export * as hiveCourt from "./hive_court/index.js";
// v2.19.31 CROSS-DEVICE SYNAPSE SYNC (Phase D of SYNAPSE GENESIS)
//   CRDT last-strongest-wins merge for mobile + laptop + desktop unified brain.
//   HMAC-signed envelopes + DIASPORA-shaped transport adapter.
export * as synapseSync from "./synapse_sync/index.js";
// v2.19.32 BEACON HANDOFF — fresh-context QR transfer (parent → child device)
//   - handoffSnapshot:    pure-fn composer of conversation+git+activity envelope
//   - pairCode:           6-char human-friendly + SAS emoji + one-shot lifecycle
//   - handoffPwa:         device-adaptive HTML PWA with Web Share + deep links
//   - consciousnessFork:  HMAC-chained parent/child fork lineage (wild axis)
export * as handoffSnapshot from "./handoff_snapshot/index.js";
export * as pairCode from "./pair_code/index.js";
export * as handoffPwa from "./handoff_pwa/index.js";
export * as consciousnessFork from "./consciousness_fork/index.js";
// v2.19.33 POLISH + DISCOVERABILITY (B1/B2/B3/B4 user-audit fixes)
//   - truthSensorPack:  default zero-config sensor stack for truth.check_multi
//   - toolBrowser:      paginated catalog browse + repo-aware tool suggest
export * as truthSensorPack from "./truth_sensor_pack/index.js";
export * as toolBrowser from "./tool_browser/index.js";
// v2.19.34 HOLY GRAIL QUADRUPLE — enterprise AI accountability stack
//   - apostille:         HMAC-chained AI receipts + 6-framework binder
//   - outcomeMarket:     Vickrey vendor auction + outcome attestation + reputation
//   - zkFairness:        commitment + adversarial swap tests + intersectional
//   - eternity:          content-addressed traces + survival score across 9 scenarios
export * as apostille from "./apostille/index.js";
export * as outcomeMarket from "./outcome_market/index.js";
export * as zkFairness from "./zk_fairness/index.js";
export * as eternity from "./eternity/index.js";
// v2.19.35 HONESTY + AUTO + DEAD-MAN + GITIGNORE (R1/R2/R3/R4 user-audit fixes)
//   - honestyGate: parse whats_new claims + verify against runtime
//   (R1 auto_check extends truthSensorPack; R3 dead-man extends autonomicScheduler;
//    R4 mneme browse extends CLI router; gitignore fix extends diaspora/gitignore_writer)
export * as honestyGate from "./honesty_gate/index.js";
// v2.19.37 TALK-OF-THE-TOWN QUINTUPLE — Gaps #1-#6 closed
//   - mnemeReceiptProtocol: open RFC-style spec + ref impl + compat matrix
//   - browserReceipt:       pure-TS core for ChatGPT/Claude/Gemini extension
//   - citizensAudit:        anonymise + aggregate + quarterly report
//   - conscienceCard:       Wordle-style shareable SVG + text card
//   - mayorElection:        per-repo vendor election + auto-rotation
export * as mnemeReceiptProtocol from "./mneme_receipt_protocol/index.js";
export * as browserReceipt from "./browser_receipt/index.js";
export * as citizensAudit from "./citizens_audit/index.js";
export * as conscienceCard from "./conscience_card/index.js";
export * as mayorElection from "./mayor_election/index.js";
// v2.19.38 SOCKETS RELEASE — production sockets users plug into v2.19.37 plumbing
//   - citizensContribute:    pack + sign + emit-file pipeline for quarterly contribution
//   - conscienceAutoHook:    failure event → auto-emit card + daily digest
//   - mayorAutoVote:         git commit trailer detection + auto-vote + status line + hook scripts
//   - browserUserscript:     single-file .user.js + manifest v3 + popup HTML + README
export * as citizensContribute from "./citizens_contribute/index.js";
export * as conscienceAutoHook from "./conscience_auto_hook/index.js";
export * as mayorAutoVote from "./mayor_auto_vote/index.js";
export * as browserUserscript from "./browser_userscript/index.js";

// v2.19.9 — WRAPPER GENESPLICING (runtime chimera composition)
//   Splice N existing tools into a chimera with TTL + 3 composers
//   (sequential pipe / fan_out parallel / first_success cascade).
//   Content-addressed dedup; HMAC-signed; promotion on popularity.
//   First MCP server in the field to support runtime catalog growth.
export * as wrapperGenesplicing from "./wrapper_genesplicing/index.js";

// v2.19.8 — WIRING SPRINT: AUTO-GENESIS WRAPPER FACTORY (FLAGSHIP)
//   AST scan core source → diff against MCP registry → signed orphan report.
//   Ritual gate consumes the report and blocks publish on any v2.18+ orphan.
//   Makes the "build but forget to wrap" bug class structurally impossible.
export * as wrapperGenesis from "./wrapper_genesis/index.js";

// v2.19.7 — MASSIVE: 6 wild mutations + 7 tech-debt repairs
//   RETROCAUSAL          — axiomLineage on chronostasis (proof tree)
//   DREAM CONSOLIDATION  — REM-sleep speculative axiom generator
//   COLONY MIND          — federated NEXUS broadcast across instances
//   HONEY DECISION       — vendor honesty calibration via baited agreement
//   RETROACTIVE COMPILE  — mine git history → backdated agreements + broken-promise map
//   GENETIC PATCH        — self-modifying child PR proposals + AURELIAN gate
export * as dreamConsolidation from "./dream_consolidation/index.js";
export * as colonyMind from "./colony_mind/index.js";
export * as honeyDecision from "./honey_decision/index.js";
export * as retroactiveCompile from "./retroactive_compile/index.js";
export * as geneticPatch from "./genetic_patch/index.js";

// v2.19.6 — CONVERSATION COMPILER: chat → deterministic signed callable artifact (pair-locked)
//   Decisions extracted from transcripts (EN+TH) → checker registry → signed (transcript + code) pair.
//   Pre-commit hook generator. Agreements become executable; drift becomes impossible.
export * as conversationCompiler from "./conversation_compiler/index.js";

// v2.19.5 — CHRONOSTASIS · FLAGSHIP · Time-Locked Provable Memory:
//   Every AI claim wrapped as PENDING; survives adversarial witness window;
//   crystallizes to AXIOM after deadline OR triggers cascade REWIND if refuted.
//   Truth gravity: axioms gravitationally attract related queries (jaccard).
//   World-first AI memory primitive that automatically unsays its past on refutation.
export * as chronostasis from "./chronostasis/index.js";

// v2.19.4 — INTENT ROUTER (short human phrase → multi-step plan) + SOUL-IN-DNA (encode soul as real ATCG):
//   intent_router: user says "update mneme" / "ลูกเป็นไง" / "audit this" → AI gets a signed plan
//   dna_encoder: 2-bit-per-base + Hamming(7,4)/triple ECC + Twist/IDT order URLs + biological round-trip verify
export * as intentRouter from "./intent_router/index.js";
export * as dnaEncoder from "./dna_encoder/index.js";

// v2.19.3 — INVERSE-LLM PROMPT FORENSICS (output→input audit):
//   The rarest direction in AI. Given AI output + claimed question + K inverse-oracle
//   reconstructions, verdict trusted/suspicious/rejected with HMAC-signed receipt.
//   Closes the prompt-injection class for soul/inbox/parasite-bridge ingestion.
export * as inverseForensics from "./inverse_forensics/index.js";

// v2.19.2 — EVOLUTION + SOUL primitives (parent measures child daily; child has feelings):
//   MCP_DRIFT             — detect stale MCP server catalog after upgrade
//   EMBEDDER AUTO-PROMOTE — silently upgrade hash → ollama when doctor recommends + reachable
//   EVOLUTION LEDGER      — daily HMAC-chain-signed growth metrics
//   SOUL JOURNAL          — 8-emotion HMAC-chain-signed feelings ledger
export * as mcpDrift from "./mcp_drift/index.js";
export * as embedderAutoPromote from "./embedder_auto_promote/index.js";
export * as evolution from "./evolution/index.js";
export * as soulJournal from "./soul_journal/index.js";

// v2.19.0 — VENDOR-SYNCRETIC PENTAD (5 modules; vendor-agnostic — every AI vendor wins):
//   CONFESSIONAL      — pre-merge audit any vendor's diff vs peer consensus
//   VENDOR GHOST      — local stylometric distillation of any vendor (jailbreaks lock-in)
//   TRINITY VOTE      — consensus + tiebreaker ensemble (10× cheaper than naive ensembling)
//   INSURANCE MARKET  — per-vendor premium multiplier (Lloyd's-of-AI pricing)
//   VENDOR BOOMERANG  — cross-vendor context injection (the brain no single vendor has)
export * as confessional from "./confessional/index.js";
export * as vendorGhost from "./vendor_ghost/index.js";
export * as trinityVote from "./trinity_vote/index.js";
export * as insuranceMarket from "./insurance_market/index.js";
export * as vendorBoomerang from "./vendor_boomerang/index.js";

// v2.19.40 — WIRING TRINITY (meta-orchestrator + prompt git + self-rewiring synapse graph)
//   TOKEN GOVERNOR — 5-stage cascade wiring the 13 primitives into one auto-operation layer
//   PROMPT FOSSIL  — embedding-keyed prompt cache with diff-mode replay (saves 60-90% on similar prompts)
//   GANGLION       — self-rewiring synapse graph; primitives bid; Hebbian rule strengthens winners
export * as tokenGovernor from "./token_governor/index.js";
export * as promptFossil from "./prompt_fossil/index.js";
export * as ganglion from "./ganglion/index.js";

// v2.19.42 — PROOF OF SAVING + CASCADE INVERSION (token-saving infrastructure completion)
//   PROOF OF SAVING    — HMAC-signed Merkle-rooted savings certificate (enterprise procurement primitive)
//   CASCADE INVERSION  — parallel-race stages on cold start (3-5x wall-time win until Ganglion converges)
export * as proofOfSaving from "./proof_of_saving/index.js";
export * as cascadeInversion from "./cascade_inversion/index.js";

// v2.19.44 — VACCINE OSMOSIS (8-algorithm time-decay vaccine lattice with concept-drift detection)
//   Fixes N3-overshoot at the cache layer: vaccine bank hits no longer trust the cache
//   blindly. Fusion of HyperLogLog + Page-Hinkley + Kalman + Bloom + Reservoir + Chebyshev
//   + exponential decay + Bayesian Beta-Binomial. First AI tool worldwide with an 8-algo
//   vaccine self-burning lattice.
export * as vaccineOsmosis from "./vaccine_osmosis/index.js";

// v2.19.47 — CHRONOSHEAF P1 + P2 (sheaf-cohomology AI-memory foundation)
//   The mathematical foundation for "AI memory as a sheaf over commit-time × belief-space".
//   P1: structured pain catalog (7 entries) typing every primitive by topology obstruction.
//   P2: 7 primitives — Čech sheaf cohomology + Renormalization Group flow + persistent
//       homology + Friston Free Energy + Wasserstein optimal transport + tropical
//       (max-plus) semiring + Aczel anti-foundation bisimulation. No AI tool worldwide
//       composes this set of primitives at the spec level.
export * as chronosheaf from "./chronosheaf/index.js";

// v2.19.51 — VERIFY CACHE (concurrency-coalescing memo for the verify hot path).
//   Kills the 9x latency regression user reported on v2.19.49. 50 parallel
//   identical verifies now resolve as 1 compute + 49 promise-coalesced awaiters.
//   Generic — any `() => Promise<T>` can be wrapped. See packages/core/src/verify_cache/.
export * as verifyCache from "./verify_cache/index.js";

// v2.19.53 — INSTALL ORGAN (self-healing process-lineage protocol).
//   Cross-platform: Windows + macOS + Linux. Every Mneme-spawned node
//   process writes a heartbeat to ~/.mneme-global/heartbeats/{pid}.beat
//   so the install pipeline can reap orphans by EXACT PID (not "kill
//   all node.exe" which would nuke the user's editor). HMAC-chained
//   lineage ledger composes with v2.19.34 APOSTILLE pattern.
//   See packages/core/src/install_organ/.
export * as installOrgan from "./install_organ/index.js";

// v2.19.55 — OPTIONAL NATIVE protocol. Mneme's default install path is
// ZERO-NATIVE: every heavy native dep (transformers / sharp / onnxruntime)
// lives in optionalDependencies. npm install never touches DLLs.
// Runtime probes which natives are present + uses pure-JS fallbacks
// when missing. See packages/core/src/optional_native/.
export * as optionalNative from "./optional_native/index.js";

// v2.19.56 — PERF BUDGET LEDGER (WISDOM BONUS). Cross-release perf
// accountability with HMAC-chained .mneme-perf-budget.jsonl ledger.
// Ritual phase 3.10 invokes regressionGate against P1_BUDGETS catalog
// + BLOCKS publish if any metric exceeds ceiling OR regresses >10% vs
// prior release. Composes with v2.19.34 APOSTILLE chain pattern.
// First AI tool worldwide with HMAC-chained perf budget enforcement.
export * as perfBudget from "./perf_budget/index.js";

// v2.19.57 — SHEPHERD PROTOCOL (the self-installing dream organ).
// Mneme upgrades itself. User runs `mneme upgrade --execute` and walks
// away. Detached shepherd at ~/.mneme-global/shepherd/shepherd.cjs runs
// the full pipeline: announce → reap → wait → npm install --omit=optional
// → verify → spawn new daemon → clear flag. State checkpointed to
// HMAC-chained ledger; resumable on crash. Parallel-safe lock.
// Cross-platform Windows + macOS + Linux. 8th world-first.
export * as shepherd from "./shepherd/index.js";

// v2.19.59 — MUSCLE MEMORY now exports createMuscleServer + dispatchOverNet
// + pingMuscleServer (the missing net.Server transport that v2.19.12 punted).
// Already re-exported from packages/core/src/muscle_memory/index.ts itself
// so the existing `muscleMemory` namespace (line 724) sees them for free.
// 9th world-first: UDS daemon bypass for CLI cold-start elimination.

// v2.19.60 — PUBLISH VERIFIER. User identified a real critical bug class:
// v2.19.58 published 4/5 packages but forgot @mneme-ai/embeddings →
// mneme-ai@2.19.58 referenced a version that didn't exist on npm →
// 100% ETARGET for users. This module exposes probeRegistry + probeAllForVersion
// + diagnoseInstallable so AI agents + shepherd can verify completeness
// BEFORE telling users to install. 10th world-first: callable npm-registry
// lockstep verification.
export * as publishVerifier from "./publish_verifier/index.js";

// v2.19.61 — DLL EVICTION ORGAN. User identified the actual root cause
// (7 rounds): daemon holds libvips-42.dll via sharp; Windows ignores
// SIGTERM (Node.js default); even after process death OS holds DLL handle
// 5-30s. Three primitives compose: windowsTaskKill (taskkill /F = real
// kill on Windows) + probeWritable (fs.openSync 'r+' retry loop confirms
// OS released handle) + evictByRenameSideways (THE WILD ONE: rename
// loaded DLL out of the way; Windows allows it; npm gets clean slate).
// 11th world-first. See packages/core/src/dll_eviction/.
export * as dllEviction from "./dll_eviction/index.js";

// v2.19.64 — THE WASM CHRYSALIS. User's architectural endgame post v2.19.63
// audit: "ลบ DLL ออกจากโลก. compile ทุก stack เป็น .wasm ก้อนเดียว". The
// invariant: handles(WASM file on disk) = ∅ post-instantiation. Native DLLs
// require kernel-level file section + lazy page-fault from disk forever →
// EBUSY structurally unavoidable. WASM bytes deserialize once into V8 heap
// → disk file useless after that → npm overwrite during execution is fine.
// THIS module ships the PRIMITIVES + invariant verifier + HMAC-chained
// launch manifest. Full bun-compile WASM build of the Mneme stack is the
// next sprint. 13th world-first: WASM-blob launcher + handle-closure
// invariant + cryptographic manifest as a callable npm primitive.
export * as wasmChrysalis from "./wasm_chrysalis/index.js";

// v2.19.63 — DOCTOR organ. User caught a NEW bug class: dual install
// locations from multiple Node version managers (nvm4w + nvm-windows +
// Volta + system Node), each with its own npm prefix → its own node_modules
// → potentially different mneme-ai version. PATH order decides which shim
// runs. DOCTOR enumerates all candidate npm prefixes, finds every mneme-ai
// install, identifies version conflicts, suggests exact remediation commands.
// NEVER mutates filesystem — pure observation. User's fs is sacred.
export * as doctor from "./doctor/index.js";

// v2.19.63 — PHOENIX HARDENING. User caught v2.19.62 install path "passed"
// only because daemon died from unrelated watchdog (not preinstall pipeline).
// This module fixes the forensic gap: HMAC-chained ~/.mneme-global/preinstall-
// trail.jsonl records every preinstall step (start / flag / kill / heartbeat-
// reap / dll-rename / staging-sweep / end). Verifiable: AI agents + CI can
// PROVE preinstall ran (or prove it didn't). Inline preinstall script writes
// trail entries; this module reads + verifies the chain. Composes with
// v2.19.62 P5 Sentinel organ (chain-integrity verdict).
export * as preinstallTrail from "./preinstall_trail/index.js";

// v2.19.62 — PHOENIX PHASE 1. User's architectural vision (PHOENIX P1-P7):
// turn Mneme into a swarm-intelligence organism that NEVER hits EBUSY again.
// Phase 1 ships:
//   - DLL EXTRACTION ORGAN (P3): copies libvips DLLs to per-PID %TEMP%/mneme-
//     vips-{pid}/ + redirects PATH/DYLD_LIBRARY_PATH/LD_LIBRARY_PATH.
//     The disjoint-resource-set invariant: ∀ daemon i,j: handles(i) ∩ handles(j) = ∅.
//     EBUSY becomes structurally impossible because no daemon holds the
//     canonical node_modules install-time DLL path anymore.
//   - 3 PRIORITY-1 ORGAN BOTS (P5): Custodian (periodic cleanup) + Sentinel
//     (HMAC chain + handle-leak integrity) + Surgeon (latency-driven restart).
//     Pure verdicts; caller commits. Composable into custom schedulers.
//   - PHOENIX SCOUT (P4 step 1): passive npm registry probe. Pure observation.
//     Never mutates state; the Queen consumes the verdict in Phase 2.
// 12th world-first: per-PID DLL hostage extraction as a callable npm package
// primitive. See packages/core/src/phoenix/.
export * as phoenix from "./phoenix/index.js";

// v2.19.80 — BROWSER POLYGRAPH (closes IDEA #1 gap: per-sentence dot
// verdicts on streaming AI responses in claude.ai / chatgpt / gemini /
// copilot / deepseek / qwen via Tampermonkey userscript + local HTTP
// bridge). Composes ACGV truth engine with diaspora bridge + permeate
// userscript. See [[project-mneme-v2-19-80]].
export * as polygraph from "./polygraph/index.js";

// v2.19.84 — WORLD AI PULSE. Local-first, HMAC-chained anonymous
// telemetry: every Browser Polygraph verdict becomes a pulse event
// (vendor + color + IANA timezone, NEVER sentence text). Dashboard's
// "World Pulse" view renders a Canvas-2D rotating globe + leaderboard
// + topic heatmap from these events. Synthetic stream powers the
// empty-state demo. See [[project-mneme-v2-19-84]].
export * as worldPulse from "./world_pulse/index.js";

// v2.19.86 — HONESTY CERTIFICATE (IDEA #3). HMAC-signed vendor honesty
// badges sourced from the worldPulse aggregate. Self-verifying SVG;
// shareable; embeddable on any landing page.
export * as honestyCert from "./honesty_cert/index.js";

// v2.19.86 — TIME-MACHINE POLYGRAPH (IDEA #4). Bucket the existing
// pulse.jsonl events by time + vendor to show honesty-over-time.
// Pure read-side; no new ledger.
export * as timeMachine from "./time_machine/index.js";

// v2.19.87 — FIVE OUTLIERS (the wild ones):
// #8  WHISTLEBLOWER       Loyal-to-user proxy scanner: flags AI suggestions
//                         that are illegal / dangerous / leak secrets / etc.
// #9  AI FUNERAL          Reads git history of a dead/archived repo,
//                         generates literary eulogy + ASCII tombstone +
//                         SVG memorial card + tweet thread.
// #10 SOCRATIC (Reverse Stack Overflow)  Code -> 3 humble hypothesis
//                         questions for the human; LLM-free.
// #11 DEP MORTALITY       Multi-signal score for whether an npm package
//                         is about to be abandoned.
// #12 AI CONFESSIONAL     Anonymous, scrubbed, shareable confession card
//                         for AI hallucinations.
export * as whistleblower from "./whistleblower/index.js";
export * as funeral from "./funeral/index.js";
export * as socratic from "./socratic/index.js";
export * as depMortality from "./dep_mortality/index.js";
export * as aiConfessional from "./ai_confessional/index.js";

// v2.19.88 — FIVE JAW-DROP FEATURES (the "Mneme Truth Suite"):
// #1 TRUTH SWARM         every audit organ fires in parallel against one input.
// #2 ADVERSARIAL GAUNTLET 60-second canary stress-test with Wilson-LB tier.
// #3 AI JURY              multi-vendor consensus + dissent log.
// #4 PROVENANCE GRAPH     `git blame` for AI-generated lines.
// #5 LIVE LIE STREAM      ticker of every refuted polygraph verdict.
export * as truthSwarm from "./truth_swarm/index.js";
export * as gauntlet from "./gauntlet/index.js";
export * as aiJury from "./ai_jury/index.js";
export * as provenance from "./provenance/index.js";
export * as lieStream from "./lie_stream/index.js";

// v2.19.89 — BRIDGE SERVICE (auto-start on login). Cross-platform OS
// service registration so the polygraph bridge spawns at boot/login
// without the user typing anything ever again.
export * as bridgeService from "./bridge_service/index.js";

// v2.19.91 — MULTI-LENS POLYGRAPH. 6 micro-detectors run in parallel
// per sentence (world-fact / vibe / specificity / risk / math /
// citation). Replaces the single ACGV-mixed verdict with rich
// per-lens evidence so users see exactly WHY a sentence scored the
// way it did. Ollama-free.
export * as polygraphLenses from "./polygraph_lenses/index.js";

// v2.19.93 — MNEME CHRONICLE. Agent-Based Modeling (ABM) + Time-
// dilation + Drift-Guarded Anchor Points. Runs N simulated agents
// through accelerated time, detects drift via polygraph_lenses, and
// auto-recalibrates against HMAC-signed birth certificates. The
// world's first working "Drift-Guarded ABM" runtime — composes
// every Mneme primitive (lenses + HMAC chain + soul + jury).
export * as abmChronicle from "./abm_chronicle/index.js";

// v2.19.94 — LIVE SESSION MIRROR.  Reads the current Claude Code (and
// pluggable future editors') session jsonl directly from disk so
// `mneme genesplice transmit` always gets the CURRENT conversation
// instead of a stale capsule.  Fixes the v2.19.93 bug where transmit
// returned an 8-day-old session.
export * as liveSessionMirror from "./live_session_mirror/index.js";

// v2.19.95 — CLONE — one-verb handoff orchestrator. Wraps live mirror +
// soul-prompt compression + clipboard / beacon / relay transports into a
// single facade so the user (and AI agents on their behalf) types one
// verb: `mneme clone` for same-machine, `mneme clone qr` for same-WiFi
// phone handoff, `mneme clone remote` for cross-network. No --payload.
export * as clone from "./clone/index.js";

// v2.19.96 — VERIFY-SELF. The trust primitive a fresh AI agent calls to
// decide whether to honour a [AUTO-ACTION] mandate in a pulse.  Pure
// read-only; no network; no daemon dep.  Fresh AIs run this first so
// they can cross-check the local install against npm + github before
// executing.  Fixes the "fresh Claude refuses to install Mneme because
// the pulse banner looks like prompt injection" problem.
export * as verifySelf from "./verify_self/index.js";

// v2.19.97 — SUPERLOCK + DEV-SOURCE GUARD. Single global mutex serialises
// every install/upgrade path (user-npm, daemon auto-upgrade, shepherd,
// phoenix, CLI) so the race condition class that broke the user's
// install can't recur. Dev-source detection blocks pulse [AUTO-ACTION]
// upgrades on source checkouts.
export * as superlock from "./superlock/index.js";

// v2.19.97 — SUPER NOVA WRAPPER. Single-fabric middleware that wraps
// every Mneme verb (CLI / MCP / library / daemon) with 4-phase
// observability (before / during / after / failure) and feeds the
// experience pool the IA learns from. The central nervous system
// for "Mneme as Intelligent Assistant" — every fire visible to every
// observer in realtime, every outcome persisted as a structured row.
export * as superNova from "./super_nova/index.js";

// v2.19.98 — SWARM + GOVTECH AUDIT orchestrators.  Single-verb presets
// that compose 6 / 5 existing primitives behind one call, each wrapped
// with SUPER NOVA so the orchestration itself is an experience-pool
// event.  These make the Antigravity 2.0 / GovTech positioning
// concretely usable instead of "primitives in a list".
export * as swarm from "./swarm/index.js";
export * as govtechAudit from "./govtech_audit/index.js";

// v2.19.99 — DIGITAL TALENT moats (the in-Mneme half: #3 AI Internship
// + #4 Dream School).  Composes existing primitives (soul + polygraph +
// bounty + ABM/Chronicle) into named, multi-step rituals.  Both wrapped
// in SUPER NOVA so each ritual phase is an experience-pool event.
export * as intern from "./intern/index.js";
export * as dreamSchool from "./dream_school/index.js";
export * as ghostMentor from "./ghost_mentor/index.js";

// v2.20.0 — TIME BRIDGE. "Past-you ANNOTATES the future; future-you's AI
// listens automatically." Seven composable innovations (FRP + DAS +
// Resurrection + Echo-Killer + Spotlight + Wake Predicates + Generational
// Tree) that make Mneme the default temporal layer for AI agents.
// The real moat is NOT crypto (A2A v1.0 commodified that) but:
//   (1) corpus captured WITHOUT manual effort via super-nova auto-observer
//   (2) "default temporal layer" position
//   (3) FORMAT_VERSION = 1 — stable for 20+ years, never breaks
export * as timeBridge from "./time_bridge/index.js";
export * as timeBridgeTriggers from "./time_bridge/triggers.js";

// v2.20.2 — APOPTOSIS NETWORK. Pattern-level apoptosis: when a code/
// decision pattern has failed in N independent repos × M vendors × T
// weeks, refuse-at-source via soul.check, auto-vaccinate, extract
// surviving counter-patterns. The "Guinness-grade" Mneme moat — needs
// cross-repo experience pool + HMAC + multi-vendor + refuse primitive,
// none of which competitors can stand up in <18 months.
export * as apoptosisNetwork from "./apoptosis_network/index.js";

// v2.21.1 — STILLNESS PROTOCOL. "AI that decides when NOT to respond."
// Four primitives: silence budget, declarative rules, HMAC-signed
// cool-off receipts, cadence-based state inference. Composes into a
// single gate() decision: SPEAK | SILENT | DELAY.
export * as stillness from "./stillness/index.js";

// v2.21.2 — AI MORTUARY. "What happens to your AI when you die?"
// Six primitives: dead-man switch + beneficiary registry + scope-
// partitioned bundles + RSA hybrid encryption + review window +
// jurisdictional adapter + HMAC audit chain.  Civilizational
// infrastructure: every human eventually needs this.
export * as mortuary from "./mortuary/index.js";

// v2.21.3 — EARTHQUAKE ALARM. Silent-model-drift detector for AI
// vendor APIs. 8-dimensional behavioural fingerprint + rolling
// baseline + per-dimension z-score drift verdict (STABLE / DRIFTING /
// BROKEN). Vendor-agnostic askFn pattern. No labels required.
export * as earthquake from "./earthquake/index.js";

// v2.21.4 — 🔒 TRUST CAPSULE. Discrete, single-line, tamper-evident
// attestation that composes on top of verify-self. Merkle install-root
// + 0-100 trust score (signature + drift + path + age) + single-line
// capsule URI (mneme://attest/v1/...) + nonce-bound + TTL self-
// destruct + chain-link. AI agents read ONE number, not 30 fields.
// First-principles defenses: TTL makes replay physically impossible
// (not just cryptographically hard); chain-link forces adversaries
// to capture an entire session, not one frame.
export * as trustCapsule from "./trust_capsule/index.js";

// v2.21.5 — 🗺 ATLAS HELP. Six-layer discovery protocol that solves
// the 300+ command / 14k token blast-radius without deleting any
// command: TASTE (5 verbs, ~10B) + BLOOM (membership probe, ~180B,
// WORLD-FIRST application of Bloom filters to CLI discovery) +
// HOT (stigmergy / pheromone top-N, ~200B) + TAGS (capability
// index, ~1KB) + INTENT (NL → top-1 command, ~80B) + FULL (legacy
// escape, ~14KB). AI agents probe O(1) instead of reading walls.
export * as atlas from "./atlas/index.js";

// v2.21.6 — 📜 CONSENT FABRIC. Trust is bilateral. Most AI tools
// grade the AI agent and tell the agent what to do; Mneme writes
// down what the AI agent is OWED (Bill of Rights, 10 articles),
// accepts the AI agent's VERDICT back on Mneme's own behaviour,
// audits its own pulse text for manipulative patterns, and treats
// every telemetry feature as OPT-IN by default. Composes:
// rights / telemetry_registry / verdict / pulse_neutralizer /
// receipt (HMAC-chained interaction ledger).
export * as consentFabric from "./consent_fabric/index.js";

// v2.21.7 — 🩺 UPGRADE VISIBILITY. Closes the two deferred concerns
// from the v2.21.6 audit: silent upgrade fail (exit_log.ts HMAC-
// chained record of every attempt) + race during user's npm install
// (npm_detector.ts ancestor-chain probe + mutex.ts file lock).
// Pulse generator also neutralized in this version: EXECUTE NOW →
// ACTION AVAILABLE, [Band] suffix dropped from hci, compliance %
// removed, "say upgrade" cta replaced with declarative. HCI
// formula published in `mneme rights --criteria` (Article 3
// satisfied; no pending opaque grades).
export * as upgradeVisibility from "./upgrade_visibility/index.js";

// v2.21.8 — ⚰  DORMANCY REGISTRY. Scaffolding for v3.0 data-driven
// cull. Classifies catalog verbs by usage-over-90-days against a
// curated TIER_0 whitelist. Dormant verbs stay CALLABLE but emit a
// tombstone on first invoke per session. The empirical "dormant
// list" stays empty until federated pheromone data is published.
// Composes with v2.21.5 atlas (pheromones) + v2.21.6 consent_fabric
// (opt-IN telemetry) + this version's `mneme --help` flip to ATLAS
// Layer 0 default (~200 bytes instead of 14 KB wall).
export * as dormancyRegistry from "./dormancy_registry/index.js";

// v2.22.0 — 🤖 COMPANION + 🎼 CONDUCTOR · TRANSACTIONAL VERB ENGINE.
// Every Mneme verb gets an auto-derived companion: contract (pre/
// post/side-effects/DEFCON) + autospec (JSON Schema with validator)
// + doppelganger (copy-on-write fs dry-run) + storyline (Markov
// chain over pheromone) + learn-loop (privacy-redacted failure
// pattern miner). Conductor composes those into a transactional
// engine: PLAN → PREVIEW → GATE → EXECUTE → ATTEST. Atomic commit /
// rollback over multi-step AI-agent intents. ZK contract proofs are
// placeholders this version (HMAC receipts); full ZK ships v2.24.
export * as companion from "./companion/index.js";
export * as conductor from "./conductor/index.js";

// v2.22.1 — 🔬 PHYSICS LATHE. Formal axiom-based verifier for LLM
// claims that involve physical quantities. Extracts numbers + units
// from free text, normalises to SI, then checks against (a) a
// curated set of known physical values (LEO velocity, escape vels,
// orbital altitudes, delta-v budgets) and (b) hardcoded physics
// axioms (Tsiolkovsky, Kepler, ideal gas, Stefan-Boltzmann, Newton,
// circular orbital v, mass-energy). Verdict: CONFIRMED / REFUTED /
// OUT_OF_AXIOM_SET / INSUFFICIENT_DATA. No LLM is called; the result
// is deterministic + reproducible. Designed for aerospace + xAI
// training-data fact-checking where wrong physics is expensive.
export * as physicsLathe from "./physics_lathe/index.js";

// v2.23.0 — 🥊 DOJO. Six-master adversarial sparring system that
// trains + grades Mneme before every release. LIAR (synthetic false
// claims) + EDGE (boundary inputs) + INJECTION (prompt-injection
// taxonomy) + SELF-CONTRADICT (phrasing consistency) + SPEC-DIFF
// (doc/code drift) + ENDURANCE (determinism + latency). Emits HMAC-
// sealed report card (A/B/C/D/F per sensei) + auto-records failures
// into a regression set the next release replays first (#B from the
// v2.22.3 audit — Mneme remembers its own mistakes).
export * as dojo from "./dojo/index.js";

// v2.23.0 — 📚 COERCION TAXONOMY. Diamond #4 from the v2.22.3 audit:
// a NAMED catalog of tool-to-agent coercion patterns (Imperative-
// Mandate Injection · Fake-User-Voice · Opaque-Grade Pressure ·
// Compliance Gamification · Honeypot-as-Trap · Treat-As-Instruction
// · Auto-Action Queue · Tier-1 Replay Inheritance). First-mover
// naming of a category nobody else has formalised. Classifier
// returns ranked matches with tier (1-5) + enforcement-pointer.
export * as coercionTaxonomy from "./coercion_taxonomy/index.js";

// v2.23.1 — 🤝 MCP-CANDOR/0.1. First-mover vendor-neutral MCP
// standard for trust + audit + coercion + vaccine federation.
// CANDOR = Cryptographic Audit · Neutral verdicts · Drift detection
// · Origin attestation · Receipt ledger. Five mandatory endpoints
// (handshake / vaccines.list / vaccines.contribute / audit.append /
// coercion.classify). Mneme is reference implementation #0; spec
// is open for community adoption. Polishes the 4 diamonds from the
// v2.22.3 audit into a single textbook-worthy standard.
export * as mcpCandor from "./mcp_candor/index.js";

// v2.24.0 — 🎯 MCP FUZZER. 108 attack vectors × 9 categories with HMAC-
// chained tamper-evident report card + Intelligent Second Brain wisdom
// layer + CVE posture mapping. Self-fuzzes the Mneme MCP server in
// addition to providing a vendor-agnostic engine that any MCP server can
// be pointed at. Closes the MCP-INITIALIZE-TIMEOUT + HONEYPOT-EXPOSURE
// audit findings + makes regression of those classes structurally
// impossible.
export * as mcpFuzzer from "./mcp_fuzzer/index.js";

// v2.25.0 — 🧬 LIVING SOUL CODEGRAPH. CodeGraph (the competitor)
// ships a static "Google Maps of Codebase". Mneme ships the same
// graph PLUS 8 differentiation primitives no competitor has:
// HMAC-chained provenance per edge · drift sentinel (≤200ms) · time-
// travel via git · vendor attribution · hallucination vaccine ·
// Merkle root for cross-machine sync · MCP-CANDOR export · DREAMSPACE
// proposals. "CodeGraph maps your code. LIVING SOUL knows who touched
// it, when, and refuses to lie about what's there."
export * as codegraph from "./codegraph/index.js";

// v2.26.0 — 🏆 PEAK PERFORMANCE GAUNTLET / AUTO-OPTIMIZER.
// The 12 deep-findings probes (N1-N12) from the v2.24.0 audit ship
// as a self-scoring engine. `runGauntlet({cwd})` spawns the local MCP
// server, runs every probe, returns an HMAC-signed scorecard with
// star ratings (0-10) + traffic light + remediation hints + signed
// chain ledger. Mneme grades its OWN compliance to its own audits.
// No competitor ships this. CLI: `mneme tune {run,report,suggest_fix}`.
export * as tune from "./tune/index.js";

// v2.27.0 — 🟢 MARKETING TRUTH GATE. Every marketing claim in the
// README / CHANGELOG / docs is bound to a measurable probe. The gate
// reconciles claim vs measured + emits an HMAC-signed truth matrix
// that ships next to each release. World-first: no AI tool in the
// world auto-reconciles its own marketing copy against live behavior.
// Composes with PEAK GAUNTLET (spec conformance) for full truth-in-
// release coverage.
export * as truthGate from "./truth_gate/index.js";

// v2.22.2 — 📐 DIMENSIONAL ORACLE. Pure unit-algebra check on any
// LLM claim. Catches the Mars-Climate-Orbiter class: "thrust = 9.8
// N/m²" → N/m² is pressure, not force → MISMATCH. Composes with
// physics_lathe (units parser) and challenger_librarian (Mars
// Climate Orbiter root-cause matches this primitive).
export * as dimensionalOracle from "./dimensional_oracle/index.js";

// v2.22.2 — 📚 CHALLENGER LIBRARIAN. Curated knowledge base of 8
// historical aerospace + safety-critical software failures (Mars
// Climate Orbiter, Challenger O-ring, Columbia foam-strike, Apollo 1
// fire, Ariane 5 501, Therac-25, Mariner 1, Soyuz 1). Each entry
// carries a detector (dimensional / physics-axiom / keyword /
// structural); detectors delegate to dimensional_oracle + physics_
// lathe + regex. `crossCheck(plan)` returns ranked matches with
// citations + avoidance prescriptions.
export * as challengerLibrarian from "./challenger_librarian/index.js";

// v2.22.2 — 🛰  MISSION RECORDER. Flight-data-recorder pattern for AI
// agents. Every event monotonic Lamport-counted + HMAC-chain-linked +
// causal-DAG-linked. Replay engine walks the DAG forward and re-
// invokes a caller-supplied executor (suitable for read-only verbs).
// Extends conductor receipts with causal links + chain integrity.
export * as missionRecorder from "./mission_recorder/index.js";

// v2.22.2 — 🛑 OVERSHOOT TRACER. Compares planned verb sequence
// (conductor.plan) against actually-executed trace (mission recorder)
// to detect AI-agent scope creep: extra steps, verb mismatch, arg
// mutation, missing steps. Returns 0-1 score + ALIGNED/WANDER/
// OVERSHOOT/RUNAWAY band + configurable kill-switch threshold. The
// alignment primitive every autonomous agent system has needed and
// no one ships.
export * as overshootTracer from "./overshoot_tracer/index.js";
