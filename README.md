<div align="center">

# μνήμη · **Mneme**

### *The memory layer of your codebase.*

*Pronounced **`NEE-meh`** · Greek for "memory" — sister of Lethe (forgetting), mother of the muses.*

**Code knows _what_. Git knows _why_. The pager knows _what broke_.**
**Until Mneme, nothing connected them.**

[![npm](https://img.shields.io/npm/v/mneme-ai?color=8b5cf6&label=mneme-ai)](https://www.npmjs.com/package/mneme-ai)
[![license](https://img.shields.io/badge/license-MIT-22d3ee)](./LICENSE)
[![tests](https://img.shields.io/badge/tests-468%20passing-22c55e)](./STATUS.md)
[![recall@3](https://img.shields.io/badge/recall%403-87%25-22c55e)](./STATUS.md)
[![local-first](https://img.shields.io/badge/local--first-yes-f59e0b)]()
[![mcp](https://img.shields.io/badge/MCP-server-c084fc)](https://modelcontextprotocol.io)
[![GitHub stars](https://img.shields.io/github/stars/patsa2561-art/mneme-ai?style=social)](https://github.com/patsa2561-art/mneme-ai)

```
   ╭──────────────────────────────────╮
   │  μνήμη  ·  Mneme                 │
   │  the memory layer of your code   │
   ╰──────────────────────────────────╯
```

</div>

<p align="center"><img src="./assets/demo.gif" alt="Mneme — doctor, ask, story, dream, calibrate" width="900"></p>

═══════════════════════════════════════════════════════════════════════════════

## L1 · The Pain

You ask Claude / Cursor / Copilot:

> *"Why does this code use a retry?"*

It looks at the **current code** and guesses. It does **not** read the PR description from 8 months ago that explains the Stripe bug. It does **not** see the incident report that triggered the fix. It hallucinates a plausible-sounding reason — and you ship it.

═══════════════════════════════════════════════════════════════════════════════

## L2 · The Cure

Mneme builds a permanent, queryable **memory** of your repo (commits + PR/issue bodies + blame + incidents) and exposes it through:

- **CLI for humans** — `mneme ask "why does X exist?"`
- **MCP server for AI clients** — Claude Code, Cursor, Continue, Copilot
- **Insights engine** — 11 "killer" commands that turn raw history into actionable answers
- **Wisdom Mutant Engine** — 24/7 daemon that gets better with every query

Local-first by default. Nothing leaves your machine unless you ask.

═══════════════════════════════════════════════════════════════════════════════

## L3 · Commands at a glance

**Tier 1 — essentials** *(`mneme --help` shows these)*

| Command | What it does |
|---|---|
| `init` | Initialize Mneme + auto-detect best embedder |
| `doctor` | Smart environment probe (Ollama / OpenAI / hardware) |
| `index` | Build memory from git history (with secret redaction by default) |
| `ask "..."` | The flagship — verdict-shaped answer with citations |
| `why <file>:<line>` | Git archaeology + RAG for any file/line range |
| `mcp` | Run as an MCP server for AI clients |
| `watch` | 24/7 daemon: re-index, calibrate hourly, self-eval daily |
| `status` | What's indexed, embedder used, DB stats |

**Tier 2 — insights** *(`mneme advanced` shows these)*

| Command | Innovation |
|---|---|
| `who-knows <topic>` | Verdict on the human expert, with % confidence + backup |
| `decisions` | Auto-extract ADRs from commit messages (9 patterns) |
| `story <topic>` | Narrate evolution across acts (initial → refactor → incidents) |
| `stack-trace` | Paste an error → historical context per frame |
| `dream` | Speculative ideas grounded in your codebase patterns |
| `chat` | Multi-turn REPL with conversation context |
| `regret` | Commits shipped + immediately fixed — the "regret rate" of your repo |
| `bus-factor` | Files where one author owns ≥75% — knowledge fragility map |
| `paradox` | Architectural flip-flops (A → B → A) over time |
| `commit-coach` | Pre-commit partner: message + reviewers + scope + warnings |
| `crystal-ball` | Predict CI / follow-up failure probability before you push |

═══════════════════════════════════════════════════════════════════════════════

## L4 · Install

Three ways. Pick by use case.

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

═══════════════════════════════════════════════════════════════════════════════

## L5 · Upgrade

```bash
mneme --version                       # 1. see what you have
npm install -g mneme-ai@latest        # 2. pull latest
mneme --version                       # 3. verify
```

> If the version doesn't change, open a fresh terminal — your shell is caching the old binary path. On Windows, `npm install -g` writes to `%APPDATA%\npm\` which the parent shell only re-reads on launch.

**Pin a version** (for reproducible setups): `npm install -g mneme-ai@0.9.0`
**Uninstall:** `npm uninstall -g mneme-ai`
**npx users:** nothing to upgrade — `npx -y mneme-ai@latest <cmd>` always pulls fresh.

═══════════════════════════════════════════════════════════════════════════════

## L6 · See the output (real terminal output, not synthetic)

### `mneme ask "why does the webhook handler retry?"`

```
  Q  why does the webhook handler retry?

  ●  HIGH CONFIDENCE         synthesized in 1.2s

  ✦ Answer

    The retry exists because Stripe occasionally drops the connection
    mid-webhook. PR #482 added exponential backoff after INC-1287
    showed it was the root cause of revenue loss on Black Friday.
    Cite: `a1b2c3d`.

  ◆ Evidence  (showing 3 of 8)

    ●  PR #482   alice@   2024-08-12
       Fix Stripe webhook crash on amount=BigInt
       ↪ src/payment.ts · src/webhook.ts

  → Try next
    $ mneme why src/payment.ts        — walk the blame on the top file
    $ mneme story stripe              — see how stripe evolved
    $ mneme who-knows stripe          — find the expert
```

### `mneme who-knows stripe` *(verdict-shaped, no list to scan)*

```
  👤  Who knows about  "stripe"
  ════════════════════════════════════════════════════════════

  ✦ Verdict

    alice@example.com
    78% confidence — 47 of 60 relevant commits
    last touch 8d ago · 23 files · ⭐ definitive

    backup: bob (8 commits, last touch 3w ago)
```

### `mneme regret` *(shipped + fixed within window — your "regret rate")*

```
  😬  Regrets — what we shipped and immediately fixed
  ════════════════════════════════════════════════════════════

  ✦ Summary

    3 regrets across 47 shipped commits  (rate: 6.4%)
    average days-to-fix: 2.7

  ◆ Recent regrets

    REVERT    shipped 2026-04-02  → fixed in 2d
        e1234ab  feat: enable HTTP/3 on edge
        ↳ a1b2c3d  Revert "feat: enable HTTP/3"
        lesson: broke 30% of mobile clients
```

### `mneme bus-factor` *(knowledge fragility map)*

```
  🚨  Bus-factor risks — knowledge fragility
  ════════════════════════════════════════════════════════════

  CRITICAL  src/payment/stripe.ts
      alice  92%  (45 of 49 commits)
      backup: bob (3 commits)
      → Pair with bob this sprint — they are the only backup signal in history.
```

### `mneme commit-coach` *(pre-commit AI partner)*

```
  🪶  Commit coach — pre-commit review
  ════════════════════════════════════════════════════════════

  ✦ Suggested commit message

    refactor(auth): extract token validation into middleware

  ◆ Reviewers

    ● alice  87%  (jwt.ts owner)
    ● bob    72%  (middleware.ts owner)

  ◆ Scope                             ✓ 2 files, 1 module — focused
  ⚠ Past warnings
    Past change in src/auth/middleware.ts caused a hotfix within 0d.
        2024-09-12 · a1b2c3d · CSRF check disappeared in refactor
```

### `mneme crystal-ball` *(predict failure before you push)*

```
  🔮  Crystal ball — CI / follow-up failure prediction
  ════════════════════════════════════════════════════════════

  ✦ Verdict

    ● MODERATE     62% clean rate  (5/8 similar past changes)

  → Recommendation
    3 of 8 similar past changes needed a follow-up fix.
    Run lint + tests locally first.
```

═══════════════════════════════════════════════════════════════════════════════

## L7 · Compatibility · Privacy · Cost

| | |
|---|---|
| **Languages** | Any (git-based). Entity parsing for TS/JS · Python · Go. |
| **Hosts** | GitHub · GitLab · Bitbucket · Gitea · self-hosted · local-only |
| **Privacy** | Local-first. Source code never leaves your machine. See [SECURITY.md](./docs/SECURITY.md). |
| **Cost** | Free with Ollama or hash. ~$0.05 to index 5k commits with OpenAI (optional). |
| **Air-gapped** | Yes. `--no-llm` mode + hash embedder = zero network calls. |
| **Banks / regulated** | `mneme ledger` (tamper-evident audit), `--no-llm`, secret redaction. See [SECURITY.md](./docs/SECURITY.md). |
| **MCP support** | Native. Drop-in for Claude Code, Cursor, Continue, Copilot. |

═══════════════════════════════════════════════════════════════════════════════

## L8 · How it works (one paragraph)

Mneme runs `git log` against your repo, fans out PR/issue lookups against the host (GitHub/GitLab/Bitbucket), and stores the result in `.mneme/mneme.db` (SQLite + FTS5 + WAL). Each commit message + PR body is chunked and embedded with Ollama (or OpenAI if you prefer; or a deterministic hash fallback). At query time, Mneme runs **hybrid retrieval** — BM25 lexical via SQLite FTS5 (trigram tokenizer for Thai/CJK/Arabic compatibility) AND cosine over embedding blobs — and fuses the two ranked lists with **Reciprocal Rank Fusion** (k=60). Confidence is computed from top-score AND gap-to-rest, so tied results drop to "low" honestly. Then the LLM (when available) synthesizes a verdict-shaped answer; when no LLM, an extractive aggregator does the same job structurally.

═══════════════════════════════════════════════════════════════════════════════

## L9 · Quality bar — measured, not claimed

468 tests passing in CI on Ubuntu/macOS/Windows × Node 20/22. Every retrieval change runs against a 50-question golden set; PRs that lower any core metric are rejected.

```
recall@1   78%      MRR        77%
recall@3   87%      nDCG@10    79%
hit rate   96%      negative   100%   ← honest "no context found"
query p50  1.3 ms   languages  TS, JS, Python, Go
```

Reproducible: `npm test`, `npm run eval`, `npm run bench`. Live numbers regenerate in [STATUS.md](./STATUS.md).

═══════════════════════════════════════════════════════════════════════════════

## L10 · Deep dive

| File | What's in it |
|---|---|
| [CHANGELOG.md](./CHANGELOG.md) | Releases — what shipped when, with numbers |
| [ARCHITECTURE.md](./ARCHITECTURE.md) | System diagram, schema, extensibility contracts |
| [ROADMAP.md](./ROADMAP.md) | Phase plan + the "mutant principle" |
| [WILD_IDEAS.md](./WILD_IDEAS.md) | The catalog of innovations (shipped + planned) |
| [docs/SECURITY.md](./docs/SECURITY.md) | Threat model + bank-grade evidence |
| [docs/PRIVACY.md](./docs/PRIVACY.md) | User-facing privacy summary |
| [MEDITATIONS.md](./MEDITATIONS.md) | Thirteen meditations — the project's philosophy |

═══════════════════════════════════════════════════════════════════════════════

## L11 · MCP integration (drop-in for any AI client)

```jsonc
// claude_desktop_config.json or cursor / continue / etc.
{
  "mcpServers": {
    "mneme": {
      "command": "npx",
      "args": ["-y", "mneme-ai", "mcp"],
      "cwd": "/abs/path/to/your/repo"
    }
  }
}
```

The AI now has tools: `mneme_ask`, `mneme_why`, `mneme_search_commits`, `mneme_status`, `mneme_list_entities`, `mneme_find_similar`, `mneme_blast`. **Result: the AI stops guessing about history. It reads it.**

═══════════════════════════════════════════════════════════════════════════════

## L12 · FAQ — short answers only

**Does it send my code anywhere?** No. Default Ollama → nothing leaves your machine. OpenAI → only commit messages + PR text, never source code.

**My commit messages are bad.** Use `mneme heal` to synthesize WHY notes from diffs. Or accept the honest "no context found" — Mneme does not fabricate.

**How big a repo?** Tested on 100k commits / 8GB DB. Beyond that, swap in `sqlite-vec` (one config line — see [ARCHITECTURE.md](./ARCHITECTURE.md)).

**Why "Mneme"?** Greek personification of memory. Sometimes counted among the Muses. The right ancestor for a tool whose job is to remember.

═══════════════════════════════════════════════════════════════════════════════

## L13 · License & support

[MIT](./LICENSE) — use it, fork it, ship it.

If Mneme saved you a 30-minute git archaeology session today, give the project a ⭐ on [GitHub](https://github.com/patsa2561-art/mneme-ai). Stars are how solo maintainers know what to keep building.

```bash
mneme wisdom    # accept a meditation as payment
```

`Copyright (c) 2026 Mneme AI contributors`

<div align="center">

**μνήμη**
*remembering what was, so we know why it is.*

</div>
