<div align="center">

<h1>μνήμη · Mneme</h1>

<p><b><i>The memory layer of your codebase.</i></b></p>

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

<h3>Your codebase remembers everything. Your AI assistant remembers nothing.<br/><i>Mneme is the bridge.</i></h3>

<p>
  Every commit, every PR, every late-night fix is recorded in your git history.<br/>
  But your AI assistant can't see any of it — so it guesses.<br/>
  <b>Mneme indexes that history and gives it back to you, and to your AI, in 2 seconds.</b>
</p>

<br/>

<img src="./assets/demo.gif" alt="Mneme — doctor, ask, story, dream, calibrate" width="900">

</div>

<br/>

═══════════════════════════════════════════════════════════════════════════════

## 🚀 Install — pick **one** of three ways

> 💡 **You only need one of these.** Pick the row that fits you, run that one command — done.

| Pick this if you… | Command |
|---|---|
| 🔬 want to **try without installing** anything | `npx -y mneme-ai init` |
| 💼 plan to **use it daily** *(recommended)* | `npm install -g mneme-ai` |
| 🛠 want to **contribute or run the latest code** | `git clone …/mneme-ai && cd mneme-ai && npm install && npm run build` |

After install, run the same 60-second flow on any git repo:

```bash
mneme init                       # creates .mneme/ inside the repo
mneme index                      # ~90s for 5k commits with Ollama
mneme ask "why does X exist?"    # query the memory
```

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

## ✨ Try these 5 commands first

The fastest way to "get it" is to copy-paste any of these on your repo right now:

### 1️⃣  Ask anything about your code

```bash
mneme ask "why does the webhook handler retry?"
```

<details>
<summary>📺 Sample output</summary>

```text
Q  why does the webhook handler retry?

  ● HIGH CONFIDENCE  ◉ TRUST 95%
  synthesized in 240ms

  ✦ Answer
    Per commit a3f9b21 from 2024-08, the team switched from sessions to
    token-based auth after the rate-limit incident referenced in #482.
    The 3-retry backoff was added in the hotfix that followed, matching
    a third-party API provider's recommended client behavior.

  ◆ Evidence  (showing 3 of 8)
  ● a3f9b21  [2024-08-14 · Alice · 0.045]
    fix: retry webhook on 502 (closes #482)
  ● 2c4d8e0  [2024-08-15 · Alice · 0.039]
    pr#503: tune retry backoff to match upstream guidance
```

</details>

### 2️⃣  Understand any line in 2 seconds

```bash
mneme why src/auth/session.ts:47
```

Walks the blame, mines the PRs, returns the actual reason — with citations.

### 3️⃣  Predict regret before you commit

```bash
mneme premortem "rewrite the auth flow"
```

<details>
<summary>📺 Sample output</summary>

```text
🔮  Pre-mortem
═══════════════════════════════════════════════════════════════
intent:  rewrite the auth flow

✦ Verdict
   risk: VERY HIGH  (P(regret) = 78%)
   7 of 9 similar past attempts ended badly.

◆ Top risks
   • token race condition (3× before)
       b2e1f04  fix: stale token served to logged-in users
   • breaking external integrations (2× before)
       9c3593c  hotfix: oauth callback dropped on PATCH
```

</details>

### 4️⃣  See your file's life as a story

```bash
mneme time-machine src/payments/charge.ts
```

Groups commits into eras: birth → rewrite → firefight → plateau. You read 8 epochs and you understand the file's life.

### 5️⃣  Ship audit-grade answers (zero hallucination)

```bash
mneme ask --audit "is this safe to merge?"
```

Refuses to answer below confidence threshold. Refuses if any cited commit hash isn't real. Returns trust score 0–100%. **Use this for CI gates and AI agent tool calls.**

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
`mneme why src/auth.ts:47` walks the blame, mines PRs, tells you the actual reason — with citations to the commit that introduced it.

</td>
</tr>
<tr>
<td valign="top">

### 🔮 Predict regret before you commit
`mneme premortem "rewrite auth"` mines past attempts and warns:
> *"7 of 9 similar attempts ended in revert/hotfix. Top risk: token race condition."*

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

> 💡 Every command supports `--help` for usage notes. Examples below show what each does in plain English.

### 🟢 Tier 1 — Essentials *(always visible in `mneme --help`)*

| Command | Plain-English use | Example |
|---|---|---|
| `init` | First-time setup — picks the best embedder for your machine | `mneme init` |
| `doctor` | "Is everything ok?" — checks Ollama, OpenAI, hardware | `mneme doctor` |
| `index` | Build the memory from your git history *(secrets auto-redacted)* | `mneme index` |
| `status` | Is the index up to date with HEAD? | `mneme status` |
| `ask "<q>"` | **The flagship** — verdict-shaped answer with citations | `mneme ask "why does X exist?"` |
| `why <file>:<line>` | Walk blame + PRs for any file or line | `mneme why src/auth.ts:47` |
| `mcp` | Run as an MCP server for your AI assistant | *(used by AI clients)* |
| `wisdom` | A meditation from the Mneme manifesto | `mneme wisdom` |

### 🌟 Insights — *world-firsts in this category*

