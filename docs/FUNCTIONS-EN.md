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

> Every marketing claim bound to a measurable probe. World-first: no AI tool auto-reconciles its own marketing copy vs live behavior.

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

**Why competitors can't copy this:**
- Anthropic / OpenAI / xAI / Google can't use users' private commits — vendors aren't a trusted third party
- They have a conflict of interest (want their own model to win)
- Mneme is local-first + vendor-neutral + already has audit chain = only player in position

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
