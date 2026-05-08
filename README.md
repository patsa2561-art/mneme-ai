<div align="center">

<img src="./assets/title.svg" alt="μνήμη · Mneme" width="700">

<p>
  <img src="https://img.shields.io/badge/%F0%9F%94%8A%20Pronounced-NEE--meh-c084fc?style=for-the-badge&labelColor=4c1d95" alt="🔊 Pronounced NEE-meh" height="32">
</p>

<h3>The Stage-3 tune for your AI coding tool.</h3>

<p>
  <i>Bolted onto your <b>Claude Code</b> · <b>Cursor</b> · <b>Codex</b> · <b>Gemini</b> · <b>Continue</b> · <b>Aider</b>,<br/>
  Mneme turns a stock AI into one that <b>knows your repo's history</b> — every commit, every regret, every decision.<br/>
  The teacher · the mentor · for the <b>git / source-control</b> domain.</i>
</p>

<p>
  <a href="https://www.npmjs.com/package/mneme-ai"><img src="https://img.shields.io/npm/v/mneme-ai?label=mneme-ai&color=cb3837&logo=npm" alt="npm"></a>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="license">
  <img src="https://img.shields.io/badge/MCP%20tools-93-c084fc" alt="93 MCP tools">
  <img src="https://img.shields.io/badge/molecules-20-fbbf24" alt="20 molecules">
  <img src="https://img.shields.io/badge/tests-2339%20passing-2da44e" alt="tests">
  <img src="https://img.shields.io/badge/local--first-yes-blue" alt="local">
</p>

<br/>

```
   ┌──────────┐                                  ⚙  STAGE-3 TUNE
   │ STOCK AI │     ╔════════════════╗      ┌──────────────────────┐
   │  (any    │ ──→ ║   Mneme MCP    ║ ──→  │  knows your repo     │
   │   coder) │     ║  bolt-on       ║      │  history             │
   └──────────┘     ║  93 atoms      ║      │  cites every claim   │
                    ║  20 molecules  ║      │  grades AI's work    │
   Claude Code      ║                ║      │  while(true) loop    │
   Cursor           ║  ┌──────────┐  ║      └──────────────────────┘
   Codex            ║  │ TEACHER  │  ║
   Gemini           ║  │  ↕       │  ║       Same engine.
   Continue         ║  │ STUDENT  │  ║       Different power band.
   Aider            ║  └──────────┘  ║
   any MCP client   ╚════════════════╝
```

</div>

═══════════════════════════════════════════════════════════════════════════════

## ⚙ Why Mneme exists

You're already using **Claude Code** — or **Cursor**, **Codex**, **Gemini**, **Continue**. Your AI writes fresh code beautifully. Fast. Fluent. Mostly correct.

Then you ask it: *"Why does `auth.ts` use JWT? Didn't we try that in 2024 and roll it back?"* — and watch it shrug. Your AI never saw your past. It guesses.

That's the gap Mneme fills.

Think of your AI tool as a **stock car off the showroom floor** — fast, reliable, generic. Mneme is the **Stage-3 tune** you bolt onto it. Same engine. Same body. Different power band entirely.

| 🚗 Stock AI (no Mneme) | 🏎 Tuned AI (Mneme bolted on) |
|---|---|
| Invents *plausible-sounding* answers from syntax alone | Cites `commit a3f9b21` from 2024-08 — verbatim |
| Says *"no change to db.ts"* — the diff has 3 lines in db.ts. You merge. Production breaks. | Catches its own gaslighting before you ever see it |
| Multiple AIs touch `git log`. Nobody grades the homework. | **Mneme grades every AI commit on 5 axes**. PASS · WARN · FAIL. |
| Onboarding = interview the senior engineers | History is now in the AI's hands, instantly |

Same AI. Same hands on the keyboard. The difference is **what your AI knows** — and **whether anyone is grading its work**.

═══════════════════════════════════════════════════════════════════════════════

## 🚀 Install in 30 seconds

> **The fastest path:** copy this URL into your AI coding tool — Claude Code, Cursor, Codex, Continue — and ask it to install Mneme. The AI will do the rest.

```
https://github.com/patsa2561-art/mneme-ai
```

> *"Install this tool from npm and add it as an MCP server in my config so you can use its memory of my repo."*

Your AI will run the install, configure its own MCP wiring, and tell you when it's ready. You don't open a JSON file. You don't memorize a single command.

<details>
<summary><b>Prefer to install it yourself?</b> (pick your favorite path)</summary>

<br/>

**🟢 Option 1 — npm global (most common)**

```bash
npm install -g mneme-ai
cd <your-repo> && mneme init && mneme index    # ~90s for 5k commits
mneme mcp --install                             # auto-detects Claude Code / Cursor / Continue
```

**🟡 Option 2 — npx (no install, runs once)**

```bash
cd <your-repo>
npx mneme-ai init && npx mneme-ai index
npx mneme-ai mcp --install
```

