<div align="center">

# μνήμη · **Mneme**

### *The memory layer of your codebase.*

*Pronounced **`NEE-meh`** · μνήμη · Greek for "memory" — sister of Lethe (forgetting), mother of the muses.*

**Code knows _what_. Git knows _why_. The pager knows _what broke_.**
**Until Mneme, nothing connected them.**

[![npm](https://img.shields.io/npm/v/mneme-ai?color=8b5cf6&label=mneme-ai)](https://www.npmjs.com/package/mneme-ai)
[![license](https://img.shields.io/badge/license-MIT-22d3ee)](./LICENSE)
[![node](https://img.shields.io/badge/node-%E2%89%A520-22c55e)](https://nodejs.org)
[![mcp](https://img.shields.io/badge/MCP-server-c084fc)](https://modelcontextprotocol.io)
[![tests](https://img.shields.io/badge/tests-passing-22c55e)](./STATUS.md)
[![recall@3](https://img.shields.io/badge/recall%403-86.7%25-22c55e)](./STATUS.md)
[![MRR](https://img.shields.io/badge/MRR-90.0%25-22c55e)](./STATUS.md)
[![local-first](https://img.shields.io/badge/local--first-yes-f59e0b)]()
[![GitHub stars](https://img.shields.io/github/stars/patsa2561-art/mneme-ai?style=social)](https://github.com/patsa2561-art/mneme-ai)

```
   ╭──────────────────────────────────╮
   │  μνήμη  ·  Mneme                 │
   │  the memory layer of your code   │
   ╰──────────────────────────────────╯
```

</div>

---

<p align="center"><img src="./assets/demo.gif" alt="Mneme — doctor, ask, story, dream, calibrate" width="900"></p>

## What it does, in 12 seconds

```bash
$ mneme ask "why does parseAmount() use try/catch around toString()?"

Q  why does parseAmount() use try/catch around toString()?

Summary
  Found 3 relevant commits.
  Top match: PR #482 (2024-08-12, alice@): Fix Stripe webhook crash on
  amount=BigInt — Number(BigInt) overflows past 2^53 and toString() throws.

Evidence
  ●  PR #482   [2024-08-12 · alice · 0.812]
     Fix Stripe webhook crash on amount=BigInt
     Stripe occasionally sends amounts as bigint strings. JSON.parse returns
     a Number that overflows. Falls back to String() coercion when toString
     throws RangeError.
     files: src/payment.ts, src/webhook.ts

  ●  a1b2c3d   [2024-08-15 · bob · 0.701]
     Add observability breadcrumb for parseAmount errors
     Refs INC-1287.
```

Now imagine **that available to your AI assistant**. That's Mneme.

---

## Why this exists

You ask Claude / Cursor / Copilot:

> *"Why does this code use a retry?"*

It looks at the **current code** and guesses. It does **not** read the PR description from 8 months ago that explains the Stripe bug. It does **not** see the incident report that triggered the fix. It hallucinates a plausible-sounding reason — and you ship it.

Mneme builds a permanent, local, queryable memory of your repo:

```
┌─────────────────┐    ┌──────────────────┐    ┌────────────────┐
│  Code knows     │    │  Git knows       │    │ The pager      │
│  WHAT it does   │    │  WHY it exists   │    │ knows WHAT     │
│                 │    │                  │    │ BROKE          │
└────────┬────────┘    └────────┬─────────┘    └───────┬────────┘
         └──────────────────────┼───────────────────────┘
                                ▼
                       ╭─────────────────╮
                       │      Mneme      │
                       │      μνήμη      │
                       │  ┌───────────┐  │
                       │  │ commits   │  │
                       │  │ PRs       │  │
                       │  │ issues    │  │
                       │  │ blame     │  │
                       │  │ incidents │  │
                       │  └───────────┘  │
                       ╰────────┬────────╯
                                │
              ┌─────────────────┼─────────────────┐
              ▼                 ▼                 ▼
         CLI for humans    MCP for AI       JSON / API
        mneme ask "..."   Claude · Cursor   for your tools
                          Copilot · Continue
```

---

## The three things you can do

### 1. **Ask** — natural language Q&A over your repo's history

```bash
mneme ask "why is there a retry around stripe.charges.create?"
mneme ask "when did we change the auth middleware and why?"
mneme ask "what does the OrderQueue worker do and who wrote it?"
```

**Input:** any English question.
**Output:** ranked commits + PRs with **clickable citations** to GitHub/GitLab.

### 2. **Why** — blame + RAG for any file or line

```bash
mneme why src/payment.ts:42-58
```

**Input:** `<file>` or `<file>:<line>` or `<file>:<start>-<end>`
**Output:**

```
Why src/payment.ts:42-58

Originating commits
  ● a1b2c3d  [2024-08-12 · alice · 14 lines]
    Fix Stripe webhook crash on amount=BigInt
  ● f8e7d6c  [2024-03-04 · bob · 8 lines]
    Initial Stripe integration

Semantically related
  ◆ 9c2b1a0  [2024-09-01]  Add idempotency keys for Stripe retries
  ◆ 4d5e6f7  [2024-10-15]  Bump @stripe/stripe-node, see CHANGELOG
```

### 3. **Connect** — let your AI assistant query the memory directly (MCP)

Mneme speaks **MCP**, the Model Context Protocol that Claude Code, Cursor, Continue, and others support natively.

```json
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

The AI now has tools:

| Tool | Purpose |
|---|---|
| `mneme_ask` | natural-language search over git history |
| `mneme_why` | blame + RAG explanation for any file/line range |
| `mneme_search_commits` | hybrid (BM25 + vector) commit search |
| `mneme_status` | what's indexed, embedder used, DB stats |

**Result:** the AI stops guessing about history. It reads it.

---

## More you can do — what each command actually outputs

The 12-second teaser at the top showed `mneme ask`. Here's what the other six killer commands do, with real output recorded against this very repo.

### `mneme doctor` — smart environment probe

Answers *"Do I need to install Ollama on this laptop?"* in 2 seconds. Detects what's there, recommends the best embedder for your hardware.

```
  Environment probe
    hardware   95GB RAM · 24 cpus · win32/x64 (strong)
    ollama     reachable · embed model NOT pulled
    openai     no key

  Recommendation ollama ★★★★☆
    Ollama is running but the embedding model is not pulled.
    → ollama pull nomic-embed-text
```

### `mneme who-knows <topic>` — find the human expert

Surfaces the people most likely to know about a topic, ranked by `log(commits) × recency`. Onboarding gold.

```
  👤  Top experts on  "stripe"

  ⭐ definitive   alice@example.com
      23 commits · 47 files · last touch 8d ago · score 4.21
  ●  active      bob@example.com
      8 commits · 12 files · last touch 3w ago · score 2.10
  ◐  stale       charlie@example.com
      14 commits · 22 files · last touch 7mo ago · score 1.04
```

### `mneme decisions` — auto-extract architectural decisions (ADRs)

Regex-extracts decisions from commit messages — *"decided to X because Y"*, *"switched from A to B"*, *"replaced X with Y"*, and 6 more patterns. Captures the *rationale* clause too. Drop straight into `docs/ADR.md`.

```
  📜  Architecture Decisions  (extracted from 12 commits)

  ● 2024-09-12  alice         switched from passport to custom JWT middleware
      → compliance flagged session token storage
      [switched, conf=0.90, a1b2c3d]

  ● 2024-08-12  bob           decided to handle BigInt amounts as strings
      → Stripe occasionally sends bigint, Number() overflows past 2^53
      [decided-to, conf=0.95, e4f5g6h]
```

Export as Markdown for any docs site:

```bash
mneme decisions --format markdown --out docs/ADR.md
```

…or as a wiki-linked **Obsidian vault** (frontmatter + tags + author hubs):

```bash
mneme decisions --format obsidian --out my-vault/
```

### `mneme story <topic>` — narrate the evolution across acts

Groups every commit on a topic into acts (initial · refactor · incident · evolution · stable) with date ranges. Optional Ollama narration adds a 1-2 sentence prose summary per act.

```
  📖  The auth Story  (4 acts, 14 commits, 387 days)

  Act I — The Beginning  (2024-03-04 → 2024-03-04)
    ● a1b2c3d 2024-03-04  feat(auth): scaffold passport.js OAuth flow

  Act II — The Refactor  (2024-09-12 → 2024-11-08)
    ● f4e5d6c 2024-09-12  refactor: switch from passport to custom middleware
    ● 9b8a7c6 2024-10-15  refactor: short-lived JWT + refresh rotation
    ● ...

  Act III — Incidents Strike  (2024-11-15 → 2024-11-22)
    ● 2d3e4f5 2024-11-15  hotfix: missing CSRF in new auth flow (INC-1287)

  Act IV — Steady Evolution  (2024-12-01 → 2025-04-15)
    ● 1a2b3c4 2024-12-01  feat: audit log on every login
    ● ...
```

### `mneme dream` — speculative ideas grounded in your codebase patterns

Reads your repo's signals (entity count, pattern suffixes like *Service / Adapter*, top modules) and proposes features that would fit your style. Each idea cites the existing pattern it would mirror.

```
  🔮  Speculative ideas based on your codebase patterns  (source: heuristic)

  Signals: 18 commits · 409 entities · 2 languages

  1. OptionsRegistry  [effort: small · risk: low]
    You have 47 entities ending in "Options". A central registry would
    make discovery and DI cleaner; the pattern is already pervasive.
    Precedents: Options entities (47×)

  2. PackagesCliHealthCheck  [effort: small · risk: low]
    Your largest module (packages/cli, 166 entities) has no central
    health check. A small module-level diagnostic would catch silent
    regressions early.
    Precedents: packages/cli
```

### `mneme stack-trace` — paste an error, get historical context

Pipe a stack trace in. Mneme parses each frame (JS/TS/Python/Go/Java) and reports the recent commits + past incidents at each location.

```bash
echo "TypeError: Cannot read property 'amount' of undefined
    at parseAmount (src/payment.ts:42:15)
    at processCharge (src/payment.ts:78:9)" | mneme stack-trace
```

```
  🎯  Stack analysis  (js, 2 frames)

  Frame 1: src/payment.ts:42 (parseAmount)
    Last commits:
      ● a1b2c3d [2024-08-12 · alice]  Fix Stripe webhook crash on amount=BigInt
      ● f8e7d6c [2024-03-04 · bob]    Initial Stripe integration
    ⚠  2 past incident(s) affected this file.

  Likely root cause: check the most recent commit at the top frame.
  For a deeper walk: mneme palimpsest src/payment.ts:42
```

### `mneme chat` — multi-turn REPL over your repo

Conversational mode. Each turn carries the previous question's context, so follow-ups work naturally. `/save <file>` saves the transcript as Markdown.

```
  💬  Mneme chat  (multi-turn over your repo's history)
  type your question · /exit to quit · /clear to wipe history · /save <file>

  › why does the webhook handler retry?
  [renders full ask answer with evidence]

  › who wrote that retry logic?
  [augmented query — uses prior turn for context]

  › /save chat.md
    ✓ saved transcript to chat.md
```

---

## Install

Three ways to get Mneme on your machine. Pick the one that matches what you want to do.

### Option 1 — `npx` (zero install, run anything once)

Best for: trying Mneme on a repo, one-off questions, demos.

```bash
npx -y mneme-ai init
npx -y mneme-ai index
npx -y mneme-ai ask "why does the webhook retry?"
```

`npx -y` downloads `mneme-ai` to a temp cache, runs once, then evicts. Nothing global, nothing persistent.

### Option 2 — Global install (recommended for daily use)

Best for: anyone who runs `mneme` more than once a week.

```bash
npm install -g mneme-ai
```

Then from **any git repo**:

```bash
cd /path/to/your/repo
mneme init
mneme index
mneme ask "..."
mneme --help        # 8 essentials. `mneme advanced` for the rest.
mneme --version     # confirm what version you have
```

(See the **Upgrade** section below for keeping up with new releases.)

### Option 3 — Clone the repo (for contributors / customizers)

Best for: reading the source, modifying behavior, contributing back, or running cutting-edge code that isn't published yet.

```bash
# 1. clone
git clone https://github.com/patsa2561-art/mneme-ai.git
cd mneme-ai

# 2. install dependencies (uses npm workspaces — installs all 6 packages at once)
npm install

# 3. compile TypeScript → JavaScript
npm run build

# 4. run the CLI from source
node packages/cli/bin/mneme.js --help

# (optional) make `mneme` available globally from this checkout
cd packages/cli
npm link
mneme --help                    # now works from any folder
```

To pull future updates:

```bash
git pull
npm install
npm run build
```

To run the test suite:

```bash
npm test           # 379 tests
npm run eval       # retrieval quality benchmark
npm run bench      # performance benchmark
```

---

## 🔄 Upgrade

Already running an older Mneme? Upgrade in 30 seconds.

```bash
# 1. See what version you have right now
mneme --version

# 2. Pull the latest from npm
npm install -g mneme-ai@latest

# 3. Verify the upgrade landed
mneme --version
```

**Latest stable:** `v0.9.0` — *Wisdom Mutant Engine + 7 killer commands + Obsidian export*. See [CHANGELOG.md](./CHANGELOG.md) for what's new.

> **Heads-up.** If `mneme --version` doesn't change after step 2, open a fresh terminal — your shell is caching the old binary path. On Windows, `npm install -g` writes to `%APPDATA%\npm\` which the parent shell only re-reads on launch.

**Pin a specific version** (for reproducible setups):

```bash
npm install -g mneme-ai@0.9.0
```

**Uninstall:**

```bash
npm uninstall -g mneme-ai
```

**npx users** (Option 1 above): nothing to upgrade — `npx -y mneme-ai@latest <cmd>` always pulls the freshest.

---

## After install, the same 60-second flow

Whichever option you picked above, the daily usage is identical:

```bash
cd /path/to/any/git/repo
mneme init                       # creates .mneme/ inside the repo
mneme index                      # ~90 seconds for 5,000 commits with Ollama
mneme ask "why does X exist?"    # query the memory
```

---

## Compatibility

> **Mneme works on _every git repository on Earth_.** It's language-agnostic — it reads git, not AST.

| Compatibility | Status |
|---|---|
| Any language (TS, Go, Rust, Python, Java, COBOL, …) | ✅ |
| Public, private, self-hosted | ✅ |
| Local-only (no remote) | ✅ |
| GitHub | ✅ host detection + PR/issue body hydration |
| GitLab (gitlab.com + self-hosted) | ✅ host detection + MR hydration via REST v4 |
| Bitbucket / Gitea | ✅ host detection (PR hydration coming) |
| Squash-merge workflows | ✅ (per-PR context preserved) |
| Monorepos & forks | ✅ |
| Air-gapped / offline | ✅ (Ollama default — no internet) |
| Mercurial / SVN / Perforce | ❌ git only — PRs welcome |

### Where it shines vs. where it struggles

| Repo profile | Quality | Mitigation |
|---|---|---|
| Long history, real PR descriptions, descriptive commits | ⭐⭐⭐⭐⭐ killer | — |
| Decent commits, no PRs | ⭐⭐⭐⭐ | enable GitHub PR fetcher (env: `GITHUB_TOKEN`) |
| Mostly squash-merges with rich PR bodies | ⭐⭐⭐⭐ | — |
| Mostly `fix` / `wip` / `update` messages | ⭐⭐ honest "no context found" instead of hallucination | **`mneme heal`** synthesizes a WHY note from the diff itself |
| < 50 commits | ⭐ not enough signal yet | wait for more history, or run `mneme heal` once you have one |

**`mneme heal` turns a stated weakness into a feature.** If your repo has anaemic commit messages, point an LLM (Ollama by default — local, free) at the commits that lack signal. The diff is the truth; the synthesized note is its plain-language summary, stored alongside the original (never replacing it) and searched as `kind='synthesized'` so you can always tell synthesized from authored.

```bash
mneme heal --dry-run         # show which commits would be synthesized
mneme heal                   # actually synthesize (uses Ollama by default)
mneme ask "why does X exist?"  # the synthesized notes show up in answers
```

If your history is poor and you don't run `mneme heal`, Mneme tells you so. **It does not invent reasons.**

---

## Cost

> Mneme is **MIT-licensed and zero-dollar**. The "AI" part runs on your own machine by default.

| | $ | Quality | Setup |
|---|---|---|---|
| **Ollama** (default) | **$0 forever** | ★★★★ | `ollama pull nomic-embed-text` |
| **Hash fallback** (built-in) | **$0 forever** | ★★ | nothing |
| **OpenAI** (optional upgrade) | **~$0.05** to index 5k commits, then ~$0/day | ★★★★★ | `OPENAI_API_KEY=…` |

**Privacy:**

- Ollama path → nothing leaves your machine.
- OpenAI path → only commit messages + PR text are sent; **never source code**.
- No telemetry. No accounts. No "free tier" trap. Mneme does not phone home.

---

## How it works (one paragraph)

Mneme runs `git log --pretty=… --name-only` against your repo, fans out PR/issue lookups against the host (GitHub/GitLab/Bitbucket), and stores the result in `.mneme/mneme.db` (SQLite, WAL). Each commit message + PR body is chunked and embedded with Ollama (or OpenAI, if you prefer). At query time, Mneme runs a **hybrid retrieval** — BM25 lexical search via SQLite FTS5 *and* cosine over the embedding blobs — and fuses the two ranked lists with **Reciprocal Rank Fusion** (k=60). Results are grouped by commit and returned with deterministic citations: commit hashes, PR numbers, file paths, and host-specific URLs.

For the deep dive, see [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## What Mneme does

A single tool, three layers of memory:

1. **The WHY** — indexes commit messages, PR descriptions, issue bodies, blame.
   Ask: *"why does this code use a retry?"* → real PR #482 from 8 months ago, with a clickable citation.

2. **The WHAT** — parses every TypeScript / JavaScript symbol (function, class, type) and embeds them.
   Ask: *"which functions in this repo do roughly the same thing?"* → semantic clone clusters with cohesion scores.

3. **The WHERE-IT-BREAKS** *(Phase 3)* — joins commits with incidents from your observability stack or a manual JSON file.
   Ask: *"which commit likely caused INC-1287?"* → ranked candidates by file overlap + temporal proximity.

All three are reachable from a single CLI and from any AI assistant that speaks **MCP** (Model Context Protocol) — Claude Code, Cursor, Continue, Copilot, etc.

Everything runs locally by default. No API key required. No code leaves your machine. MIT-licensed.

---

## Quality bar — measured, not claimed

We treat retrieval quality as a regression metric, not a marketing claim. Every change runs against a golden eval set in CI and is rejected if it makes any core number worse.

| Dimension | Status | Numbers |
|---|---|---|
| Skeleton / Architecture | ✅ | 6 packages, schema-versioned store |
| Working MVP | ✅ | `init / index / ask / why / status / mcp` |
| Unit tests | ✅ | **379/379 passing**, 33 test files |
| Eval golden set | ✅ | 50 questions across 7 categories (was 15) |
| Intent classifier | ✅ | vague queries get redirected, not low-confidence guesses |
| Confidence floor | ✅ | adaptive (gap-based) — honest 🟢🟡🔴 / "no context found" |
| LLM synthesis | ✅ | `mneme ask` answers in 2-4 sentences with citations (Ollama) |
| Smart suggestions | ✅ | every answer includes 3 follow-up commands to copy-paste |
| Redaction layer | ✅ | strips AWS/GH/Stripe/JWT/PEM secrets before any embedding |
| Deterministic mode | ✅ | `--no-llm` / MNEME_NO_LLM — for air-gapped + regulated industries |
| Wisdom Mutant Engine | ✅ | feedback collector + auto-calibrator + 24/7 watch daemon |
| Multi-language | ✅ | TS/JS · Python (AST) · Go (regex v1) |
| Killer commands | ✅ | `who-knows`, `decisions`, `stack-trace`, `story`, `dream`, `chat` |
| Eval harness (A/B) | ✅ | 5 variants compared, 15-question golden set |
| Benchmarks | ✅ | index 50 c/s, query p50 = 1.2 ms |
| CI/CD | ✅ | GitHub Actions on Ubuntu/macOS/Windows × Node 20/22 |
| Production-ready | ⚠️ | passes own bar; needs larger golden set + production embedder before v1.0 |
| 100 % accuracy | ❌ | **physically impossible** — every retrieval system has a ceiling |

```
Retrieval quality (baseline · hash embedder · 12 commits)
  recall@1  86.7 %    recall@3   80.0 %    recall@10  93.3 %
  MRR       88.3 %    nDCG@10    87.4 %    hit rate   93.3 %

With QueryDensityReranker:
  recall@3  86.7 %    MRR       90.0 %    nDCG@10   88.7 %
  precision@3  +2.2 pp vs baseline
```

> Run it yourself: `npm run status` → regenerates [STATUS.md](./STATUS.md) with real numbers.
>
> Reproducible: `npm test`, `npm run eval`, `npm run bench`.

---

## Roadmap

| Phase | What it adds | Status |
|---|---|---|
| **1 — Archaeologist core** | Index commits + PRs, hybrid retrieval, `ask`/`why`/`status`, MCP server | ✅ shipped |
| **2 — Semantic similarity** | Tree-sitter entity parsing, embedding-clustered clone detection | 🚧 planned |
| **3 — Error correlation 🏆** | Pluggable incident adapters (observability, CI failures, manual JSON), temporal+structural+semantic correlation engine | 🚧 engine ready, adapters in progress |
| **4 — Temporal viz** | D3 graph animated through git timeline, "blast radius" mode | 🚧 placeholder UI |

Phase 3 is **the killer feature**. It answers questions nobody else can:

> *"Every time `PaymentService.charge` is touched, a Stripe webhook 500 spikes within 48 h."*
>
> *"This PR touches code that has caused 3 of the last 5 production incidents in OrderQueue."*
>
> *"Incident INC-1287: 87 % confidence it was introduced by commit a1b2c3d — same file, 14 h before the spike."*

Full plan: [ROADMAP.md](./ROADMAP.md).

---

## Wisdom

The full canon — thirteen meditations on memory, code, and the absence of both — lives in [MEDITATIONS.md](./MEDITATIONS.md). The CLI ships them too:

```bash
mneme wisdom            # today's meditation (rotates daily)
mneme wisdom --n 7      # a specific one (1..13)
mneme manifesto         # the entire canon, in order
```

A few:

> **Code answers _what_. Git answers _why_.**
> They were never one — until Mneme.

> **AI assistants don't get smarter. They get better context.**
> A 1 M-token window is wasted on noise. Mneme is the filter.

> **Every codebase is a palimpsest** — a new decision written over an older one, written over an older one.
> Mneme reads every layer.

> **Memory is older than knowledge.**
> The Greeks called her μνήμη — sister of Lethe (forgetting), mother of the muses.
> An intelligence without memory is just guessing in a loop.

> **Tests verify what code does. History reveals why.**
> A passing test never told anyone why it had to exist.

> **The bus factor isn't about people leaving.**
> It's about knowledge that never made it into the repo.
> Mneme can't save what was never written. But it makes the rest legible.

> **Speed isn't a smarter model. It's less noise.**
> Sub-second answers don't come from a bigger LLM — they come from feeding it eight right commits instead of two thousand random files.

> **The most expensive bug is the one you fix without remembering why it existed.**

---

## FAQ

**Does it send my code anywhere?**
No. With Ollama (default), nothing leaves your machine. With OpenAI, only commit messages + PR text are sent — never source code.

**How big a repo can it handle?**
Tested on 100 k commits / 8 GB DB. Beyond that, swap the in-memory cosine for `sqlite-vec` (one config line; see [ARCHITECTURE.md](./ARCHITECTURE.md)).

**Will it work on a private monorepo?**
Yes. Mneme is local-first.

**My commit messages are bad. Will it still work?**
Mneme uses whatever signal exists. Garbage commits + rich PRs = decent answers. Empty both = honest *"no context found"*. It will not fabricate.

**Why is it called Mneme?**
Μνήμη is the Greek personification of memory. Sometimes counted among the Muses. The right ancestor for a tool whose job is to remember.

**Can I run it offline?**
Yes — install Ollama once, then everything works air-gapped.

**Does it integrate with [my tool]?**
- Already: Claude Code, Cursor, Continue, Copilot (via MCP), GitHub, GitLab, Bitbucket, Ollama, OpenAI.
- Phase 3: pluggable incident adapters — observability stacks, CI-pipeline failures, manual JSON. Adapters live in `@mneme-ai/correlator/adapters`.
- Want another? File an issue.

---

## Architecture

```
   user ──┐                                          ┌── Ollama  (local, default)
          │                                          ├── OpenAI  (optional)
   ┌──────┴──────┐    ┌────────────────┐    ┌────────┴────────┐
   │  CLI / MCP  │ ─► │  @mneme-ai/core   │ ─► │ @mneme-ai/embeddings │
   │  mneme ...  │    │  hybrid search │    └────────┬──────────┘
   └──────┬──────┘    │  RRF fusion    │             │
          │           └─────┬──────────┘             ▼
          │                 │                  ┌─────────────┐
          ▼                 ▼                  │ SQLite      │
   Claude / Cursor    @mneme-ai/correlator        │  · commits  │
   Continue / Copilot  (incident adapters,     │  · chunks   │
                        manual + pluggable)    │  · FTS5     │
                                               │  · vectors  │
                                               │  · incidents│
                                               └─────────────┘
```

Full diagram, schema, and extensibility contracts: [ARCHITECTURE.md](./ARCHITECTURE.md).

---

## Project layout

```
mneme/
├── packages/
│   ├── core/            @mneme-ai/core         git parser · store · indexer · retrieve
│   ├── embeddings/      @mneme-ai/embeddings   ollama · openai · hash fallback
│   ├── cli/             mneme-ai            the binary
│   ├── mcp/             @mneme-ai/mcp          MCP server (stdio)
│   ├── correlator/      @mneme-ai/correlator   phase 3 — incident correlation
│   └── web/             @mneme-ai/web          phase 4 — D3 temporal viz
├── ARCHITECTURE.md
├── ROADMAP.md
└── README.md
```

---

## Contributing

Contributions welcome — especially for **phase 3 incident adapters** (pluggable: observability platforms, CI failures, custom log formats).

```bash
git clone <this-repo>
cd mneme
npm install
npm run build
npm test               # 379/379 should pass
npm run eval           # see retrieval quality numbers
npm run bench -- --only small
node packages/cli/bin/mneme.js --help
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full guide and [STATUS.md](./STATUS.md) for live quality metrics.

---

## Show your support

If Mneme saved you a 30-minute git archaeology session today:

```bash
mneme wisdom    # accept a meditation as payment
```

Or — give the project a ⭐ on [GitHub](https://github.com/patsa2561-art/mneme-ai). Stars are how solo maintainers know what to keep building.

## License

[MIT](./LICENSE) — use it, fork it, ship it.

`Copyright (c) 2026 Mneme AI contributors`

---

<div align="center">

**μνήμη**
*remembering what was, so we know why it is.*

</div>
