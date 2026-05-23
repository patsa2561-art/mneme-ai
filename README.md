<div align="center">

<img src="./assets/title.svg" alt="μνήμη · Mneme" width="640">

# Memory · Truth · Consensus — for every AI agent

<sub><b>μνήμη · NEE-meh · Greek for "memory."</b> The brain that bolts onto Claude Code / Cursor / Cline / Codex / Continue / ChatGPT / Gemini. Remembers across sessions + vendors. Refuses to hallucinate. Cross-vendor Byzantine consensus when it matters. <b>Local-first. Vendor-neutral. MIT.</b></sub>

<br/><br/>

<a href="https://www.npmjs.com/package/mneme-ai" target="_blank" rel="noopener"><img alt="npm" src="https://img.shields.io/npm/v/mneme-ai?label=npm&color=cb3837&logo=npm&style=for-the-badge" /></a>
<a href="docs/AI_AGENT_CONTRACT.md" target="_blank" rel="noopener"><img alt="MCP tools" src="https://img.shields.io/badge/MCP%20tools-820%2B-c084fc?style=for-the-badge" /></a>
<a href="docs/FUNCTIONS-EN.md" target="_blank" rel="noopener"><img alt="GAUNTLET" src="https://img.shields.io/badge/PEAK%20GAUNTLET-100%2F100-2da44e?style=for-the-badge" /></a>
<a href="docs/FUNCTIONS-EN.md" target="_blank" rel="noopener"><img alt="TRUTH GATE" src="https://img.shields.io/badge/TRUTH%20GATE-100%2F100-2da44e?style=for-the-badge" /></a>
<a href="LICENSE" target="_blank" rel="noopener"><img alt="license MIT" src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" /></a>

<br/><br/>

### 📖 Start here

<table>
<tr>
<td align="center" width="25%"><a href="docs/FUNCTIONS-EN.md" target="_blank" rel="noopener"><b>📘 Functions (EN)</b></a><br/><sub>What Mneme does, in 5 minutes</sub></td>
<td align="center" width="25%"><a href="docs/FUNCTIONS-TH.md" target="_blank" rel="noopener"><b>📗 ฟังก์ชั่น (ไทย)</b></a><br/><sub>อ่านจบใน 5 นาที</sub></td>
<td align="center" width="25%"><a href="docs/AI_AGENT_CONTRACT.md" target="_blank" rel="noopener"><b>🤖 AI Agent Contract</b></a><br/><sub>Deep install + protocol</sub></td>
<td align="center" width="25%"><a href="#-author--contact" target="_blank" rel="noopener"><b>👤 Contact me</b></a><br/><sub>Author · stack · DM</sub></td>
</tr>
</table>

</div>

---

## Install (60 seconds — you don't type the commands)

**Tell your AI agent (Claude Code / Cursor / Codex / Continue / Cline / Zed / Aider) one sentence:**

> "Install Mneme from https://github.com/patsa2561-art/mneme-ai per the AI agent contract."

The agent reads <a href="docs/AI_AGENT_CONTRACT.md" target="_blank" rel="noopener">`docs/AI_AGENT_CONTRACT.md`</a> — 775 lines of deterministic steps — and runs everything on your behalf: env detect → `npm install -g mneme-ai` → `mneme init` → `mneme mcp --install` (auto-configures itself as your MCP client) → verify after restart → security auto-arms. **You speak natural language; the AI handles the tooling.** That's the MANDATE in the contract: *"The user will NEVER type a CLI command."*

<details>
<summary>If you DO want to type the commands yourself (chat-only AI, no shell access)</summary>

```bash
npm install -g mneme-ai
mneme init                  # one-time per repo
mneme mcp --install         # auto-detects Claude Code / Cursor / Codex / Continue
```

Restart your AI tool. First MCP call: `mneme.welcome` → loads install handoff + recent changes.

</details>

For browser polygraph (live dots on claude.ai / chatgpt.com / gemini), tell your AI agent: *"set up Mneme browser polygraph"* — it runs `mneme polygraph autosetup` for you.

---

## What Mneme does

Mneme is **15 primitives** every AI agent can call. Each has discrete pinned tests, HMAC-chained ledgers, and offline verification. Each row below is a **story** — what it is, who it's for, why it exists:

