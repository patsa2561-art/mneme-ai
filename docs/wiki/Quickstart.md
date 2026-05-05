# Quickstart — first query in 60 seconds

## 1. Install

```bash
npm install -g mneme-ai
```

(See [Installation](Installation) for npx, clone-from-source, and per-OS notes.)

## 2. Verify

```bash
mneme --version
# → 0.10.0 (or higher)

mneme doctor
# → smart probe: detects Ollama, OpenAI key, hardware tier, recommends best embedder
```

## 3. Initialize on any git repo

```bash
cd /path/to/your/repo
mneme init
mneme index
```

`mneme init` creates a `.mneme/` folder (gitignored by default) with a SQLite DB.
`mneme index` walks your git log, parses PR/issue bodies, and builds the embedding index. Typical times:

- 100 commits with hash embedder: ~2 seconds
- 5,000 commits with Ollama: ~90 seconds
- 100k commits: ~30 minutes

## 4. Ask your first question

```bash
mneme ask "why does the webhook handler retry?"
```

You'll see:

- **Confidence badge** (🟢 high / 🟡 medium / 🔴 low / ○ none)
- **✦ Answer** — verdict-shaped synthesis (LLM if available, extractive otherwise)
- **◆ Evidence** — top-3 commits with hashes + dates + authors
- **⊕ Files** — clustered by module
- **→ Try next** — three follow-up commands you can copy-paste
- **Was this useful?** — feedback CTA wired into the Wisdom Mutant Engine

## 5. Wire into your AI assistant (MCP)

Add this to your Claude Code / Cursor / Continue config:

```jsonc
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

The AI now has 7 tools:
`mneme_ask`, `mneme_why`, `mneme_search_commits`, `mneme_status`, `mneme_list_entities`, `mneme_find_similar`, `mneme_blast`.

It will read your repo's history instead of guessing.

## 6. Discover the rest

```bash
mneme advanced
```

Shows all 47 advanced commands grouped by phase: Phase 2 (semantic similarity), Phase 3 (incident correlation), Phase 4 (Wisdom Mutant Engine), Insights, Quant, WILD ideas.

## What's next

- **[Recipes](Recipes)** — practical use cases (onboarding, retros, security)
- **[Configuration](Configuration)** — fine-tune embedder, indexer, redaction
- **[Commands-Tier-2-Quant](Commands-Tier-2-Quant)** — 10 finance-inspired analyses (drawdown, Kelly criterion, Greeks, …)
