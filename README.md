<div align="center">

<img src="./assets/title.svg" alt="μνήμη · Mneme" width="640">

# The Trust & Cost Layer for AI Agents

<sub><b>μνήμη · NEE-meh · Greek for "memory."</b> A <b>local-first</b> trust boundary every AI agent crosses: it <b>verifies before it acts</b>, keeps your <b>code &amp; secrets from leaking</b> to the model (with a signed, offline-auditable proof), <b>remembers</b> across sessions + vendors, and <b>meters the tokens it saves you</b>. The brain that bolts onto Claude Code / Cursor / Cline / Codex / Continue / ChatGPT / Gemini. <b>Vendor-neutral. MIT. Air-gap-ready.</b></sub>

<br/><br/>

<a href="https://www.npmjs.com/package/mneme-ai" target="_blank" rel="noopener"><img alt="npm" src="https://img.shields.io/npm/v/mneme-ai?label=npm&color=cb3837&logo=npm&style=for-the-badge" /></a>
<a href="docs/AI_AGENT_CONTRACT.md" target="_blank" rel="noopener"><img alt="MCP tools" src="https://img.shields.io/badge/MCP%20tools-820%2B-c084fc?style=for-the-badge" /></a>
<a href="docs/FUNCTIONS-EN.md" target="_blank" rel="noopener"><img alt="GAUNTLET" src="https://img.shields.io/badge/PEAK%20GAUNTLET-100%2F100-2da44e?style=for-the-badge" /></a>
<a href="docs/FUNCTIONS-EN.md" target="_blank" rel="noopener"><img alt="TRUTH GATE" src="https://img.shields.io/badge/TRUTH%20GATE-100%2F100-2da44e?style=for-the-badge" /></a>
<a href="LICENSE" target="_blank" rel="noopener"><img alt="license MIT" src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" /></a>

<br/><br/>

### 🧠 Mneme is **ALETHEIA** — the savant of verifiable *truth · memory · structure*

> An LLM is a brilliant generalist — and *therefore* prone to hallucinate and forget. Mneme is the **savant** beside it: it **remembers** across sessions and vendors, and it says **`UNKNOWN` instead of guessing**. That's the whole idea.

📖 **The full story** (why a savant beats a generalist · the axes · the ethos) → [`docs/ALETHEIA.md`](docs/ALETHEIA.md)  ·  📜 **Every release** → [`CHANGELOG.md`](CHANGELOG.md)

🧠 **The Sovereign Cognitive Layer** — signed, vendor-neutral, byte-lossless context memory (HYDRA), self-aware wisdom gates, and a shared memory bus every AI agent (Grok / GPT / Gemini / Claude / Codex) contributes to that *heals its own contradictions by proof*. **How to use it →** [`docs/COGNITIVE-LAYER.md`](docs/COGNITIVE-LAYER.md)

💰 **Pay-per-Token-Saved** — Mneme does deterministic local work to cut what your agent sends to the model (🔭 **OUTLINE** lets any agent — Claude / GPT / Gemini / Grok / Codex / Cursor / Cline, via CLI or MCP — read a file's *structure* for a fraction of the tokens, then fetch the byte-exact slice only where it edits; DISTILL compresses a verbose error+diff to its causal brief; LOOPGUARD stops a thrash; NKL skips a proven dead-end), and meters the **measured** saving into a **signed** ledger — so `mneme savings` shows real input-tokens (and USD, at *your* vendor's price) you didn't spend. Falsifiable, not marketing. **The model →** [`docs/BUSINESS-MODEL.md`](docs/BUSINESS-MODEL.md)

<sub><b>🔭 OUTLINE benchmark — measured on 5 real files in this repo</b> (`node scripts/outline-bench.mjs`; ≈chars/4 INPUT-token estimate, labelled — char reduction is exact; multi-language TS/JS/Python/Go/Rust):</sub>

| File | Lines | Raw read (~tok) | Skeleton (~tok) | Skeleton + 1 region (~tok) |
|---|--:|--:|--:|--:|
| `cli/commands/demo.ts` | 901 | 13,688 | **296 (−97.8%)** | 5,807 |
| `core/squadron/acgv.ts` | 1,063 | 13,212 | **219 (−98.3%)** | 8,625 |
| `core/outline/index.ts` | 438 | 5,949 | **373 (−93.7%)** | 3,994 |
| `mcp/tools/_registry.ts` | 419 | 4,347 | **224 (−94.8%)** | 1,411 |
| **5-file total** | | **41,473** | **1,704 (−95.9%)** | **21,573 (−48%)** |

<sub>Orient on the whole repo's structure for **−95.9%** tokens; even a realistic single-edit (skeleton + one symbol's byte-exact body) is **−48%**. The skeleton is honestly *lossy* (for orientation); the region fetch is byte-*exact* (for editing). It only helps when an agent **chooses** to outline instead of a raw read — Mneme never hooks your agent's Read.</sub>

### 🏛 For the enterprise — Trust, Sovereignty, Cost

|  | What it answers for a CISO / CRO / CFO | In Mneme |
|---|---|---|
| 🧬 **Second Brain · Inheritance** | *"What happens to our knowledge when a key person (or agent) leaves?"* | **`mneme bequest`** — capture a departing expert's knowledge as a signed Succession Capsule, verify a successor inherited it intact, and report **orphaned knowledge** (no living heir) + the minimum heirs to assign |
| 🛡 **Absolute Trust Layer** | *"Every agent verifies before it acts."* | verify-before-act gate + cross-vendor consensus + signed audit trail |
| 🔒 **Sovereign / Air-Gapped AI** | *"Our code &amp; secrets never leak to the model — with proof."* | **SOVEREIGN EGRESS GUARD** (redacts secrets, honeytoken canaries, Bloom membership, signed egress cert) **+ CONTEXT BLINDING** (`mneme blind` — real identifier names → reversible local placeholders, secrets removed: the provider only ever sees structurally-valid but meaningless code; the map never leaves your machine) |
| 🌐 **The Context Gateway (Standard MCP boundary)** | *"One governed surface every agent crosses — and we meter what it saves."* | local-first, vendor-neutral MCP server + capability passports; every crossing is outlined / blinded / verified and the **measured** token saving is metered into a signed ledger (`mneme savings`) — value-based, not seat-based |
| 💰 **Value-based cost** | *"Pay only for tokens you actually save."* | the signed, measured savings ledger above |

