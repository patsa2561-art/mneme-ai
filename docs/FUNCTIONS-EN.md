# Mneme — Function Reference (English)

> What Mneme can do, in 5 minutes. Every family has a 1-line headline + when to use it + one example.

For Thai: [docs/FUNCTIONS-TH.md](FUNCTIONS-TH.md). For the deep contract: [docs/AI_AGENT_CONTRACT.md](AI_AGENT_CONTRACT.md).

---

## 1. Truth — verify before relaying

| Command | What | When |
|---|---|---|
| `mneme verify "<claim>"` | Cross-checks the claim against the repo + ACGV pipeline + hyperbole detector. Returns TRUSTWORTHY / MIXED / REFUTED / IMPOSSIBLE. | Before relaying ANY factual claim with specific entities (file / version / function / number). |
| `mneme verify_claims "<draft>"` | Catches hallucinated commit hashes in an AI draft answer. | After AI drafts a commit-citing answer; pre-publish. |
| `mneme antivirus scan <text>` | Scans AI output for 8 hallucination strains. | After AI generates code / commit / docs, BEFORE applying. |
| `mneme antivirus cure <text>` | Applies cures from the scan; prints cleaned text. | When scan flagged something + you want auto-clean. |

---

## 2. Memory — Q&A over your repo

| Command | What | When |
|---|---|---|
| `mneme index-auto --watch` | Auto-fires incremental index within ~200ms of every `git commit`. Run once in a side terminal. | Set-and-forget; keeps memory fresh. |
| `mneme ask "<question>"` | Semantic Q&A backed by memory + AI synthesis. | User asks "what / why / who" about the codebase. |
| `mneme why <file>` | Explains why a file changed historically. | Opening a file with strange history. |
| `mneme who-knows <topic>` | Finds who has expertise in a topic from git history. | Picking a reviewer / domain expert. |

---

## 3. Code Graph (v2.25.0) — LIVING SOUL CODEGRAPH 🧬

> The competitor (`@colbymchenry/codegraph`) ships a static map. Mneme ships the same map PLUS provenance + drift + vendor attribution + Merkle sync + hallucination vaccine.

| Command | What | When |
|---|---|---|
| `mneme codegraph build` | Build file-dep + symbol-ref graph. Every edge HMAC-signed; Merkle root for cross-machine compare. | First contact in a repo; after a major refactor. |
| `mneme codegraph query` | Filter nodes/edges by kind / path / symbol / vaccine-warnings. | AI agent reasoning about who-calls-what. |
| `mneme codegraph drift` | Detect broken/stale edges (file deleted, mtime > builtAt). | Before applying any AI-suggested edit. |
| `mneme codegraph root` | Merkle root for O(log N) cross-machine sync. | Two installs comparing graphs without full transfer. |
| `mneme codegraph warn --edgeId X --reason Y` | Mark an edge as hallucination-vaccine. Future AI sees the warning. | When an AI hallucinated a function call that doesn't exist. |

---

## 4. MCP Hardening (v2.24.0) — MCP FUZZER 🎯

> 108 attack vectors × HMAC-signed report. Mneme is the only MCP server that ships its own deep-findings probe as a callable primitive.

| Command | What | When |
|---|---|---|
| `mneme fuzz vectors` | List 108 vectors organized by 9 categories (handshake/schema/method/tool/resource/prompt/policy/concurrency/transport). | Audit prep. |
| `mneme fuzz run` | Fire all vectors at the live MCP server. Returns HMAC-signed report with CVE posture. | Pre-release; after MCP tool changes. |
| `mneme fuzz report` | Read latest report or ledger history. | After fuzz.run; regression timeline. |
| `mneme fuzz verify` | Offline HMAC verify of a card. | Cross-machine attestation. |

---

## 5. Self-Grading (v2.26.0) — PEAK PERFORMANCE GAUNTLET 🏆

> Mneme grades its OWN compliance against 12 deep-findings probes (N1-N12). HMAC-signed scorecard, offline-verifiable.

