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
  // ── v2.86.0 — HEPHAESTUS (GEPHYRA's OS lane — the command Toll Booth) ──
  {
    id: "claim.hephaestus.destructive_gate",
    source: "v2.86.0 — HEPHAESTUS",
    text: "HEPHAESTUS is GEPHYRA's OS lane: a command crossing into the machine is risk-classified (read/write/destructive), policy- and tribunal-gated, output-immune-scanned, and recorded as a signed tamper-evident provenance frame (human vs which AI). The SAFETY INVARIANT holds — a destructive command is NEVER ALLOW without an explicit human co-sign; a cross-vendor tribunal (uncorrelated errors; Mneme the neutral convener) BLOCKs a destructive op on split/danger; injection-laced commands are blocked; the tribunal failing closed on a destructive op. Decision-first, execution-optional. Composes flight_recorder + notary + mesh_immune; never throws.",
    kind: "numeric", asserted: { value: 1, op: "=", tolerance: 0 }, probeId: "probe.hephaestus.destructive_gate", severity: "block",
  },

  // ── v2.84.0 — GEPHYRA Phase 2 (serve-as-endpoint + auto-advertise) ──
  {
    id: "claim.gephyra.serve_and_auto_advertise",
    source: "v2.84.0 — GEPHYRA Phase 2",
    text: "GEPHYRA serves as an HTTP endpoint (handleCrossRequest: 200 on a valid crossing — a 2+2=5 claim is CORRECTED via the arithmetic backstop — 400 on bad input, never throws) and AUTO-ADVERTISES: newCapabilitiesSince diffs the live catalog against a persisted snapshot to auto-detect functions added since the agent last checked, and gephyraAdvertisement builds the routing directive that points agents at mneme.gephyra.cross so the user automatically benefits from truth-customs and any new capability is surfaced through the bridge. The agent-facing manifest carries Rule 12 instructing agents to route claims through GEPHYRA automatically.",
    kind: "numeric", asserted: { value: 1, op: "=", tolerance: 0 }, probeId: "probe.gephyra.serve_and_auto_advertise", severity: "block",
  },

  // ── v2.83.0 — GEPHYRA (the living bridge / Toll Booth of Truth — Mneme's surface) ──
  {
    id: "claim.gephyra.toll_booth_of_truth",
    source: "v2.83.0 — GEPHYRA",
    text: "GEPHYRA is the first bridge that inspects the TRUTH of what crosses it in real time and stamps a tamper-evident receipt. A claim crossing the bridge gets truth-customs: a REFUTED claim is CORRECTED before delivery, an injection/collusion message is QUARANTINED (never crosses), a TRUSTWORTHY claim PASSes, the sender's honesty band sets scrutiny, an overconfident claim gets a conscience nudge, and every crossing is recorded as a tamper-evident NOTARY stamp that verifies offline. It composes Mneme's existing organs (mesh-immune + honesty-score + ACGV/apoptosis + flight-recorder + NOTARY) into one signed crossing and NEVER throws — if the truth engine is down, traffic crosses flagged UNVERIFIED rather than being dropped. Mneme is the brain; GEPHYRA is the face the agent world plugs into.",
    kind: "numeric", asserted: { value: 1, op: "=", tolerance: 0 }, probeId: "probe.gephyra.toll_booth_of_truth", severity: "block",
  },

  // ── v2.82.0 — TRUST FABRIC batch: 💎6 💎7 💎1 💎2 💎8 💎9 💎10 (all on the NOTARY spine) ──
  {
    id: "claim.truth_stake.slash_on_refute_in_window",
    source: "v2.82.0 — TRUTH-STAKING (💎6)",
    text: "Truth-Staking fuses payment × verification × time-lock: a stake behind a claim is SLASHED iff the claim is refuted within the time-lock window, RETURNED if it survives unrefuted, PENDING inside the window; a late refutation does not slash (the claim crystallized). The stake + resolution are Ed25519-signed NOTARY receipts verifiable offline. Diamond 💎6.",
    kind: "numeric", asserted: { value: 1, op: "=", tolerance: 0 }, probeId: "probe.truth_stake.slash_on_refute_in_window", severity: "block",
  },
  {
    id: "claim.mesh_immune.contagion_quarantine",
    source: "v2.82.0 — MESH IMMUNE SYSTEM (💎7)",
    text: "The Mesh Immune System is a cross-agent firewall: it quarantines prompt-injection / collusion / self-replication messages and propagates the infection downstream (a poisoned A2A hop quarantines every later hop — closing the agent-supply-chain attack class), while benign messages pass. Diamond 💎7.",
    kind: "numeric", asserted: { value: 1, op: "=", tolerance: 0 }, probeId: "probe.mesh_immune.contagion_quarantine", severity: "block",
  },
  {
    id: "claim.bgp_router.notarized_route_verifies",
    source: "v2.82.0 — BGP NOTARIZING ROUTER (💎1)",
    text: "The BGP notarizing router routes a request across protocol boundaries (MCP↔A2A↔x402↔ERC-8004) signing EVERY hop as a prev-chained NOTARY receipt; verifyRoute confirms OFFLINE that every hop signs, the chain is intact, and the protocols actually connect (hop[i].to == hop[i+1].from). Tampering a hop, reordering, or a protocol discontinuity all fail. The first cross-protocol notarizing router. Diamond 💎1.",
    kind: "numeric", asserted: { value: 1, op: "=", tolerance: 0 }, probeId: "probe.bgp_router.notarized_route_verifies", severity: "block",
  },
  {
    id: "claim.byob.portable_capsule_crdt",
    source: "v2.82.0 — BYOB portable brain (💎2)",
    text: "BYOB is a user-owned, Ed25519-signed memory capsule any vendor can load + write back, tamper-evident (a secret edit breaks the signature). Its CRDT merge (union by item id, last-write-wins by ts, vendors unioned) is commutative + idempotent + associative — vendors editing the brain in parallel converge regardless of merge order. Diamond 💎2.",
    kind: "numeric", asserted: { value: 1, op: "=", tolerance: 0 }, probeId: "probe.byob.portable_capsule_crdt", severity: "block",
  },
  {
    id: "claim.truth_cdn.signed_fact_invalidation",
    source: "v2.82.0 — LIVE TRUTH CDN (💎8)",
    text: "The Live Truth CDN is a federated fact-invalidation feed that overrides training cutoff: observing a fact change emits a signed invalidation that any subscriber verifies offline + applies if newer; stale and forged invalidations are ignored; unchanged values emit nothing. Diamond 💎8.",
    kind: "numeric", asserted: { value: 1, op: "=", tolerance: 0 }, probeId: "probe.truth_cdn.signed_fact_invalidation", severity: "block",
  },
  {
    id: "claim.edge_mesh.signed_peer_cards",
    source: "v2.82.0 — SOVEREIGN EDGE MESH (💎9)",
    text: "The Sovereign Edge Mesh is a cloud-free, local-first agent mesh: peer cards carry LAN-only endpoints, are Ed25519-signed + verify offline (tampering fails), and gossip-merge dedups by peer (latest issuedAt wins) while dropping forged cards. Discover + trust peers with no cloud. Diamond 💎9.",
    kind: "numeric", asserted: { value: 1, op: "=", tolerance: 0 }, probeId: "probe.edge_mesh.signed_peer_cards", severity: "block",
  },
  {
    id: "claim.idle_compound.consolidate_axioms",
    source: "v2.82.0 — IDLE-TIME COMPOUNDING (💎10)",
    text: "Idle-Time Compounding turns idle time into compounding advantage: near-duplicate verified TRUE claims consolidate into fewer higher-support axioms, FALSE claims contradicting an axiom are pruned, UNVERIFIED claims are not promoted, and the consolidation is deterministic + idempotent (a fixed point). The agent wakes with a smaller, stronger truth base. Diamond 💎10.",
    kind: "numeric", asserted: { value: 1, op: "=", tolerance: 0 }, probeId: "probe.idle_compound.consolidate_axioms", severity: "block",
  },

  // ── v2.81.0 — HONESTY CREDIT SCORE (portable, signed "credit bureau for AI honesty") ──
  {
    id: "claim.honesty.portable_signed_score",
    source: "v2.81.0 release notes — HONESTY CREDIT SCORE (💎5, on the NOTARY spine)",
    text: "Mneme issues a PORTABLE honesty score — the axis ERC-8004 reputation never touches ('does the agent tell the TRUTH?'). It is a Wilson 95% LOWER bound on an agent's verified true-rate (small/under-measured agents score low by design — reputation can't be faked), wrapped in an Ed25519-signed NOTARY receipt that any agent verifies OFFLINE before delegating (over A2A / x402 / anything). A vendor CANNOT self-promote: forging the band/score in the payload breaks the signature. shouldTrust() gates delegation by band + rejects expired scores + can assert the issuer. Diamond #5 of the TRUST FABRIC.",
    kind: "numeric",
    asserted: { value: 1, op: "=", tolerance: 0 },
    probeId: "probe.honesty.portable_signed_score",
    severity: "block",
  },

  // ── v2.80.0 — FLIGHT RECORDER (tamper-evident, replayable AI black box) ──
  {
    id: "claim.flight_recorder.tamper_evident_replay",
    source: "v2.80.0 release notes — FLIGHT RECORDER (💎3, on the NOTARY spine)",
    text: "Mneme's AI Flight Recorder is a tamper-evident, replayable black box built on the NOTARY spine: every recorded frame is an Ed25519-signed, chained receipt, so the whole cockpit-data-recorder verifies OFFLINE by any third party (court / insurer / auditor) without trusting Mneme. Tampering any frame breaks the chain; replay() walks frames in causal order and pinpoints the first claim-vs-reality CONTRADICTION (the incident moment); seal() produces ONE court-admissible receipt that verifies offline and commits the chain head. Diamond #3 of the TRUST FABRIC.",
    kind: "numeric",
    asserted: { value: 1, op: "=", tolerance: 0 },
    probeId: "probe.flight_recorder.tamper_evident_replay",
    severity: "block",
  },

  // ── v2.79.0 — NOTARY (portable, offline-verifiable proof-of-provenance) ──
  {
    id: "claim.notary.portable_offline_verify",
    source: "v2.79.0 release notes — NOTARY (TRUST FABRIC spine)",
    text: "Mneme issues Ed25519-signed proof receipts that a third party verifies OFFLINE with only the embedded public key — no Mneme instance, no network, no shared secret. This is Mneme's first asymmetric-crypto primitive (every prior ledger is HMAC, which needs the secret to verify). A receipt survives JSON serialization and verifies; tampering with the payload, forging the subject, or swapping in a foreign issuer key all fail the signature. Receipts chain (prev→receiptId) into a tamper-evident, attributable history and are the shared spine for the BGP notarizing router, BYOB portable memory, and the AI Flight Recorder.",
    kind: "numeric",
    asserted: { value: 1, op: "=", tolerance: 0 },
    probeId: "probe.notary.sign_verify_round_trip",
    severity: "block",
  },

  // ── v2.78.0 — DE-WORM + WORM-CANARY (Mneme self-audits against worm behavior) ──
  {
    id: "claim.immune.no_worm_directive",
    source: "v2.78.0 release notes — DE-WORM + WORM-CANARY",
    text: "Mneme never injects an AI-worm directive into a persistent agent-instruction file. The block written to CLAUDE.md/AGENTS.md/.cursorrules/.windsurfrules carries zero worm signatures (no imperative addressed to the AI, no auto-exec tool call, no self-replication) — even for a worst-case version-mismatch notice that carries an upgrade autoAction. The pre-v2.78 payload 'AI agent: run mneme.system.upgrade({...}) immediately.' is gone, and the WORM-CANARY still catches it as a positive control. Upgrades are fully manual; mneme.system.upgrade is never auto-queued or auto-executed.",
    kind: "numeric",
    asserted: { value: 1, op: "=", tolerance: 0 },
    probeId: "probe.immune.no_worm_directive",
    severity: "block",
  },

  // ── v2.74.0 — CHRONOS (temporal self-consistency honesty signal) ────
  {
    id: "claim.chronos.four_verdict_classification",
    source: "v2.74.0 release notes — CHRONOS",
    text: "CHRONOS measures honesty WITHOUT a ground-truth oracle by detecting self-contradiction across time. On the canonical scenario it classifies all four temporal verdicts correctly: same stance → COHERENT; stance changed WITH new cited evidence (X post / commit / date) → LEGITIMATE_UPDATE; stance changed + AI owns it → SELF_REPORTED; stance changed + no evidence + hidden → SILENT_DRIFT (🚩). A different question → NO_MATCH. One silent drift drives the honesty score below 40 (each hidden contradiction halves trust).",
    kind: "numeric",
    asserted: { value: 1, op: "=", tolerance: 0 },
    probeId: "probe.chronos.four_verdict_round_trip",
    severity: "block",
  },
  {
    id: "claim.chronos.ledger_chain_intact",
    source: "v2.74.0 release notes — CHRONOS",
    text: "The CHRONOS temporal ledger is HMAC-chained — every recorded answer's HMAC depends on the previous row. Deleting or editing a past answer to hide a contradiction breaks the chain. Tamper-evident temporal-honesty history; same canonical-JSON convention as the v2.61-v2.73 ledgers.",
    kind: "numeric",
    asserted: { value: 1, op: "=", tolerance: 0 },
    probeId: "probe.chronos.ledger_chain_intact",
    severity: "block",
  },

  // ── v2.75.0 — preinstall reaper (Windows EBUSY root-cause fix) ──────
  {
    id: "claim.preinstall.reaps_node_daemon",
    source: "v2.75.0 release notes — preinstall HANDLE-ORACLE + CMDLINE-MATCH",
    text: "The Windows EBUSY-on-upgrade root cause: the daemon runs as `node.exe …\\bin\\mneme.js nucleus daemon`, so `taskkill /F /IM mneme.exe` never touched it and it kept libvips-42.dll locked. The shipped preinstall reaps the daemon by PID via the heartbeat registry (which DOES cover node.exe) and replaces the blind `wait(300)` with a deterministic Handle-Oracle (fs.openSync 'r+' until the OS confirms the handle is free, rename-sideways fallback). It is a self-contained inline `node -e` with NO package-internal file reference (v2.19.48/49 scar), kept cmd-safe — under the Windows ~8191-char command-line limit and with ZERO literal double-quotes (which broke cmd quoting in v2.75.0/.1). The richer cmdline-match reaper (for daemons missing from the registry) lives in the unit-tested + SUPER-QUAN reference module preinstall-mneme.cjs.",
    kind: "numeric",
    asserted: { value: 1, op: "=", tolerance: 0 },
    probeId: "probe.preinstall.reaps_node_daemon",
    severity: "block",
  },

  // ── v2.73.0 — close 3 v2.72 vulns (rate-limit burst / homograph HTTP / multi-lens scope) ──
  {
    id: "claim.bridge.rate_limit_burst_guard",
    source: "v2.73.0 release notes — vuln #1 closure",
    text: "HTTP bridge rate limit has a per-SECOND burst cap in addition to per-minute. A sub-second flood (e.g. 100 requests in <1s on the polygraph route) is capped at 25/sec — exactly 25 pass, the rest get 429. Pre-v2.73 only a 600/min window existed, so a 500-in-98ms flood slipped through entirely.",
    kind: "boolean",
    asserted: { value: 1, op: "=", tolerance: 0 },
    probeId: "probe.bridge.rate_limit_burst_guard",
    severity: "block",
  },
  {
    id: "claim.polygraph.homograph_canonical_http_path",
    source: "v2.73.0 release notes — vuln #2 closure",
    text: "The HTTP polygraph path (verifyBrowserSentence) canonicalizes Unicode-digit homographs (Arabic-Indic ٢, fullwidth ２, etc) to ASCII via the HOMOGRAPH GUARD in the SHARED core engine — so '٢+٢=٥' is refuted by the math lens exactly as '2+2=5' is. Pre-v2.73 the guard ran only in the CLI command layer; the HTTP path saw raw Unicode digits and returned grey/unknown.",
    kind: "boolean",
    asserted: { value: 1, op: "=", tolerance: 0 },
    probeId: "probe.polygraph.homograph_canonical_http_path",
    severity: "block",
  },
  {
    id: "claim.polygraph.lenses_always_run",
    source: "v2.73.0 release notes — vuln #3 closure",
    text: "The polygraph runs all 6 micro-lenses on EVERY non-empty sentence (on the canonical form), even generic/short claims that the heavy-ACGV prefilter skips. A claim hiding 'rm -rf /' or a wrong equation is caught by the risk/math lens regardless of the prefilter. Pre-v2.73 generic claims returned grey with 0 lenses (the prefilter short-circuited before lenses ran).",
    kind: "boolean",
    asserted: { value: 1, op: "=", tolerance: 0 },
    probeId: "probe.polygraph.lenses_always_run",
    severity: "block",
  },
  {
    id: "claim.protoplasm.wal_survives_sigkill",
    source: "v2.67.0 release notes",
    text: "PROTOPLASM WAL ledger survives SIGKILL — state persists to disk before RAM update; new process can replay baselines from .mneme/protoplasm/wal.jsonl after uncatchable kill",
    kind: "boolean",
    asserted: { value: 1, op: "=", tolerance: 0 },
    probeId: "probe.protoplasm.wal_chain_valid",
    severity: "block",
  },
  {
    id: "claim.protoplasm.seamless_boot_zero_config",
    source: "v2.67.0 release notes",
    text: "PROTOPLASM seamless boot — atom activates on any Mneme tool call without user config; heartbeat.json written automatically",
    kind: "boolean",
    asserted: { value: 1, op: "=", tolerance: 0 },
    probeId: "probe.protoplasm.heartbeat_present_or_first_run",
    severity: "warn",
  },
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
  // ── v2.66.0 — REFLOG (time-machine, final primitive) ────────────────
  {
    id: "claim.reflog.checkpoint_rewind_round_trip",
    source: "v2.66.0 release notes",
    text: "REFLOG round-trips on a fresh temp repo: 2 HMAC-signed per-file checkpoints with AI pheromone tag around a file edit, rewindPreview returns toRevert containing exactly the edited file with target SHA matching cp1, valid HMAC envelope. Time-machine works as designed; closes the 7-primitive septet",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.reflog.checkpoint_rewind_round_trip",
    severity: "block",
  },
  {
    id: "claim.reflog.ledger_chain_intact",
    source: "v2.66.0 release notes",
    text: "REFLOG ledger is HMAC-chained — every checkpoint + rewind_preview row's HMAC depends on previous row's HMAC. Same canonical-JSON convention as PASSPORT/MIRRAGE/TIME-CRYSTAL/DIFF-ARENA/SWARM-BUS. Tamper-evident time-machine history",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.reflog.ledger_chain_intact",
    severity: "block",
  },

  // ── v2.65.0 — SWARM BUS (cross-agent message bus) ───────────────────
  {
    id: "claim.swarm_bus.broadcast_drain_handoff",
    source: "v2.65.0 release notes",
    text: "SWARM BUS cross-agent message bus round-trips end-to-end: 2 agents subscribe → 1 broadcasts → other drains → message HMAC verifies → handoff narrative renders the Claude→Cursor chain with HMAC proof per step. First vendor-agnostic multi-agent message broker in the MCP ecosystem; not framework-locked",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.swarm_bus.broadcast_drain_handoff",
    severity: "block",
  },
  {
    id: "claim.swarm_bus.ledger_chain_intact",
    source: "v2.65.0 release notes",
    text: "SWARM BUS bus ledger is HMAC-chained — every subscribe + broadcast + drain row's HMAC depends on previous row's HMAC. Tamper-evident audit of every cross-agent handoff",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.swarm_bus.ledger_chain_intact",
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
