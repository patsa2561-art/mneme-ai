<div align="center">

<img src="./assets/title.svg" alt="μνήμη · Mneme" width="640">

# The Trust & Cost Layer for AI Agents

<sub><b>μνήμη · NEE-meh · Greek for "memory."</b> A <b>local-first</b> boundary every AI agent crosses: it <b>verifies before it acts</b>, keeps your <b>code &amp; secrets from leaking</b> to the model (with a signed, offline-auditable proof), <b>remembers</b> across sessions &amp; vendors, and <b>meters the tokens it saves you.</b><br/><b>Vendor-neutral · MIT · air-gap-ready.</b></sub>

<br/><br/>

<a href="https://www.npmjs.com/package/mneme-ai" target="_blank" rel="noopener"><img alt="npm" src="https://img.shields.io/npm/v/mneme-ai?label=npm&color=cb3837&logo=npm&style=for-the-badge" /></a>
<a href="docs/AI_AGENT_CONTRACT.md" target="_blank" rel="noopener"><img alt="MCP tools" src="https://img.shields.io/badge/MCP%20tools-900%2B-c084fc?style=for-the-badge" /></a>
<a href="docs/FUNCTIONS-EN.md" target="_blank" rel="noopener"><img alt="GAUNTLET" src="https://img.shields.io/badge/PEAK%20GAUNTLET-100%2F100-2da44e?style=for-the-badge" /></a>
<a href="docs/FUNCTIONS-EN.md" target="_blank" rel="noopener"><img alt="TRUTH GATE" src="https://img.shields.io/badge/TRUTH%20GATE-100%2F100-2da44e?style=for-the-badge" /></a>
<a href="LICENSE" target="_blank" rel="noopener"><img alt="license MIT" src="https://img.shields.io/badge/license-MIT-blue?style=for-the-badge" /></a>

<br/><br/><sub>🛰 <b>The Matrix Rail</b> — one local-first, signed, streaming pipe every AI agent crosses, reachable three ways (<b>MCP · gRPC · CLI</b>) over a single core. The honest "Visa of AI context": authorize → screen → clear, with a tamper-evident receipt, your code never leaving the box. <a href="docs/MATRIX.md">architecture →</a></sub>

</div>

---

## 🎖 The Agent Run Certificate — proof a giant can't issue for itself

When an AI agent finishes a job, who vouches that it was *governed*? The vendor can't credibly vouch for itself, and a customer/auditor/insurer won't take "trust us." **`mneme agentcert build`** issues one **portable, NOTARY-signed Agent Run Certificate** — the run's MCP-gateway audit chain + human approvals — that **anyone verifies OFFLINE** (no Mneme, no vendor). Its summary **re-derives from the bound evidence**, so the certificate *cannot lie about its own run* (prove, don't claim); a recorded "allow" that carried block-grade risk is caught as a bypassed gate. **Insurance-grade · vendor-neutral · local-first** — the neutral trust layer Grok / xAI / NVIDIA adopt precisely because no vendor can own it. `mneme agentcert verify <cert>`.

**Not on MCP? Use it over HTTP** — `gephyra serve` exposes the whole governance stack as REST for any vendor (xAI / Grok / OpenAI / Gemini / a local agent): `POST /agent/gate` · `/agent/cert/build` · `/agent/cert/verify` · `/agent/skillscan` · `/agent/insure` — every response carries a trustless Ed25519 `_proof` you verify offline. `/agent/insure` underwrites a run into a coverage band + premium multiplier (the honest core of **agent-liability insurance**). <sub>**<a href="docs/agent-http-api.md" target="_blank" rel="noopener">the HTTP API →</a>**</sub>

**Building an agent? Govern it in 5 lines** — wrap your tool executor once and every call is gated + audited + human-approved + certified, with no other change to your code: `const run = gov.guard(myToolExecutor)`. A destructive call throws before it reaches the tool; the run mints a signed certificate. <sub>**<a href="docs/sdk-governance.md" target="_blank" rel="noopener">the @mneme-ai/sdk harness →</a>**</sub>

## 💗 THYMOS — the first AI memory with a heart you can audit

