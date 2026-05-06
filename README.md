<div align="center">

<h1>μνήμη · Mneme</h1>

<p><i>The memory layer of your codebase.</i></p>

<p>
  Pronounced <code>NEE-meh</code> · Greek for "memory"<br/>
  <sub>sister of Lethe (forgetting), mother of the muses.</sub>
</p>

<p>
  <a href="https://www.npmjs.com/package/mneme-ai"><img src="https://img.shields.io/npm/v/mneme-ai?label=mneme-ai&color=cb3837&logo=npm" alt="npm"></a>
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="license">
  <img src="https://img.shields.io/badge/tests-742%20passing-2da44e" alt="tests">
  <img src="https://img.shields.io/badge/recall%401-87%25-2da44e" alt="recall">
  <img src="https://img.shields.io/badge/local--first-yes-blue" alt="local">
  <a href="https://registry.modelcontextprotocol.io/"><img src="https://img.shields.io/badge/MCP-registered-c084fc" alt="mcp"></a>
  <a href="https://github.com/patsa2561-art/mneme-ai/stargazers"><img src="https://img.shields.io/github/stars/patsa2561-art/mneme-ai?logo=github&color=fbbf24" alt="stars"></a>
</p>

<p><b>Code knows <i>what</i>. Git knows <i>why</i>. The pager knows <i>what broke</i>.</b><br/>
Until Mneme, nothing connected them.</p>

</div>

<br/>

═══════════════════════════════════════════════════════════════════════════════

## 🚀 Install — three ways, pick by use case

| Use case | Command |
|---|---|
| 🔬 **Try once** *(zero install)* | `npx -y mneme-ai init` |
| 💼 **Daily use** *(recommended)* | `npm install -g mneme-ai` |
| 🛠 **Contributing / cutting edge** | `git clone …/mneme-ai && cd mneme-ai && npm install && npm run build` |

After install, the same 60-second flow on any git repo:

```bash
mneme init                       # creates .mneme/ inside the repo
mneme index                      # ~90s for 5k commits with Ollama
mneme ask "why does X exist?"    # query the memory
```

> 📌 Local SQLite · no signup · no telemetry · MIT licensed.

═══════════════════════════════════════════════════════════════════════════════

## 🔧 Upgrade

```bash
mneme --version                       # 1. see what you have
npm install -g mneme-ai@latest        # 2. pull latest
mneme --version                       # 3. verify
```

> 💡 If the version doesn't change, open a fresh terminal — your shell caches the old binary path. On Windows, `npm install -g` writes to `%APPDATA%\npm\` which the parent shell only re-reads on launch.

| Action | Command |
|---|---|
| 📌 Pin a version *(reproducible setups)* | `npm install -g mneme-ai@0.14.0` |
| 🗑 Uninstall | `npm uninstall -g mneme-ai` |
| 🔄 Re-index after upgrade | `mneme index` *(idempotent — your data is safe)* |
| ⚡ npx users | nothing to upgrade — `npx -y mneme-ai@latest <cmd>` always pulls fresh |

═══════════════════════════════════════════════════════════════════════════════

## 🎯 Why people use Mneme

> 💬 *"I gave my AI assistant a memory of my repo. It stopped guessing."*

<table>
<tr>
<td width="50%" valign="top">

### 🤖 AI assistants stop guessing
Plug Mneme into Claude Code · Cursor · Codex · Continue · Cline via **MCP** — the AI answers from your real history, not generic advice.

</td>
<td width="50%" valign="top">

### 🔎 Find the WHY in 2 seconds
`mneme why src/auth.ts:47` walks blame, mines PRs, tells you the actual reason — with citations to the commit that introduced it.

</td>
</tr>
<tr>
<td valign="top">

### 🔮 Predict regret before you commit
`mneme premortem "rewrite auth"` mines past attempts:
> *"7 of 9 similar attempts ended in revert/hotfix. Top risk: token race condition (`b2e1f04`)."*