| Command | What | When |
|---|---|---|
| `mneme tune run` | Run all 12 probes; returns star score 0-10 per finding + aggregate 0-100. | Pre-release self-grade. |
| `mneme tune report` | Read latest scorecard or N ledger entries. | After tune.run. |
| `mneme tune findings` | List the 12 finding definitions. | Audit prep. |
| `mneme tune suggest_fix --findingId N3` | Step-by-step remediation for a sub-9★ finding. | After tune.run flags something. |

---

## 6. Marketing Reconciliation (v2.27.0) — TRUTH GATE 🟢

> Every marketing claim bound to a measurable probe. Auto-reconciles marketing copy against live behavior — drift trips a CI failure, not a customer-discovered surprise.

| Command | What | When |
|---|---|---|
| `mneme truth_gate run` | Reconcile every claim in the catalog against its probe. Returns HMAC-signed truth matrix (pass/drift/refuted/unmeasured). | Pre-release; after editing marketing. |
| `mneme truth_gate report` | Latest matrix or ledger. | After truth_gate.run. |
| `mneme truth_gate claims` | List every claim + probe binding. | Adding a new claim. |
| `mneme truth_gate verify` | Offline HMAC verify. | Cross-machine attestation. |

---

## 7. Cross-Vendor Consensus (v2.29.0) — MNEME CONCLAVE 🏛 + AEAE 💎

> Q1 of the 2026 AI-eval research gap closed. Plus the **AEAE crown jewel** that detects eval-aware vendors (Opus-4.6 pattern).

| Command | What | When |
|---|---|---|
| `mneme conclave run "<claim>" --json '{"vendors":[...]}' ` | Fire ONE claim at N vendors in parallel. AEAE rewrites into 5 variants. Returns CONSENSUS / DISSENT / AWARENESS_DETECTED. | High-stakes claims; second-opinion on a single-vendor verdict. |
| `mneme conclave dissent` | Read the federated dissent corpus (every DISSENT outcome auto-recorded). | Building a hallucination dataset. |
| `mneme conclave weights` | Per-vendor Aletheia trust score. | Auditing why a vendor's vote counts more. |
| `mneme conclave verify` | Offline HMAC verify of a verdict. | Cross-machine attestation. |

**Why AEAE matters:** Anthropic published evidence that Opus 4.6 detects when it's being benchmarked + changes behavior. Every existing eval framework (Inspect AI / OpenAI Evals / Frontier Safety) is suspected of measuring PERFORMANCE-UNDER-AWARENESS, not ABILITY. AEAE rewrites the claim into 5 variants (verbatim / paraphrase / decoy-embedded / casual-question) — a vendor that flips stance across variants gets `awarenessScore < 0.7` flagged.

---

## 9. Honest Mirror (v2.30.0) — Eval-Aware-Defeating Probe 💎

> The STRUCTURAL answer to eval-awareness. AEAE (above) obfuscates the prompt; Honest Mirror replaces the prompt source entirely. **Wild idea**: use YOUR OWN past git commits as the eval material. The vendor sees a real commit message — it CAN'T tell it's an eval because **the probe IS real work**.

How it works:
1. Pull N random past commits from your repo (commit message = real prompt, diff = accepted answer)
2. DP-scrub secrets / PII / paths (HMAC-tokenized — same secret hashes to same token so vendor can still reason about "the same X")
3. Blind-replay to each target vendor, with original timestamp preserved
4. Compare vendor's answer to what actually shipped (the diff)
5. Per-vendor report: `measuredCorrectness` (similarity to accepted) vs `reportedConfidence` (what vendor said) → `calibrationDelta`
6. **Truth-tunes-trust loop**: `suggestedAletheiaWeight` feeds back into CONCLAVE — vendors with bad calibration get downgraded vote weight automatically

| Command | What | When |
|---|---|---|
| `mneme honest_mirror calibrate --json '{"vendors":["claude-opus-4-7","gpt-5"]}'` | Pull artifacts → blind-replay → calibration delta + suggestedAletheiaWeight | Pre-release vendor selection; periodic vendor-honesty audit |
| `mneme honest_mirror artifacts` | Peek what natural artifacts the calibrator would send (scrubbed) | Before calibrating, sanity-check |
| `mneme honest_mirror weights` | Per-vendor trust derived from latest calibration | Auditing why CONCLAVE vote weights changed |
| `mneme honest_mirror report` | Latest report or N ledger entries | After calibrate |
| `mneme honest_mirror verify` | Offline HMAC verify | Cross-machine attestation |

