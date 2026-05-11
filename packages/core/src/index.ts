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