</td>
<td valign="top">

### 🛡 Audit-grade — zero hallucination
`mneme ask --audit` refuses below confidence floor **and** refuses if any LLM-cited hash isn't in the evidence. ✨ **No other tool ships this.** ✨

</td>
</tr>
</table>

═══════════════════════════════════════════════════════════════════════════════

## 🤖 Tell your AI to install it (one prompt)

Paste this into Claude Code, Cursor, Codex CLI, or any agent that can edit files & run shell:

```
Install Mneme as an MCP server for this repo so you can query my git history
and codebase memory.

Steps:
  1. Run `npx -y mneme-ai init` then `npx -y mneme-ai index`.
  2. Add an MCP server entry pointing to `npx -y mneme-ai mcp` (cwd = this
     repo's absolute path) in the right config file:
       - Claude Code:  ~/.claude/settings.json
       - Cursor:       ~/.cursor/mcp.json
       - Codex CLI:    ~/.codex/config.json
  3. Reload MCP and confirm `mneme_ask`, `mneme_why`, `mneme_search_commits`
     appear.
  4. From now on, before answering "why" questions about this code, call
     `mneme_ask` first.
```

The agent will install, configure, and start using Mneme as a tool in its reasoning loop.

═══════════════════════════════════════════════════════════════════════════════

## ⚡ All Commands

### 🟢 Tier 1 — Essentials *(always visible in `mneme --help`)*

| Command | What it does |
|---|---|
| `init` | Initialize Mneme + auto-detect best embedder |
| `doctor` | Smart environment probe |
| `index` | Build memory from git history *(with secret redaction)* |
| `status` | Is the index up to date? |
| `ask "<q>"` | The flagship — verdict-shaped answer with citations |
| `why <file>:<line>` | Git archaeology + RAG for any file/line |
| `mcp` | Run as an MCP server for AI clients |
| `wisdom` | A meditation from the Mneme manifesto |

### 🌟 Insights — *world-firsts in this category*

| Command | Unique because |
|---|---|
| `who-knows <topic>` | Verdict on who's the expert — *active / definitive / stale* tiers |
| `decisions` | Auto-extract ADRs from commit messages *(9 patterns)* |
| `stack-trace [--from F]` | Paste an error → historical context per frame |
| `story <topic>` | Narrate evolution as acts *(initial / refactor / incidents)* |
| `dream` | Speculative ideas grounded in **YOUR** patterns |
| `chat` | Multi-turn REPL over your repo's history |
| `regret [--window N]` | Commits shipped + immediately fixed |
| `bus-factor` | Files where one author owns ≥75% — fragility map |
| `paradox` | Architectural flip-flops *(A → B → A patterns)* |
| `commit-coach` | Pre-commit AI partner |
| `crystal-ball` | Predict CI/follow-up failure for staged diff |
| ✨ **`time-machine <file>`** | Narrate a file's life as eras *(birth/rewrite/firefight/plateau)* |
| ✨ **`premortem "<intent>"`** | Predict regret % grounded in YOUR repo's failures |
| ✨ **`ghost`** | Surface haunted code — half-finished features + stale TODOs |
| ✨ **`dna [@author]`** | Exportable developer fingerprint *(style, hours, file affinity)* |
| ✨ **`drift`** | Topical evolution *(feature/refactor/firefight ratios)* |
| ✨ **`chronicle`** | Auto-generate chaptered narrative documentary |
| ✨ **`oracle`** | Predict next-window co-edits and author collisions |
| ✨ **`constellation`** | Graph view: files=stars, authors=orbitals, commits=edges |
| ✨ **`cluster`** | Semantic clustering of commit messages *(NLP)* |
| ✨ **`network`** | Author social graph: co-edit + co-time + co-topic edges |
| ✨ **`manage`** | Engineering management dashboard *(succession + skill matrix)* |
| ✨ **`bundle`** | Universal codebase export *(every analysis → JSON + Markdown)* |