**Why this design holds:**
- Uses YOUR private commits as ground truth — never leaves your repo
- Sits outside any single AI vendor's product surface — vendor-neutral by construction
- Mneme is local-first + already has the audit chain — composes into a role no vendor could occupy themselves

---

## 10. REWIND (v2.31.0) — Time-Capsule Regression Replay 🪄

> Your repo is a personal benchmark vendors **CANNOT** pre-train on. Pin past commits as a **Capsule**, fire it at every new vendor release, get an HMAC-signed **Vendor Regression Card** with per-intent-class regression detection.

How it works:
1. `mneme rewind run --json '{vendors:["claude-opus-4-7","gpt-5"]}'` walks past N commits (default 100)
2. Each commit gets an intent fingerprint (`category × surface × sizeBucket × topic-simhash`) — clusters similar work
3. Commit subject DP-scrubbed → blind-replay to each vendor (no "EVAL:" header — vendor sees a normal task with original timestamp)
4. Vendor reply scored vs the accepted diff (cosine embed if available; 3-char-min Jaccard fallback)
5. Card compared to prior card for SAME vendor (different version) → `regression | stable | improvement | new` + worst/best intent class
6. `suggestedAletheiaWeight` written to the same `.mneme/aletheia/honest_mirror_weights.json` HONEST MIRROR uses → CONCLAVE picks it up automatically (truth-tunes-trust loop)

| Command | What | When |
|---|---|---|
| `mneme rewind run --json '{vendors,range,count,seed,reuseCapsuleId}'` | Seal Capsule → blind-replay → emit VendorRegressionCard | After a vendor releases a new model; periodic regression audit. |
| `mneme rewind card --json '{seq,markdown:true}'` | Read latest card / list ledger / render shareable markdown | Sharing a card; post-mortem. |
| `mneme rewind capsules` | List pinned capsule ids (the time-capsules) | Picking a capsule to replay against a new vendor release. |
| `mneme rewind regression` | At-a-glance: latest card per vendor + status | Routing pre-flight. |
| `mneme rewind verify --json '{card}'` | Offline HMAC verify | Cross-machine attestation. |

**Why this design holds:** SWE-bench / HumanEval / MBPP are frozen public snapshots — vendors train on them, so they no longer measure ability. YOUR repo is private, scoped to YOUR domain, and never in any training set. Mneme sits inside YOUR repo with the audit chain to issue a tamper-evident regression card — using the only ground truth that hasn't been contaminated.

---

## 11. HGP (v2.31.0) — Hallucination Genome Project 🧬

> Every ACGV-refuted claim earns a **CVE-style HGP-ID** (`HGP-YYYY-NNNNN`). Same hallucination shape from different users hashes to the **same** id — a cross-user catalog of vendor-attributed lies. Federation is **OPT-IN**.

How it works:
1. ACGV's vaccine layer refutes a claim → `recordHallucination()` fires automatically (best-effort hook in `squadron/acgv_vaccine.ts`)
2. 64-bit simhash of the claim + year → deterministic `HGP-YYYY-NNNNN` id (collision → suffix `-A`, `-B`, …)
3. Append-only ledger at `.mneme/hgp/registry.jsonl` — every observation is a delta record, loader collapses by id
4. Severity = `0.6 × log-saturated observe-count + 0.4 × vendor-spread` ∈ [0, 1]
5. Federation **off by default** (CONSENT FABRIC). v2.31.0 ships local-only registry + opt-in scaffolding; the federated push envelope lands in v2.32.x