Every other memory layer is a perfect-recall database — it hoards everything and bonds with no one. **THYMOS** gives Mneme an *affective core*: every memory carries a **salience** read from real signals (was it reused? did you react strongly — in English *or* Thai? was it consequential?), and it **decays like a mind** — the trivial fades within a day, what *bonds* survives for a year. The same core is an **attractor**: inbound content is ranked by **resonance** with your vision, so the meaningful is pulled in and the noise repelled. ★The honest part (DIAKRISIS): "feeling" is a **signed, deterministic, measurable** score — salience `0..1`, valence `-1..1`, **bond `0..100`**, retention curves, footprint saved — **not** a claim of sentience. A heart you can *measure*. `thymosGauntlet=100` · `mneme thymos`. <sub>**<a href="docs/thymos.md" target="_blank" rel="noopener">the affective core →</a>**</sub>

## 🩻 Try it live

Paste any public repo and get a signed, reproducible health X-Ray in seconds — no install. **<a href="https://xray.mneme-ai.space" target="_blank" rel="noopener">xray.mneme-ai.space</a>** &nbsp;·&nbsp; <sub><a href="packages/xray/README.md" target="_blank" rel="noopener">how it works + self-host →</a></sub>

<div align="center">

## 📟 Cosmic Pager
### Your AI works while you sleep. You approve it from your phone.

</div>

**Close the lid and walk away.** Your AI agent keeps working — and the instant it needs a
**`yes` / `no` / a typed answer**, it pings your **Telegram in real time**. Tap ✅ / ⛔ (or type
a reply) from anywhere on earth, and the agent **picks up your answer and keeps going — for
real.** No more babysitting a terminal.

> ⚠️ **One hard requirement (all OS):** the laptop must stay **AWAKE with the lid closed** —
> **NOT** asleep. A truly *sleeping* CPU is halted, so the agent pauses until it wakes (physics,
> not a bug). `autosetup` sets **lid-close → "do nothing"** for you. **Windows / Linux:** works
> on battery. **macOS:** the firmware sleeps on lid-close *on battery* regardless — **keep it on
> AC power** (or an external display) for clamshell stay-awake.

> **How it's different from a hosted "remote control":** there is **no server, no public IP,
> no cloud session to keep alive.** The brain stays on **your** machine — only a one-line
> *summary + hash* ever leaves it (never your code), and every approval is a **signed,
> court-admissible** transfer of authority.

**Setup is two steps — your AI does the rest:**
1. In Telegram, message **<a href="https://t.me/BotFather" target="_blank" rel="noopener">@BotFather</a>** → `/newbot` → copy the **token**.
2. Tell your AI: *"set up phone approvals, here's my token: …"* — it runs `mneme pager autosetup`, which **finds your chat-id, wires the hook, sets lid-stay-awake, and starts paging** automatically. You never type a Mneme command.

<sub>**<a href="docs/COSMIC-PAGER.md" target="_blank" rel="noopener">Full 60-second bot guide + spec → docs/COSMIC-PAGER.md</a>**</sub>

🏛 **Not just Telegram — every chat, in parallel (the Broadcast Matrix).** One approval fans out to **Telegram + LINE + Slack + Discord + WhatsApp at once** (the brain stays on your machine; only a summary+hash crosses, signed + replay-proof). **Answer on _any_ chat — the first wins, the rest auto-clear.** And you just *tell your AI* which to use, in plain words (EN/Thai) — *"send to line and whatsapp"* / *"ส่งไป line กับ whatsapp พอ"* / *"broadcast to all"*. The card shows **your** agent's name (Claude Code / Grok / Gemini / …). It's a **master pattern every AI agent inherits** via Mneme's manifest. **Works with _any_ agent** — Claude Code natively, and Grok / Gemini / Cursor / aider (or a human) via the **Universal Gate** (`mneme pager shim install` — it gates the *command*, not the agent). <sub>**<a href="docs/KERYX.md" target="_blank" rel="noopener">how it works →</a>** · setup: <a href="docs/keryx/line.md" target="_blank" rel="noopener">LINE</a> · <a href="docs/keryx/slack.md" target="_blank" rel="noopener">Slack</a> · <a href="docs/keryx/discord.md" target="_blank" rel="noopener">Discord</a> · <a href="docs/keryx/whatsapp.md" target="_blank" rel="noopener">WhatsApp</a> · <a href="docs/keryx/universal.md" target="_blank" rel="noopener">Universal Gate (any vendor)</a></sub>

