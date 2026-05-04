# Mneme architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│                            User-facing surface                         │
│  CLI  ──  MCP server (stdio)  ──  Web UI (D3, phase 4)                 │
└──────────────────────────────────┬─────────────────────────────────────┘
                                   │
┌──────────────────────────────────▼─────────────────────────────────────┐
│                              @mneme-ai/core                                │
│                                                                         │
│   git/         store/          indexer/        retrieve/    correlate/  │
│   ───          ─────           ───────         ────────     ──────────  │
│   exec.ts      sqlite.ts       indexer.ts      search.ts    types       │
│   repo.ts      schema.ts       (chunker)       (hybrid:     (engine     │
│   log.ts       (commits,                       BM25+vec     contracts   │
│   blame.ts     chunks,                         RRF fused)   for phase 3)│
│                incidents,                                                │
│                correlations,                                             │
│                graph_snapshots)                                          │
└──┬─────────┬───────────────────────────────────────────────┬───────────┘
   │         │                                               │
   │         │                                               │
┌──▼──────┐ ┌▼─────────────────────┐                ┌────────▼───────────┐
│ git CLI │ │ better-sqlite3 +     │                │ @mneme-ai/embeddings  │
│ (spawn) │ │ FTS5 + BLOB vectors  │                │  ollama / openai / │
└─────────┘ └──────────────────────┘                │  hash fallback     │
                                                    └────────────────────┘

                    Phase 3 layer (the moat)
┌──────────────────────────────────────────────────────────────────────┐
│   @mneme-ai/correlator                                                    │
│   ──────────────────                                                   │
│   TemporalCorrelationEngine — joins commits × incidents × time        │
│   adapters/sentry.ts        ── pull issues, map to Incident schema    │
│   adapters/datadog.ts       ── pull events, map to Incident schema    │
│   adapters/manual.ts        ── JSON file input (works today)          │
└──────────────────────────────────────────────────────────────────────┘
```

## Data flow

### Indexing (`mneme index`)

```
git log --pretty=… --name-only        →   Commit[]            ┐
git show --numstat <sha>              →   FileChange[]        │   upsert into
chunk(commit.subject + body + PR)     →   CommitChunk[]       │   SQLite store
embedder.embed(chunks)                →   Float32Array[]      ┘
```

Chunks are stored as raw `BLOB` next to FTS5 rows, so search is hybrid:
- **lexical** — `bm25(chunks_fts) MATCH ?`
- **semantic** — cosine over embedding blobs (in-memory; small enough for ≤1M chunks)
- **fused** — Reciprocal Rank Fusion with configurable lex/sem weight

### Question answering (`mneme ask`)

```
question  →  embed  →  vector top-K
              │
              ├──→  FTS top-K
              │
              ▼
        RRF fusion (k=60)  →  group by commit  →  citations
```

### Correlation (`mneme correlate`, phase 3)

For each `(commit, incident)` pair where the incident occurred within `windowMs`
after the commit, score by:

1. **Temporal proximity**: `1 - Δt / windowMs`
2. **File overlap**: `|commit.files ∩ incident.files| / min(|c.f|, |i.f|)`
3. **Semantic** (future): cosine of commit message vs stack trace embedding

Persisted as `correlations(from_kind, from_id, to_kind, to_id, weight, reason, evidence)`.

## Storage layout

`.mneme/mneme.db` (SQLite, WAL mode):

| Table | Phase | Notes |
|---|---|---|
| `commits` | 1 | hash, subject, body, parents, PR fields, issue refs |
| `file_changes` | 1 | per-commit per-file numstat |
| `chunks` | 1 | text + embedding BLOB + model name |
| `chunks_fts` | 1 | FTS5 virtual table over chunks.text |
| `entities` | 2 | functions, classes, modules — with embeddings |
| `incidents` | 3 | imported from Sentry/Datadog/manual |
| `correlations` | 3 | the (commit ↔ incident) edges |
| `graph_snapshots` | 4 | serialized graph at points in time |

Schema lives in [`packages/core/src/store/schema.ts`](packages/core/src/store/schema.ts) — every phase adds tables only, never breaks existing ones.

## Why TypeScript + better-sqlite3

| Decision | Reason |
|---|---|
| TypeScript monorepo | `npx -y mneme` distribution, MCP SDK is TS-native, web UI shares types |
| `better-sqlite3` | synchronous = simple; works on Win/Mac/Linux without daemon |
| FTS5 + BLOB vectors | one file, no Qdrant/Pinecone deps; can swap to `sqlite-vec` later |
| Spawn `git` directly | no `libgit2` native binding; matches user's installed git |
| Ollama default | local-first, no API key, no telemetry |

## Extending Mneme

The shape that everything plugs into is in [`packages/core/src/types.ts`](packages/core/src/types.ts).

- **New embedder?** Implement `EmbeddingProvider` (4 lines) and pass it to the indexer.
- **New incident source?** Implement `IncidentAdapter` and feed into the engine.
- **New correlation strategy?** Implement `CorrelationEngine`.
- **Custom MCP tools?** Add to the `TOOLS` array in `@mneme-ai/mcp/src/index.ts`.

The schema versions table (`meta.schema_version`) lets future migrations stay safe.