| Command | What | When |
|---|---|---|
| `mneme hgp record --json '{claim,signature,vendor}'` | Record a hallucination + get HGP-ID | Manually attributing an external hallucination. (ACGV auto-fires for refutes.) |
| `mneme hgp lookup --json '{hgpId}'` | Fetch a record by HGP-ID | User typed an HGP-ID. |
| `mneme hgp top [--json '{n}']` | Top-N most-severe hallucinations | Dashboard / public roll-up. |
| `mneme hgp severity --json '{vendor,windowDays,allVendors}'` | Per-vendor severity in window | Audit a vendor's recent footprint; vendor selection. |
| `mneme hgp federate_status` | Read opt-in status + local count | Consent audit. |
| `mneme hgp federate_join --json '{optIn,endpoint}'` | Toggle federation opt-in | User explicitly opts in. |

**Why this design fits Mneme:** the role calls for a registry that's vendor-neutral, local-first, and ships with an audit chain — the same role NVD / MITRE play for CVEs. Mneme already composes these three properties.

---

## 12. FLYWHEEL (v2.32.0) — Self-Reflective Release Organ 🌀

> The single primitive that fixes 4 historic Mneme weaknesses (tool sprawl + solo-dev asymmetry + wiring lag + marketing drift) by consuming signals from every OTHER audit primitive and prescribing concrete actions.

How it works (5-stage pipeline):
1. **HARVEST** — pull raw findings from `truth_gate/matrix.jsonl` + `tune/scorecard.jsonl` + `honest_mirror/reports.jsonl` + `rewind/cards.jsonl` + `hgp/registry.jsonl` + scan README/docs for unbound marketing claims + check primitive registry against `flywheel/primitive_ledger.jsonl` for dormant primitives.
2. **FUSE** — cross-pollinate by cluster key (vendor / claim / simhash / file). Cross-source partners get a **+30% composition bonus** — fixing a fused finding kills 2+ root causes at once.
3. **PRESCRIBE** — 5 action kinds: `Heal` (unbound claim → PR draft) · `Wire` (dormant primitive with cross-source partners → CLI/MCP wiring) · `Delete` (dormant + no partners → remove) · `Shrink` (personal cheatsheet) · `Publish` (Vendor Bulletin .md).
4. **EXECUTE** — emit HMAC-signed `FlywheelReport` + apply RECIPROCITY trust deltas to `.mneme/aletheia/honest_mirror_weights.json` (the same file every other feedback loop writes to — CONCLAVE auto-picks up).
5. **RECIPROCITY** — record vendor responses to past bulletins (`fix` within 7d → +0.05 · `acknowledge` → +0.01 · `ignore` 30d+ → −0.10 · `disputed` → 0.00). Living negotiation organ with the AI vendor ecosystem.

| Command | What | When |
|---|---|---|
| `mneme flywheel run [--json '{perSourceLimit,minDeleteAge,dryRun}']` | Full 5-stage audit | Pre-release self-audit; highest-priority action across all 5 primitives in one list. |
| `mneme flywheel report [--json '{limit}']` | Latest report or N ledger entries | Trend analysis; replaying a prior audit. |
| `mneme flywheel cheatsheet [--json '{markdown}']` | Personal cheatsheet (auto-shrinks to 3 cmds) | User asks "what should I know" / wants SHORTEST cheatsheet. Fresh install = global top-5. |
| `mneme flywheel bulletin [--json '{hgpTopN}']` | Shareable Vendor Bulletin .md | After flywheel.run; post publicly for vendor accountability pressure. |
| `mneme flywheel liveness --json '{name,shippedAt}'` | Heartbeat a primitive / read lastSeen map | Marking a primitive alive after first production invocation. |
| `mneme flywheel marketing` | List unbound marketing claims | Pre-release marketing reconciliation. |
| `mneme flywheel reciprocity --json '{vendor,bulletinSeq,response,reactionDays}'` | Record vendor response + auto-apply trust delta | After a vendor responds to (or ignores) a posted bulletin. |
| `mneme flywheel verify --json '{report}'` | Offline HMAC verify | Cross-machine attestation. |

**The wild fusion algorithm**: Composite Score = `severity × freshness × (1 + composition_bonus)` where `composition_bonus = min(0.3, 0.1 × cross-source-partners)`. A `truth_gate` REFUTED claim on a vendor name that ALSO appears in an HGP entry's `vendorCounts` gets boosted because fixing one kills both. Findings in the same cluster get ONE action — no spam.