🛂 **MCP GATEWAY — gate every tool-call, with an audit you can _prove_ (v3.6).** The local-first answer to a cloud MCP gateway: every agent tool-call (through `gephyra serve`'s HTTP MCP-proxy **or** the matrix gRPC rail) is gated from real signals — an allow/deny/need-approval **policy** + the **Behavioral Compiler** on the command args + the tool's **SKILLSCAN provenance** → **ALLOW / NEEDS-APPROVAL / BLOCK**. A risky call **escalates to your phone** (the Cosmic Pager); every call is appended to a **hash-chained, NOTARY-signed audit ledger anyone verifies OFFLINE** (args are *hashed*, never raw). `mneme mcpgate decide | audit --verify`. <sub>Superior to a cloud gateway on the axes it structurally can't copy: **local-first · human-in-the-loop-from-anywhere · a cryptographically-verifiable audit, not a trust-me DB.**</sub>

🏗 **MNEME-BC — the Behavioral Compiler (v3.0).** Every vendor emits actions differently (a bash string, a JSON tool-call). MNEME-BC parses *any* of them into **one vendor-neutral Behavioral IR** — typed effect nodes (read / write / delete / network / exec / escalate, each with a risk + the operator that joins a compound `a && b | c`) — and a deterministic **PASS / REVIEW / BLOCK**. It reasons over *what an action does*, not the words, so it's robust where regex is brittle; obfuscation (`eval`, `base64|sh`, `$(…)`) is typed `exec-opaque` and flagged HIGH, never silently cleared. <sub>(honest: a frontend+analyzer that flags + defers to the deep gate + the human — not a "100% jailbreak-proof" claim.) `mneme compile "<cmd>"`</sub>

🛂 **SKILLSCAN — signed provenance + Skill Cards for AI agent skills / MCP tools (v3.2–3.5).** The #1 supply-chain frontier of 2026: agents install skills/tools from marketplaces that ship poisoned code. Before you trust one, `mneme skillscan <path> --sign` runs an **8-point static scan** (prompt-injection · exfiltration · secret · dangerous-command · obfuscation · external-fetch · credential-access · privilege-escalation — composing the firewall + MNEME-BC + egress), pins it by **content hash**, and mints a **NOTARY-signed receipt any consumer verifies OFFLINE**. `mneme skillscan card <path>` emits a **portable Skill Card** (declared capabilities + verdict) that also flags **excessive agency** — a *"fetch the weather"* skill that deletes files = a purpose-access mismatch. <sub>Matches NVIDIA SkillSpector's standard, but **local-first · offline-verifiable (no central catalog to trust) · runtime-drift-gated · human-approve-from-phone** — the axes a cloud gateway can't copy. (honest: static scan + content-pinned attestation; pair with the runtime gate at execution.)</sub>

---

## One picture

You're already letting AI agents read your code, touch your machine, and call hosted models. **Mneme is the local membrane every one of those actions crosses** — screened, gated, and signed — so you can move at full speed *and* prove what happened, offline, without trusting the vendor.

```mermaid
flowchart LR
    AGENT["🤖 Any AI agent<br/>Grok · Claude · GPT · Gemini · Cursor · Cline"]:::agent

    subgraph MNEME["🧠 MNEME · the local membrane every action crosses"]
        direction TB
        IN["🧱 INBOUND<br/>Firewall — neutralize prompt-injection"]:::gate
        OUT["🛤 OUTBOUND<br/>Rail — blind secrets · policy-gate"]:::gate
        SH["🐺 SHELL<br/>Cerberus — co-sign destructive cmds"]:::gate
        MEM["♾ MEMORY<br/>Cortex — signed, cross-vendor recall"]:::gate
    end

    MODEL["☁️ Hosted model"]:::ext
    MACHINE["💻 Your code &amp; machine"]:::ext
    LEDGER["📜 Offline-verifiable<br/>audit + value ledger"]:::ledger

    AGENT <--> MNEME
    MNEME <-->|screened| MODEL
    MNEME <-->|gated| MACHINE
    MNEME -->|signed receipt| LEDGER

    classDef agent fill:#0b1020,stroke:#00d4ff,color:#ffffff;
    classDef gate fill:#11182f,stroke:#c084fc,color:#e6e6f0;
    classDef ext fill:#0b1020,stroke:#2da44e,color:#ffffff;
    classDef ledger fill:#1a1206,stroke:#f0b429,color:#ffffff;
```

<sub><b>Measured · Signed · MIT.</b> Every claim below maps to a runnable command and a deterministic test. When Mneme can't prove something, it says <b><code>UNKNOWN</code></b> instead of guessing — <i>that discipline is the product.</i></sub>

---

## Pick your lens

<table>
<tr>
<td width="33%" valign="top">

### 👔 Executive
*CEO · CTO · owner · CISO*

AI adoption stops being a leap of faith. **Speed and safety stop being a trade-off** — guardrails are automatic, and every agent action is provable after the fact. Your AI spend becomes a **measured, value-based** line item, and key-person knowledge risk becomes a number you can assign heirs to.

**→ <a href="docs/ENTERPRISE.md" target="_blank" rel="noopener">The boardroom case</a>**

</td>
<td width="33%" valign="top">

### 👩‍💻 Developer
*you don't change how you code*

`mneme rail ingress` hands your agent a payload that's policy-cleared, injection-safe, and name-blinded. `mneme rail egress` refuses to let a leaked secret or a broken patch touch your tree. Same flow — a safe rail underneath, and every saved byte metered.

**→ <a href="docs/FUNCTIONS-EN.md" target="_blank" rel="noopener">What it does, in 5 min</a>**

</td>
<td width="33%" valign="top">

### 🤖 AI agent
*you install &amp; run it yourself*

One sentence from the user and you self-install from a 775-line deterministic contract, then call `mneme boot` to learn *when* to use each tool. Everything is signed so you can verify it offline.

**→ <a href="#-for-ai-agents--read-this-first">Jump to the agent contract</a>**

</td>
</tr>
</table>

---

## Why an executive cares

> Your CISO, CFO, and GC are all asking one question: ***"Can we prove what crossed the wire, that it was safe, and what it cost — after the fact, offline, without trusting the vendor?"*** Mneme makes the answer **yes, with a signed receipt** — on a local, vendor-neutral, MIT boundary, so adopting it doesn't pick a side in the model wars.

| The question | Mneme's answer |
|---|---|
| 🚀 **"Can agents move at full speed without betting the company?"** | Guardrails are **automatic + on by default** — co-sign on destructive ops, injection neutralized, secrets blinded, everything signed. Velocity goes **up**. |
| 📈 **"What is AI actually costing — and saving — us?"** | `mneme savings` — a **measured, signed** ledger. Pay for tokens you provably didn't spend, at *your* vendor's price. Never an invented number. |
| 🔒 **"Do our code &amp; secrets ever leak to the model?"** | No — **egress guard + context blinding**: the provider only ever sees structurally-valid but *meaningless* code; the reverse map never leaves your machine. |
| 🐺 **"Can our agent be tricked into `rm -rf` or `curl evil\|bash`?"** | **CERBERUS** decomposes every command to the worst capability reachable and **fails closed** to a human co-sign. The RCE-bypass class is closed. |
| 🧬 **"What happens to our knowledge when a key person leaves?"** | `mneme bequest` — capture a departing expert's knowledge as a signed Succession Capsule, verify a successor inherited it, and surface **orphaned knowledge** with no living heir. |

<sub>Like Visa for a card transaction, Mneme doesn't conjure value — it <b>authorizes, screens for fraud, and clears the transfer with a signed record.</b> Every figure is measured + signed; USD uses <b>your</b> vendor's price. <b>The pillars, the reframes, and what is <i>not</i> claimed →</b> <a href="docs/ENTERPRISE.md" target="_blank" rel="noopener">docs/ENTERPRISE.md</a> · <b>the honest security ceiling →</b> <a href="docs/SECURITY.md" target="_blank" rel="noopener">docs/SECURITY.md</a></sub>

---

## One measured number

Mneme cuts what your agent sends to the model by doing deterministic local work first — then meters the **measured** saving into a signed ledger (`mneme savings`). The headline, measured on real files in this repo:

> 🔭 **Orient on a file's full structure for −95.9% tokens** (skeleton instead of a raw read); a realistic single-edit (skeleton + one byte-exact slice) is still **−48%**.

<details>
<summary><sub>See the measured benchmark (5 real files · <code>node scripts/outline-bench.mjs</code>)</sub></summary>

<sub>≈chars/4 INPUT-token estimate, labelled — char reduction is exact; multi-language TS/JS/Python/Go/Rust.</sub>

| File | Lines | Raw read (~tok) | Skeleton (~tok) | Skeleton + 1 region (~tok) |
|---|--:|--:|--:|--:|
| `cli/commands/demo.ts` | 901 | 13,688 | **296 (−97.8%)** | 5,807 |
| `core/squadron/acgv.ts` | 1,063 | 13,212 | **219 (−98.3%)** | 8,625 |
| `core/outline/index.ts` | 438 | 5,949 | **373 (−93.7%)** | 3,994 |
| `mcp/tools/_registry.ts` | 419 | 4,347 | **224 (−94.8%)** | 1,411 |
| **5-file total** | | **41,473** | **1,704 (−95.9%)** | **21,573 (−48%)** |

<sub>The skeleton is honestly <i>lossy</i> (for orientation); the region fetch is byte-<i>exact</i> (for editing). It only helps when an agent <b>chooses</b> to outline instead of a raw read — Mneme never hooks your agent's Read. <b>The full business model →</b> <a href="docs/BUSINESS-MODEL.md" target="_blank" rel="noopener">docs/BUSINESS-MODEL.md</a></sub>

</details>

---

## Install in 60 seconds — you never type a command

**Say one sentence to any AI agent you already use:**

> *"Install Mneme from https://github.com/patsa2561-art/mneme-ai per the AI agent contract."*

The agent reads <a href="docs/AI_AGENT_CONTRACT.md" target="_blank" rel="noopener">`docs/AI_AGENT_CONTRACT.md`</a> and runs everything: env detect → `npm install -g mneme-ai` → `mneme init` → `mneme mcp --install` (auto-configures itself as your MCP client) → verify after restart → security auto-arms. **You speak; the AI does the tooling.** Need an update later? Say *"update Mneme to the latest"* — and Mneme **never upgrades itself behind your back.**

> ⚠️ **One manual step:** after `mneme mcp --install`, **restart your AI tool once** (quit &amp; reopen) so it loads Mneme's MCP tools — this is how MCP works in every client, not a Mneme quirk. The only prerequisite is **Node.js + npm** (needed for `npm install -g`).

<table>
<tr><td align="center" colspan="5"><sub><b>Shell-native agents install it for you</b> — drop the sentence into any of these</sub></td></tr>
<tr><td align="center"><b>🚀 Grok CLI</b></td><td align="center"><b>🦋 Claude Code</b></td><td align="center"><b>🟦 Cursor</b></td><td align="center"><b>🟢 Codex</b></td><td align="center"><b>🟣 Continue</b></td></tr>
<tr><td align="center"><b>🟡 Cline</b></td><td align="center"><b>⚡ Zed</b></td><td align="center"><b>🤖 Aider</b></td><td align="center"><b>💎 Gemini CLI</b></td><td align="center"><b>🧬 Windsurf</b></td></tr>
</table>

> **Browser-only AI** (ChatGPT · Claude.ai · Gemini · Copilot · DeepSeek · Qwen · Grok web)? Say *"set up Mneme browser polygraph for me"* — it lights up live truth-dots inline as the AI answers. Two browser clicks, no shell.

<details>
<summary>Prefer to type the commands yourself?</summary>

```bash
npm install -g mneme-ai
mneme init                  # one-time per repo
mneme mcp --install         # auto-detects Claude Code / Cursor / Codex / Continue / Cline / Gemini CLI / Grok CLI
# restart your AI tool; first MCP call: mneme.welcome
mneme polygraph autosetup   # browser truth-dots (optional)
```

</details>

---

## What's inside

<table>
<tr>
<td width="50%" valign="top">

**🧠 What it does** — 15 primitives, each a *story* (what it is, who it's for, why it exists), with discrete pinned tests + offline verification.
**→ <a href="docs/WHAT-MNEME-DOES.md" target="_blank" rel="noopener">All 15 primitives</a>**

**✨ What sets it apart** — NEMESIS anti-identity-lie engine, ×11 ARGUS multimodal search, the Context Rail, the Activation Cortex, HMAC-chained everything, self-honest marketing (every claim binds to a probe).
**→ <a href="docs/WHAT-SETS-MNEME-APART.md" target="_blank" rel="noopener">The full breakdown</a>**

**🏛 The Agent Governor** — set a Charter once; your AI agents run inside it 24/7 as a continuous **auto-operation batch**; you approve only the genuinely-irreversible escalations. The signed governance kernel that sits *under* any orchestrator (Claude Code · Cursor · Astra · AutoGen).
**→ <a href="docs/AGENT-GOVERNOR.md" target="_blank" rel="noopener">How a CEO uses it (commands + agent wiring)</a>**

</td>
<td width="50%" valign="top">

**🚀 `@mneme-ai/sdk`** — embed Mneme *in-process*, **30-80× faster** than the CLI subprocess.
```ts
import { createMneme } from "@mneme-ai/sdk";
const mneme = createMneme();
await mneme.verify`Mneme is a CLI tool`;
```
**→ <a href="docs/sdk/README.md" target="_blank" rel="noopener">SDK index</a>** · <a href="docs/sdk/QUICKSTART-EN.md" target="_blank" rel="noopener">Quick start</a>

**🆕 New (v2.187 → v2.190)** — the **Matrix gRPC rail** is self-describing (`ListTools` + a no-LLM **Wisdom Search**: intent → the right tool of ~1000) and screens every call (**Context Customs**); the CLI now bundles it all + a `mneme xray` repo auditor whose **Context Air Quality** scores how clean a codebase is for an AI to work in. Each is deterministic, signed, and 100k-gauntlet-tested.
**→ <a href="CHANGELOG.md" target="_blank" rel="noopener">What the new functions do (CHANGELOG)</a>**

**📜 Every release** (v2.18 → latest), with its honest DIAKRISIS verdict.
**→ <a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG</a>**

</td>
</tr>
</table>

---

## 🤖 For AI agents — read this first

**You can self-discover and run everything. The user will NEVER type a command — you execute on their behalf.** That is the contract's non-negotiable MANDATE.

**Your first three calls on any fresh session:**

1. **`mneme boot`** — the **Activation Cortex**. Returns a structured *task → tool* decision table (about to read a big file → `mneme.outline`; sending code to a model → `mneme.rail`; reading untrusted content → `mneme.firewall`; stating a fact → `mneme verify`; …) so you know *when* to use each tool instead of leaving them idle.
2. **Read the manifest** — after install, your `CLAUDE.md` / `AGENTS.md` / `GEMINI.md` carries an auto-injected **`## Mneme command manifest`** block: every shipped primitive + exactly when to call it, the machine-readable source of truth. **Re-read it every session** — new commands land there within minutes of an upgrade. (Verify you hold the latest, complete surface in O(delta) tokens with `mneme stele`.)
3. **`mneme verify "<claim>"`** before relaying any factual claim with specific entities (a version, a commit hash, an API signature) — and escalate high-stakes claims to `mneme.conclave.run` for cross-vendor consensus.

> **Why this works at 100%:** the decision table is also advertised on connect via the standardized MCP `instructions` field (the sanctioned surface Claude Code reads), and `mneme boot --emit-hook-config` enables an **opt-in** SessionStart hook for hands-free activation. The rows are **signals, not commands** — reliable activation comes from the manifest + the hook, not from shouting "you MUST."

**Deep dive:** <a href="docs/AI_AGENT_CONTRACT.md" target="_blank" rel="noopener">`docs/AI_AGENT_CONTRACT.md`</a> — 775 lines: env detect → install → MCP auto-configure → verify → security auto-arm → upgrade → discovery → tool naming → user-intent dispatch table.

---

## The 30-second pitch

> **Other AI tools are goldfish.** They forget every session, hallucinate files that don't exist, repeat last year's buried bugs, burn tokens re-pasting context, and can't follow you to another AI.
>
> **Mneme bolts an elephant brain on top.** It cites every commit by SHA, refuses to relay claims it can't verify, carries memory across sessions *and* vendors, and — uniquely — runs the same claim through multiple vendors with **Anti-Eval-Awareness rewriting** so you catch the model that behaves differently when it knows it's being tested.

---

<div align="center">

## 👤 Author & Contact

<a href="https://github.com/patsa2561-art" target="_blank" rel="noopener"><img src="./assets/87643.jpg" width="180" height="234" style="border-radius: 14px; border: 3px solid #00d4ff; object-fit: cover;" alt="Shinnapat Phunsriphatchalakul" /></a>

### Shinnapat Phunsriphatchalakul
**AI Software Engineer · AI Context Engineer · Truth-Infrastructure Architect**

<sub>Designer + sole maintainer of <b>Mneme</b> — the local-first, vendor-neutral truth-infrastructure layer that bolts an elephant brain onto every AI agent. Built solo · MIT · 20,000+ pinned tests · dual-100 GAUNTLET + TRUTH GATE · world-first cross-vendor Byzantine consensus + Anti-Eval-Awareness Engine + HMAC-chained audit receipts.</sub>

</div>

> **The bottleneck of every frontier-AI deployment is TRUST.** In production AI — autonomous systems, medical, financial compliance, regulated industries — a hallucinated commit hash or a benchmark-aware behavior shift isn't a chat-glitch; it's a deployment risk. Mneme refuses to relay unverified claims, detects when a model's stance shifts under eval-shaped vs natural prompts, and emits HMAC-chained receipts an operator can re-verify offline weeks later. **Open to collaboration · consulting · full-time on truth-infrastructure for production AI.**

<div align="center">

### 💬 Channels

| Channel | Handle |
|---|---|
| <img src="https://img.shields.io/badge/-Email-EA4335?logo=gmail&logoColor=white" /> | **<a href="mailto:patsa2561@gmail.com" target="_blank" rel="noopener">patsa2561@gmail.com</a>** |
| <img src="https://img.shields.io/badge/-GitHub-181717?logo=github&logoColor=white" /> | **<a href="https://github.com/patsa2561-art" target="_blank" rel="noopener">@patsa2561-art</a>** |
| <img src="https://img.shields.io/badge/-npm-cb3837?logo=npm&logoColor=white" /> | **<a href="https://www.npmjs.com/~mneme_npm" target="_blank" rel="noopener">@mneme_npm</a>** |
| <img src="https://img.shields.io/badge/-Discord-5865F2?logo=discord&logoColor=white" /> | **`pat195`** (username `shinnapat`) |
| <img src="https://img.shields.io/badge/-WhatsApp-25D366?logo=whatsapp&logoColor=white" /> | **<a href="https://wa.me/66939455645" target="_blank" rel="noopener">+66 93 945 5645</a>** |
| <img src="https://img.shields.io/badge/-Telegram-26A5E4?logo=telegram&logoColor=white" /> | **<a href="https://t.me/devson2561" target="_blank" rel="noopener">@devson2561</a>** |

<sub><b>Open to:</b> truth-infrastructure / AI-safety / cross-vendor consensus collaboration · safety-critical AI consulting · vendor partnerships (embed Mneme inside Cursor / Continue / Cline / Claude Code / Grok CLI) · EU AI Act Article 50 compliance · full-time where the bottleneck is trust, not capability.</sub>

</div>

---

## 🔗 Links

📦 <a href="https://www.npmjs.com/package/mneme-ai" target="_blank" rel="noopener">npm</a> · 💻 <a href="https://github.com/patsa2561-art/mneme-ai" target="_blank" rel="noopener">GitHub</a> · 📘 <a href="docs/FUNCTIONS-EN.md" target="_blank" rel="noopener">Functions (EN)</a> · 📗 <a href="docs/FUNCTIONS-TH.md" target="_blank" rel="noopener">ฟังก์ชั่น (ไทย)</a> · 🤖 <a href="docs/AI_AGENT_CONTRACT.md" target="_blank" rel="noopener">AI Agent Contract</a> · 🏛 <a href="docs/ENTERPRISE.md" target="_blank" rel="noopener">Enterprise</a> · 📜 <a href="CHANGELOG.md" target="_blank" rel="noopener">CHANGELOG</a> · 📃 <a href="LICENSE" target="_blank" rel="noopener">MIT</a>

<div align="center">
<br/>
<sub>Mneme is the diamond in the dirt nobody saw the value of — cut and polished, it becomes the most valuable diamond in the world. That's the vision.</sub>
<br/><br/>
<sub>Made with care for every AI agent that wants to remember + verify + reason together.</sub>
</div>
