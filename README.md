<h1 align="center">μνήμη · Mneme</h1>

<p align="center"><i>The memory layer of your codebase.</i></p>

<p align="center">
  Pronounced <code>NEE-meh</code> · Greek for "memory" — sister of Lethe (forgetting), mother of the muses.
</p>

<p align="center">
  <img src="https://img.shields.io/npm/v/mneme-ai?label=mneme-ai&color=cb3837" alt="npm">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="license">
  <img src="https://img.shields.io/badge/tests-742%20passing-2da44e" alt="tests">
  <img src="https://img.shields.io/badge/recall%401-87%25-2da44e" alt="recall">
  <img src="https://img.shields.io/badge/local--first-yes-blue" alt="local">
  <img src="https://img.shields.io/badge/MCP-server-c084fc" alt="mcp">
  <a href="https://github.com/patsa2561-art/mneme-ai/stargazers"><img src="https://img.shields.io/github/stars/patsa2561-art/mneme-ai?logo=github&color=fbbf24" alt="stars"></a>
</p>

> Code knows *what*. Git knows *why*. The pager knows *what broke*.
> Until Mneme, nothing connected them.

═══════════════════════════════════════════════════════════════════════════════

## 🚀 Install — three ways, pick by use case

```bash
# Try once — zero install
npx -y mneme-ai init

# Daily use — global install (recommended)
npm install -g mneme-ai

# Contributing / cutting edge
git clone https://github.com/patsa2561-art/mneme-ai.git
cd mneme-ai && npm install && npm run build
```

After install, the same 60-second flow on any git repo:

```bash
mneme init                       # creates .mneme/ inside the repo
mneme index                      # ~90s for 5k commits with Ollama
mneme ask "why does X exist?"    # query the memory
```

Local SQLite, no signup, no telemetry, MIT licensed.

═══════════════════════════════════════════════════════════════════════════════

## 🎯 Why people use Mneme

**1. AI coding assistants stop guessing.**
Plug Mneme into Claude Code / Cursor / Codex / Continue / Cline via **MCP** and the AI answers from your real history — not generic advice.

**2. Find the WHY behind any line in 2 seconds.**
`mneme why src/auth.ts:47` walks the blame, mines the PRs, and tells you the actual reason — with citations to the commit that introduced it.

**3. Predict regret before you commit.**
`mneme premortem "rewrite auth"` mines past attempts and warns:
> *"7 of 9 similar attempts ended in revert/hotfix. Top risk: token race condition (cited from `b2e1f04`)."*

**4. Audit-grade answers — zero hallucination.**
`mneme ask --audit` refuses to answer below confidence floor *and* refuses if any LLM-cited hash isn't in the retrieved evidence. ✨ **No other tool ships this guarantee.** ✨

═══════════════════════════════════════════════════════════════════════════════

## 🤖 Tell your AI to install it (one prompt)

Paste this into Claude Code, Cursor, Codex CLI, or any agent that can edit files:

> *Install Mneme as an MCP server for this repo so you can query my git history and codebase memory. Run `npx -y mneme-ai init` then `npx -y mneme-ai index`, then add an MCP server entry pointing to `npx -y mneme-ai mcp` (cwd = this repo's absolute path) in the right config file (`~/.claude/settings.json` for Claude Code, `~/.cursor/mcp.json` for Cursor, `~/.codex/config.json` for Codex). Reload MCP and confirm `mneme_ask`, `mneme_why`, `mneme_search_commits` appear. From now on, before answering "why" questions about this code, call `mneme_ask` first.*

The agent will install, configure, and start using Mneme as a tool in its reasoning loop.

═══════════════════════════════════════════════════════════════════════════════

## ⚡ All Commands

### Tier 1 — Essentials *(always visible)*

| Command | What it does |
|---|---|
| `init` | Initialize Mneme + auto-detect best embedder |
| `doctor` | Smart environment probe |
| `index` | Build memory from git history (with secret redaction) |
| `status` | Is the index up to date? |
| `ask "<q>"` | The flagship — verdict-shaped answer with citations |
| `why <file>:<line>` | Git archaeology + RAG for any file/line |
| `mcp` | Run as an MCP server for AI clients |
| `wisdom` | A meditation from the Mneme manifesto |

### 🌟 Insights — *world-firsts in this category*

| Command | Unique because |
|---|---|
| `who-knows <topic>` | Verdict on who's the expert (active / definitive / stale tier) |
| `decisions` | Auto-extract ADRs from commit messages (9 patterns) |
| `stack-trace [--from F]` | Paste an error → historical context per frame |
| `story <topic>` | Narrate evolution as acts (initial / refactor / incidents) |
| `dream` | Speculative ideas grounded in YOUR patterns |
| `chat` | Multi-turn REPL over your repo's history |
| `regret [--window N]` | Commits shipped + immediately fixed (regret rate) |
| `bus-factor` | Files where one author owns ≥75% — fragility map |
| `paradox` | Architectural flip-flops (A → B → A patterns) |
| `commit-coach` | Pre-commit AI partner: message + reviewers + warnings |
| `crystal-ball` | Predict CI/follow-up failure for staged diff |
| **`time-machine <file>`** ✨ | Narrate a file's life as eras (birth / rewrite / firefight / plateau) |
| **`premortem "<intent>"`** ✨ | Predict regret % grounded in YOUR repo's failure history |
| **`ghost`** ✨ | Surface haunted code: half-finished features + stale TODOs |
| **`dna [@author]`** ✨ | Exportable developer fingerprint (style, hours, file affinity) |
| **`drift`** ✨ | Topical evolution over time (feature/refactor/firefight ratios) |
| **`chronicle`** ✨ | Auto-generate chaptered narrative documentary |
| **`oracle`** ✨ | Predict next-window co-edits and author collisions |
| **`constellation`** ✨ | Graph view: files=stars, authors=orbitals, commits=edges |
| **`cluster`** ✨ | Semantic clustering of commit messages (NLP) |
| **`network`** ✨ | Author social graph with co-edit + co-time + co-topic edges |
| **`manage`** ✨ | Engineering management dashboard (succession + skill matrix) |
| **`bundle`** ✨ | Universal codebase export (every analysis → JSON + Markdown) |

### 💰 Quant — *Wall-Street-inspired engineering intelligence*

| Command | What it tells you |
|---|---|
| `drawdown` | Worst losing streaks (firefighting periods) |
| `alpha --items F` | Kelly-criterion allocation across tech-debt items |
| `backtest --samples F` | Validate any predictor against historical outcomes |
| `black-swan` | Rare-but-catastrophic file patterns |
| `insider-trading` | Authors who fix bugs they introduced |
| `moneyball` | Undervalued contributors (high ROI, low LOC) |
| `greek` | Δ knowledge loss · Γ risk acceleration · Θ file decay |
| `correlation-matrix` | Hidden behavioral coupling between files |
| `implied-volatility` | Chaos predicted from commit message tone |
| `tax-loss-harvest` | Dead-code deletion candidates |

### 🔧 Phase 2-3 + WILD

| Command | What it does |
|---|---|
| `entities` · `clones` | Phase 2 — semantic similarity over symbols |
| `correlate` · `blast` · `palimpsest` · `conscience` | Phase 3 — incident correlation |
| `heal` · `echo` · `runaway` · `mirror` · `rumor` · `fossil` · `ledger` | WILD: opinionated extras |
| `feedback` · `calibrate` · `adapt` · `teach` · `genius` | Wisdom Mutant Engine (self-improving) |

═══════════════════════════════════════════════════════════════════════════════

## 🛡 Audit-grade mode (✨ unique to Mneme)

```bash
mneme ask --audit "why does the webhook retry?"
```

In audit mode:
- ✅ Refuses to answer below confidence floor (default: medium)
- ✅ Refuses if any LLM-cited hash is **not** in the retrieved evidence
- ✅ Returns a **trust score 0–100%** with every answer
- ✅ JSON output usable as a CI gate or MCP tool result

This is the only tool we know of that ships an explicit hallucination guard for git Q&A.

═══════════════════════════════════════════════════════════════════════════════

## 🐑 The Black Sheep position

We surveyed every adjacent tool in the landscape:

| Category | Closest tool | What was missing | Mneme answer |
|---|---|---|---|
| Author social graph | Unblocked.com (closed, paid) | OSS | `mneme network` |
| Semantic commit clustering | arxiv 2110.00697 (research only) | shipped CLI | `mneme cluster` |
| Predictive co-edit | MergeBERT (research only) | productized | `mneme oracle` |
| Exportable developer DNA | HowYouCode (snapshot only) | history-derived | `mneme dna` |
| Engineering management | — | combined frame | `mneme manage` |
| Universal codebase export | — | bundled artifact | `mneme bundle` |
| File evolution as eras | git log | grouped, labeled | `mneme time-machine` |
| Codebase narrative | — | novel-format | `mneme chronicle` |
| Predictive risk grounded in your repo | generic AI tools | repo-specific | `mneme premortem` |
| Ghost-code detection | — | combined score | `mneme ghost` |
| Codebase graph | Gource (dead 2014) | maintained, exportable | `mneme constellation` |
| **Audit-grade no-hallucination Q&A** | — | **— nothing ships this** | `mneme ask --audit` |

**12 world-firsts.** Local-first by design. Alone in the field. Black sheep.

═══════════════════════════════════════════════════════════════════════════════

## 🔧 Upgrade

```bash
mneme --version                       # 1. see what you have
npm install -g mneme-ai@latest        # 2. pull latest
mneme --version                       # 3. verify
```

> If the version doesn't change, open a fresh terminal — your shell is caching the old binary path. On Windows, `npm install -g` writes to `%APPDATA%\npm\` which the parent shell only re-reads on launch.

- **Pin a version** (for reproducible setups): `npm install -g mneme-ai@0.14.0`
- **Uninstall:** `npm uninstall -g mneme-ai`
- **npx users:** nothing to upgrade — `npx -y mneme-ai@latest <cmd>` always pulls fresh.

Re-index after upgrading: `mneme index` — schema migrations are idempotent so your data is safe.

═══════════════════════════════════════════════════════════════════════════════

## 📚 Want more? → [Wiki](https://github.com/patsa2561-art/mneme-ai/wiki)

| Page | What's there |
|---|---|
| [**Innovations**](https://github.com/patsa2561-art/mneme-ai/wiki/Innovations) | 14 unique commands deep-dive (with output samples) |
| [**Command-Tour**](https://github.com/patsa2561-art/mneme-ai/wiki/Command-Tour) | Story-driven walkthrough — every command, told as workflow |
| [**MCP-Integration**](https://github.com/patsa2561-art/mneme-ai/wiki/MCP-Integration) | Drop into Claude Code / Cursor / Codex / Continue / Cline / Zed |
| [**Quickstart**](https://github.com/patsa2561-art/mneme-ai/wiki/Quickstart) · [**Installation**](https://github.com/patsa2561-art/mneme-ai/wiki/Installation) · [**Configuration**](https://github.com/patsa2561-art/mneme-ai/wiki/Configuration) | First 5 minutes, in detail |
| [**Recipes**](https://github.com/patsa2561-art/mneme-ai/wiki/Recipes) | Multi-command workflows for real engineering scenarios |
| [**FAQ**](https://github.com/patsa2561-art/mneme-ai/wiki/FAQ) · [**Troubleshooting**](https://github.com/patsa2561-art/mneme-ai/wiki/Troubleshooting) | Short, direct answers |

Architecture deep-dive: [ARCHITECTURE.md](./ARCHITECTURE.md) · Privacy & Security: [docs/SECURITY.md](./docs/SECURITY.md) · Roadmap: [ROADMAP.md](./ROADMAP.md)

═══════════════════════════════════════════════════════════════════════════════

## 🔒 Privacy in 60 seconds

| Concern | Default behavior |
|---|---|
| Where does my code go? | **Nowhere.** SQLite stays in `.mneme/` (gitignored). |
| LLM calls? | Off by default. Opt in with Ollama (local) or OpenAI (your key). |
| Secrets in commits? | Auto-redacted: 12 patterns (AWS / GitHub PAT / Stripe / Slack / JWT / …). |
| Telemetry? | Zero. No phone home. No analytics. |
| Tamper-evident audit log? | `mneme ledger --since 2025-01-01` (SOX/SOC2-friendly). |

═══════════════════════════════════════════════════════════════════════════════

## 📦 Project links

- **npm:** https://www.npmjs.com/package/mneme-ai
- **MCP Registry:** https://registry.modelcontextprotocol.io/ (`io.github.patsa2561-art/mneme-ai`)
- **GitHub:** https://github.com/patsa2561-art/mneme-ai
- **Wiki:** https://github.com/patsa2561-art/mneme-ai/wiki
- **CHANGELOG:** [./CHANGELOG.md](./CHANGELOG.md)

═══════════════════════════════════════════════════════════════════════════════

## 📜 License & support

[MIT](./LICENSE) — use it, fork it, ship it.

Solo developer. I read every issue. PRs welcome. Be kind.

> *"Until Mneme, your code knew what but not why."*
> *"μνήμη — the memory layer of your codebase."*