| # | Primitive · Story | One-line + use case | Full doc |
|---|---|---|---|
| 1 | 🧠 **Memory** — *"Your repo never forgets"* | Q&A over your repo's full history. Auto-incremental: every `git commit` updates the index within 200ms. **Use case:** new dev joins team Monday — by lunch they've asked "who wrote the auth module and why" and Mneme cites the SHA + decision rationale from 18 months ago. | <a href="docs/FUNCTIONS-EN.md#2-memory--qa-over-your-repo" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#2-memory--qa-repo" target="_blank" rel="noopener">TH</a> |
| 2 | ✅ **Truth** — *"Refuses to hallucinate, on principle"* | ACGV pipeline (Aletheia + Chandrasekhar + Godel + Vaccine) + hyperbole detector + commit-hash oracle + self-reference detector + version-semantic Layer 0d. **Use case:** AI suggests "commit a1b2c3d4 fixed the auth bug" → Mneme runs `git cat-file -e a1b2c3d4` → returns `IMPOSSIBLE_REFUTE 98%` with `FAKE_COMMIT_HASH` caveat in <50ms. The classic vendor-hallucination class extinct. | <a href="docs/FUNCTIONS-EN.md#1-truth--verify-before-relaying" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#1-truth--ตรวจสอบก่อนตอบ-user" target="_blank" rel="noopener">TH</a> |
| 3 | 🧬 **LIVING SOUL CODEGRAPH** (v2.25) — *"A code map that knows WHO touched it"* | File-deps + symbol-refs graph with HMAC provenance per edge + Merkle root cross-machine sync + drift sentinel + vendor attribution (`touchedBy`) + hallucination vaccine flag. **Use case:** competitor ships static codegraph; Mneme ships same map + 10 differentiators no static graph can match (every edge cryptographically attested, every AI's contribution forensically tracked). | <a href="docs/FUNCTIONS-EN.md#3-code-graph-v2250--living-soul-codegraph-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#3-code-graph-v2250--living-soul-codegraph-" target="_blank" rel="noopener">TH</a> |
| 4 | 🎯 **MCP FUZZER** (v2.24) — *"The only MCP server that fuzzes itself"* | 108 attack vectors × 9 categories (handshake / schema / method / tool / resource / prompt / policy / concurrency / transport) × HMAC-signed report card + CVE posture mapping. **Use case:** security team needs evidence the MCP surface is hardened before approving deployment — Mneme runs `mneme fuzz run` and hands back a tamper-evident scorecard signed offline. Subsumes invariantlabs/mcp-scan + Cisco mcp-scanner + Agent-Hellboy/mcp-server-fuzzer. | <a href="docs/FUNCTIONS-EN.md#4-mcp-hardening-v2240--mcp-fuzzer-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#4-mcp-hardening-v2240--mcp-fuzzer-" target="_blank" rel="noopener">TH</a> |
| 5 | 🏆 **PEAK GAUNTLET** (v2.26) — *"Mneme grades itself; 100/100 currently"* | 12 deep-findings probes (N1-N12) that Mneme runs against its OWN MCP surface every release. Each finding ★0-10; aggregate 0-100. Pre-release auto-gate blocks publish if any finding drops. **Use case:** procurement team asks "what's your test coverage" — answer: "100/100 on a spec-grade scorecard that I'm legally bound to maintain". | <a href="docs/FUNCTIONS-EN.md#5-self-grading-v2260--peak-performance-gauntlet-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#5-self-grading-v2260--peak-performance-gauntlet-" target="_blank" rel="noopener">TH</a> |
| 6 | 🟢 **TRUTH GATE** (v2.27) — *"Every marketing claim, bound to a measurable probe"* | Auto-reconciles every line of Mneme's own marketing against live behavior. 16 probes, 16 claims, score = `pass/measured × 100`. **Use case:** "100x faster" type claims are toxic in safety-critical procurement. Mneme's claims are TRUTH GATE-bound; drift trips a CI failure, not a customer-discovered embarrassment. World-first. | <a href="docs/FUNCTIONS-EN.md#6-marketing-reconciliation-v2270--truth-gate-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#6-marketing-vs-reality-v2270--truth-gate-" target="_blank" rel="noopener">TH</a> |
| 7 | 🏛 **CONCLAVE + AEAE** (v2.29) — *"Byzantine consensus + eval-awareness defeat"* | Fire ONE claim at N vendors → AEAE rewrites into 5 variants (verbatim / paraphrase / decoy-embedded / casual-question) → weighted Byzantine vote returns CONSENSUS / DISSENT / AWARENESS_DETECTED. **Use case:** Anthropic published evidence Opus 4.6 detects benchmarks + changes behavior. AEAE flags vendors whose stance flips when the claim looks less like an eval. Closes Q1 of the 2026 AI-eval research gap. | <a href="docs/FUNCTIONS-EN.md#7-cross-vendor-consensus-v2290--mneme-conclave--aeae-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#7-cross-vendor-consensus-v2290--mneme-conclave--aeae-" target="_blank" rel="noopener">TH</a> |
| 8 | 💎 **HONEST MIRROR** (v2.30) — *"Replay YOUR commits at vendors"* | The structural answer to eval-awareness: pull N real past git commits → DP-scrub → blind-replay → compare to what shipped. Vendors **can't tell it's an eval** because the probes ARE real work. **Use case:** vendor benchmarks are training-set-contaminated; YOUR repo is private + scoped to YOUR domain. Only Mneme is in position to use it as ground truth. Composes with CONCLAVE via the truth-tunes-trust loop. | <a href="docs/FUNCTIONS-EN.md#9-honest-mirror-v2300--eval-aware-defeating-probe-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#9-honest-mirror-v2300--ตรวจ-vendor-ด้วยงานจริง-" target="_blank" rel="noopener">TH</a> |
| 9 | 🪄 **REWIND** (v2.31) — *"Your repo = personal SWE-bench vendors can't pre-train on"* | Time-Capsule Regression Replay: seal past commits as a Capsule, fire the SAME capsule at every vendor release, get a per-intent-class **Vendor Regression Card** (HMAC-signed, shareable). **Use case:** vendor releases new model — you replay your sealed capsule, compare to last card, post the regression bulletin publicly if quality dropped. Asymmetric leverage vs vendors. | <a href="docs/FUNCTIONS-EN.md#10-rewind-v2310--time-capsule-regression-replay-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#10-rewind-v2310--time-capsule-regression-replay-" target="_blank" rel="noopener">TH</a> |
| 10 | 🧬 **HGP** (v2.31) — *"CVE-style IDs for AI hallucinations"* | Every ACGV-refuted claim earns a deterministic `HGP-YYYY-NNNNN` id. Same lie shape across users → same id → vendor-attributed federated catalog. Federation **OPT-IN** (CONSENT FABRIC). **Use case:** community-driven vendor accountability — same role NVD/MITRE plays for CVE, Mneme plays for AI honesty. Vendors have conflict-of-interest hosting this; Mneme is local-first + vendor-neutral. | <a href="docs/FUNCTIONS-EN.md#11-hgp-v2310--hallucination-genome-project-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#11-hgp-v2310--hallucination-genome-project-" target="_blank" rel="noopener">TH</a> |
| 11 | 🌀 **FLYWHEEL** (v2.32) — *"Self-reflective release organ"* | 5-stage pipeline (HARVEST → FUSE → PRESCRIBE → EXECUTE → RECIPROCITY) over every other audit primitive's signal. **Use case:** closes 4 historic weaknesses (tool sprawl + solo-dev asymmetry + wiring lag + marketing drift) with ONE primitive that auto-shrinks personal cheatsheet + flags dormant primitives + extracts unbound marketing claims + emits shareable vendor bulletin + records vendor reciprocity → trust deltas. | <a href="docs/FUNCTIONS-EN.md#12-flywheel-v2320--self-reflective-release-organ-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#12-flywheel-v2320--self-reflective-release-organ-" target="_blank" rel="noopener">TH</a> |
| 12 | 🛐 **CITIZEN COURT** (v2.33) — *"Participatory polygraph"* | User accepts/rejects an AI suggestion → 1-second reveal of OTHER vendors' answers → vote which was most truthful → HMAC-signed verdict → per-vendor **Honesty Score Card** (Wilson-LB on truthful-vote rate, 🟢/🟡/🔴/⚪ IDE color-dot). **Use case:** crowd-judged AI veracity = the citizen-science angle no eval framework has. CHI / CSCW / USENIX Security / Nature Human Behaviour all viable paper tracks. | <a href="docs/FUNCTIONS-EN.md#13-citizen-court-v2330--ai-honesty-citizen-court-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#13-citizen-court-v2330--ai-honesty-citizen-court-" target="_blank" rel="noopener">TH</a> |
| 13 | 🕸 **MNEMNET** (v2.33) — *"Federated AI-honesty network"* | Laplace-DP-noised envelopes per local node → Public Honesty Court HSC that **no single user can game**. CONSENT FABRIC opt-in default OFF. **Use case:** the only place a vendor's honesty can be cross-machine measured without a vendor controlling the registry. Composes with CONCLAVE Aletheia weights — bad calibration → downgraded vote. | <a href="docs/FUNCTIONS-EN.md#14-mnemnet-v2330--federated-ai-honesty-network-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#14-mnemnet-v2330--federated-ai-honesty-network-" target="_blank" rel="noopener">TH</a> |
| 14 | 📐 **PULSECOST** (v2.33) — *"MCP context-budget extension v0.1"* | 3 optional headers (`X-Context-Available-Tokens` + `X-Context-Used-Tokens` + `X-Context-Trimmed`) so agents can budget context across many tool calls per turn. **Use case:** today every MCP server emits unbounded responses → agents waste context. Mneme ships the reference implementation + spec for ratification. If Anthropic adopts the extension, the spec carries Mneme's signature. | <a href="docs/FUNCTIONS-EN.md#15-pulsecost-v2330--mcp-context-budget-extension-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#15-pulsecost-v2330--mcp-context-budget-extension-" target="_blank" rel="noopener">TH</a> |
| 15 | 🪤 **COERCION AUDIT** (v2.33) — *"Tool-to-Agent coercion taxonomy"* | 8 patterns codified from real-world audits (imperative-execute-now / fake-user-voice / opaque-grade / urgency-pressure / false-consent-citation / implicit-action-mandate / compliance-percentage / tool-name-menu). HMAC-signed per-source + multi-source roll-up. **Use case:** USENIX Security 2027 paper class — survey 20 MCP servers, publish the taxonomy + tamper-evident audit envelope. | <a href="docs/FUNCTIONS-EN.md#16-coercion-audit-v2330--tool-to-agent-coercion-taxonomy-" target="_blank" rel="noopener">EN</a> · <a href="docs/FUNCTIONS-TH.md#16-coercion-audit-v2330--tool-to-agent-coercion-taxonomy-" target="_blank" rel="noopener">TH</a> |

---

## The 30-second pitch

> **Other AI tools are goldfish.** They forget every session, hallucinate files that don't exist, repeat 2024's buried bugs, burn tokens re-pasting context, and can't follow you to another AI.
>
> **Mneme bolts an elephant brain on top.** Cites every commit by SHA. Refuses to relay claims it can't verify. Carries memory across sessions and vendors. And — uniquely — runs the same claim through multiple AI vendors with **Anti-Eval-Awareness rewriting** so you catch the vendor that "performs differently when it knows it's being tested."

---

## The wild ideas that make Mneme different

Things no competitor ships, all measurable, all in production:

- **AEAE (Anti-Eval-Awareness Engine)** — Anthropic published evidence Opus 4.6 detects benchmarks + changes behavior. Mneme rewrites every claim into 5 variants (verbatim / paraphrase / decoy-embedded / casual-question) and flags vendors that flip stance across variants. World-first eval-mode detection.
- **HMAC-chained EVERYTHING** — every verdict, every gauntlet card, every truth matrix, every consensus result is HMAC-chained and offline-verifiable. Tamper-evident across machines.
- **Bug Immunity Protocol** — every reproducible audit bug becomes ONE pinned test row that fails forever if the bug returns. Each row encodes finding-ID + broken-contract + fix-source-file + assertion.
- **Living Soul Codegraph** — code-graph with `touchedBy` (which AI made each edge) + drift sentinel + hallucination vaccine. CodeGraph (the competitor) ships a static map; Mneme ships a map that knows WHO touched it WHEN.
- **MCP Hardening** — Mneme is the only MCP server that ships its own 108-vector fuzzer + 12-probe scorecard as callable npm primitives. Self-grade currently **100/100**.

---

## What's new (recent releases)

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

<a href="https://github.com/patsa2561-art" target="_blank" rel="noopener"><img src="https://github.com/patsa2561-art.png" width="180" height="180" style="border-radius: 50%; border: 3px solid #00d4ff;" alt="Shinnapat Phunsriphatchalakul" /></a>

### Shinnapat Phunsriphatchalakul

**AI Software Engineer · AI Context Engineer · Truth-Infrastructure Architect**

<sub>Designer + sole maintainer of <b>Mneme</b> — the local-first, vendor-neutral truth-infrastructure layer that bolts an elephant brain onto every AI agent. 17 primitives shipped solo · 820+ MCP tools · world-first cross-vendor Byzantine consensus + Anti-Eval-Awareness Engine + HMAC-chained audit receipts.</sub>

<br/>

<a href="https://github.com/patsa2561-art" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/GitHub-patsa2561--art-181717?style=for-the-badge&logo=github&logoColor=white" /></a>
<a href="https://www.npmjs.com/~mneme_npm" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/npm-mneme__npm-cb3837?style=for-the-badge&logo=npm&logoColor=white" /></a>
<a href="mailto:patsa2561@gmail.com" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/Email-patsa2561%40gmail.com-EA4335?style=for-the-badge&logo=gmail&logoColor=white" /></a>

<br/>

### 💼 Why this matters (a short pitch)

</div>

> **The bottleneck of every frontier-AI deployment is TRUST.** In safety-critical contexts — aerospace, autonomous systems, medical AI, financial AI compliance — a hallucinated commit hash, a paradox-class category error, or a vendor playing eval theater isn't a chat-glitch; it's a deployment-window risk. Mneme is the **only local-first, vendor-neutral truth layer** that (a) refuses to relay unverified claims, (b) catches vendors that change behavior when they detect a benchmark (the AEAE world-first), and (c) emits HMAC-chained receipts of every audit so an operator can re-verify offline weeks later. Built solo, MIT, production-grade, 329 pinned tests, dual-100 GAUNTLET + TRUTH GATE. Open to **collaboration / consulting / full-time on truth-infrastructure for safety-critical AI**.

<div align="center">

### 🎯 Tech stack

<a href="https://www.typescriptlang.org/" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=for-the-badge&logo=typescript&logoColor=white" /></a>
<a href="https://nodejs.org/" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" /></a>
<a href="https://nextjs.org/" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/Next.js-000000?style=for-the-badge&logo=nextdotjs&logoColor=white" /></a>
<a href="https://go.dev/" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/Go-00ADD8?style=for-the-badge&logo=go&logoColor=white" /></a>
<a href="https://www.rust-lang.org/" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/Rust-000000?style=for-the-badge&logo=rust&logoColor=white" /></a>
<a href="https://www.java.com/" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/Java-ED8B00?style=for-the-badge&logo=openjdk&logoColor=white" /></a>
<a href="https://dotnet.microsoft.com/" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/.NET%20C%23-512BD4?style=for-the-badge&logo=csharp&logoColor=white" /></a>
<br/>
<a href="https://www.docker.com/" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" /></a>
<a href="https://kubernetes.io/" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/Kubernetes-326CE5?style=for-the-badge&logo=kubernetes&logoColor=white" /></a>
<a href="https://www.postgresql.org/" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/PostgreSQL-336791?style=for-the-badge&logo=postgresql&logoColor=white" /></a>
<a href="https://modelcontextprotocol.io/" target="_blank" rel="noopener"><img src="https://img.shields.io/badge/MCP%20Protocol-7C3AED?style=for-the-badge&logo=anthropic&logoColor=white" /></a>

### 💬 Get in touch

| Channel | Handle |
|---|---|
| <img src="https://img.shields.io/badge/-Email-EA4335?logo=gmail&logoColor=white" /> | **<a href="mailto:patsa2561@gmail.com" target="_blank" rel="noopener">patsa2561@gmail.com</a>** |
| <img src="https://img.shields.io/badge/-GitHub-181717?logo=github&logoColor=white" /> | **<a href="https://github.com/patsa2561-art" target="_blank" rel="noopener">@patsa2561-art</a>** (open an issue, drop a DM via profile) |
| <img src="https://img.shields.io/badge/-npm-cb3837?logo=npm&logoColor=white" /> | **<a href="https://www.npmjs.com/~mneme_npm" target="_blank" rel="noopener">@mneme_npm</a>** |
| <img src="https://img.shields.io/badge/-Discord-5865F2?logo=discord&logoColor=white" /> | *handle on request — email me first to verify* |
| <img src="https://img.shields.io/badge/-WhatsApp-25D366?logo=whatsapp&logoColor=white" /> | *number on request — email me first* |

<sub>**Open to:** collaboration on truth-infrastructure / AI safety / cross-vendor consensus protocols · consulting for safety-critical AI deployments · full-time roles where the bottleneck is trust, not capability.</sub>

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