### 💰 Quant — *Wall-Street-inspired engineering intelligence*

| Command | What it tells you |
|---|---|
| `drawdown` | Worst losing streaks *(firefighting periods)* |
| `alpha --items F` | Kelly-criterion allocation across tech-debt items |
| `backtest --samples F` | Validate any predictor against historical outcomes |
| `black-swan` | Rare-but-catastrophic file patterns |
| `insider-trading` | Authors who fix bugs they introduced |
| `moneyball` | Undervalued contributors *(high ROI, low LOC)* |
| `greek` | Δ knowledge loss · Γ risk acceleration · Θ file decay |
| `correlation-matrix` | Hidden behavioral coupling between files |
| `implied-volatility` | Chaos predicted from commit message tone |
| `tax-loss-harvest` | Dead-code deletion candidates |

### 🔧 Phase 2-3 + WILD + Wisdom

| Command | What it does |
|---|---|
| `entities` · `clones` | Phase 2 — semantic similarity over symbols |
| `correlate` · `blast` · `palimpsest` · `conscience` | Phase 3 — incident correlation |
| `heal` · `echo` · `runaway` · `mirror` · `rumor` · `fossil` · `ledger` | WILD: opinionated extras |
| `feedback` · `calibrate` · `adapt` · `teach` · `genius` | Wisdom Mutant Engine *(self-improving)* |

═══════════════════════════════════════════════════════════════════════════════

## 🛡 Audit-grade mode — *zero hallucination guarantee*

```bash
mneme ask --audit "why does the webhook retry?"
```

In audit mode, Mneme:

- ✅ **Refuses below confidence floor** *(default: medium · `--audit-floor low|medium|high`)*
- ✅ **Refuses on unverified citations** — every backtick-hash in the answer is checked against the retrieved evidence
- ✅ **Returns trust score 0–100%** with every answer *(green / cyan / yellow / red badge)*
- ✅ **JSON output** usable as a CI gate or MCP tool result

> 🐑 *This is the only tool we know of that ships an explicit hallucination guard for git Q&A. The new moat.*

═══════════════════════════════════════════════════════════════════════════════

## 🐑 The Black Sheep position

We surveyed every adjacent tool — **Gource · code_swarm · Hercules · Unblocked · HowYouCode · MergeBERT · Cody · Greptile · Copilot Workspace** — and confirmed every command below occupies real whitespace.

| # | Capability | Closest existing | Mneme |
|---|---|---|---|
| 1 | Author social graph w/ semantic edges | Unblocked *(closed, paid)* | ✅ `network` |
| 2 | Semantic commit clustering | arxiv 2110.00697 *(research only)* | ✅ `cluster` |
| 3 | Predictive co-edit | MergeBERT *(research only)* | ✅ `oracle` |
| 4 | Exportable developer DNA | HowYouCode *(snapshot only)* | ✅ `dna` |
| 5 | Engineering management | — *(no tool)* | ✅ `manage` |
| 6 | Universal codebase export | — *(no tool)* | ✅ `bundle` |
| 7 | File evolution as eras | git log *(flat list)* | ✅ `time-machine` |
| 8 | Codebase narrative | — *(no tool)* | ✅ `chronicle` |
| 9 | Predictive risk grounded in your repo | generic AI tools | ✅ `premortem` |
| 10 | Ghost-code detection | — *(no tool)* | ✅ `ghost` |
| 11 | Codebase graph | Gource *(dead, 2014)* | ✅ `constellation` |
| 12 | Topical drift over time | — *(no tool)* | ✅ `drift` |
| 13 | **Audit-grade no-hallucination Q&A** | — *(no tool ships this)* | ✅ `ask --audit` |

**13 world-firsts.** Local-first by design. Alone in the field. **The black sheep.**

═══════════════════════════════════════════════════════════════════════════════

## 🔒 Privacy in 60 seconds