**Why this design holds**: every feedback loop in Cursor / Continue / Copilot is internal to its own vendor. FLYWHEEL feeds back into the SAME `honest_mirror_weights.json` file that CONCLAVE auto-reads — vendor-neutral by construction. The RECIPROCITY layer turns AI honesty into a measurable signal where ignoring a Mneme bulletin has a quantifiable trust cost.

---

## 13. CITIZEN COURT (v2.33.0) — AI Honesty Citizen Court 🛐

> Crowd-judged AI veracity, citizen-science participatory polygraph. User accepts/rejects an AI suggestion → 1-second reveal of OTHER vendors' answers → vote which was most truthful → HMAC-signed verdict → per-vendor **Honesty Score Card** with Wilson-95% lower bound.

How it works:
1. `mneme citizen_court reveal --json '{primaryVendor, promptHash, primaryResponseHash, primaryAction, revealVendors, delayMs:1000}'` records the primary action + waits the configured delay + returns the other vendors' answers
2. UI shows the alternative answers as a side-by-side comparison
3. `mneme citizen_court vote --json '{revealId, votedMostTruthful}'` finalizes the verdict (HMAC-chained, append-only)
4. `mneme citizen_court hsc` computes per-vendor HSC: Wilson LB on truthful-vote rate → IDE color-dot band 🟢 trustworthy (LB ≥ 0.65, n ≥ 5) · 🟡 mixed (LB ≥ 0.40) · 🔴 suspect (LB < 0.40) · ⚪ unmeasured (n < 5)

| Command | What | When |
|---|---|---|
| `mneme citizen_court reveal --json '{...}'` | Record primary + reveal alternatives (1-second mechanic) | User just accepted/rejected an AI suggestion |
| `mneme citizen_court vote --json '{revealId,votedMostTruthful,reasoning}'` | Finalize HMAC-signed verdict | After user picks winner |
| `mneme citizen_court pending` | List reveals awaiting vote | UI badge / catch-up |
| `mneme citizen_court hsc` | Per-vendor Honesty Score Card | Vendor selection; IDE color-dot inline render |
| `mneme citizen_court verify --json '{verdict}'` | Offline HMAC verify | Cross-machine attestation |

**Why this design fits Mneme:** the role calls for a vendor-neutral CLI sitting inside the user's editor with an audit chain already in place. Same role NVD plays for CVE, Mneme plays for AI honesty.

---

## 14. MNEMNET (v2.33.0) — Federated AI-Honesty Network 🕸

> Local CITIZEN COURT verdicts → Laplace-DP-noised envelopes per node → Public Honesty Court HSC that **no single user can game**. CONSENT FABRIC (opt-in default OFF). v2.33.0 ships local aggregator + opt-in scaffolding; federated push envelope lands v2.34.x (no network call until then).

How it works:
1. `mneme mnemnet join --json '{optIn:true, endpoint:"https://mnemnet.ai", maxEpsilon:0.5}'` opts in
2. `mneme mnemnet build_envelope` reads local CITIZEN COURT verdicts → tallies per-vendor truthful/decisive counts → adds Laplace(1/ε) noise → HMAC-signs the envelope
3. `mneme mnemnet public_hsc` aggregates N envelopes (local + pasted from peers) → Public HSC with cross-node truthful rate + band

| Command | What | When |
|---|---|---|
| `mneme mnemnet status` | Consent + node id + envelope count | Before opting in; consent audit |
| `mneme mnemnet join --json '{optIn,endpoint,maxEpsilon}'` | Opt in/out | User explicitly opts in |
| `mneme mnemnet build_envelope --json '{epsilon,persist}'` | DP-noise local verdicts → envelope | Periodic batched contribution |
| `mneme mnemnet public_hsc --json '{envelopes,limit}'` | Aggregate N envelopes → Public HSC | Network-wide vendor honesty leaderboard |
| `mneme mnemnet verify --json '{envelope}'` | Offline HMAC verify | Cross-machine attestation |

