# Mneme roadmap

Built bottom-up: every phase is shippable on its own, every phase plugs into the same store schema.

| Phase | Weeks | Status | Output |
|---|---|---|---|
| 1 — Archaeologist core | 4 | ✅ scaffolded | `mneme ask`, `mneme why`, MCP server |
| 2 — Semantic similarity | 2 | ✅ shipped (v0.3.0) | `mneme entities`, `mneme clones`, TS/JS parser, cosine clones |
| 3 — Error correlation 🏆 | 4 | ✅ wired (v0.4.0) | `mneme correlate --source sentry --org X --project Y` |
| 4 — Temporal viz | 6 | ✅ shipped (v0.4.0) | `mneme web` — live D3 graph + timeline scrubber |
| WILD #1 — `mneme heal` | 1 | ✅ shipped (v0.4.0) | LLM synthesizes WHY for poor commit messages |
| WILD #2-15 — see [WILD_IDEAS.md](./WILD_IDEAS.md) | varies | sketches | `echo`, `ledger`, `oracle`, `palimpsest`, `conscience`, `prophecy`, … |

---

## Phase 1 — Archaeologist core (✅ scaffolded)

**Done in this scaffold:**

- [x] Monorepo + tsconfig project references
- [x] `git/` parser: log, blame, repo metadata, host detection (GitHub/GitLab/Bitbucket)
- [x] SQLite store with FTS5 + BLOB embeddings + WAL
- [x] Indexer with progress reporting
- [x] Hybrid retriever: BM25 + cosine fused via RRF
- [x] Embedding adapters: Ollama (default), OpenAI, hash fallback
- [x] CLI: `init`, `index`, `ask`, `why`, `status`, `correlate`, `mcp`
- [x] MCP server (stdio) with 4 tools

**Remaining for v0.1 release:**

- [ ] PR/issue body fetching (`gh api` or REST adapter)
- [ ] Tests (parser, RRF math, store round-trip)
- [ ] `npx -y mneme init` works end-to-end on a public repo demo
- [ ] Publish `mneme` to npm

---

## Phase 2 — Semantic similarity (2 weeks)

**Goal:** detect "5 functions doing the same thing, written by 5 different people, never refactored."

- [ ] Parse entities with tree-sitter (start with TS/JS/Python/Go)
- [ ] Embed each entity (signature + body summary)
- [ ] HDBSCAN-style clustering on embedding cosine
- [ ] CLI: `mneme entities`, `mneme clones`
- [ ] MCP tools: `mneme_find_similar`, `mneme_list_entities`

This is where "neural" earns its keep — semantic clones are invisible to AST tools.

---

## Phase 3 — Error correlation graph (4 weeks) 🏆

**The moat.** The differentiator. Nobody connects git+code+errors+time today.

- [x] Engine contract (`CorrelationEngine`, `IncidentAdapter`)
- [x] `TemporalCorrelationEngine` (temporal proximity + file overlap)
- [x] `ManualJsonAdapter` (works today)
- [x] First incident adapter (REST API; org/project/issues + events for stack frames) — pluggable, vendor-agnostic contract
- [ ] `DatadogAdapter` (Events API)
- [ ] `GitHubLogAdapter` (workflow run failures from `gh api`)
- [ ] Semantic correlation layer (commit msg ↔ stack trace embeddings)
- [ ] CLI: `mneme correlate sentry --org X --project Y`
- [ ] CLI: `mneme blast <commit>` — show predicted incidents
- [ ] CLI: `mneme blame-incident <id>` — walk back to suspected commits

### What this unlocks

Demo-able statements:

> *"Every time `PaymentService.charge` is touched, we get a Stripe webhook 500 within 48h."*
>
> *"This PR touches code that has caused 3 of the last 5 prod incidents in `OrderQueue`."*
>
> *"Incident `INC-1287`: 87% confidence it was introduced by commit `a1b2c3d` — same file, 14h before the spike."*

### Privacy / security

- All correlation runs locally; only the chosen API tokens leave the machine.
- All adapter tokens stay in `.mneme/secrets` (git-ignored).
- No incident *content* is sent to any embedder by default — only commit text.

---

## Phase 4 — Temporal viz (6 weeks)

- [x] Static HTML placeholder + zero-dep server
- [ ] `/api/graph?at=<iso>` returns the graph at a point in time
- [ ] D3 force layout with commit/incident/entity nodes
- [ ] Timeline scrubber → animate graph evolution through git history
- [ ] Incident → ancestry walk (highlight commits in the suspect window)
- [ ] Cluster collapsing for big repos (>10k nodes)
- [ ] Export to PNG / shareable link

---

## Beyond phase 4

- Team-shared cache (turn personal Mneme into team Mneme)
- IDE extensions (VS Code, JetBrains) that show "WHY" on hover
- `mneme review <pr>` — review a PR using the historical/incident graph
- `mneme onboard` — generate "5 people to talk to + 8 PRs to read" for new joiners
- LSP-style integration: hover any symbol → originating commits + linked incidents

---

## Open design questions

1. **Cross-repo memory** — should the store optionally federate across multiple repos in a workspace?
2. **Diff embeddings** — embed actual code diffs (not just messages) for far better recall on un-described commits?
3. **Compaction** — at >1M commits, in-memory cosine slows. Migrate to `sqlite-vec` or `lancedb`?
4. **Privacy model** — do we want a "redaction" layer for repos containing secrets in old commits?

PRs and proposals welcome.
