<div align="center">

# Mneme roadmap

*Mneme is not a single tool. It is a kit that adapts to whatever repo you point it at.*

```
   The bar is not "does it run?" — it is "does it run on YOUR repo?"
```

</div>

---

## How to read this file

Mneme is built **bottom-up**: every phase is shippable on its own, and every phase plugs into the same SQLite schema. Adding a new feature never breaks an old one.

Items are checked when the code is in `main`, has tests, and was smoke-tested on a real repo. We do not check items because they "feel done."

There are **no time estimates** here on purpose. Engineering is not a Gantt chart — it is the order of trade-offs.

---

## The mutant principle

Real codebases are not uniform. Mneme is honest about that:

- **Brand-new repo** → no value yet. `mneme adapt` will tell you to wait.
- **Repo with `wip` / `fix` / `update` commits** → `mneme heal` synthesizes the WHY from the diff itself.
- **Repo with no PRs** → still works on commit text alone; `GITHUB_TOKEN` upgrades it.
- **Repo with no incident data** → manual JSON adapter gets you started; `mneme correlate --source pager` upgrades it.
- **TS/JS-heavy repo** → Phase 2 entity parsing kicks in.
- **Polyglot repo with COBOL** → still works for Phase 1; Phase 2 degrades gracefully.
- **Tiny repo (< 30 commits)** → results marked preview-quality.
- **Massive repo (> 100 k commits)** → in-memory cosine swaps for `sqlite-vec`.

`mneme adapt` is the command that detects which of these situations you're in and recommends the next 1-3 commands. **The same Mneme acts differently for different repos** — that is the whole point.

---

## Headline status

| Phase | Output | Status |
|---|---|---|
| **1 — Archaeologist core** | `init`, `index`, `ask`, `why`, `status`, MCP server, hybrid retrieval | ✅ shipped |
| **2 — Semantic similarity** | `entities`, `clones`, TS/JS entity parser, cosine clone detector | ✅ shipped |
| **3 — Error correlation** | `correlate`, `blast`, `palimpsest`; pager / Datadog / GitHub-Actions / manual adapters | ✅ shipped |
| **4 — Temporal viz** | `mneme web` — live D3 force layout, timeline scrubber, click-to-inspect, SQLite-backed `/api/graph` | ✅ shipped |
| **WILD ideas** | `heal`, `echo`, `mirror`, `rumor`, `runaway`, `fossil`, `ledger`, `teach`, `conscience` | ✅ 9 of 15 shipped — see [WILD_IDEAS.md](./WILD_IDEAS.md) |
| **Mutant** | `adapt` — repo profile + recommendations | ✅ shipped |

**Beyond v0.7:** team-shared cache, IDE extensions, and a few research-grade ideas — all detailed below.

---

## Phase 1 — Archaeologist core

The foundation. Read git, store it, search it, hand it to AI.

- [x] Monorepo + tsconfig project references
- [x] `git/` parser: log, blame, repo metadata, host detection (GitHub / GitLab / Bitbucket / Gitea)
- [x] SQLite store with FTS5 + BLOB embeddings, WAL, schema-versioned
- [x] Indexer with progress reporting and graceful re-runs
- [x] Hybrid retriever: BM25 + cosine fused via Reciprocal Rank Fusion (k = 60)
- [x] Embedding adapters: Ollama (default), OpenAI, hash fallback
- [x] CLI: `init`, `index`, `ask`, `why`, `status`
- [x] MCP server (stdio) — `mneme_ask`, `mneme_why`, `mneme_search_commits`, `mneme_status`
- [x] PR / issue body fetching — `GitHubAdapter` + `GitLabAdapter`
- [x] Tests — 167+ unit + integration + eval-harness tests; CI on Win/macOS/Linux × Node 20/22
- [x] Eval harness — golden set + recall@k / MRR / nDCG metrics with regression-gate in CI
- [x] Honest fallback: if no embedder is reachable, search degrades to lexical-only instead of crashing
- [ ] Publish to npm (waiting on `NPM_TOKEN` per [docs/PUBLISH.md](./docs/PUBLISH.md))

---

## Phase 2 — Semantic similarity

Symbol-level memory. The "WHAT does this code do" layer that complements Phase 1's "WHY".

