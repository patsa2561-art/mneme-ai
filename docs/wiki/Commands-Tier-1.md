# Tier 1 — The 8 Essentials

These are the commands that show up in `mneme --help`. Every Mneme user touches them.

═══════════════════════════════════════════════════════════════════════════════

## `mneme init`

Initialize Mneme in the current repo. Creates `.mneme/` (gitignored), runs an environment probe, and recommends the best embedder for your hardware.

```bash
mneme init                  # default: probe + write config
mneme init --force          # overwrite existing config
mneme init --skip-probe     # for scripts / CI
```

After running, you'll see:

```
Environment probe
  hardware   16GB RAM · 8 cpus · linux/x64 (good)
  ollama     reachable · embed model pulled
  openai     no key

Recommendation ollama ★★★★☆
  Ollama is running and nomic-embed-text is pulled — local, free, high quality.
```

═══════════════════════════════════════════════════════════════════════════════

## `mneme doctor`

Same probe as `init`, runnable any time:

```bash
mneme doctor               # human-readable
mneme doctor --json        # machine-readable
```

Use it when:
- Switching machines
- Debugging "why is this slow?"
- Before posting a bug report

═══════════════════════════════════════════════════════════════════════════════

## `mneme index`

Walk the git log, parse PR/issue bodies, and build the embedding index.

```bash
mneme index
mneme index --since 2024-01-01
mneme index --max 5000
mneme index --embedder hash       # force hash fallback (fastest, lower quality)
mneme index --embedder ollama --model nomic-embed-text
mneme index --no-redact           # disable secret redaction (only for trusted repos)
mneme index --aggressive-redact   # enable password=/long-hex patterns too
mneme index --no-llm              # deterministic mode — force hash embedder
```

Typical timings:

| Repo size | Embedder | Time |
|---|---|---|
| 100 commits | hash | ~2s |
| 5,000 commits | Ollama | ~90s |
| 100,000 commits | Ollama | ~30 min |

Re-running `mneme index` is incremental — only new commits get processed.

═══════════════════════════════════════════════════════════════════════════════

## `mneme ask "<question>"`

The flagship command. Returns a verdict-shaped answer with evidence.

```bash
mneme ask "why does the webhook handler retry?"
mneme ask "when did we change the auth middleware?"
mneme ask "stripe bigint overflow" -k 5         # top-K override
mneme ask "..." --json                          # machine-readable
mneme ask "..." --no-llm                        # extractive answer only
mneme ask "..." --debug                         # show intent classification + scores
```

Output sections:

1. **Confidence badge** — 🟢 high / 🟡 medium / 🔴 low / ○ none
2. **✦ Answer** — synthesized verdict (LLM if available, extractive otherwise)
3. **◆ Evidence** — top-3 commits with hashes + dates + authors
4. **⊕ Files** — clustered by top-2 path segments
5. **→ Try next** — three follow-up commands you can copy-paste
6. **Was this useful?** — feedback CTA wired to the Wisdom Mutant Engine

The intent classifier short-circuits VAGUE queries with a redirect:

```bash
$ mneme ask "how to improve my code"
⚠ Mneme can't answer this directly.
  "how to" — Mneme indexes history, not best-practices

  Try:
    • "why does <function> exist?"
    • "when did we change <module>?"
    • "who wrote <file>?"
```

═══════════════════════════════════════════════════════════════════════════════

## `mneme why <target>`

Git archaeology + RAG for any file or line range.

```bash
mneme why src/payment.ts
mneme why src/payment.ts:42
mneme why src/payment.ts:42-58
mneme why packages/core/src/index.ts -k 8     # related-commits cap
```

Returns:

- **Originating commits** — top blame contributors with line counts
- **Semantically related** — embedding-search similar commits across the repo

Doubles as an implicit positive-feedback signal: if you `mneme why` a commit that recently appeared in `mneme ask` results, that result gets marked helpful in `wisdom_feedback`.

═══════════════════════════════════════════════════════════════════════════════

## `mneme status`

What's indexed, embedder used, DB stats.

```bash
mneme status
```

Output:

```
Memory
  commits indexed:   5,432
  chunks:           18,127
  with embeddings:  18,127
  entities:           844
  incidents:           12
  embedder:         ollama:nomic-embed-text
  schema version:    3
  DB size:           48 MB
```

═══════════════════════════════════════════════════════════════════════════════

## `mneme mcp`

Run as an MCP server (stdio) for AI clients. See [MCP-Integration](MCP-Integration) for full setup.

```bash
mneme mcp                  # foreground — usually invoked by the AI client, not directly
```

Exposes 7 tools:
`mneme_ask`, `mneme_why`, `mneme_search_commits`, `mneme_status`, `mneme_list_entities`, `mneme_find_similar`, `mneme_blast`.

═══════════════════════════════════════════════════════════════════════════════

## `mneme watch`

The 24/7 Wisdom Mutant Engine daemon.

```bash
mneme watch                              # default settings
mneme watch --calibrate-ms 1800000       # calibrate every 30 min instead of 60
mneme watch --self-eval-ms 86400000      # self-eval daily
mneme watch --quiet                      # suppress per-event logs
```

Schedule:
- **On every commit** (file watcher on `.git/HEAD`) — re-index incrementally
- **Every 1 hour** — re-calibrate search knobs against feedback set (grid search)
- **Every 24 hours** — self-eval, write a row to `wisdom_eval_run`

Run it in a tmux/screen/systemd session and forget it.

═══════════════════════════════════════════════════════════════════════════════

## See also

- **[Commands-Tier-2-Insights](Commands-Tier-2-Insights)** — who-knows, decisions, story, dream, chat, …
- **[Commands-Tier-2-Quant](Commands-Tier-2-Quant)** — drawdown, alpha, black-swan, Greeks, …
- **[Recipes](Recipes)** — practical use cases combining multiple commands
