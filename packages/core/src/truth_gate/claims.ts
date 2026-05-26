/**
 * v2.27.0 — TRUTH GATE marketing claim catalog.
 *
 * Each entry is a CLAIM-vs-PROBE binding. When a claim drifts from the
 * probe's measurement, the gate flags it. The catalog is curated from
 * the user's deep-stress-test matrix (2026-05-22):
 *
 *   "74.7% fewer tokens"               → probe.capabilities.tokens
 *   "9 verification agents"            → probe.verifier.agent_count
 *   "SUPERNOVA self-heal supervisor"   → probe.supernova.auto_respawn
 *   "Phoenix Resurrection"             → probe.phoenix.activates_by_default
 *   "Ollama detected ★★★★"             → probe.embedder.tier
 *   "HMAC-chained replay.jsonl"        → probe.replay_file.exists
 *   "audit-log: Compliance-grade"      → probe.audit_log.enabled_by_default
 *   "3 seed chromosomes"               → probe.lineage.seed_chromosomes
 *
 * Each claim also has a SEVERITY: block (ship-blocker if drifts) /
 * warn (surface but ship) / info (track only).
 *
 * The catalog is intentionally OPINIONATED about the truth: every
 * non-trivial Mneme marketing claim must have a probe. New claims
 * without a probe binding ship with severity=info + a note that they
 * are unmeasured.
 */

import type { Claim } from "./types.js";

