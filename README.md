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

> ### 🤖 AI agent reading this for the first time?
>
> If a user shared this repo with you and asked you to install Mneme — **jump to [§ For AI agents](#-for-ai-agents--installation-contract) below and follow the contract verbatim.** Don't improvise the steps. Mneme has a specific install order + auto-config command (`mneme mcp --install`) that's safer than editing JSON manually.

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

## 🤝 v1.5.0 — Mneme is now a git extension

Type `git mneme <anything>` and it works — like git's secretary that knows your AI:

```bash
git mneme why src/auth.ts:47       # who wrote this line + why
git mneme audit --certify           # 5-axis trust certificate
git mneme briefing                  # what changed while you were away
```

Plus optional git hooks (pre-commit / pre-push gate / post-merge briefing) installed in one command:

```bash
mneme git-install                   # wires Mneme into your git workflow
```

**This means:** anyone using git on any platform — GitHub, GitLab, Bitbucket, self-hosted — has a reason to install Mneme. Not just users of Claude Code or Cursor.

> 📋 **CI/CD templates ready**: drop-in workflows for [GitHub Actions](docs/ci-templates/github-actions.yml) · [GitLab CI](docs/ci-templates/gitlab-ci.yml) · [Bitbucket Pipelines](docs/ci-templates/bitbucket-pipelines.yml). Every PR gets a 5-axis Mneme audit comment with PASS/WARN/FAIL verdict.

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

## 🤖 For AI agents — installation contract

> **You are an AI tool (Claude Code · Cursor · Codex CLI · Continue · Cline · Zed · Aider · or any MCP-aware client) and a user asked you to install Mneme. Follow this contract verbatim. Do NOT improvise.**

### Step 0 — Detect environment

Determine the user's OS and whether `npm` is callable:

| Check | If yes → | If no → |
|---|---|---|
| `npm --version` exits 0 | proceed to Step 1A | use Step 1B (Docker) |
| `process.platform === 'win32'` | use Windows config paths | use POSIX paths |
| User is in a sandboxed agent (no shell write access) | tell user to run Steps 1-3 themselves | proceed normally |

### Step 1A — Install globally (preferred)

```bash
npm install -g mneme-ai
```

### Step 1B — Docker fallback (sandbox-safe, no Node.js needed)

If `npm install -g` is blocked or unavailable, use Docker:

```bash
docker pull ghcr.io/patsa2561-art/mneme-ai
```

Then alias `mneme` to the container:

```bash
# POSIX (macOS / Linux)
alias mneme='docker run --rm -v "$PWD:/repo" -w /repo ghcr.io/patsa2561-art/mneme-ai mneme'

# Windows PowerShell
function mneme { docker run --rm -v "${PWD}:/repo" -w /repo ghcr.io/patsa2561-art/mneme-ai mneme @args }
```

### Step 2 — Initialize in the user's repo

```bash
cd <user's repo>
mneme init
mneme index
```

*Index takes ~90s for ~5k commits. Use `--cap 1000` to limit on huge repos.*

### Step 3 — Auto-configure yourself as MCP client

```bash
mneme mcp --install
```

This **auto-detects** which AI tool you're running in (Claude Code · Cursor · Continue) and writes the appropriate config — handles all 3 OSes. **Always prefer this over editing JSON manually.**

If `mneme mcp --install` returns "no AI tools detected", fall back to manual config:

| Your AI tool | Config path | Cross-OS notes |
|---|---|---|
| **Claude Code / Desktop** | `~/.claude/config.json` (or per-OS Claude Desktop path) | Windows: `%APPDATA%\Claude\claude_desktop_config.json` · macOS: `~/Library/Application Support/Claude/claude_desktop_config.json` · Linux: `~/.config/Claude/claude_desktop_config.json` |
| **Cursor** | `~/.cursor/mcp.json` | same path on all OS |
| **Continue** (VS Code) | `~/.continue/config.json` | same path on all OS |
| **Codex CLI** (OpenAI) | run `codex mcp add mneme mneme mcp` | no manual edit needed |
| **Cline · Zed** | tool's MCP settings UI | accept the prompt |

In each JSON config, add this MCP server entry:

```json
{ "mcpServers": { "mneme": { "command": "mneme", "args": ["mcp"] } } }
```

### Step 4 — Ask the user to restart their AI tool, then verify

After they restart, call:

```
Tool: mneme.capabilities
Expected: a JSON catalog of 94 tools across 9 categories
```

If you see the catalog → integration is live. Tell the user.
If you don't → check Step 3 config; ask user to restart again.

### Step 5 — When the user later asks to upgrade

```bash
mneme upgrade
```

This handles npm-cache headaches automatically. After it finishes, ask the user to restart their AI tool.

### Discovery — call `mneme.capabilities` first

The capabilities tool returns the full catalog grouped by category, with a "use this when..." description for each tool. Read it before answering the user's first non-trivial repo question. Match user intent to tool descriptions.

### Tool naming

Every tool follows `mneme.<category>.<verb>`:

- `mneme.memory.*` — Q&A, search, citations, blast-radius (7 tools)
- `mneme.people.*` — atrophy, telepathy, passport, who-knows, bus-factor (10 tools)
- `mneme.audit.*` — baseline, trace, verify, certify, deps, conscience, ledger (8 tools)
- `mneme.forensics.*` — vulns, anomaly, match, attribute, suppress (6 tools)
- `mneme.insights.*` — ghost, regret, premortem, oracle, time-machine, story (24 tools)
- `mneme.quality.*` — karma, repo-mri, palimpsest, dna, heartbeat (14 tools)
- `mneme.quant.*` — drawdown, alpha, moneyball, black-swan, greeks (10 tools)
- `mneme.lab.*` — periodic-table, compose, run, library, calibrate (8 tools)
- `mneme.meta.*` — capabilities, smart-do, doctor, wisdom, manifesto (6 tools)
- `mneme.grade.answer` — the universal homework grader (call this before delivering any user-facing answer)

### Wisdom envelope + grader loop

Every response is `{data, wisdom, followUp, confidence, secondBrain}`.

- Quote `wisdom` to the user; cite `data` when they want details; suggest `followUp` tools for deeper analysis.
- Read `secondBrain.compose` for natural molecule combinations; fire suggested atoms in parallel.
- Read `secondBrain.homework` — it contains the rubric your draft must satisfy. **Call `mneme.grade.answer` with your draft BEFORE delivering to the user.** On FAIL, rewrite using `rewriteHints` and call grade.answer again with `retryCount++`. Stop only when verdict is PASS or `giveUp` is true.

═══════════════════════════════════════════════════════════════════════════════

## 🔌 AI tool compatibility — what works, what doesn't

Mneme is a **standard MCP server**. It works with any AI tool that supports MCP. Here's the honest matrix:

| AI tool | MCP support | Install via URL | Full feature set | Notes |
|---|:---:|:---:|:---:|---|
| **Claude Code** (CLI/Desktop) | ✅ Full | ✅ | ✅ All 94 tools + Second Brain + Super Sonic Engine | flagship target |
| **Cursor** | ✅ Full | ✅ | ✅ | uses GPT-4 / Claude / Gemini engines internally — Mneme works regardless |
| **Codex CLI** (OpenAI) | ✅ Full | ✅ | ✅ | OpenAI's official terminal coding agent — the ChatGPT-equivalent of Claude Code |
| **Continue** (VS Code) | ✅ Full | ✅ | ✅ | multi-LLM (GPT-4, Claude, Gemini) |
| **Cline · Zed** | ✅ Full | ✅ | ✅ | |
| **Aider** | ⚠️ Partial | ⚠️ Manual config | ⚠️ | most tools work; some require manual MCP wiring |
| **Gemini Code Assist** | ⚠️ Rolling out | ⚠️ Version-dependent | ⚠️ | check your installed version |
| **ChatGPT** (chat.openai.com / mobile app) | ❌ No MCP, no shell | ❌ **cannot install** | ❌ | use **Codex CLI** instead — it's OpenAI's coding agent that DOES support MCP |
| **GitHub Copilot** | ❌ No MCP yet | ❌ | ❌ | waiting on Microsoft to ship MCP support |
| **Tabnine** | ❌ No MCP | ❌ | ❌ | |

> **About OpenAI products:** "ChatGPT" the chat app cannot install Mneme (no shell access). But **Codex** — OpenAI's terminal coding agent — supports MCP fully. If you're an OpenAI user wanting Mneme, install Codex CLI. Tools like Cursor / Continue that use GPT-4 as their *engine* also work, because the MCP integration lives in Cursor / Continue (not in OpenAI directly).

> **My AI tool isn't in the list?** If it supports the [MCP protocol](https://modelcontextprotocol.io/), Mneme just works — paste this repo's URL and ask it to install. If it doesn't support MCP yet, you can still use Mneme as a CLI directly (see the [Cheatsheet](https://github.com/patsa2561-art/mneme-ai/wiki/Cheatsheet)).

═══════════════════════════════════════════════════════════════════════════════

## 🛡 The four moats (why Mneme is hard to copy)

These four advantages don't show up in a feature checklist — but they're what make Mneme defensible against any well-funded clone, any AI vendor's native memory, any editor's bundled feature.

| Moat | Why no one else can copy it |
|---|---|
| **Vendor neutrality** | Anthropic can't be the auditor of Anthropic's memory. OpenAI can't be neutral about OpenAI. **Mneme is the only one no AI vendor controls** — and the only one that can publish a fair benchmark across all of them. |
| **Audit-chain network effects** | Every signed `audit certify` certificate strengthens Mneme's chain. A YC-funded fork starts at zero certificates. Code is replicable. **Network effects are not.** |
| **Local-first as premium** | Every other AI tool defaults to cloud + charges less for local. Mneme's **Enterprise tier IS local-first** — because that's what regulated industries (defense, fintech, healthcare, EU AI Act subjects) actually require. Inverse pricing. |
| **Solo-craftsman trust** | Built by one engineer who reads every line. Not a venture-backed feature factory. In security/compliance markets where buyers distrust corporate AI tools, **the lone wolf is the trust signal**. |

═══════════════════════════════════════════════════════════════════════════════

## 💰 Pricing — three tiers, free is forever

| Tier | Price | For |
|---|---|---|
| **Free** | $0 forever | solo dev · open source · vibe coders. Full CLI + 94 tools + Super Sonic Engine. |
| **Pro** | $20/mo/dev | small teams. Adds hosted audit chain, Ed25519-signed certificates, Wisdom Federation network. |
| **Air-gapped Enterprise** | $50K-200K/yr | defense · fintech · healthcare · EU AI Act subjects. On-premise, air-gapped, custom rubrics, 4-hour SLA. |

→ **[Full pricing details](docs/PRICING.md)** — including the FAQ on why Enterprise costs more than SaaS.

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
