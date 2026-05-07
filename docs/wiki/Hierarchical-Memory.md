# Hierarchical Token Cache (HTC) — v0.24

> The first memory layer that pre-compresses an entire codebase's git history into LLM-consumable form. **50,000 commits fit in one Claude prompt.** Token cost paid ONCE at index time. Re-used forever.

═══════════════════════════════════════════════════════════════════════════════

## TL;DR

Every existing AI-codebase tool — Sourcegraph Cody, Greptile, Cursor, Continue, Sweep, Aider, Copilot Workspace — is a **retrieval-only** system. They search your repo at query time and dump raw code/commits into the LLM's context window. That works for one query at a time and breaks at scale.

Mneme v0.24 introduces a different paradigm: **compression-as-storage**. At index time, free LLMs (Groq Gemma 2B / Ollama Qwen 2.5) walk every commit, every cluster, the entire repo and write tiered summaries:

```
Layer 0 — Raw commits           full body, indexed in SQLite          (existed before v0.24)
Layer 1 — Semantic abstracts    ~30 tok/commit, LLM-generated once    (NEW)
Layer 2 — Topic clusters        ~100 tok/cluster, summarized          (NEW)
Layer 3 — Repo memoir            ~500 tok of repo evolution            (NEW)
```

Now `mneme ask` routes to the right layer based on question complexity. AI clients (Claude Code, Cursor) consume **10× fewer tokens** for the same answer quality.

═══════════════════════════════════════════════════════════════════════════════

## Why nobody has done this

- **Sourcegraph Cody / Greptile** — retrieval, raw code only. No layer above.
- **Cursor / Continue** — context window of currently-open files. No history compression.
- **Sweep / Aider** — operates per-PR/diff. No long-memory.
- **GitHub Copilot Workspace** — agentic but no persistent compressed memory.
- **RTK** (the inspiration) — compresses ONE shell-command output per call. Not stored.

Mneme HTC is the first to:
1. Compress at **index time**, not per-query
2. Store compressions **persistently** in the same SQLite memory layer
3. Build a **hierarchy** so question complexity routes to the right level
4. Keep raw layer 0 alongside, so cited evidence stays verifiable

═══════════════════════════════════════════════════════════════════════════════

## How to use

### Build the cache (one-time, ~10 min for a 5K-commit repo)

```bash
mneme index --compress
```

Mneme walks every commit, generates a 30-token abstract via your free LLM ladder (Ollama → Groq → OpenRouter), then clusters, then memoir. Progress is streamed; cache survives crashes.

### Inspect what was built

```bash
mneme htc-stats
```

```text
✦ HTC coverage
   abstracts:  4,827 / 4,827 commits   (100%)
   clusters:   23 topics covered
   memoir:     generated 2 hours ago

✦ Token math
   raw commit text:        4.8M tokens
   compressed cache:       312K tokens
   compression ratio:      15.4×
```

### Ask normally — Mneme picks the right layer

```bash
mneme ask "why does the auth flow use JWT?"        # specific → L0 + L1
mneme ask "summarize the security work this year"  # broad → L1 + L2
mneme ask "what is this repo about, in one para"   # repo-level → L3 only
```

The smart router uses the v0.19 intent classifier + question token count to decide. You can override with `--htc-layer 1|2|3|all`.

### MCP clients see compressed responses by default

When an AI client (Claude Code, Cursor, Codex) queries Mneme via MCP, the responses are **Layer 1 abstracts by default** — 10× fewer tokens than raw commits, with citations that resolve to full bodies on demand.

═══════════════════════════════════════════════════════════════════════════════

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   mneme ask "..."                         │
└──────────────────┬───────────────────────────────────────┘
                   │
                   ▼  intent + length → layer choice
┌──────────────────────────────────────────────────────────┐
│              Smart Router (Phase 4)                       │
└────┬─────────────┬─────────────┬─────────────────────────┘
     │             │             │
     ▼             ▼             ▼
┌────────┐    ┌─────────┐    ┌────────┐
│Layer 1 │    │Layer 2  │    │Layer 3 │
│30 tok  │    │100 tok  │    │500 tok │
└────────┘    └─────────┘    └────────┘
     │             │             │
     ▼             ▼             ▼  fallback (raw needed?)
┌──────────────────────────────────────────────────────────┐
│           Layer 0 — raw SQLite store                       │
│           commits + diffs + file_changes                   │
└──────────────────────────────────────────────────────────┘
```

═══════════════════════════════════════════════════════════════════════════════

## Why it matters for big-codebase teams

### xAI / SpaceX scale

A repo with 50,000 commits would not fit in any LLM context window today. With Layer 1 (30 tok × 50K = 1.5M tokens), it fits in Sonnet's 1M context with summaries-of-summaries. With Layer 3 (500 tok), the entire repo fits in Haiku's 200K window. New engineers can ask "what should I read first?" and get a meaningful answer that cites every era of the project.

### Anthropic Claude tools

Every MCP tool call sends raw commit text today. With Mneme HTC, the Claude Code / Cursor / Codex tool call returns dense abstracts. **Same answer quality, 10× lower API spend per session.**

### Solo devs

You don't pay for the compression — free Ollama / Groq does it once. The cost moves from per-query to per-index, amortized over months of use.

═══════════════════════════════════════════════════════════════════════════════

## Honest limits

- **Compression is lossy.** Layer 1 keeps the meaning of each commit, not the details. For audit-grade citation (a la `--audit`), Mneme always falls back to Layer 0 raw bodies.
- **Quality depends on the free LLM you use.** Qwen 2.5:3b ≥ Gemma 2:2b ≥ Llama 3.2:1b for abstract quality. The setup wizard already recommends qwen2.5:3b first.
- **Repo size limits.** A 100K-commit monorepo will take ~1 hour to compress on first run. Incremental compression on `mneme index` (only new commits) keeps subsequent updates fast.
- **Compressed ≠ omniscient.** Layer 3 is a *narrative*, not an exhaustive index. For "find every commit touching X", use Layer 0 retrieval.

═══════════════════════════════════════════════════════════════════════════════

## Related pages

- 🔬 [[Speculative-Reasoning]] — v0.23: streaming events + Leviathan + DDTree (HTC's L1 abstracts feed into Leviathan citation matcher)
- 📊 [[Novel-Algorithms]] — TDWE / RACB / ADS / CGAR (composable with HTC layer routing)
- 🍳 [[Recipes]] — multi-command workflows now routed by HTC
