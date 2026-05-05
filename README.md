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
- **Insights engine** — 14 "killer" commands that turn raw history into actionable answers
- **Wisdom Mutant Engine** — 24/7 daemon that gets better with every query

Local-first by default. Nothing leaves your machine unless you ask.

═══════════════════════════════════════════════════════════════════════════════

## L2.5 · Ten things **only Mneme** can do

Other tools show diffs, blame, and search. Mneme answers questions about your repo's *past*, *present*, and *future*. We surveyed the whole landscape (Gource, code_swarm, Hercules, Unblocked, HowYouCode, MergeBERT) before shipping these — every one of them occupies real whitespace.

The first five (v0.11) tell you what *was*. The next five (v0.12 — *King of Git*) tell you who *is* and what's coming *next*.

---

### 1 · 🕰️  `mneme time-machine <file>` — narrate a file's life as eras, not a flat log

Instead of dumping `git log file.ts`, Mneme groups commits into **eras** (birth, rewrite, evolution, firefight, polish, plateau, twilight) and labels each with the WHY.

```text
🕰  Time Machine — life of a file
═══════════════════════════════════════════════════════════════
src/auth/session.ts
57 commits across 412 days

✦ Health
   rewrite 18%  ·  firefight 12%  ·  polish/plateau 70%

◆ Epochs
   BIRTH      2024-03-12  (0d)
       born — "scaffold session middleware"
       1 commits · +84/-0 (84 lines)

   REWRITE    2024-08-14 → 2024-08-21  (7d)
       rewrite — "switch from sessions to JWT after rate-limit incident #482" (412 lines)
       3 commits · +298/-218 (516 lines)

   FIREFIGHT  2024-08-22 → 2024-08-25  (3d)
       firefight — "hotfix: token refresh race"
       4 commits · +47/-12 (59 lines)

   PLATEAU    2024-08-26 → 2025-04-01
       quiet stretch — 218 days untouched

   EVOLUTION  2025-04-02 → today  (32d)
       evolution — "add MFA hooks"
       11 commits · +203/-44 (247 lines)
```

> **Unique because:** every other tool gives you a flat list. Mneme gives you the *story*.

---

### 2 · 🔮  `mneme premortem "<intent>"` — predict regret *before* you write the code

Mines your repo's history for similar past attempts, then walks forward in time looking for revert / hotfix / incident / rewrite signals. Returns a regret probability grounded in **your** failure history — not generic AI advice.

```text
🔮  Pre-mortem — what your repo's history says about this
═══════════════════════════════════════════════════════════════
intent:  add caching layer to api responses

✦ Verdict
   risk: VERY HIGH  (P(regret) = 78%)

   7 of 9 similar past attempts ended badly (78%). This pattern has burned
   this repo before — slow down, write tests first, and review the cited
   commits.

◆ Top risks
   • cache invalidation regression (3× before)
       b2e1f04  fix: stale cache served to logged-in users
       9c3593c  hotfix: invalidation skipped on PATCH
   • memory leak (2× before)
       7f4a821  revert "add LRU cache" — heap grew 8x in 2 hours
   • stale-data races on writes (2× before)
       f9a2c30  incident: orders showed wrong totals after concurrent writes

◇ Similar past attempts  (9 found)
   2024-05-14  b933a2f  [revert]    add response cache to user endpoints
   2024-09-02  9c3593c  [incident]  cache user permissions in middleware
   2025-01-08  6e9a846  [hotfix]    introduce read-through cache for /search
```

> **Unique because:** generic AI tools say *"watch out for cache invalidation."*  Mneme cites the **specific commits** in your repo where that exact thing went wrong.

---

### 3 · 👻  `mneme ghost` — surface "ghost code" haunting your repo

Combines staleness, low-touch ratio, and TODO density into a single **ghostliness score**. Also detects stale TODOs — markers added long ago and ignored through every later edit of the file.

```text
👻  Ghost Code — what's haunting your repo
═══════════════════════════════════════════════════════════════
247 files analyzed  ·  5 ghosts surfaced  ·  avg ghostliness 31%

◆ Ghost files  (top 5)
   src/exporter.ts
     ████████░░  87%   born and forgotten — 412d untouched, only 2 commits ever
     2 commits · 412d quiet · last: "scaffold csv exporter (TODO finish)"

   src/integrations/zendesk.ts
     ███████░░░  74%   one-shot file — added once, never revisited
     1 commits · 287d quiet · last: "stub zendesk webhook handler"

   src/payments/legacy.ts
     ██████░░░░  62%   long-untouched — 198d since last edit
     14 commits · 198d quiet · last: "freeze legacy provider behavior"

◇ Stale TODOs  (3 ignored markers)
   src/payments/charge.ts
     312d old · ignored 47× since
     ↳ "TODO: handle 3DS callback failure path"
```

> **Unique because:** the "haunted code" framing is new. No other tool combines staleness + low-touch + TODO-density into one score.

---

### 4 · 🪞  `mneme channel @<author>` *(coming v0.12.0)* — preserve knowledge when key people leave

Analyzes a contributor's commit patterns to learn their style, then "channels" them when you ask: *"How would Alice have done this?"*