**Goal:** detect *"five functions doing the same thing, written by five different people, never refactored."* That kind of duplication is invisible to grep and visible to embeddings.

- [x] `EntityParser` + `CloneDetector` contracts in `@mneme-ai/core/entities`
- [x] `TypeScriptParser` (TS / TSX / JS / JSX) using the TypeScript compiler API — no new runtime deps
- [x] Entity classification by layer (api / service / data / ui / utility / test / config / unknown) via path heuristics
- [x] `CosineCloneDetector` — pre-normalized vectors, union-find connected components, cohesion scoring
- [x] CLI: `mneme entities`, `mneme clones --threshold 0.85`
- [x] MCP tools: `mneme_list_entities`, `mneme_find_similar`
- [x] Smoke-tested on Mneme's own codebase: surfaced `sleep()` duplicated in 3 files + type aliases shared across GitHub/GitLab adapters
- [ ] Python parser (tree-sitter)
- [ ] Go / Rust parsers (tree-sitter)
- [ ] Cross-language clones (semantic similarity ignores language barrier — surface intent, not syntax)

> **Mutant note:** repos that are 100% TS/JS get full Phase-2 quality today. Polyglot repos get partial quality and an honest note about it. We do not pretend to parse what we can't.

---

## Phase 3 — Error correlation 🏆

The moat. Nobody else connects git + code + errors + time. This is the row that sells the team plan.

- [x] Engine contract (`CorrelationEngine`, `IncidentAdapter`)
- [x] `TemporalCorrelationEngine` — temporal proximity + file overlap with convex-combination scoring (the math that the unit tests caught)
- [x] `ManualJsonAdapter` — works without any vendor token; great for bootstrapping or for orgs that don't ship a paid observability stack
- [x] `SentryAdapter` — Sentry REST API client with pagination, retries, level → severity mapping, optional stack-frame hydration
- [x] `DatadogAdapter` — Events API v2 with cursor pagination + 429/5xx retry
- [x] `GitHubActionsAdapter` — failed-workflow runs as incidents (a red CI run IS an incident for many teams)
- [x] CLI: `mneme correlate --source <pager|manual> ...`
- [x] CLI: `mneme blast <commit>` — predict the incidents likely to follow shipping this commit, with a base-rate verdict (LOW / MED / HIGH)
- [x] CLI: `mneme palimpsest <file>:<line>` — walk the full causal chain (commit → incident → suspect commit → …)
- [x] Honest "no-incidents-found" path: every adapter and command degrades to a friendly `--source manual` recommendation when there's nothing to fetch
- [ ] Semantic correlation layer — embed commit messages + stack traces and add a similarity term to the scoring
- [ ] Watch mode — re-run correlate when new commits or new incidents arrive
- [ ] Confidence calibration on a per-repo basis (right now the 0.30 default threshold is universal)

### What this unlocks

Demo-able statements you can run today:

> *"Every time `PaymentService.charge` is touched, an incident on the same files spikes within 48 h."*
>
> *"This PR touches code that has caused 3 of the last 5 production incidents."*
>
> *"INC-1287: 87 % confidence it was introduced by commit `a1b2c3d` — same file, 14 h before the spike."*

### Privacy / security

- All correlation runs locally; only the chosen API tokens leave the machine.
- All adapter tokens stay in `.mneme/secrets` (git-ignored).
- No incident *content* is sent to any embedder by default — only commit text.
- The `synthesized_notes` table is append-only and clearly labeled — original commits are never modified.

---

## Phase 4 — Temporal viz

D3 force layout over the indexed memory, with a timeline scrubber that lets you walk back through git history.

- [x] Zero-dep HTTP server (`packages/web/server.js`)
- [x] `/api/graph` — SQLite-backed nodes (commits + incidents) and links (correlations) with `?at=<iso>` time-travel filter
- [x] `/api/timeline` — ordered timestamps for the scrubber
- [x] `/api/healthz` for monitoring
- [x] D3 force layout with drag, pan/zoom, click-to-inspect detail panel
- [x] Timeline slider that re-renders the graph at any past moment
- [x] Link highlighting on selection (incident → correlated commits)
- [ ] Cluster collapsing — groups of >50 nodes within a date range collapse into a "supercluster"; click to expand
- [ ] Incident-to-commit ancestry walk visualized as a path (highlight the chain that `mneme palimpsest` returns in JSON)
- [ ] Export to PNG / shareable link