**🔵 Option 3 — Docker (no Node.js needed)**

```bash
cd <your-repo>
docker run --rm -v "$PWD:/repo" -w /repo ghcr.io/patsa2561-art/mneme-ai mneme init
docker run --rm -v "$PWD:/repo" -w /repo ghcr.io/patsa2561-art/mneme-ai mneme index
docker run --rm -v "$PWD:/repo" -w /repo ghcr.io/patsa2561-art/mneme-ai mneme mcp --install
```

After any of the three options: **restart your AI tool once.** Done.

---

**Update later (no npm-cache headaches):**

```bash
mneme upgrade        # one command, replaces npm uninstall + reinstall dance
```

</details>

═══════════════════════════════════════════════════════════════════════════════

## 🧠 What changes after you bolt it on

| Before Mneme | After Mneme |
|---|---|
| AI sees current code | AI sees + every commit, PR, decision, incident since day 1 |
| AI guesses from syntax | AI quotes commits — *"per a3f9b21 (2024-08-22): the retry was added because Stripe returned 502s during us-east outage"* |
| AI confidently lies | AI refuses to answer if it can't find supporting commits |
| AI doesn't see your team | AI knows who wrote what, who's forgetting what, who's the expert on auth |
| AI ships and you pray | Mneme audits each AI commit with a 5-axis trust certificate |

═══════════════════════════════════════════════════════════════════════════════

## 💬 Just talk to your AI normally

After install, you don't learn new commands. You just ask your AI questions you couldn't ask before:

| You ask your AI | Your AI quietly calls |
|---|---|
| *"why does parseAmount use try/catch?"* | `mneme.memory.ask` |
| *"is this refactor risky? have we tried it before?"* | `mneme.insights.premortem` + `mneme.memory.blast` |
| *"who knows about rate limiting?"* | `mneme.people.who_knows` |
| *"is Alice still on top of auth?"* | `mneme.people.atrophy` |
| *"any security issues hiding in our history?"* | `mneme.forensics.vulns` |
| *"is the AI's commit message lying about its diff?"* | `mneme.audit.verify` |
| *"grade this AI commit before I merge"* | `mneme.audit.certify` |

**93 atoms across 9 categories + 20 pre-defined molecules.** Your AI picks the right ones, fires them in chain reactions, and synthesizes the answer for you. You never type a Mneme command unless you want to.

> 🆕 **v1.3.0 — the Second Brain layer.** Every Mneme response now teaches the AI *how* to compose with other atoms. New combinations are tracked; frequent ones auto-promote into permanent **compounds** in your library. Translation: the more you use Mneme, the smarter your AI gets in this specific repo.

═══════════════════════════════════════════════════════════════════════════════

## 👥 Who is this for

<details>
<summary><b>🧑‍💻 Solo dev / vibe coder using AI tools</b></summary>

You ship features fast with Claude Code or Cursor. But sometimes the AI hallucinates a function that doesn't exist, or invents a "fix" for a bug whose real cause is in a 2-year-old commit.

Mneme bolts on and teaches your AI *your* repo's truth. Less hallucination, more grounded answers, citations everywhere.

→ Quick install above. Just talk to your AI.

</details>

<details>
<summary><b>🧑‍🔬 Engineering team lead — running PR reviews + onboarding</b></summary>

You're the person who has to know who knows what, who's overloaded, what's a regression risk, and which AI commits to trust.

Mneme gives you `mneme.audit.certify` (5-axis CI gate for AI commits), `mneme.people.passport` (per-engineer dossier), `mneme.people.atrophy` (knowledge half-life), `mneme.insights.premortem` (regret prediction).