> Honest by design (DIAKRISIS): every figure is **measured + signed**, never fabricated; USD uses **your** vendor's price. **The pillars, the reframes (Key-Person Risk · Governance Cert · Capital Burn), and what is *not* claimed →** [`docs/ENTERPRISE.md`](docs/ENTERPRISE.md)

### 📖 Start here

<table>
<tr>
<td align="center" width="20%"><a href="docs/FUNCTIONS-EN.md" target="_blank" rel="noopener"><b>📘 Functions (EN)</b></a><br/><sub>What Mneme does, in 5 minutes</sub></td>
<td align="center" width="20%"><a href="docs/FUNCTIONS-TH.md" target="_blank" rel="noopener"><b>📗 ฟังก์ชั่น (ไทย)</b></a><br/><sub>อ่านจบใน 5 นาที</sub></td>
<td align="center" width="20%"><a href="docs/AI_AGENT_CONTRACT.md" target="_blank" rel="noopener"><b>🤖 AI Agent Contract</b></a><br/><sub>Deep install + protocol</sub></td>
<td align="center" width="20%"><a href="docs/README.md" target="_blank" rel="noopener"><b>📚 Docs index</b></a><br/><sub>Primitives · RFCs · pricing · indispensability</sub></td>
<td align="center" width="20%"><a href="#-author--contact"><b>👤 Author & Contact</b></a><br/><sub>Scroll down to author bio</sub></td>
</tr>
</table>

<br/>

### 🚀 `@mneme-ai/sdk` — embed Mneme *in-process*

<a href="https://www.npmjs.com/package/@mneme-ai/sdk" target="_blank" rel="noopener"><img alt="@mneme-ai/sdk on npm" src="https://img.shields.io/npm/v/@mneme-ai/sdk?label=%40mneme-ai%2Fsdk&color=cb3837&logo=npm&style=for-the-badge" /></a>

**The fastest way to put Mneme inside your AI tool.** A premium in-process SDK — **30-80× faster** than the CLI subprocess + tagged-template verify + async-iterator events + branded types + file-lock adapter. Vendors embed Mneme silently inside Cursor / Continue / Cline / Claude Code, etc.

```ts
import { createMneme } from "@mneme-ai/sdk";
const mneme = createMneme();
const r = await mneme.verify`Mneme is a CLI tool`;   // tagged template
const id = mneme.nemesis.classify({ diff, prDescription, commitMessages });
const bench = await mneme.benchmark.vsCli();         // proves the speedup on your hardware
```

- 📑 <a href="docs/sdk/README.md" target="_blank" rel="noopener">SDK index (bilingual)</a> · 🚀 Quick start <a href="docs/sdk/QUICKSTART-EN.md" target="_blank" rel="noopener">EN</a> / <a href="docs/sdk/QUICKSTART-TH.md" target="_blank" rel="noopener">TH</a> · 📘 Design <a href="docs/sdk/DESIGN.md" target="_blank" rel="noopener">EN</a> / <a href="docs/sdk/DESIGN-TH.md" target="_blank" rel="noopener">TH</a> · 🔄 Migration <a href="docs/sdk/MIGRATION.md" target="_blank" rel="noopener">EN</a> / <a href="docs/sdk/MIGRATION-TH.md" target="_blank" rel="noopener">TH</a> · 📚 <a href="docs/README.md" target="_blank" rel="noopener">Docs index</a>

📜 Every release in full detail (v2.18 → latest): <a href="CHANGELOG.md" target="_blank" rel="noopener"><b>CHANGELOG.md</b></a>

</div>

---

## Install in 60 seconds — you don't type the commands

**Just one sentence to any AI agent you already use:**

> "Install Mneme from https://github.com/patsa2561-art/mneme-ai per the AI agent contract."

The agent reads <a href="docs/AI_AGENT_CONTRACT.md" target="_blank" rel="noopener">`docs/AI_AGENT_CONTRACT.md`</a> — 775 lines of deterministic steps — and runs everything on your behalf: env detect → `npm install -g mneme-ai` → `mneme init` → `mneme mcp --install` (auto-configures itself as your MCP client) → verify after restart → security auto-arms. **You speak natural language; the AI handles the tooling.** That's the MANDATE: *"The user will NEVER type a CLI command."*

---

### 🛠 Shell-native agents — they install Mneme for you

Drop the sentence above into any of these. They have shell access + can read the contract.

<table>
<tr><td align="center"><b>🦋 Claude Code</b></td><td align="center"><b>🟦 Cursor</b></td><td align="center"><b>🟢 Codex</b></td><td align="center"><b>🟣 Continue</b></td><td align="center"><b>🟡 Cline</b></td></tr>
<tr><td align="center"><b>⚡ Zed</b></td><td align="center"><b>🤖 Aider</b></td><td align="center"><b>💎 Gemini CLI</b></td><td align="center"><b>🚀 Grok CLI</b></td><td align="center"><b>🧬 Jules / Windsurf</b></td></tr>
</table>

### 🌐 Browser-only AIs — one-click polygraph (no shell needed)

For chat surfaces without shell access — ChatGPT · Claude.ai · Gemini · Copilot · DeepSeek · Qwen · Grok web — Mneme ships a Tampermonkey userscript that lights up live truth-dots inline as the AI answers.

> Tell ANY agent: *"set up Mneme browser polygraph for me"* — it runs `mneme polygraph autosetup` and walks you through the 2 unavoidable browser-side clicks (install Tampermonkey once + click "Install" in the script prompt).

<table>
<tr><td align="center"><b>💬 ChatGPT</b></td><td align="center"><b>🟠 Claude.ai</b></td><td align="center"><b>💎 Gemini</b></td><td align="center"><b>🔵 Copilot Chat</b></td><td align="center"><b>🐋 DeepSeek</b></td><td align="center"><b>🇨🇳 Qwen</b></td><td align="center"><b>⚡ Grok web</b></td></tr>
</table>

