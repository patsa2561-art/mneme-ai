# The Second Brain (v0.42)

> v0.42 closes the loop. Every plan composed via `mneme compose` is recorded in a per-repo library; frequent plans get **promoted** into named aliases that run with one command. The plans become executable via the new molecule executor — sandbox-aware, audit-logged, fully resumable on partial failure.

═══════════════════════════════════════════════════════════════════════════════

## The three new pieces

| Piece | What | Where |
|---|---|---|
| **Executor** | Resolves a plan's manifests, dynamically imports each implementation, invokes them in order, captures outputs in a scratchpad. Side-effect-aware (network/filesystem/git/subprocess can be forbidden per run). | `packages/core/src/periodic/executor.ts` |
| **Library** | Per-repo persistent log of composed plans. Tracks `hits`, `firstSeen`, `lastSeen`, optional `alias` (post-promotion), `note`. | `.mneme/library.json` |
| **CLI surface** | `mneme library` (manage), `mneme run <alias-or-id>` (execute) | `packages/cli/src/commands/{library,run}.ts` |

═══════════════════════════════════════════════════════════════════════════════

## End-to-end workflow

```bash
# 1. compose a plan from intent
mneme compose "find SQL injection in payment files"
# → plan written to .mneme/molecule-cache.json AND library.json

# 2. browse the library
mneme library
# → shows every plan you've composed, ranked by hits

# 3. promote frequent plans to a named alias
mneme library --eligible                       # entries with ≥ 5 hits
mneme library --promote <id> --alias weekly    # name it
mneme run weekly --execute                     # run it

# 4. annotate / clean up
mneme library --annotate <id> --note "weekly security review"
mneme library --archived                       # entries unused 30+ days
mneme library --forget <id>                    # remove
```

═══════════════════════════════════════════════════════════════════════════════

## The promotion algorithm (precise)

An entry is **eligible for promotion** when EITHER:
- `hits >= 5` (the default `hitsThreshold`), OR
- `firstSeen >= 7 days ago` AND `hits >= 2` ("cooled" — a plan you've come back to a few times over a week)

Already-promoted entries are excluded. Promoting auto-derives an alias from the intent (`"Find SQL Injection"` → `find-sql-injection`) unless `--alias <name>` is passed explicitly. The mapping lives in `.mneme/library.json`; `mneme run <alias>` is the only commitment.

An entry is **archived** when `lastSeen >= 30 days ago`. Archived entries are not surfaced by default; pass `--archived` to see them. Use `--forget <id>` to delete.

═══════════════════════════════════════════════════════════════════════════════

## The executor — safety-first design

```bash
mneme run <alias>                       # DRY-RUN by default — prints the plan
mneme run <alias> --execute             # actually run

# Sandbox controls
mneme run <alias> --execute --forbid-network       # no fetches
mneme run <alias> --execute --forbid-filesystem    # no fs writes
mneme run <alias> --execute --forbid-git           # no git subprocess
mneme run <alias> --execute --forbid-subprocess    # no subprocess at all
```

When a step is forbidden, it's **recorded as failed** rather than silently skipped — the user sees explicitly which step would have hit the network. A failed step does NOT poison the run; the executor captures the error and continues so the user gets the full picture.

Each step's output is summarised in the rendered output and stored under the scratchpad key matching the step's manifest id. The next step receives the merged scratchpad as its input — that's how primitives compose at runtime.

═══════════════════════════════════════════════════════════════════════════════

## Why the chemistry metaphor pays off here

```
intent → compile     ← the v0.41 compiler (rule-based or LLM-augmented)
       → record      ← v0.42: every compose hits the library
       → promote     ← v0.42: hits ≥ 5 → eligible for alias
       → run         ← v0.42: executor materialises the plan
       → record-hit  ← every run also bumps hits → keeps the loop alive
```

Every step is **introspectable**. Plans are JSON. Manifests are declared. The executor's per-step result is rendered as a list. There is no hidden control flow.

═══════════════════════════════════════════════════════════════════════════════

## Honest scope

- v0.42 ships the **frequency-based promotion**. We don't yet do *semantic* promotion — two intents that describe the same plan with different words still create two library entries. Semantic dedup lands in v0.43+ once we wire embedding-based intent matching.
- The executor's `bindArgs` heuristic handles object-parameter functions (the common case) and Float32Array-positional functions (vector kernels). It is intentionally simple — three lines of regex. Catalog primitives that don't fit either shape need a small adapter when registered.

═══════════════════════════════════════════════════════════════════════════════

## Related

- 🧪 [[Periodic-Table]] — the v0.40 catalog of primitives
- 🔧 [[Compose-And-Compiler]] — the v0.41 planner
- 💎 [[The-Frontier]] — the broader Mneme world-firsts
