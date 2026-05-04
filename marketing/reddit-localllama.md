# Reddit — r/LocalLLaMA draft

> r/LocalLLaMA cares deeply about: local-first, no API keys, offline operation, MCP, RAG quality. Lead with all of those.

## Title

```
[Tool] Mneme — local-first MCP server that indexes git history for any AI assistant (Ollama default, MIT)
```

## Body

> tl;dr: Drop-in MCP server that gives any AI assistant (Claude Code, Cursor, Continue, Copilot via MCP, anything that speaks the protocol) a permanent, searchable memory of a git repo's history — commits, PR descriptions, issue bodies, blame.
>
> Runs entirely locally. Ollama is the default embedder (`nomic-embed-text`, 768-dim). No API key. No telemetry. No accounts. The whole memory is a single SQLite file in `.mneme/` inside your repo.
>
> ```bash
> npm install -g mneme-ai
> cd /path/to/repo
> mneme init
> mneme index           # 5,000 commits ≈ 90s with Ollama
> mneme ask "why does the webhook handler retry idempotently?"
> ```
>
> **What it adds to your AI assistant:**
> - `mneme_ask` — natural-language search over git history
> - `mneme_why` — blame + RAG explanation for any file/line range
> - `mneme_search_commits` — hybrid (BM25 + vector) commit search
> - `mneme_status` — what's indexed
>
> **Retrieval design:**
> - Hybrid: BM25 (FTS5) + cosine over embeddings, fused via Reciprocal Rank Fusion
> - In-memory cosine for ≤1M chunks; `sqlite-vec` migration is documented for larger
> - Optional reranker (QueryDensityReranker) lifts precision@3 by +2.2pp
>
> **Eval harness ships in-tree.** 15-question golden set, recall@k / MRR / nDCG metrics. CI runs eval on every PR. Numbers from the canonical eval (hash fallback embedder — Ollama would be higher):
> - recall@1: 86.7%
> - recall@3: 86.7% (with reranker)
> - MRR: 90.0%
> - query latency p50: 1.2 ms, p95: 2.7 ms
>
> **MCP config for Claude Code:**
> ```json
> {
>   "mcpServers": {
>     "mneme": {
>       "command": "npx",
>       "args": ["-y", "mneme-ai", "mcp"],
>       "cwd": "/abs/path/to/your/repo"
>     }
>   }
> }
> ```
>
> Repo: https://github.com/patsa2561-art/mneme-ai
> MIT, TypeScript, Node 20+, works offline.
>
> Phase 3 (incident correlation — joining commits with your observability platform incident timelines) is engine-complete; adapters land in v0.2.
>
> Honest limit: needs a git repo with non-trivial history. Repos full of `wip`/`update`/`fix` get poor results — and the tool tells you so instead of hallucinating.
>
> Happy to answer questions about the retrieval pipeline, the MCP integration, or the eval setup.

## Why this works on r/LocalLLaMA

- "Local-first" in the title (their love language)
- "No API key. No telemetry." early
- Specific Ollama model (`nomic-embed-text`, 768-dim) — speaks their dialect
- MCP integration is hot in this community right now
- Real numbers from a real eval harness
- Honest about limitations

## Posting tips

- Post in the evening US time / morning Asia time — that's when the sub is most active
- Use the `[Tool]` prefix (sub convention)
- If you have a demo GIF, embed it (Reddit allows this)

## What to avoid

- ❌ "Revolutionary" or "world-class" — they will downvote
- ❌ Comparing to commercial tools by name — looks like an ad
- ❌ Replying defensively to "is this just RAG?" — yes it's RAG, just say so