| Command | Plain-English use | Example |
|---|---|---|
| `who-knows <topic>` | Who's the expert? *(active / definitive / stale)* | `mneme who-knows stripe` |
| `decisions` | Auto-extract architecture decisions from commits | `mneme decisions` |
| `stack-trace` | Paste an error → historical context per stack frame | `mneme stack-trace --from error.log` |
| `story <topic>` | Narrate evolution as acts | `mneme story stripe` |
| `dream` | Speculative ideas grounded in YOUR patterns | `mneme dream` |
| `chat` | Multi-turn REPL over your repo's history | `mneme chat` |
| `regret` | Commits shipped + immediately fixed | `mneme regret --window 7` |
| `bus-factor` | Files where one author owns ≥75% — fragility map | `mneme bus-factor` |
| `paradox` | Architectural flip-flops *(A → B → A)* | `mneme paradox` |
| `commit-coach` | Pre-commit AI partner | `mneme commit-coach --stdin` |
| `crystal-ball` | Predict CI failure for staged diff | `mneme crystal-ball --stdin` |
| ✨ `time-machine <file>` | Narrate a file's life as eras | `mneme time-machine src/auth.ts` |
| ✨ `premortem "<intent>"` | Predict regret % from YOUR repo's failures | `mneme premortem "add caching"` |
| ✨ `ghost` | Surface haunted code + stale TODOs | `mneme ghost --top 10` |
| ✨ `dna [@author]` | Exportable developer fingerprint | `mneme dna alice@example.com` |
| ✨ `drift` | Topical evolution over time | `mneme drift --granularity month` |
| ✨ `chronicle` | Auto-generate chaptered narrative | `mneme chronicle --output STORY.md` |
| ✨ `oracle` | Predict next-window co-edits + collisions | `mneme oracle --window-days 30` |
| ✨ `constellation` | Graph view: stars/orbitals/edges | `mneme constellation --output graph.json` |
| ✨ `cluster` | Semantic clustering of commit messages | `mneme cluster` |
| ✨ `network` | Author social graph w/ semantic edges | `mneme network` |
| ✨ `manage` | Engineering management dashboard | `mneme manage` |
| ✨ `bundle` | Universal codebase export | `mneme bundle -o release-q2` |

### 💰 Quant — *Wall-Street-inspired engineering intelligence*

| Command | Plain-English use | Example |
|---|---|---|
| `drawdown` | Worst losing streaks *(firefighting periods)* | `mneme drawdown` |
| `alpha` | Kelly-criterion allocation across tech debt | `mneme alpha --items debt.json` |
| `backtest` | Validate any predictor against history | `mneme backtest --samples s.json` |
| `black-swan` | Rare-but-catastrophic file patterns | `mneme black-swan` |
| `insider-trading` | Authors who fix bugs they introduced | `mneme insider-trading` |
| `moneyball` | Undervalued contributors *(high ROI, low LOC)* | `mneme moneyball` |
| `greek` | Δ knowledge loss · Γ risk · Θ file decay | `mneme greek` |
| `correlation-matrix` | Hidden coupling between files | `mneme correlation-matrix` |
| `implied-volatility` | Chaos predicted from commit message tone | `mneme implied-volatility` |
| `tax-loss-harvest` | Dead-code deletion candidates | `mneme tax-loss-harvest` |

> 🧰 **More commands available** — entity-level similarity, incident correlation, the Wisdom Mutant Engine (self-improving), and several specialized tools live in the [Command Tour wiki](https://github.com/patsa2561-art/mneme-ai/wiki/Command-Tour). Run `mneme advanced` to list them all.

═══════════════════════════════════════════════════════════════════════════════

## 🛡 Audit-grade mode — *zero hallucination guarantee*

```bash
mneme ask --audit "why does the webhook retry?"
mneme ask --audit --audit-floor high "..."   # tighten the threshold
```

In audit mode, Mneme:

- ✅ **Refuses below confidence floor** *(default: medium · `--audit-floor low|medium|high`)*
- ✅ **Refuses on unverified citations** — every backtick-hash is checked against retrieved evidence
- ✅ **Returns trust score 0–100%** with every answer *(green / cyan / yellow / red)*
- ✅ **JSON output** usable as a CI gate or MCP tool result

> 🌌 *This is the only tool we know of that ships an explicit hallucination guard for git Q&A. The new moat.*

═══════════════════════════════════════════════════════════════════════════════

## 🌌 The Frontier — what makes Mneme one of a kind

After researching the landscape of git, code-search, and AI-coding tools, we confirmed every command below occupies whitespace where no maintained, open-source, local-first tool ships this capability today.

| # | Capability | Mneme |
|---|---|---|
| 1 | Author social graph with semantic edges | ✅ `network` |
| 2 | Semantic clustering of commit messages *(NLP)* | ✅ `cluster` |
| 3 | Predictive co-edit detection | ✅ `oracle` |
| 4 | Exportable, history-derived developer fingerprint | ✅ `dna` |
| 5 | Engineering management dashboard | ✅ `manage` |
| 6 | Universal codebase export *(bundled artifact)* | ✅ `bundle` |
| 7 | File evolution narrated as eras | ✅ `time-machine` |
| 8 | Codebase narrative documentary | ✅ `chronicle` |
| 9 | Predictive regret risk grounded in YOUR repo | ✅ `premortem` |
| 10 | Multi-signal ghost-code detection | ✅ `ghost` |
| 11 | Maintained codebase graph data layer | ✅ `constellation` |
| 12 | Topical drift over time *(feature/refactor/firefight)* | ✅ `drift` |
| 13 | **Audit-grade Q&A — explicit hallucination guard** | ✅ `ask --audit` |

**13 world-firsts. Local-first by design. One of a kind. The frontier.**

> 🛡 *Built to complement existing AI coding assistants — not to replace them.*

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

**μνήμη — the memory layer of your codebase.**

</div>