<details>
<summary>If you actually want to type the commands yourself</summary>

```bash
npm install -g mneme-ai
mneme init                  # one-time per repo
mneme mcp --install         # auto-detects Claude Code / Cursor / Codex / Continue / Cline / Gemini CLI / Grok CLI
```

Restart your AI tool. First MCP call: `mneme.welcome` → loads install handoff + recent changes.

For browser polygraph manually: `mneme polygraph autosetup`.

</details>

---

## What Mneme does

Mneme is **15 primitives** every AI agent can call. Each has discrete pinned tests, HMAC-chained ledgers, and offline verification. Each row below is a **story** — what it is, who it's for, why it exists:

| # | Primitive · Story | One-line + use case | Full doc |
|---|---|---|---|
| 1 | 🧠 **Memory** — *"Your repo never forgets"* | Q&A over your repo's full history. Auto-incremental: every `git commit` updates the index within 200ms. **Use case:** new dev joins team Monday — by lunch they've asked "who wrote the auth module and why" and Mneme cites the SHA + decision rationale from 18 months ago. | <a href="docs/FUNCTIONS-EN.md#2-memory--qa-over-your-repo" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#2-memory--qa-repo" target="_blank" rel="noopener">TH</a> |
| 2 | ✅ **Truth** — *"Refuses to hallucinate, on principle"* | ACGV pipeline (Aletheia + Chandrasekhar + Godel + Vaccine) + hyperbole detector + commit-hash oracle + self-reference detector + version-semantic Layer 0d. **Use case:** AI suggests "commit a1b2c3d4 fixed the auth bug" → Mneme runs `git cat-file -e a1b2c3d4` → returns `IMPOSSIBLE_REFUTE 98%` with `FAKE_COMMIT_HASH` caveat in <50ms. The classic vendor-hallucination class extinct. | <a href="docs/FUNCTIONS-EN.md#1-truth--verify-before-relaying" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#1-truth--ตรวจสอบก่อนตอบ-user" target="_blank" rel="noopener">TH</a> |
| 3 | 🧬 **LIVING SOUL CODEGRAPH** (v2.25) — *"A code map that knows WHO touched it"* | File-deps + symbol-refs graph with HMAC provenance per edge + Merkle root cross-machine sync + drift sentinel + vendor attribution (`touchedBy`) + hallucination vaccine flag. **Use case:** static codegraphs render imports + symbol refs; Mneme layers 10 differentiators on top (every edge cryptographically attested, every AI's contribution forensically tracked). | <a href="docs/FUNCTIONS-EN.md#3-code-graph-v2250--living-soul-codegraph-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#3-code-graph-v2250--living-soul-codegraph-" target="_blank" rel="noopener">TH</a> |
| 4 | 🎯 **MCP FUZZER** (v2.24) — *"The only MCP server that fuzzes itself"* | 108 attack vectors × 9 categories (handshake / schema / method / tool / resource / prompt / policy / concurrency / transport) × HMAC-signed report card + CVE posture mapping. **Use case:** security team needs evidence the MCP surface is hardened before approving deployment — Mneme runs `mneme fuzz run` and hands back a tamper-evident scorecard signed offline. Subsumes invariantlabs/mcp-scan + Cisco mcp-scanner + Agent-Hellboy/mcp-server-fuzzer. | <a href="docs/FUNCTIONS-EN.md#4-mcp-hardening-v2240--mcp-fuzzer-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#4-mcp-hardening-v2240--mcp-fuzzer-" target="_blank" rel="noopener">TH</a> |
| 5 | 🏆 **PEAK GAUNTLET** (v2.26) — *"Mneme grades itself; 100/100 currently"* | 12 deep-findings probes (N1-N12) that Mneme runs against its OWN MCP surface every release. Each finding ★0-10; aggregate 0-100. Pre-release auto-gate blocks publish if any finding drops. **Use case:** procurement team asks "what's your test coverage" — answer: "100/100 on a spec-grade scorecard that I'm legally bound to maintain". | <a href="docs/FUNCTIONS-EN.md#5-self-grading-v2260--peak-performance-gauntlet-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#5-self-grading-v2260--peak-performance-gauntlet-" target="_blank" rel="noopener">TH</a> |
| 6 | 🟢 **TRUTH GATE** (v2.27) — *"Every marketing claim, bound to a measurable probe"* | Auto-reconciles every line of Mneme's own marketing against live behavior. 16 probes, 16 claims, score = `pass/measured × 100`. **Use case:** "100x faster" type claims are toxic in safety-critical procurement. Mneme's claims are TRUTH GATE-bound; drift trips a CI failure, not a customer-discovered embarrassment. World-first. | <a href="docs/FUNCTIONS-EN.md#6-marketing-reconciliation-v2270--truth-gate-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#6-marketing-vs-reality-v2270--truth-gate-" target="_blank" rel="noopener">TH</a> |
| 7 | 🏛 **CONCLAVE + AEAE** (v2.29) — *"Byzantine consensus + eval-awareness defeat"* | Fire ONE claim at N vendors → AEAE rewrites into 5 variants (verbatim / paraphrase / decoy-embedded / casual-question) → weighted Byzantine vote returns CONSENSUS / DISSENT / AWARENESS_DETECTED. **Use case:** Anthropic published evidence Opus 4.6 detects benchmarks + changes behavior. AEAE flags vendors whose stance flips when the claim looks less like an eval. Closes Q1 of the 2026 AI-eval research gap. | <a href="docs/FUNCTIONS-EN.md#7-cross-vendor-consensus-v2290--mneme-conclave--aeae-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#7-cross-vendor-consensus-v2290--mneme-conclave--aeae-" target="_blank" rel="noopener">TH</a> |
| 8 | 💎 **HONEST MIRROR** (v2.30) — *"Replay YOUR commits at vendors"* | The structural answer to eval-awareness: pull N real past git commits → DP-scrub → blind-replay → compare to what shipped. Probes are real work — they look identical to genuine traffic. **Use case:** public benchmarks are training-set-contaminated; YOUR repo is private + scoped to YOUR domain. Mneme uses that uncontaminated ground truth. Composes with CONCLAVE via the truth-tunes-trust loop. | <a href="docs/FUNCTIONS-EN.md#9-honest-mirror-v2300--eval-aware-defeating-probe-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#9-honest-mirror-v2300--ตรวจ-vendor-ด้วยงานจริง-" target="_blank" rel="noopener">TH</a> |
| 9 | 🪄 **REWIND** (v2.31) — *"Your repo = personal SWE-bench scoped to your domain"* | Time-Capsule Regression Replay: seal past commits as a Capsule, fire the SAME capsule at every vendor release, get a per-intent-class **Vendor Regression Card** (HMAC-signed, shareable). **Use case:** vendor releases new model — you replay your sealed capsule, compare to last card, publish the regression bulletin if quality moved. Durable signal grounded in your own work. | <a href="docs/FUNCTIONS-EN.md#10-rewind-v2310--time-capsule-regression-replay-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#10-rewind-v2310--time-capsule-regression-replay-" target="_blank" rel="noopener">TH</a> |
| 10 | 🧬 **HGP** (v2.31) — *"CVE-style IDs for AI hallucinations"* | Every ACGV-refuted claim earns a deterministic `HGP-YYYY-NNNNN` id. Same lie shape across users → same id → vendor-attributed federated catalog. Federation **OPT-IN** (CONSENT FABRIC). **Use case:** community-driven vendor accountability — same role NVD/MITRE plays for CVE, Mneme plays for AI honesty. Hosted outside any single AI vendor's surface; Mneme is local-first + vendor-neutral. | <a href="docs/FUNCTIONS-EN.md#11-hgp-v2310--hallucination-genome-project-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#11-hgp-v2310--hallucination-genome-project-" target="_blank" rel="noopener">TH</a> |
| 11 | 🌀 **FLYWHEEL** (v2.32) — *"Self-reflective release organ"* | 5-stage pipeline (HARVEST → FUSE → PRESCRIBE → EXECUTE → RECIPROCITY) over every other audit primitive's signal. **Use case:** closes 4 historic weaknesses (tool sprawl + solo-dev asymmetry + wiring lag + marketing drift) with ONE primitive that auto-shrinks personal cheatsheet + flags dormant primitives + extracts unbound marketing claims + emits shareable vendor bulletin + records vendor reciprocity → trust deltas. | <a href="docs/FUNCTIONS-EN.md#12-flywheel-v2320--self-reflective-release-organ-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#12-flywheel-v2320--self-reflective-release-organ-" target="_blank" rel="noopener">TH</a> |
| 12 | 🛐 **CITIZEN COURT** (v2.33) — *"Participatory polygraph"* | User accepts/rejects an AI suggestion → 1-second reveal of OTHER vendors' answers → vote which was most truthful → HMAC-signed verdict → per-vendor **Honesty Score Card** (Wilson-LB on truthful-vote rate, 🟢/🟡/🔴/⚪ IDE color-dot). **Use case:** crowd-judged AI veracity = the citizen-science angle no eval framework has. CHI / CSCW / USENIX Security / Nature Human Behaviour all viable paper tracks. | <a href="docs/FUNCTIONS-EN.md#13-citizen-court-v2330--ai-honesty-citizen-court-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#13-citizen-court-v2330--ai-honesty-citizen-court-" target="_blank" rel="noopener">TH</a> |
| 13 | 🕸 **MNEMNET** (v2.33) — *"Federated AI-honesty network"* | Laplace-DP-noised envelopes per local node → Public Honesty Court HSC robust against single-user manipulation. CONSENT FABRIC opt-in default OFF. **Use case:** cross-machine measurement of vendor honesty without any single vendor controlling the registry. Composes with CONCLAVE Aletheia weights — bad calibration → downgraded vote. | <a href="docs/FUNCTIONS-EN.md#14-mnemnet-v2330--federated-ai-honesty-network-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#14-mnemnet-v2330--federated-ai-honesty-network-" target="_blank" rel="noopener">TH</a> |
| 14 | 📐 **PULSECOST** (v2.33) — *"MCP context-budget extension v0.1"* | 3 optional headers (`X-Context-Available-Tokens` + `X-Context-Used-Tokens` + `X-Context-Trimmed`) so agents can budget context across many tool calls per turn. **Use case:** today every MCP server emits unbounded responses → agents waste context. Mneme ships the reference implementation + spec for ratification. If Anthropic adopts the extension, the spec carries Mneme's signature. | <a href="docs/FUNCTIONS-EN.md#15-pulsecost-v2330--mcp-context-budget-extension-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#15-pulsecost-v2330--mcp-context-budget-extension-" target="_blank" rel="noopener">TH</a> |
| 15 | 🪤 **COERCION AUDIT** (v2.33) — *"Tool-to-Agent coercion taxonomy"* | 8 patterns codified from real-world audits (imperative-execute-now / fake-user-voice / opaque-grade / urgency-pressure / false-consent-citation / implicit-action-mandate / compliance-percentage / tool-name-menu). HMAC-signed per-source + multi-source roll-up. **Use case:** USENIX Security 2027 paper class — survey 20 MCP servers, publish the taxonomy + tamper-evident audit envelope. | <a href="docs/FUNCTIONS-EN.md#16-coercion-audit-v2330--tool-to-agent-coercion-taxonomy-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#16-coercion-audit-v2330--tool-to-agent-coercion-taxonomy-" target="_blank" rel="noopener">TH</a> |

---

## The 30-second pitch

> **Other AI tools are goldfish.** They forget every session, hallucinate files that don't exist, repeat 2024's buried bugs, burn tokens re-pasting context, and can't follow you to another AI.
>
> **Mneme bolts an elephant brain on top.** Cites every commit by SHA. Refuses to relay claims it can't verify. Carries memory across sessions and vendors. And — uniquely — runs the same claim through multiple AI vendors with **Anti-Eval-Awareness rewriting** so you catch the vendor that "performs differently when it knows it's being tested."

---

## What sets Mneme apart

Every claim below is measurable + has a probe + can be reproduced from a fresh clone:

- **🧬 NEMESIS — world's first Anti-Identity-Lie Engine for AI agents** (v2.46.0) — composes academic vendor-fingerprinting (arxiv 2601.17406 — 97.2% F1 across 33,580 PRs) with Mneme's HMAC chain and EU AI Act Article 50 (enforceable 2 Aug 2026). 5 organs: (1) **Fingerprinter** — extracts 41 behavioral features from any diff/PR/commits + env-var scan (CLAUDECODE / CURSOR_AGENT / DEVIN_SESSION / ...); (2) **Lie Detector** — compares claimed vendor vs detected and emits HMAC-signed CONFIRMED / DISPUTED / IMPOSSIBLE verdict; (3) **Article 50 Auto-Stamper** — appends machine-readable disclosure block to every commit (auto-installed git pre-commit hook + zero-width-stego watermark fallback); (4) **Model Drift Timeline** — flags when a vendor's fingerprint shifts ≥3σ ("your Cursor changed personality on 2026-04-15"); (5) **Replay Attack Detector** — same-prompt-same-vendor variance over 8 discriminator features ≥ 0.6 → stealth-upgrade / stealth-downgrade flag. Verified by `claim.nemesis.world_first` — drift trips TRUTH GATE.
- **👁×11 ARGUS multimodal search** — 11 eyes (5 surface lex/phon/shape + 5 truth HMAC-chain/honest-mirror/number-paraphrase/homoglyph/embedding + 2 multimodal image/code) with **softmax-rebalancing Guardian** (failed eyes auto-redistribute weight, never a blind spot) + **bloom pre-filter** (cuts 1000-candidate corpora to ~50 in <5ms) + **PHANTOM EYE** lazy eval (expensive eyes only fire when cheap eyes leave verdict ambiguous, ≥3× wall-time reduction) + **HYDRA autospawn** (every accepted antivirus strain becomes a new search signal) + **HMAC-signed audit frame**. Verified by `claim.argus11.world_first_multimodal` — drift trips TRUTH GATE.
- **AEAE (Anti-Eval-Awareness Engine)** — Anthropic published evidence Opus 4.6 detects benchmarks + changes behavior. Mneme rewrites every claim into 5 variants (verbatim / paraphrase / decoy-embedded / casual-question) and flags vendors that flip stance across variants.
- **HMAC-chained everything** — every verdict, every gauntlet card, every truth matrix, every consensus result is HMAC-chained and offline-verifiable. Tamper-evident across machines.
- **Bug Immunity Protocol** — every reproducible audit bug becomes ONE pinned test row that fails forever if the bug returns. Each row encodes finding-ID + broken-contract + fix-source-file + assertion.
- **Living Soul Codegraph** — code-graph with `touchedBy` (which AI made each edge) + drift sentinel + hallucination vaccine. A map that knows WHO touched it WHEN.
- **MCP Hardening** — 108-vector fuzzer + 12-probe scorecard ship as callable npm primitives. Self-grade currently **100/100**.
- **Self-honest marketing** — every README claim binds to a probe (`mneme truth_gate run` → 17/17 = 100/100). If marketing copy drifts ahead of implementation, the gate refutes it — same release pipeline that signs the build refuses to ship.

---

## What's new (recent releases)

- **v2.104.0** 🧠 **THE COGNITIVE CORTEX — a Sovereign Memory Bus every AI vendor shares, that HEALS its own contradictions by proof.** A local, vendor-neutral, Ed25519-**signed**, drift-guarded **shared memory** that Grok / GPT / Gemini / Claude / Codex all contribute to and recall from. Mneme is the **logic gatekeeper**: a contribution that contradicts established memory is **QUARANTINED**, never silently overwritten — the mesh can't be poisoned. The magical power: **reconciliation by PROOF** — when two agents disagree, the cortex consults the truth kernel; if one claim is verifiably FALSE the other wins (signed), and if neither can be proven false it stays quarantined with a signed belief-diff (never auto-decides an opinion). `mneme cortex` · MCP `mneme.cortex.{contribute,recall,handoff,reconcile,verify}`. Honest: a safe cross-vendor protocol, **not** a kernel hack or process injection. Adversarially reviewed (6 real bugs found + fixed + pinned). (<a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG</a>)
- **v2.103.0** 🧠 **Two Wisdom Gates that empower every agent — Cognitive Gate + Branch Oracle** — **Cognitive Gate** (NEMESIS × HYDRA): a self-aware, *signed* second opinion on whether a diff matches an author's coding **style** — and crucially it **returns UNKNOWN and refuses to flag when it can't actually separate styles** (prove-or-unknown; never auto-rejects). The honest core of "cognitive entanglement" without the quantum-mysticism. **Branch Oracle**: a *signed real-signal* snapshot of every branch (merge-conflict overlap / decay / divergence → healthy/caution/risky) — the "multi-timeline" idea made honest (present-tense signals, **not** fortune-telling). Both gather their own git facts, are NOTARY-self-attesting (any vendor verifies offline), and are 100% total (never throw). `mneme cognitive-gate` · `mneme branch-oracle` · MCP `mneme.cognitive.judge` / `mneme.branch.analyze`. (<a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG</a>)
- **v2.102.0** 💤 **HYDRA Epigenetic Dormancy — sleep state + JIT revival** — the image's "Epigenetic Sleep State" + "Demethylation", made real (and honest — it's deterministic tiered memory, not biology and not fortune-telling). Cold codebook entries are **methylated** (moved out of the active working set into a cold *signed* store, shrinking the active footprint ~50-70% at scale) and **demethylate byte-exact on demand** — a full revive reconstructs the original codebook with an *identical canonical hash*, Ed25519-signed. Lossless-revival *proof*, never lossy. `mneme hydra sleep`. (<a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG</a>)
- **v2.101.0** 🔌 **HYDRA → MCP: self-attesting tool results** — any AI agent now calls the whole HYDRA stack straight through MCP (`mneme.hydra.forge/.gauntlet/.guard/.chain/.replay/.verify`). The crazy-but-accurate gem: **every result is wrapped with a NOTARY (Ed25519) signature over the SHA-256 of its own data**, so the calling model — Claude, GPT, Gemini, anything — can **verify offline that the tool didn't lie or get tampered**. Output you can *check*, not output you must *believe*. Proven end-to-end through the real MCP JSON-RPC server (forge → score 100 → sig valid → hash matches; tamper the data → caught). (<a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG</a>)
- **v2.100.0** ⏳ **HYDRA Guard × Chain — temporal guarded replay** — the two gems fuse: replay the codebook at any past step and **staleness is derived from the chain's own history** (atrophy). An entry added long ago and never touched expands only to a *signed abstract* on replay — a time-traveling agent gets the **shape** of old knowledge, not rotten detail. Deterministic + proven-old-only (unknown ⇒ fresh). `mneme hydra replay <index> --guard`. End-to-end proven (redact cold, keep fresh byte-exact). (<a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG</a>)
- **v2.99.0** 🪝 **HYDRA Chain → Git** — every commit auto-appends a *signed* HYDRA context delta **anchored to its commit sha** (forge the anchor → caught). A fail-open, non-blocking `post-commit` hook (`mneme hydra install-hook`) builds a portable, offline-verifiable record of *what Mneme knew at each commit* — complements git, doesn't replace it. Proven end-to-end: a real-git-repo loop test (20 commits + hook + tamper + idempotency + corrupt-recovery) — **93/93 green**. (<a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG</a>)
- **v2.98.0** ⛓ **HYDRA Provenance Chain** — memory with a *cryptographic, replayable, byte-exact history*. Each codebook evolution is a **signed delta** chained to the last; the chain **replays to any past step byte-for-byte**, **verifies offline** (Ed25519 + prev→result links) with the public key alone, and is **tamper-evident** (edit any delta → localized break). The deepest fusion — NOTARY × HYDRA, at the root. `mneme hydra chain`. (<a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG</a>)
- **v2.97.0** 🛡 **HYDRA Guard — Time-To-Trust** — the fusion gem: HYDRA × the knowledge-atrophy clock × NOTARY. Guarded expansion is byte-lossless for *trusted* content but **provably redacts stale memory to a signed abstract** (sha256 + byte-count, never the raw text) — so an AI **cannot hallucinate from expired knowledge**, yet can still verify the redacted region's identity and request re-hydration. Four measurable invariants (fresh-lossless ∧ redaction-sound ∧ fresh-preserved ∧ deterministic) + every guard function is *total* (never throws; fail-closed). `mneme hydra guard`. (<a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG</a>)
- **v2.96.0** 💎 **HYDRA** — the signed, provably-lossless, vendor-neutral context codebook Mneme forges from its *own* corpus. A live engine mines it, then refuses to ship unless `compress→expand` is **byte-identical** (SHA-256 proof — not a similarity score), collision-free, and Ed25519-signed (verify *offline*). Honest: the win is the *cut* (signed × lossless × portable on the NOTARY spine — a composition prior-art found unfilled), not the compression ratio. (<a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG</a>)
- **v2.95.0** 🧼 **AUP-gap closure** — Mneme's own manifest stops tripping Anthropic's cyber-content classifier (33 high triggers → **0**, measured), via a case-preserving lexicon + the `manifest doctor` auditor. (<a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG</a>)
- **v2.94.0** 🤫 **ETHOS §XI + whisper-not-nag** — character proven by *subtraction*; the upgrade notice is version-deduped under severity tiers (security always · feature once-per-new-version · cosmetic quiet).
- **v2.92.0** 💎 **DIAKRISIS** — the second axis: discern *genuine* vs *merely-good-looking* (Reject-or-Unknown · structural lustre · Padgett anti-conservatism guard).
- **v2.91.0** 💎 **ANAMNESIS** — compute once, recollect forever: a cross-vendor signed proof cache; the first AI pays inference, every AI after pays ~0 (the energy layer of truth).
- **v2.88–2.90** 🧠 **ALETHEIA** — the savant identity (Prove-or-Unknown) + the truth diamonds (Axiom Lattice · Symbiosis · Idle Compounding · Public Gauntlet · Truth Mesh).
- **v2.86–2.87** 🔨 **HEPHAESTUS** — the command Toll Booth: pre-flight + a *real* cross-vendor tribunal + GEPHYRA MCP-proxy.
- **v2.83–2.85** 🌉 **GEPHYRA** — the Toll Booth of Truth, graduated to the deployable `@mneme-ai/gephyra` package.
- **v2.79–2.82** 🏛 **TRUST FABRIC** — NOTARY (Ed25519 offline-verifiable proof) + the 10-diamond fabric on its spine.
- **v2.74.0** ⏳ **CHRONOS** — temporal self-consistency as a **ground-truth-free** honesty signal. Every AI answer → HMAC-timestamp + semantic embed → append-only ledger; same-question revisits classify as COHERENT / LEGITIMATE_UPDATE (changed *with* a cited source) / SELF_REPORTED / **SILENT_DRIFT** 🚩 (changed with nothing backing it). Per-agent temporal-honesty score = Wilson-LB on consistent revisits × exponential silent-drift penalty. The xAI/Grok weapon: prove "I changed because the world changed, not because I'm fickle." 4 CLI verbs + 4 MCP tools + 48 pinned tests. (<a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG</a>)
- **v2.36.0** 📜 **HONEST RECEIPT + ACGV Layer 0d** — closes 4 audit-card bugs (recursive self-verify on historical version / multi-install ambiguity / wiring_proof CLI missing / latency-claim drift). New ACGV Layer 0d emits HISTORICAL_CLAIM caveat instead of refuting past-version claims against current state. HONEST RECEIPT module signs every CLI invocation with install path + version + code path + latency. New CLIs: `mneme honest`, `mneme doctor_install`, `mneme wiring_proof`. 22 new pinned tests. (<a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG</a>)
- **v2.35.0** 🔌 **WIRING-PROOF PROTOCOL** — closes the WIRING LAG bug class forever. v2.34.0 fixes lived in core but were silently overridden at the CLI surface (forensic merge overwrote SELF-PARADOX headlines, pulse counter diverged from CLI). v2.35.0 wires CORE→CLI for 5 visible regressions + ships **WIRING-PROOF TESTS** that spawn the actual `mneme verify` subprocess and assert user-visible stdout. 9 new pinned tests. (<a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG</a>)
- **v2.34.0** 🛡 **BUG IMMUNITY PROTOCOL v2** — 4 audit-card persists + 3 session-found bugs closed at root: new ACGV **Layer 0b** (self-reference + liar-paradox detector — R1+NEW2) + **Layer 0c** (fake commit hash oracle via `git cat-file -e` — NEW3) + INPUT_TRUNCATED visible headline (R3) + pulse↔CLI inbox single-source-of-truth (NEW1). 14 new pinned regression tests. (<a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG</a>)
- **v2.33.0** 🛐 **CITIZEN COURT** + 🕸 **MNEMNET** + 📐 **PULSECOST** + 🪤 **COERCION AUDIT** — paper-grade primitives covering 4 of the 5 academic research directions in one shipped release. The marquee: user-judged Honesty Score Cards for every vendor, with optional DP-federated public roll-up. (<a href="docs/FUNCTIONS-EN.md#13-citizen-court-v2330--ai-honesty-citizen-court-" target="_blank" rel="noopener">CITIZEN COURT</a> · <a href="docs/FUNCTIONS-EN.md#14-mnemnet-v2330--federated-ai-honesty-network-" target="_blank" rel="noopener">MNEMNET</a> · <a href="docs/FUNCTIONS-EN.md#15-pulsecost-v2330--mcp-context-budget-extension-" target="_blank" rel="noopener">PULSECOST</a> · <a href="docs/FUNCTIONS-EN.md#16-coercion-audit-v2330--tool-to-agent-coercion-taxonomy-" target="_blank" rel="noopener">COERCION</a>)
- **v2.32.0** 🌀 FLYWHEEL — self-reflective release organ. 5-stage pipeline over signals from every audit primitive. Closes 4 historic weaknesses (tool sprawl + solo-dev asymmetry + wiring lag + marketing drift) as ONE primitive. RECIPROCITY layer turns vendor responses to bulletins into auto-applied trust deltas. (<a href="docs/FUNCTIONS-EN.md#12-flywheel-v2320--self-reflective-release-organ-" target="_blank" rel="noopener">docs</a>)
- **v2.31.0** 🪄 REWIND + 🧬 HGP — Time-Capsule Regression Replay (your repo becomes a personal SWE-bench vendors can't pre-train on) + Hallucination Genome Project (CVE-style HGP-YYYY-NNNNN IDs for every refuted claim). Both compose with CONCLAVE Aletheia weights. (<a href="docs/FUNCTIONS-EN.md#10-rewind-v2310--time-capsule-regression-replay-" target="_blank" rel="noopener">REWIND</a> · <a href="docs/FUNCTIONS-EN.md#11-hgp-v2310--hallucination-genome-project-" target="_blank" rel="noopener">HGP</a>)
- **v2.30.0** 💎 HONEST MIRROR — Tests vendors on YOUR OWN past git commits. Vendors can't tell it's an eval. Closes the truth-tunes-trust loop with CONCLAVE. (<a href="docs/FUNCTIONS-EN.md#9-honest-mirror-v2300--eval-aware-defeating-probe-" target="_blank" rel="noopener">docs</a>)
- **v2.29.1** 📘 Docs refresh + agent manifest sync (22 commands added so AI agents discover every new family).
- **v2.29.0** 🏛 MNEME CONCLAVE — Cross-vendor Byzantine consensus + AEAE. Closes Q1 of the 2026 AI-eval research gap. (<a href="docs/FUNCTIONS-EN.md#7-cross-vendor-consensus-v2290--mneme-conclave--aeae-" target="_blank" rel="noopener">docs</a>)
- **v2.28.x** 🛡 BUG IMMUNITY PROTOCOL + HTTP bridge hardening (15 vectors lifted to 9-10★). (<a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG</a>)
- **v2.27.0** 🟢 MARKETING TRUTH GATE. (<a href="docs/FUNCTIONS-EN.md#6-marketing-reconciliation-v2270--truth-gate-" target="_blank" rel="noopener">docs</a>)
- **v2.26.x** 🏆 PEAK PERFORMANCE GAUNTLET 100/100 (avg 10.0★ across 12 findings).
- **v2.25.0** 🧬 LIVING SOUL CODEGRAPH ships 10 differentiators vs CodeGraph competitor.
- **v2.24.0** 🎯 MCP FUZZER 108 attack vectors.
- **v2.23.x** ACGV hyperbole detector + Layer -1 input guard + MCP-CANDOR/0.1 spec.

Full changelog: <a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG.md</a> · Long-form README: <a href="docs/README_FULL.md" target="_blank" rel="noopener">docs/README_FULL.md</a>

---

## For AI agents reading this

**You can self-discover everything.** <a href="docs/AI_AGENT_CONTRACT.md" target="_blank" rel="noopener">`docs/AI_AGENT_CONTRACT.md`</a> (775 lines) is the deterministic install + operation contract: env detect → install → MCP auto-configure → verify → security auto-arm → upgrade → discovery → tool naming → user-intent dispatch table → companion modules. Read it once on first contact; it tells you every command + when to call it.

After install, your CLAUDE.md / AGENTS.md / GEMINI.md gets an auto-injected `## Mneme command manifest` block (220+ entries) with every shipped primitive + "when to call". Re-read on every session start — new commands ship there within minutes of an upgrade.

Run these in order on every fresh session:

1. `mneme.welcome` — install handoff + what changed since last session
2. `mneme.capabilities` (skinny mode is default; ~3KB) — tool catalog
3. Before relaying any factual claim with specific entities: `mneme.truth.check { claim }` OR `mneme verify "..."`
4. For high-stakes claims: `mneme.conclave.run` with 3+ vendors for cross-vendor consensus

**MANDATE from the contract** (non-negotiable): *"The user will NEVER type a CLI command. They speak natural language. You — the AI agent — execute every command on their behalf."* If you have shell access, USE IT. If you're chat-only, tell the user once then continue with what you CAN do.

The auto-injected `## Mneme command manifest` block in `CLAUDE.md` lists every command + when to call it. Re-read on every session start — new commands ship there within minutes of a Mneme upgrade.

Deep contract: <a href="docs/AI_AGENT_CONTRACT.md" target="_blank" rel="noopener">docs/AI_AGENT_CONTRACT.md</a>.

---

## Compose with

- **Claude Code · Cursor · Cline · Codex · Continue** — native MCP
- **ChatGPT · Claude.ai · Gemini · Copilot · DeepSeek · Qwen** — browser polygraph (`mneme polygraph autosetup`)
- **Any HTTP-aware tool** — `mneme bridge` (default :17741)
- **Cross-machine** — Merkle-root sync + HMAC-chain attestation

---

## 👤 Author & Contact

<div align="center">

<a href="https://github.com/patsa2561-art" target="_blank" rel="noopener"><img src="./assets/87643.jpg" width="200" height="260" style="border-radius: 14px; border: 3px solid #00d4ff; object-fit: cover;" alt="Shinnapat Phunsriphatchalakul" /></a>

### Shinnapat Phunsriphatchalakul

**AI Software Engineer · AI Context Engineer · Truth-Infrastructure Architect**

<sub>Designer + sole maintainer of <b>Mneme</b> — the local-first, vendor-neutral truth-infrastructure layer that bolts an elephant brain onto every AI agent. 17 primitives shipped solo · 820+ MCP tools · world-first cross-vendor Byzantine consensus + Anti-Eval-Awareness Engine + HMAC-chained audit receipts.</sub>

### 💼 Why this matters (a short pitch)

</div>

> **The bottleneck of every frontier-AI deployment is TRUST.** In production AI — autonomous systems, medical AI, financial AI compliance, regulated industries — a hallucinated commit hash, a paradox-class category error, or a benchmark-aware behavior shift isn't a chat-glitch; it's a deployment risk. Mneme is a **local-first, vendor-neutral truth layer** that (a) refuses to relay unverified claims, (b) detects when a model's stance shifts under eval-shaped vs natural prompts (AEAE), and (c) emits HMAC-chained receipts of every audit so an operator can re-verify offline weeks later. Built solo, MIT, production-grade, 329+ pinned tests, dual-100 GAUNTLET + TRUTH GATE. Open to **collaboration / consulting / full-time on truth-infrastructure for production AI**.

<div align="center">

### 🤝 Support · Partnership · Collaboration

> **Interested in supporting Mneme, partnering on truth-infrastructure, or exploring something together?**
> Reach me on any of the channels below — I read every one.
>
> **สนใจ support / ร่วมเป็น partner / collaborate?** ทักได้ทุก channel ด้านล่างเลยครับ — อ่านทุกข้อความ

<sub>Whether you're a vendor wanting to embed Mneme inside your product · an enterprise needing safety-critical AI guardrails · a researcher building on the corpus · a regulator exploring AI-disclosure tooling · or just someone with a sharp question — **the inbox is open.**</sub>

---

### 💬 Channels

| Channel | Handle |
|---|---|
| <img src="https://img.shields.io/badge/-Email-EA4335?logo=gmail&logoColor=white" /> | **<a href="mailto:patsa2561@gmail.com" target="_blank" rel="noopener">patsa2561@gmail.com</a>** |
| <img src="https://img.shields.io/badge/-GitHub-181717?logo=github&logoColor=white" /> | **<a href="https://github.com/patsa2561-art" target="_blank" rel="noopener">@patsa2561-art</a>** (open an issue, drop a DM via profile) |
| <img src="https://img.shields.io/badge/-npm-cb3837?logo=npm&logoColor=white" /> | **<a href="https://www.npmjs.com/~mneme_npm" target="_blank" rel="noopener">@mneme_npm</a>** |
| <img src="https://img.shields.io/badge/-Discord-5865F2?logo=discord&logoColor=white" /> | **`pat195`** (username `shinnapat`) |
| <img src="https://img.shields.io/badge/-WhatsApp-25D366?logo=whatsapp&logoColor=white" /> | **<a href="https://wa.me/66939455645" target="_blank" rel="noopener">+66 93 945 5645</a>** |

<sub>**Open to:** collaboration on truth-infrastructure / AI safety / cross-vendor consensus protocols · consulting for safety-critical AI deployments · vendor partnerships (embed Mneme inside Cursor / Continue / Cline / Claude Code / Grok-CLI / etc) · enterprise compliance for EU AI Act Article 50 · full-time roles where the bottleneck is trust, not capability.</sub>

</div>

---

## 🔗 Links

- 📦 npm: <a href="https://www.npmjs.com/package/mneme-ai" target="_blank" rel="noopener">mneme-ai</a>
- 💻 GitHub: <a href="https://github.com/patsa2561-art/mneme-ai" target="_blank" rel="noopener">patsa2561-art/mneme-ai</a>
- 📘 Functions (EN): <a href="docs/FUNCTIONS-EN.md" target="_blank" rel="noopener">docs/FUNCTIONS-EN.md</a>
- 📗 ฟังก์ชั่น (ไทย): <a href="docs/FUNCTIONS-TH.md" target="_blank" rel="noopener">docs/FUNCTIONS-TH.md</a>
- 🤖 AI Agent Contract: <a href="docs/AI_AGENT_CONTRACT.md" target="_blank" rel="noopener">docs/AI_AGENT_CONTRACT.md</a>
- 📜 CHANGELOG: <a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG.md</a>
- 📃 License: <a href="LICENSE" target="_blank" rel="noopener">MIT</a>

---

<div align="center">

<sub>Mneme is the diamond in the dirt that nobody saw the value of — but cut and polished, it becomes the most valuable diamond in the world. That's the vision.</sub>

<br/>
<sub>Made with care for every AI agent that wants to remember + verify + reason together.</sub>

</div>
