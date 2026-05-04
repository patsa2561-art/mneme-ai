# Phase 2 — Semantic similarity & clone detection

> **Status:** designed, contracts shipped, implementation pending.
> Tracked toward v0.2.0.

## What this phase adds

Phase 1 answers *"why does this commit exist?"*. Phase 2 answers a different family of questions:

1. **"Which functions in this repo do roughly the same thing as `parseAmount`?"**
   Five engineers independently reinvented retry-with-backoff and now we have five subtly different versions. Mneme should find them.

2. **"Where is this concept handled outside its declared module?"**
   `validateOrder` lives in `src/orders/`, but the same validation also lives — silently — in three other files. That is invisible to grep and visible to embeddings.

3. **"Show me the cross-cutting concerns."**
   Logging, auth, rate-limiting, retries, idempotency. These are themes scattered across the codebase. Mneme should be able to surface them as clusters.

4. **"Onboard me — give me the 10 entities a new contributor must understand."**
   Pick the most-connected, most-edited, most-imported symbols. Show those first.

## The contract surface (already shipped)

The interfaces are in [`packages/core/src/entities/index.ts`](../packages/core/src/entities/index.ts). They are intentionally narrow:

```ts
interface EntityParser {
  readonly name: string;
  readonly languages: string[];
  parseRepo(opts: ParseOptions): AsyncIterable<Entity>;
  parseFile(filePath: string, source: string): Iterable<Entity>;
}

interface CloneDetector {
  readonly name: string;
  detect(opts: DetectOptions): Promise<EntityCluster[]>;
}
```

The store schema already has the `entities` table from v0.1 — we did not have to migrate. Each entity is an `id`, `kind`, `name`, `file_path`, `start_line`, `end_line`, `signature`, `language`, and an optional `embedding` BLOB. Good for >1M entities on a laptop.

## Implementation plan (4 weeks of focused work)

### Week 1 — TreeSitterParser

A single `EntityParser` implementation backed by [`web-tree-sitter`](https://www.npmjs.com/package/web-tree-sitter). Targets, in priority order:

1. TypeScript / TSX
2. JavaScript / JSX
3. Python
4. Go
5. Rust

Output shape per file: every `function`, `class`, `interface`, `type alias`, `exported variable`, and `module/namespace`. Drop nested closures unless they are exported.

We **do not** use ESLint/Babel — too heavy, too JS-only. tree-sitter is uniform across languages.

### Week 2 — Embedding entities

Reuse the existing `EmbeddingProvider` interface. For each entity, embed:

```
"<kind> <name> <signature?>
 <body, truncated to 800 chars>"
```

Why include the body: a function called `validate` could mean anything; including the implementation tells the embedder what it actually does. Body truncation keeps embedding cost bounded.

Store as `entities.embedding` BLOB. Same vector-space rules as commit chunks: cosine search is in-memory until we wire `sqlite-vec`.

### Week 3 — CosineCloneDetector

A simple, transparent algorithm:

1. For each entity, find its top-K nearest neighbors by cosine.
2. Build the similarity graph: edge between A and B if `cos(A, B) ≥ threshold`.
3. Connected-component-cluster the graph.
4. Drop singletons; cap clusters at `maxClusterSize`.
5. Compute cohesion = mean pairwise cosine within cluster.

Why connected components and not HDBSCAN: the threshold is the user's lever. They want to slide it from "exact reimplementations" to "vaguely similar". Connected-component-cluster gives a clean monotone behavior: raise threshold → fewer / tighter clusters.

### Week 4 — CLI surface + eval

```bash
mneme entities          # show counts + per-language breakdown
mneme clones            # cluster the codebase, print top-N clusters
mneme similar <name>    # find entities similar to a named symbol
```

MCP tools:

- `mneme_list_entities` — paginated, filterable
- `mneme_find_similar` — input: snippet OR entity id, output: ranked similar entities

Eval harness extension:

- Add a "clone detection" golden set: known-similar pairs in the fixture repo
- Metric: pairwise recall @ threshold (does the detector group things we know belong together?)
- Add to `npm run status` so STATUS.md gets a Phase 2 row

## What the user actually sees

```
$ mneme clones --top 3

  Cluster 1   cohesion 0.91   8 members
    "retry with exponential backoff"
    src/api/stripe.ts:retryRequest             [original?]
    src/api/twilio.ts:doWithRetry              [duplicate]
    src/workers/queue.ts:retry                 [duplicate]
    src/utils/http.ts:withRetry                [duplicate]
    src/orders/email.ts:_retry                 [private dup]
    src/auth/refresh.ts:tryRefresh             [adapted dup]
    src/billing/webhook.ts:wrapRetry           [thin wrapper]
    src/notif/send.ts:tryEnqueue               [adapted]

  Cluster 2   cohesion 0.88   5 members
    "validate input order shape"
    ...
```

## What this is NOT

- **Not a duplicate-line detector.** PMD / SonarQube already do that. They report syntactic clones; we report *semantic* clones — the same intent expressed differently.
- **Not a refactoring tool.** We surface candidates; humans decide what to extract.
- **Not language-complete.** We will support a small set of languages well, not all languages poorly.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| tree-sitter native binaries are platform-fragile | Use `web-tree-sitter` (WASM) — runs the same on every OS |
| Repo with 50 k functions + 768-dim vectors blows memory | Stream parse + embed in batches; flush BLOBs every 1k entities |
| Threshold is too sensitive | Ship sensible defaults; surface the lever in `mneme clones --threshold 0.9` |
| False clusters bury real ones | Cohesion score per cluster + `--min-cohesion` flag |
| "All my React components are clones" panic | Filter generic patterns by IDF on entity names; document the trade-off |

## Acceptance criteria (Phase 2 done)

- [ ] `TreeSitterParser` parses TS/JS/Python/Go/Rust at ≥1 k files/sec on a laptop
- [ ] `CosineCloneDetector` finds known clones in the fixture repo (recall ≥80% on a 20-pair golden set)
- [ ] `mneme clones` runs end-to-end on a 5 k-commit repo in <60 seconds
- [ ] MCP tools `mneme_list_entities` + `mneme_find_similar` respond to Claude Code in <500 ms
- [ ] STATUS.md regenerates with a Phase 2 quality row

When all five rows tick green, we tag v0.2.0.