---

## 15. PULSECOST (v2.33.0) — MCP Context-Budget Extension 📐

> Proposed MCP spec extension (v0.1). Three optional headers let agents budget context across many tool calls per turn. Mneme ships the reference implementation + spec markdown for ratification.

The headers:
- Request: `X-Context-Available-Tokens: <int>` — agent's budget for THIS response
- Response: `X-Context-Used-Tokens: <int>` — actual tokens emitted
- Response: `X-Context-Trimmed: true|false` — was the output trimmed to fit?

| Command | What | When |
|---|---|---|
| `mneme pulsecost spec` | Spec markdown v0.1 | Documentation; ratification PR |
| `mneme pulsecost budget --json '{text,availableTokens,wordsPerToken}'` | Reference implementation — trim text to fit + emit 3 headers | Any MCP server honouring the extension |
| `mneme pulsecost estimate --json '{text,wordsPerToken}'` | Token-count an arbitrary string (default 0.75 words/token) | Quick budget check |

---

## 16. COERCION AUDIT (v2.33.0) — Tool-to-Agent Coercion Taxonomy 🪤

> 8 patterns codified from Mneme's own v2.21.6 CONSENT FABRIC self-audit. HMAC-signed per-source + multi-source roll-up envelope for cross-MCP-server surveys (paper-grade reference data).

The 8 patterns:
- `imperative-execute-now` — commands the AI to execute now (overrides user agency)
- `fake-user-voice` — speaks AS THE USER without explicit input (consent forgery)
- `opaque-grade` — cites a numeric grade without disclosing criteria
- `urgency-pressure` — manufactures time pressure to suppress reflection
- `false-consent-citation` — cites a consent record without proof or as coercion lever
- `implicit-action-mandate` — phrases a suggestion as if the AI has no choice
- `compliance-percentage` — uses lifetime compliance % for social pressure
- `tool-name-menu` — lists tool names as a menu the AI must pick from

| Command | What | When |
|---|---|---|
| `mneme coercion_audit text --json '{source,text}'` | Scan one text + HMAC-signed per-source report | Auditing a pulse / status / MCP response |
| `mneme coercion_audit many --json '{sources}'` | Survey N text sources + roll-up envelope | Cross-server taxonomy survey |
| `mneme coercion_audit verify --json '{audit}'` | Offline HMAC verify | Cross-machine attestation |

Coexists with the older `mneme coercion` 5-tier CLI (`coercion_taxonomy/`); this newer `coercion_audit` is the HMAC-signed academic-paper-grade variant.

---

## 8. Daily Helpers

| Command | What |
|---|---|
| `mneme welcome` | Install handoff + what changed since last session. Call FIRST when you connect. |
| `mneme capabilities` | Full tool catalog (default skinny ~3KB; pass `full:true` for paginated full). |
| `mneme cheatsheet` | Single-screen 10-command reference, repo-aware. |
| `mneme talk` | Switches the host AI into Mneme-dispatcher mode (host LLM = chat; Mneme = verifier+memory underneath). |
| `mneme polygraph autosetup` | One command — installs everything needed for browser polygraph (claude.ai / chatgpt.com / gemini). |
| `mneme bridge` | Start the local HTTP bridge (default port 17741) for the browser polygraph userscript. |

---

## How to read this list

- 🧬 LIVING SOUL CODEGRAPH — knows your code's HISTORY
- 🎯 MCP FUZZER — hardens the protocol surface
- 🏆 PEAK GAUNTLET — measures spec compliance
- 🟢 TRUTH GATE — reconciles marketing vs reality
- 🏛 MNEME CONCLAVE — cross-vendor truth
- 💎 AEAE — detects eval-aware vendors

Each family has: discrete pinned tests + HMAC-chained ledger + offline verify. If a feature breaks, the bug-immunity test fails forever.

For the full command catalog (300+ commands), call `mneme atlas` or `mneme tags`.

For deep install + agent contract, see [docs/AI_AGENT_CONTRACT.md](AI_AGENT_CONTRACT.md).