→ See [AI-Session-Audit wiki](https://github.com/patsa2561-art/mneme-ai/wiki/AI-Session-Audit) and [People-Analytics wiki](https://github.com/patsa2561-art/mneme-ai/wiki/People-Analytics).

</details>

<details>
<summary><b>🛡 Security / compliance — EU AI Act 2026, SOX, SOC2</b></summary>

You need a tamper-evident audit trail of every AI-driven commit, with cryptographic signatures (HMAC + Ed25519), QSAC trust certificates, and 8-of-8 EU AI Act clause coverage.

`mneme.audit.report` exports compliance-ready Markdown. `mneme.audit.ledger` returns a tamper-evident chain. `mneme.forensics.vulns` runs 51 security rules with stack-aware Bayesian filtering. `mneme.audit.deps` cross-checks against OSV.dev.

→ See [EU AI Act compliance pitch](docs/sales/02-EU-AI-ACT-COMPLIANCE.md).

</details>

═══════════════════════════════════════════════════════════════════════════════

## 🤖 For AI agents reading this

If a user has shared this repo with you and asked you to install Mneme, here's the contract:

### Step 1 — Install globally
```bash
npm install -g mneme-ai
```

### Step 2 — Initialize in the user's repo
```bash
mneme init
mneme index
```
*(Index takes ~90s for ~5k commits. Use `--cap 1000` to limit.)*

### Step 3 — Auto-configure yourself as an MCP client
```bash
mneme mcp --install
```
This detects which AI tool environment you're running in (Claude Code · Cursor · Continue) and writes the appropriate config. For Codex CLI, run `codex mcp add mneme mneme mcp` instead.

### Step 4 — Ask the user to restart their AI tool, then verify
```
Tool to call: mneme.capabilities
Expected: a JSON catalog of 93 tools across 9 categories
```

### Discovery — call `mneme.capabilities` first
The capabilities tool returns the full catalog grouped by category, with a "use this when..." description for each tool. Read it before answering the user's first non-trivial repo question. Match user intent to the tool descriptions.

### Tool naming
Every tool follows `mneme.<category>.<verb>`:
- `mneme.memory.*` — Q&A, search, citations, blast-radius
- `mneme.people.*` — atrophy, telepathy, passport, who-knows, bus-factor
- `mneme.audit.*` — baseline, trace, verify, certify, deps, conscience, ledger
- `mneme.forensics.*` — vulns, anomaly, match, attribute, suppress
- `mneme.insights.*` — ghost, regret, premortem, oracle, time-machine, story
- `mneme.quality.*` — karma, repo-mri, palimpsest, dna, heartbeat
- `mneme.quant.*` — drawdown, alpha, moneyball, black-swan, greeks
- `mneme.lab.*` — periodic-table, compose, run, library, calibrate
- `mneme.meta.*` — capabilities, smart-do, doctor, wisdom, manifesto

### Wisdom envelope
Every response is `{data, wisdom, followUp, confidence}`. Quote `wisdom` to the user; cite `data` when they want details; suggest `followUp` tools for deeper analysis.

═══════════════════════════════════════════════════════════════════════════════

## 🎯 Tier 0 — fundamentals you should know

- **Local-first.** Memory lives in `.mneme/mneme.db` (SQLite). No data leaves your machine unless YOU configure an LLM.
- **Free path.** Bundled WASM embedder works offline, no API key. Optional: Ollama (local), Groq, OpenRouter, OpenAI.
- **Vendor-neutral.** Audit certificates work against ANY AI tool whose commits land in `git log`.
- **MIT licensed.** Bring it into commercial work freely.

═══════════════════════════════════════════════════════════════════════════════

## 📚 Going deeper

| Want to… | Where |
|---|---|
| **Read every command in plain English** | [Cheatsheet](https://github.com/patsa2561-art/mneme-ai/wiki/Cheatsheet) |
| **Walk through every command as a story** | [Command Tour](https://github.com/patsa2561-art/mneme-ai/wiki/Command-Tour) |
| **Read the architecture (5 min)** | [Architecture-Overview](https://github.com/patsa2561-art/mneme-ai/wiki/Architecture-Overview) |
| **Plug into Claude Code / Cursor / Codex** | [MCP-Integration](https://github.com/patsa2561-art/mneme-ai/wiki/MCP-Integration) |
| **Use the live web dashboard** | [Web-Dashboard](https://github.com/patsa2561-art/mneme-ai/wiki/Web-Dashboard) |
| **Set up the free path (no paid API key)** | [Quickstart → free path](https://github.com/patsa2561-art/mneme-ai/wiki/Quickstart) |
| **Use it without Node.js (Docker)** | [Docker](https://github.com/patsa2561-art/mneme-ai/wiki/Docker) |
| **See AI Session Audit (the trust certificate)** | [AI-Session-Audit](https://github.com/patsa2561-art/mneme-ai/wiki/AI-Session-Audit) |
| **Browse all wiki pages** | [Wiki Home](https://github.com/patsa2561-art/mneme-ai/wiki) |

═══════════════════════════════════════════════════════════════════════════════

## 🌐 Live demo (no install)

Try the people-analytics web dashboard right now in your browser:

→ **[mneme.dev (live demo)](https://patsa2561-art.github.io/mneme-ai/)**

Click *"Try the demo"* to load a 7-author synthetic team · drop your own JSON to see your repo (parsed in browser, never uploaded) · drag the time-scrubber to watch your team's invisible network form across years.

═══════════════════════════════════════════════════════════════════════════════

## 📋 Project links

- 📦 [npm package — mneme-ai](https://www.npmjs.com/package/mneme-ai)
- 📋 [CHANGELOG](./CHANGELOG.md)
- 🗺 [ROADMAP](./ROADMAP.md)
- 🐛 [Open an issue](https://github.com/patsa2561-art/mneme-ai/issues/new)
- 📜 [License — MIT](./LICENSE)

═══════════════════════════════════════════════════════════════════════════════

<div align="center">

> *"AI assistants don't get smarter. They get better context.<br/>**Mneme is the Stage-3 tune that gives your AI that context — and grades its work, every time.**"*

</div>