```text
🪞  Channeling @alice
═══════════════════════════════════════════════════════════════
  847 commits · 6 months of data

  Q: "How would you handle this auth flow?"

  Alice's pattern suggests:
    • Functional approach           (98% of her code)
    • Pino for logging              (her go-to logger)
    • Skip class wrappers           (zero classes in her commits)
    • Prefers small composable fns  (median fn = 14 LOC)

  Cited from: a3f9b21, 2c4d8e0, 9f1a440, …
```

> **Unique because:** when a key contributor leaves, their knowledge usually leaves with them. Channel preserves their voice in the codebase.

---

### 5 · 📡  `mneme echo "<idea>"` *(roadmap)* — déjà vu detector for rewrites

Catches the moment you start re-attempting the same kind of change you've tried before — and tells you what happened the previous times.

```text
📡  Echo — you've tried this before
═══════════════════════════════════════════════════════════════
  query: "rewriting auth"

  📡 You've echoed this 3 times:
     • 2024-05  rewrote auth, reverted after 2 weeks   [reverted]
     • 2024-09  partial rewrite, abandoned mid-way     [abandoned]
     • 2025-01  done, but caused 3 prod incidents      [shipped+regret]

  Verdict: 67% historical regret rate.
  Consider: the smaller incremental change in commit 9f1a440 worked.
```

> **Unique because:** pattern recurrence detection — the moment you're about to repeat a mistake, Mneme catches it.

---

### 6 · 🧬  `mneme dna [author]` — *exportable fingerprint of a contributor's style*  ✨ v0.12.0

Other tools show snapshots ("here's their code style today"). DNA extracts a portable signature from *history* — style, hours, message DNA, file affinity — and packages it as JSON you can share or compare.

```text
🧬  Codebase DNA — alice@example.com
═══════════════════════════════════════════════════════════════
  847 commits  ·  2024-03-12 → 2026-05-05  ·  hash a3f9b21

  ✦ Style genome
    files/commit ........ 3
    test ratio .......... 67%
    conventional commits  92%

  ✦ Message DNA
    avg subject length .. 47 chars
    imperative ratio .... 94%
    top verbs ........... add×312  fix×87  refactor×54

  ✦ Working hours (UTC)
    peak window ......... 14:00–18:00
    weekend ratio ....... 6%

  ✦ File affinity
    38%  src/payments
    21%  src/auth
    14%  src/api

  ✦ Compatibility vs bob@example.com
    overall ............. 74%
    style ............... 81%
    message ............. 79%
    hours ............... 65%
    files ............... 70%
```

> **Unique because:** HowYouCode is snapshot-only. Hercules tracks ownership churn but no fingerprint export. **Nobody ships portable, history-derived, comparable per-developer DNA.**

---

### 7 · 📈  `mneme drift` — *topical evolution of a repo over time*  ✨ v0.12.0

Buckets every commit into quarters (or months), classifies each as feature / refactor / firefight / polish / docs, then plots the trajectory as a colored sparkline. Auto-detects burnout, recovery, and rewrite clusters.

```text
📈  Commit Drift — topical evolution
═══════════════════════════════════════════════════════════════

  ◆ Trajectory  (quarter)

    2024-Q1   ████████░░   62 commits  FEATURE
    2024-Q2   ███████░░░   48 commits  FEATURE
    2024-Q3   ░░▓▓▓▓▓▓▓░   31 commits  FIREFIGHT  ⚠
    2024-Q4   ░░░▓▓▓▓▓▓▓   28 commits  FIREFIGHT
    2025-Q1   █▓▓▓▓░░░░░   42 commits  REFACTOR
    2025-Q2   ████████░░   58 commits  FEATURE

  ✦ Insights
    • 2024-Q2 → 2024-Q3   firefight ratio jumped 12% → 71% — burnout signal.
    • 2024-Q4 → 2025-Q1   recovery — fires fell 71% → 18%.
```

> **Unique because:** academic papers cluster commits semantically but never ship. Mneme is the first CLI that does it.

---

### 8 · 📖  `mneme chronicle` — *narrative documentary of your codebase*  ✨ v0.12.0

Auto-detects significant epochs, names each chapter ("The Founding", "The Great Refactor", "The Reckoning"), identifies the protagonist, emits Markdown ready for PDF/EPUB export.

```text
📖  Chronicles of Your Codebase
═══════════════════════════════════════════════════════════════
  847 commits  ·  792 days  ·  6 chapters

  Chapter 1 · The Founding
    2024-03-12 → 2024-05-04  (53d, 87 commits)  protagonist: @alice
    subtitle: scaffold session middleware

  Chapter 2 · The Great Refactor
    2024-08-14 → 2024-10-22  (69d, 142 commits)  protagonist: @alice
    subtitle: switch from sessions to JWT after rate-limit incident #482

  Chapter 3 · The Reckoning
    2024-10-23 → 2024-11-30  (38d, 67 commits)  protagonist: @bob
    subtitle: hotfix: token refresh race condition

  ✓ Markdown chronicle written to CHRONICLE.md
```