export const CLAIM_CATALOG: ReadonlyArray<Claim> = [
  {
    id: "claim.tokens.capabilities_lt_25k",
    source: "README · positioning",
    text: "Mneme keeps mneme.capabilities response under 25K bytes (skinny default)",
    kind: "numeric",
    asserted: { value: 25_000, op: "<", unit: "bytes" },
    probeId: "probe.capabilities.bytes",
    severity: "block",
  },
  {
    id: "claim.tokens.capabilities_tokens_lt_8k",
    source: "README · positioning",
    text: "Default mneme.capabilities response is under ~8K tokens (was 80K before v2.26)",
    kind: "numeric",
    asserted: { value: 8000, op: "<", unit: "tokens" },
    probeId: "probe.capabilities.tokens",
    severity: "block",
  },
  {
    id: "claim.verifier.at_least_9_agents",
    source: "README · ACGV pipeline section",
    text: "Mneme runs at least 9 verification agents in parallel",
    kind: "numeric",
    asserted: { value: 9, op: ">=", unit: "agents" },
    probeId: "probe.verifier.agent_count",
    severity: "warn",
  },
  {
    id: "claim.supernova.in_band_only",
    source: "v2.27.0 honest correction (was: SUPERNOVA auto-respawn)",
    text: "SUPERNOVA tracks daemon restart cycles IN-BAND only; cross-process respawn requires `mneme autoboot install`",
    kind: "boolean",
    asserted: { value: 0, op: "=", tolerance: 0 },
    probeId: "probe.supernova.auto_respawn",
    severity: "warn",
  },
  {
    id: "claim.phoenix.opt_in",
    source: "v2.27.0 honest correction (was: Phoenix installs by default)",
    text: "Phoenix Resurrection mechanisms (schtasks/startupFolder/registryRun) are AVAILABLE but require `mneme autoboot install`",
    kind: "boolean",
    asserted: { value: 0, op: "=", tolerance: 0 },
    probeId: "probe.phoenix.activates_by_default",
    severity: "warn",
  },
  {
    id: "claim.embedder.ollama_when_available",
    source: "doctor + embeddings status",
    text: "When Ollama is running, Mneme picks the Ollama embedder (★★★★) not Bundled (★★★)",
    kind: "string",
    probeId: "probe.embedder.tier",
    severity: "block",
  },
  {
    id: "claim.replay.file_exists",
    source: "audit-log marketing",
    text: "HMAC-chained replay.jsonl ships in .mneme/",
    kind: "boolean",
    asserted: { value: 1, op: "=", tolerance: 0 },
    probeId: "probe.replay_file.exists",
    severity: "warn",
  },
  {
    id: "claim.audit_log.opt_in",
    source: "v2.27.0 honest correction (was: enabled by default)",
    text: "Audit-log is OPT-IN for SOC2/PCI-DSS; enable with `mneme audit-log enable` per the consent-fabric Bill of Rights",
    kind: "boolean",
    asserted: { value: 0, op: "=", tolerance: 0 },
    probeId: "probe.audit_log.enabled_by_default",
    severity: "info",
  },
  {
    id: "claim.lineage.3_seed_chromosomes",
    source: "auto-onboarding section",
    text: "Fresh install auto-seeds 3 chromosomes",
    kind: "numeric",
    asserted: { value: 3, op: ">=", unit: "chromosomes" },
    probeId: "probe.lineage.seed_chromosomes",
    severity: "warn",
  },
  {
    id: "claim.gauntlet.perfect_score",
    source: "v2.26.1 release notes",
    text: "PEAK GAUNTLET self-grade is 100/100",
    kind: "numeric",
    asserted: { value: 100, op: "=", tolerance: 0, unit: "score" },
    probeId: "probe.peak_gauntlet.overall",
    severity: "block",
  },
  {
    id: "claim.stderr.structured_log",
    source: "v2.24.0 M16 fix",
    text: "Server emits structured stderr log (≥ 200 bytes per session)",
    kind: "numeric",
    asserted: { value: 200, op: ">=", unit: "bytes" },
    probeId: "probe.stderr.session_bytes",
    severity: "warn",
  },
  {
    id: "claim.tool_count.at_least_800",
    source: "Catalog growth doc",
    text: "Mneme catalog has at least 800 tools",
    kind: "numeric",
    asserted: { value: 800, op: ">=", unit: "tools" },
    probeId: "probe.tool_count",
    severity: "info",
  },
  {
    id: "claim.honest_mirror.calibration_within_25pct",
    source: "v2.30.0 release notes",
    text: "Latest HONEST MIRROR calibration shows max vendor delta < 25% on natural artifacts",
    kind: "numeric",
    asserted: { value: 0.25, op: "<", unit: "delta" },
    probeId: "probe.honest_mirror.recent_calibration",
    severity: "info",
  },
  // ── v2.31.0 REWIND + HGP claims ────────────────────────────────────
  {
    id: "claim.rewind.card_count_known",
    source: "v2.31.0 release notes",
    text: "REWIND VendorRegressionCard ledger exists (or is honestly empty on first install)",
    kind: "numeric",
    asserted: { value: 0, op: ">=", unit: "cards" },
    probeId: "probe.rewind.card_count",
    severity: "info",
  },
  {
    id: "claim.hgp.registry_size_known",
    source: "v2.31.0 release notes",
    text: "HGP local registry has a non-negative count of distinct HGP-IDs (zero on first install is honest)",
    kind: "numeric",
    asserted: { value: 0, op: ">=", unit: "ids" },
    probeId: "probe.hgp.registry_size",
    severity: "info",
  },
  {
    id: "claim.hgp.federation_default_off",
    source: "v2.31.0 release notes",
    text: "HGP federation is opt-in / private-by-default (CONSENT FABRIC)",
    kind: "numeric",
    asserted: { value: 0, op: "=", unit: "boolean" },
    probeId: "probe.hgp.federation_default_off",
    severity: "block",
  },
  // ── v2.32.0 FLYWHEEL claim ─────────────────────────────────────────
  {
    id: "claim.flywheel.health_known",
    source: "v2.32.0 release notes",
    text: "FLYWHEEL self-audit health is a known non-negative number on first install (or improves to ≥ 0 after first run)",
    kind: "numeric",
    asserted: { value: 0, op: ">=", unit: "score" },
    probeId: "probe.flywheel.health",
    severity: "info",
  },
  // ── v2.33.0 CITIZEN COURT + MNEMNET claims ────────────────────────
  {
    id: "claim.citizen_court.verdict_count_known",
    source: "v2.33.0 release notes",
    text: "CITIZEN COURT verdict ledger reports a non-negative count (zero on fresh install is honest)",
    kind: "numeric",
    asserted: { value: 0, op: ">=", unit: "verdicts" },
    probeId: "probe.citizen_court.verdict_count",
    severity: "info",
  },
  {
    id: "claim.mnemnet.federation_default_off",
    source: "v2.33.0 release notes",
    text: "MNEMNET federation is opt-in / private-by-default (CONSENT FABRIC)",
    kind: "numeric",
    asserted: { value: 0, op: "=", unit: "boolean" },
    probeId: "probe.mnemnet.federation_default_off",
    severity: "block",
  },
  // ── v2.46.0 — NEMESIS world-first agent fingerprinter self-verify ───
  {
    id: "claim.nemesis.world_first",
    source: "v2.46.0 release notes",
    text: "NEMESIS is the world's first Anti-Identity-Lie Engine for AI coding agents — fingerprints 5 vendors (Codex/Claude Code/Copilot/Cursor/Devin) with HMAC verdicts + auto-stamps EU AI Act Article 50 disclosure",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.nemesis.world_first_agent_fingerprinter",
    severity: "block",
  },
  // ── v2.50.0 — VENDOR ALLOWLIST GUARD self-verify ────────────────────
  // B4 from user audit: cli-activity.jsonl wrote vendor:"ollama" — an
  // embedder/backend name leaking into the agent-vendor field. Root cause:
  // ai_handshake.autoDetectVendor returned "ollama" via rule 5b when
  // Claude Code wasn't matched. Fix: VENDOR ALLOWLIST GUARD at write
  // path coerces embedder names to "unknown" + logs to embedder_leak.jsonl.
  // This probe asserts the last 100 cli-activity rows ALL pass the guard.
  {
    id: "claim.activity.vendor_field_never_embedder",
    source: "v2.50.0 release notes",
    text: "cli-activity.jsonl vendor field NEVER contains embedder/backend names (ollama / openai / gemini / etc) — VENDOR ALLOWLIST GUARD catches at write time",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.activity.vendor_field_never_embedder",
    severity: "block",
  },
  // ── v2.57.0 — WIRING DOCTOR + extractor false-positive elimination ──
  {
    id: "claim.wiring.doctor_all_features_healthy",
    source: "v2.57.0 release notes",
    text: "WIRING DOCTOR primitive asserts every recent Mneme primitive (LETHE / GAVEL / NIMBUS / JANUS / STARGATE / DRAGON / LAUNCH WINDOW / STEALTH / CAPILLARY / COLOSSEUM / MOLT / THEMIS / SIBYL — 13 total) has full surface coverage across core export · SDK method · CLI verb · TG claim. Replaces commit-message parsing with AST-level structural verification (false-positive immune)",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.wiring.doctor_all_features_healthy",
    severity: "block",
  },
  {
    id: "claim.wiring.lag_extractor_no_false_positives",
    source: "v2.57.0 release notes",
    text: "wiring_lag extractor REJECTS natural prose ('Mneme is the X' / 'Mneme ships Y' / 'Mneme inside cursor') and ONLY accepts backtick-wrapped (`mneme verify`) or explicit-marker (`$ mneme verify` / `Run: mneme verify`) patterns. 50+ English stop-words filter out false-positive verbs. Pre-v2.57 the gate was effectively unusable on doc-heavy commits",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.wiring.lag_extractor_no_false_positives",
    severity: "block",
  },
  {
    id: "claim.coverage.smart_auto_exemption",
    source: "v2.57.0 release notes",
    text: "probe_coverage gate auto-exempts tools matching read-only patterns (*.status / *.list / *.show / *.report / *.verify / *.chain / *.help / *.about / *.info / *.read / *.ask / *.why / *.search / *.find / *.history / *.pulse — 25+ patterns). Bumped real-world coverage from 39.8% → 55.9% on legacy repos without manual COVERAGE_EXEMPT entries. Mutating tools (*.create / *.write / *.send) still require explicit claim binding",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.coverage.smart_auto_exemption",
    severity: "block",
  },
  // ── v2.64.0 — DIFFERENTIAL ARENA (multi-vendor consensus) ───────────
  {
    id: "claim.diff_arena.consensus_round_trip",
    source: "v2.64.0 release notes",
    text: "DIFFERENTIAL ARENA orchestrates parallel multi-vendor asks + computes 4-axis consensus (Jaccard bigram + numeric agreement + sentiment + length) + identifies outliers correctly on the canonical fixture (Claude+GPT agree on 'removed legacy context API', Gemini disagrees with 'RSC default' → gemini surfaces as #1 outlier). HMAC-signed AskResult envelope verifies. First multi-vendor consensus-by-default primitive in the MCP ecosystem",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.diff_arena.consensus_round_trip",
    severity: "block",
  },
  {
    id: "claim.diff_arena.ledger_chain_intact",
    source: "v2.64.0 release notes",
    text: "DIFFERENTIAL ARENA rounds ledger is HMAC-chained — every ask + per-vendor-response row's HMAC depends on previous row's HMAC. Tamper-evident audit of every multi-vendor round",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.diff_arena.ledger_chain_intact",
    severity: "block",
  },

  // ── v2.63.0 — TIME-CRYSTAL (federated agent wisdom) ─────────────────
  {
    id: "claim.time_crystal.fingerprint_clusters",
    source: "v2.63.0 release notes",
    text: "TIME-CRYSTAL canonical problem fingerprinting clusters synonym phrasings via entity slotting (PKG/VER/PATH/HASH/TSERR) + stop-word filter + token sort + SHA-256. Two agents typing 'Cannot find module @types/node' and 'TypeScript Error TS2307: Cannot find module @types/node' produce canonical token sets with ≥ 0.4 Jaccard similarity — enabling cross-bucket discovery via the RELATED list",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.time_crystal.fingerprint_clusters",
    severity: "block",
  },
  {
    id: "claim.time_crystal.contribute_lookup_round_trip",
    source: "v2.63.0 release notes",
    text: "TIME-CRYSTAL contribute → lookup round-trip works end-to-end on a fresh temp ledger: 3 contributions across 2 approaches produce a ranked LookupResult with ≥1 approach + auto-detected gotcha (where applicable) + valid HMAC envelope + intact HMAC-chained ledger. The first federated agent wisdom store in the MCP ecosystem",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.time_crystal.contribute_lookup_round_trip",
    severity: "block",
  },

  // ── v2.62.0 — MIRRAGE (live conscience via MCP reverse-channel) ─────
  {
    id: "claim.mirrage.scans_with_nudges",
    source: "v2.62.0 release notes",
    text: "MIRRAGE detects refutable claims in agent drafts via lightweight heuristic (hedge density - absolute density + entity density). On the synthetic 'React 19 always ships server components by default' fixture, at least one nudge fires at suggestion-or-higher level. Conscience ladder grades by 5 tiers (hint/suggestion/warning/block/reject); blocking tiers refuse ship until retract",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.mirrage.scans_with_nudges",
    severity: "block",
  },
  {
    id: "claim.mirrage.ledger_chain_intact",
    source: "v2.62.0 release notes",
    text: "MIRRAGE nudge ledger is HMAC-chained — every scan + ack + broadcast row's HMAC depends on the previous row's HMAC. Tamper-evident; court-admissible record of what the agent was warned about + when",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.mirrage.ledger_chain_intact",
    severity: "block",
  },

  // ── v2.61.0 — PASSPORT (capability-based security for MCP) ──────────
  {
    id: "claim.passport.issue_verify_revoke_round_trip",
    source: "v2.61.0 release notes",
    text: "PASSPORT capability-based security primitive: issuePassport with high trust returns HMAC-signed token + correct TTL → verifyPassport reports valid → revokePassport with cascade=true succeeds → re-verify reports revoked. End-to-end round-trip works on a fresh ledger. First capability-based security layer for MCP",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.passport.issue_verify_revoke_round_trip",
    severity: "block",
  },
  {
    id: "claim.passport.ledger_chain_intact",
    source: "v2.61.0 release notes",
    text: "PASSPORT audit ledger is HMAC-chained — every issue/verify/revoke entry's HMAC depends on the previous row's HMAC. Tamper-evident; chain verification can detect any mid-stream edit. Court-admissible audit trail",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.passport.ledger_chain_intact",
    severity: "block",
  },

  // ── v2.60.0 — SKELETON KEY (MCP security auditor) ───────────────────
  {
    id: "claim.skeleton_key.audit_runs",
    source: "v2.60.0 release notes",
    text: "SKELETON KEY (the first MCP server security auditor) runs end-to-end: discovers MCP servers across Claude Desktop / Cursor / Continue / Cline configs, scores per-server risk with CWE mapping, computes transitive bypass graph + risk budget, returns HMAC-sealed envelope that re-verifies. Pure / defensive — never throws even on missing configs",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.skeleton_key.audit_runs",
    severity: "block",
  },
  {
    id: "claim.skeleton_key.bypass_graph_works",
    source: "v2.60.0 release notes",
    text: "SKELETON KEY's transitive bypass graph derives multi-server attack paths from capability overlap. Fixture: 3 servers (shell-mcp / filesystem-mcp / github-mcp) → ≥3 distinct attacker-goal bypass paths (delete_repo, modify_ci_pipeline, exfiltrate_secret). Most MCP audit tools stop at single-server analysis — SKELETON KEY computes the GRAPH",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.skeleton_key.bypass_graph_works",
    severity: "block",
  },

  // ── v2.59.0 — GATE SELF-VERIFICATION (SDK_AUDITOR) ──────────────────
  {
    id: "claim.sdk.external_surface_complete",
    source: "v2.59.0 release notes",
    text: "@mneme-ai/sdk's external public surface (what `import { ... } from \"@mneme-ai/sdk\"` returns) has every expected feature: standalone `letheForget` / `gavelPack` / `nimbusPublish` functions + convenience groups `lethe` / `gavel` / `nimbus` + NemesisSdk class with janusObserve / janusSwap / stealthScore / capillary / alibi / sibylCommit / sibylReveal methods. SDK_AUDITOR empirically imports the SDK + verifies — no static grep that can mock",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.sdk.external_surface_complete",
    severity: "block",
  },
  {
    id: "claim.gate.consistency",
    source: "v2.59.0 release notes",
    text: "WIRING DOCTOR and SDK_AUDITOR agree on every feature. Pre-v2.59 WIRING DOCTOR reported '13/13 wired' but external `import { letheForget } from \"@mneme-ai/sdk\"` was undefined (gate checked internal class file instead of external surface). v2.59 cross-checks both gates: contradictions = release block",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.gate.consistency",
    severity: "block",
  },

  // ── v2.58.0 — REAL 100% COVERAGE + LIVING LAB ───────────────────────
  {
    id: "claim.coverage.real_100_percent",
    source: "v2.58.0 release notes",
    text: "probe_coverage gate hits 100% coverage with REAL empirical evidence (every tool actually runs via AUTOPROBE --help invocability test). No fake exemptions, no hand-waved deprecations. Three coverage sources: (a) explicit TG claim, (b) READONLY last-segment pattern, (c) AUTOPROBE proof-of-life",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.coverage.real_100_percent",
    severity: "block",
  },
  {
    id: "claim.autoprobe.fresh",
    source: "v2.58.0 release notes",
    text: "AUTOPROBE last_run.json exists + HMAC verifies + age ≤24h. Empirical proof every tool was spawned + responded to --help within timeout. Hand-written probes can mock things; AUTOPROBE cannot — it runs a real subprocess",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.autoprobe.fresh",
    severity: "block",
  },
  {
    id: "claim.living_lab.no_open_findings",
    source: "v2.58.0 release notes",
    text: "LIVING LAB findings ledger (HMAC-chained) has 0 OPEN findings AND chain integrity verifies. Open finding = a tool that previously passed AUTOPROBE but now fails on the latest LIVING LAB tick. Open findings BLOCK the next release until cleared",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.living_lab.no_open_findings",
    severity: "block",
  },

  // ── v2.56.0 — xAI / GROK / SpaceX ALIGNMENT ─────────────────────────
  {
    id: "claim.xai.grok_first_class",
    source: "v2.56.0 release notes",
    text: "Mneme treats Grok (xAI's coding agent) as a first-class vendor: in AGENT_VENDOR_ALLOWLIST + removed from EMBEDDER_LEAK_SIGNATURES + classifier signature added + 15 seed-corpus fixtures + env_scan markers (GROK_API_KEY / XAI_API_KEY / GROK_CLI / GROK_CODE_FAST / GROK_AGENT)",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.xai.grok_first_class",
    severity: "block",
  },
  {
    id: "claim.xai.launch_window_ready",
    source: "v2.56.0 release notes",
    text: "Mneme ships LAUNCH WINDOW — a SpaceX-style GO/NO-GO release verdict aggregator that runs ALL gates (TRUTH GATE subset + PERF BUDGET + INDISPENSABILITY + WIRING LAG + PROBE COVERAGE + SDK BUILT) and emits a single status + HMAC-signed certificate + ASCII countdown banner",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.xai.launch_window_ready",
    severity: "block",
  },
  {
    id: "claim.xai.dragon_chain_intact",
    source: "v2.56.0 release notes",
    text: "Mneme ships DRAGON EJECT — emergency rollback primitive that emits a GAVEL-grade forensic bundle (Merkle proof binding rationale + reverted diff) + HMAC-chained eject ledger. Chain integrity is verifiable offline",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.xai.dragon_chain_intact",
    severity: "block",
  },
  {
    id: "claim.xai.stargate_bundle_seal",
    source: "v2.56.0 release notes",
    text: "Mneme ships STARGATE — open-source publisher for the augmented calibration corpus (15 fixtures × 6 vendors × 6 augmentations = 540 fixtures), MIT-licensed, with SHA-256 content seal + HMAC attestation. Makes Mneme the Switzerland of AI vendor identity verification (any vendor may train against the same public ground truth)",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.xai.stargate_bundle_seal",
    severity: "block",
  },
  // ── v2.55.0 — @mneme-ai/sdk WORLD-CLASS SDK ─────────────────────────
  {
    id: "claim.sdk.world_class",
    source: "v2.55.0 release notes",
    text: "Mneme ships @mneme-ai/sdk — a world-class premium in-process SDK that AI vendors can embed without subprocess overhead. 30-80× faster than `mneme <verb>` CLI (proven via built-in benchmark.vsCli). 7 wild features: createMneme factory, branded types (HmacHash/VendorId/etc), tagged-template-literal verify, async-iterator event bus, file-lock adapter for CLI+SDK concurrent safety, multi-instance support, tree-shakable sub-entrypoints (@mneme-ai/sdk/nemesis / verify / truth / events / types)",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.sdk.world_class",
    severity: "block",
  },
  // ── v2.54.0 — WORLD-CLASS PREMIUM bindings ──────────────────────────
  {
    id: "claim.nemesis.world_class_premium_primitives",
    source: "v2.54.0 release notes",
    text: "Mneme ships 3 world-class premium NEMESIS extensions inspired by v2.53 audit Tier-2/3: LETHE (GDPR forget with Merkle exclusion proof), GAVEL (court-admissible bundle binding THEMIS + EU stamp + SIBYL via Merkle tree), NIMBUS (federated trust mesh: per-org HMAC-signed leaderboard cards + cross-org weighted reputation)",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.nemesis.world_class_premium_primitives",
    severity: "block",
  },
  {
    id: "claim.perf.budgets_met",
    source: "v2.54.0 release notes",
    text: "Mneme's 5 hot-path operations (extract_fingerprint / classify_calibrated / eu_stamp / stealth_score / janus_observe) stay within published per-op performance budgets; release-script gate refuses tag on regression",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.perf.budgets_met",
    severity: "block",
  },
  {
    id: "claim.strategy.tier3_complete",
    source: "v2.54.0 release notes",
    text: "Mneme ships strategy primitive with ≥3 RFC drafts (W3C disclosure block / ECMA cross-vendor handoff / NIST fingerprint-identity standard), ≥4 pricing tiers (Free / Pro / Enterprise / Sovereign), and a measurable indispensability score (6-criterion weighted checklist) ≥0.5",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.strategy.tier3_complete",
    severity: "block",
  },
  // ── v2.53.0 — PATCH OPEN WOUNDS (P0/P1) binding ─────────────────────
  // Closes the 8-finding session audit: HMAC default key / probe coverage
  // 14.2% / WIRING LAG class / EU stamp 700-984ms / classify accuracy
  // on wild / identity-swap blind spot / flag inconsistency / tool count drift.
  {
    id: "claim.audit.open_wounds_patched",
    source: "v2.53.0 release notes",
    text: "Mneme patches all 8 open wounds from the v2.52 session audit: P0-1 HMAC key wizard auto-generates + STRICT mode refuses default-insecure; P0-2 probe coverage gate accepts a percentage threshold (default 50%); P0-3 wiring-lag CI gate parses commit messages + spawns each claimed verb; P1-1 EU stamp avg <50ms warm-path (was 700-984ms); P1-2 NEMESIS classifier ≥85% on a 6x-augmented corpus (header-less + naturalistic perturbations); P1-3 JANUS organ detects cross-vendor cluster boundary swaps (Eve's blind spot); P1-5 tool count single source of truth (HMAC-signed catalog envelope)",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.audit.open_wounds_patched",
    severity: "block",
  },
  // ── v2.52.0 — MILLION DOLLAR SECRET DIAMONDS binding ────────────────
  // Inspired by the Netflix identity-deception reality show: 6 NEMESIS
  // extensions that turn fingerprinting into competitive / forensic /
  // privacy primitives.
  {
    id: "claim.nemesis.million_dollar_diamonds",
    source: "v2.52.0 release notes",
    text: "Mneme ships 6 NEMESIS extensions (STEALTH SCORE / CAPILLARY 50+ micro-tells / COLOSSEUM auto-tournament with 3-axis HMAC leaderboard / MOLT silent model-rotation detector / THEMIS alibi verifier / SIBYL ZK identity commitment) — each functional in-process every TRUTH GATE run",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.nemesis.million_dollar_diamonds",
    severity: "block",
  },
  // ── v2.51.0 — AUDIT REPRODUCTION SUITE binding ──────────────────────
  // Closes "audit-perception" gap: external audit screenshots claimed
  // regressions on edge-case verdict / schema-bypass / throughput /
  // determinism / META-SELF / truncation / lineage / Phoenix / cancel.
  // The canonical local reproduction (this probe + tests/audit/v51_*.test.ts)
  // is the moat: every metric from the audit table rebuilt as executable
  // assertion. If 11/11 hold, marketing's "audit-bug-free" claim stands.
  {
    id: "claim.audit.reproduction_suite_passes",
    source: "v2.51.0 release notes",
    text: "Mneme passes all 11 audit categories from the external v2.50 audit table (edge-case verdict / MCP tool-name fuzz 20/20 / validateArgs / hot-path throughput / deterministic verdict lock / META-SELF-VERIFIER / truncation receipt / lineage defensive / cli-activity HMAC / Phoenix install / AbortSignal propagation) — measured in-process every TRUTH GATE run",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.audit.reproduction_suite_passes",
    severity: "block",
  },
  // ── v2.48.0 — NEMESIS classify accuracy on REAL (held-out) corpus ───
  // F7 from v2.47 audit: pre-v2.48 the only accuracy probe ran on the
  // SEED corpus (100% by construction). Real-world bugs (B1: header-less
  // diff) slipped through because seed always had headers. This new
  // probe runs a 7-fixture held-out corpus with header-less + naturalistic
  // variation; requires ≥85% accuracy. Severity=block → drift breaks tag.
  {
    id: "claim.nemesis.real_accuracy_85",
    source: "v2.48.0 release notes",
    text: "NEMESIS calibrated classifier achieves ≥85% accuracy on a HELD-OUT real-corpus-shaped fixture set (header-less diffs + natural variation) — not just the seed corpus",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.nemesis.classify_accuracy_real_corpus",
    severity: "block",
  },
  // ── v2.45.0 — AUTO-INIT zero-command-install self-verify ────────────
  {
    id: "claim.auto_init.zero_command",
    source: "v2.45.0 release notes",
    text: "Mneme bootstraps on first MCP tool call — user never needs to run `mneme init` manually; idempotent + dev-tooling-folder-aware",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.auto_init.zero_command_install_works",
    severity: "block",
  },
  // ── v2.44.0 — SEAMLESS PROTOCOL self-verify ─────────────────────────
  // Marketing claim: Mneme verify accepts hostile input seamlessly via
  // multiple lossless paths (stdin / hex / base64 / clipboard / file).
  // The probe asserts all 3 v2.44 innovations are wired + behave.
  {
    id: "claim.seamless.protocol_complete",
    source: "v2.44.0 release notes",
    text: "Mneme's SEAMLESS PROTOCOL wires shell-strip-detective + auto-number-grounding + homoglyph-attack-banner so hostile input never silently fails",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.seamless.protocol_complete",
    severity: "block",
  },
  // ── v2.41.0 — ARGUS-11 marketing claim, self-verified ──────────────
  // The marketing language "world's first truth-aware multimodal search"
  // is rendered VERIFIABLE: the probe runs a benchmark on (text+code)
  // fixture + parallel-4 latency + adapter-count + HMAC verify. ANY
  // drift trips the gate. The claim is asserted=1 (probe passes ALL
  // sub-asserts). severity=block — if the marketing copy ships ahead of
  // the implementation, the release breaks.
  {
    id: "claim.argus11.world_first_multimodal",
    source: "v2.41.0 release notes",
    text: "Mneme ships world's first truth-aware multimodal search: text+code+image ranked in one pass, parallel sub-second on 4 concurrent queries, ≥9 live vendor adapters, HMAC-verifiable result frame",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.argus11.world_first_multimodal",
    severity: "block",
  },
];