> **Mutant note:** the viz works on any size repo, but for repos > 5 k commits the force layout slows. Cluster collapsing is the next milestone here.

---

## Mutant — `mneme adapt`

The command that makes Mneme behave differently for different repos.

- [x] Repo profile detector — counts commits, entities, incidents, correlations, synthesized notes; samples commit hygiene
- [x] Archetype classification — *empty, indexed-not-yet, young, early-stage, active service, mature large, with sparse hygiene / PR-driven / incident-correlated modifiers*
- [x] Recommendation generator — ranked list of next commands tailored to THIS repo
- [x] Honest caveats surfaced when results would be preview-quality
- [x] Deterministic output: same repo state → same recommendations
- [ ] `mneme adapt --watch` — re-runs whenever the working tree or store changes
- [ ] `mneme adapt --for-role <onboarding|reviewer|on-call|maintainer>` — same profile, role-specific tour
- [ ] Per-role MCP tool surfacing (e.g. expose a smaller toolset to AI clients when the repo profile is "early-stage")

---

## WILD ideas — current state

Detailed in [WILD_IDEAS.md](./WILD_IDEAS.md). Status as of v0.7.0:

| # | Command | Status |
|---|---|---|
| 1 | `mneme heal` | ✅ shipped |
| 2 | `mneme echo` | ✅ shipped |
| 3 | `mneme ledger` | ✅ shipped — hash-chained audit log |
| 4 | `mneme oracle` | 🚧 design page |
| 5 | `mneme palimpsest` | ✅ shipped |
| 6 | `mneme conscience` | ✅ shipped |
| 7 | `mneme prophecy` | 🔬 research (needs ML model) |
| 8 | `mneme constellation` | 🔬 research (needs hosted infra) |
| 9 | `mneme genome` | 🚧 design page |
| 10 | `mneme fossil` | ✅ shipped |
| 11 | `mneme dialogue` | 🚧 design page |
| 12 | `mneme rumor` | ✅ shipped |
| 13 | `mneme mirror` | ✅ shipped |
| 14 | `mneme runaway` | ✅ shipped |
| 15 | `mneme tribute` | 🚧 design page |
| ⭐ | `mneme teach` (UA-inspired) | ✅ shipped |
| ⭐ | `mneme adapt` (mutant) | ✅ shipped |

**11 of 17 ideas now shipped as real CLI commands.** The 4 marked 🚧 print thoughtful design pages with implementation plans, not lorem-ipsum stubs. Two are research-grade.

---

## Beyond — collaborator-grade and infrastructure

These ship when the project has paying users or external contributors making them necessary. Listing here so anyone scanning the roadmap can see the direction.

- **Team-shared cache** — turn personal `.mneme/` into a shared service so a team's index is built once and queried by everyone. Implies hosted infrastructure, auth, and a privacy story.
- **IDE extensions** — VS Code and JetBrains plugins that surface `mneme why` / `mneme palimpsest` on hover. Probably their own repos.
- **`mneme review <pr-url>`** — read a PR diff, run conscience + blast + clones, post a single comment summarizing risk.
- **`mneme onboard --for <person|role>`** — extension of `mneme mirror`, role-specific.
- **LSP-style integration** — the same memory accessible via Language Server Protocol so any editor that speaks LSP gets it for free.
- **Cross-repo memory** — federate the store across multiple repos in a workspace so questions can span service boundaries.
- **Diff-level embeddings** — embed the *actual code diff*, not just the message. Biggest accuracy gain still on the table.
- **Compaction layer** — at >1 M chunks, in-memory cosine slows. Migrate to `sqlite-vec` or `lancedb` with the same surface contract.
- **Redaction layer** — repos with secrets in old commits need an opt-in scrubber before any text leaves the machine.

PRs and proposals welcome. Open an issue or a Discussion thread before writing a large patch — for big-design changes, the conversation is the deliverable.

---

## How to interpret this roadmap if you are a user

Run **`mneme adapt`** in your repo. It will tell you which row of this document is most relevant to *you*, today. The roadmap is the menu — `adapt` is the waiter.