`mneme chronicle --output CHRONICLE.md` exports the full narrative as markdown. Convert to PDF or EPUB to print/share.

> **Unique because:** no tool generates novel-format codebase histories. Documentation tools describe code; chronicles describe its *journey*.

---

### 9 · 🔮  `mneme oracle` — *predict next-window co-edits + collisions*  ✨ v0.12.0

From recent commits, builds a recency-weighted author × file affinity matrix and projects probabilities for the next window. Surfaces predicted *collisions* — two authors both likely to touch the same file — so teams can sync before merge-conflicting.

```text
🔮  Oracle — predicted next-window co-edits
═══════════════════════════════════════════════════════════════
  283 commits in window

  ⚠ Predicted collisions

    src/auth/session.ts
      alice ⨯ bob   joint P = 56%
      last joint touch: 4d ago

    src/payments/charge.ts
      bob ⨯ charlie   joint P = 38%

  ◆ Top file predictions

    src/api/handler.ts
      alice                 67%
      bob                   23%
      charlie               10%
```

> **Unique because:** Microsoft's MergeBERT (research) predicts conflicts but isn't shipped. Mneme ships it as a CLI today.

---

### 10 · 🌌  `mneme constellation` — *graph view of your codebase*  ✨ v0.12.0

Build a graph where files are stars (size = touches), authors are orbital bodies, and commits are edges. Co-edit edges connect files committed together. JSON exportable; **WebGL viewer is on the v1.0 roadmap.**

```text
🌌  Codebase Constellation — graph view of your repo
═══════════════════════════════════════════════════════════════
  247 file-stars  ·  8 orbitals  ·  142 co-edit edges  ·  6 clusters

  ◆ Brightest stars (most-touched files)
    ████████  src/payments/charge.ts  (87×)
    ███████░  src/auth/session.ts  (62×)
    ██████░░  src/api/handler.ts  (54×)

  ◆ Closest orbitals (most-active authors)
    ████████  alice  (412 commits)
    ██████░░  bob  (287 commits)
    ████░░░░  charlie  (148 commits)

  ◆ Strongest co-edit edges (files often committed together)
    34×  src/auth/session.ts ⟷ src/auth/jwt.ts
    28×  src/payments/charge.ts ⟷ src/payments/refund.ts
```

> **Unique because:** Gource is animated 2.5D but post-hoc and dead. 3ource (its three.js clone) was abandoned in 2014. Mneme ships the data layer first; the WebGL viewer comes next.

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

## L11 · MCP integration — make your AI coding assistant smarter

Mneme exposes its memory through the **Model Context Protocol** (MCP) — the open standard supported by Claude Code, Cursor, Continue, Codex CLI, Cline, Zed, and any other MCP-aware client. Once attached, your AI gains tools it can call directly: `mneme_ask`, `mneme_why`, `mneme_search_commits`, `mneme_status`, `mneme_list_entities`, `mneme_find_similar`, `mneme_blast`.

**Effect:** the assistant stops guessing about your history. It reads it.

### Just tell your AI to install it (recommended)

Paste this into Claude Code / Cursor / Codex / any AI agent that can edit files and run shell commands:

> *Install Mneme as an MCP server for this repository so you can query my git history and codebase memory.*
>
> *Steps:*
> 1. *Run `npx -y mneme-ai init` to set up the local index, then `npx -y mneme-ai index` to populate it.*
> 2. *Add an MCP server entry pointing to `npx -y mneme-ai mcp` with `cwd` set to this repo's absolute path. Use the right config file for the tool you are running in (`~/.claude/settings.json` for Claude Code, `~/.cursor/mcp.json` for Cursor, `~/.codex/config.json` for Codex CLI, etc.).*
> 3. *Reload the MCP servers and confirm the `mneme_ask`, `mneme_why`, `mneme_search_commits` tools appear.*
> 4. *From now on, before answering any question about why this code exists or how it evolved, call `mneme_ask` first instead of guessing from the open files.*

That's it. The agent will install, configure, and start using Mneme as part of its reasoning loop.

### Manual config (if you prefer to do it yourself)

```jsonc
// claude_desktop_config.json · cursor / continue / codex / cline / zed / etc.
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

| Client | Config file |
|--------|-------------|
| Claude Code | `~/.claude/settings.json` (or `.claude/settings.json` per repo) |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) · `%APPDATA%\Claude\claude_desktop_config.json` (Windows) |
| Cursor | `~/.cursor/mcp.json` |
| Codex CLI | `~/.codex/config.json` |
| Continue | `~/.continue/config.yaml` (mcpServers section) |
| Cline | VSCode settings → Cline → MCP Servers |
| Zed | `~/.config/zed/settings.json` (context_servers) |

### What changes after install

Before:
> AI: *"This auth flow probably uses JWT because that's common."*

After:
> AI: *(calls `mneme_ask "why this auth flow"`)*
> AI: *"Per commit a3f9b21 from 2024-08, you switched from sessions to JWT after the rate-limit incident referenced in #482. The retry logic in line 47 was added in the hotfix that followed."*

Same model, same prompt — different reasoning, because it now has memory.

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