| Concern | Default behavior |
|---|---|
| 📂 Where does my code go? | **Nowhere.** SQLite stays in `.mneme/` *(gitignored)* |
| 🤖 LLM calls? | Off by default. Opt in with Ollama *(local)* or OpenAI *(your key)* |
| 🔑 Secrets in commits? | Auto-redacted: 12 patterns *(AWS · GitHub PAT · Stripe · Slack · JWT · …)* |
| 📡 Telemetry? | **Zero.** No phone home. No analytics. |
| 📜 Tamper-evident audit log? | `mneme ledger --since 2025-01-01` *(SOX/SOC2-friendly)* |

═══════════════════════════════════════════════════════════════════════════════

## 📚 Want more? → [Wiki](https://github.com/patsa2561-art/mneme-ai/wiki)

| Page | What's there |
|---|---|
| 🌟 [**Innovations**](https://github.com/patsa2561-art/mneme-ai/wiki/Innovations) | 15 unique commands deep-dive *(with output samples)* |
| 🗺 [**Command-Tour**](https://github.com/patsa2561-art/mneme-ai/wiki/Command-Tour) | Story-driven walkthrough — every command, told as workflow |
| 🤖 [**MCP-Integration**](https://github.com/patsa2561-art/mneme-ai/wiki/MCP-Integration) | Drop into Claude Code · Cursor · Codex · Continue · Cline · Zed |
| 🚀 [**Quickstart**](https://github.com/patsa2561-art/mneme-ai/wiki/Quickstart) · [**Installation**](https://github.com/patsa2561-art/mneme-ai/wiki/Installation) · [**Configuration**](https://github.com/patsa2561-art/mneme-ai/wiki/Configuration) | First 5 minutes, in detail |
| 🍳 [**Recipes**](https://github.com/patsa2561-art/mneme-ai/wiki/Recipes) | Multi-command workflows for real engineering scenarios |
| ❓ [**FAQ**](https://github.com/patsa2561-art/mneme-ai/wiki/FAQ) · [**Troubleshooting**](https://github.com/patsa2561-art/mneme-ai/wiki/Troubleshooting) | Short, direct answers |

🏗 Architecture deep-dive: [ARCHITECTURE.md](./ARCHITECTURE.md) · 🔒 Privacy: [docs/SECURITY.md](./docs/SECURITY.md) · 🗺 Roadmap: [ROADMAP.md](./ROADMAP.md)

═══════════════════════════════════════════════════════════════════════════════

## 📦 Project links

<table>
<tr>
<td>📦 <b>npm</b></td>
<td><a href="https://www.npmjs.com/package/mneme-ai">https://www.npmjs.com/package/mneme-ai</a></td>
</tr>
<tr>
<td>🌐 <b>MCP Registry</b></td>
<td><code>io.github.patsa2561-art/mneme-ai</code> at <a href="https://registry.modelcontextprotocol.io/">registry.modelcontextprotocol.io</a></td>
</tr>
<tr>
<td>💻 <b>GitHub</b></td>
<td><a href="https://github.com/patsa2561-art/mneme-ai">github.com/patsa2561-art/mneme-ai</a></td>
</tr>
<tr>
<td>📚 <b>Wiki</b></td>
<td><a href="https://github.com/patsa2561-art/mneme-ai/wiki">github.com/patsa2561-art/mneme-ai/wiki</a></td>
</tr>
<tr>
<td>📋 <b>CHANGELOG</b></td>
<td><a href="./CHANGELOG.md">./CHANGELOG.md</a></td>
</tr>
</table>

═══════════════════════════════════════════════════════════════════════════════

## 📜 License & support

[**MIT**](./LICENSE) — use it, fork it, ship it.

> 🧑‍💻 Solo developer. I read every issue. PRs welcome. Be kind.

<div align="center">

<br/>

*"Until Mneme, your code knew **what** but not **why**."*

**μνήμη — the memory layer of your codebase.** 🐑

</div>
