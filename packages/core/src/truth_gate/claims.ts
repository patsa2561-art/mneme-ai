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
