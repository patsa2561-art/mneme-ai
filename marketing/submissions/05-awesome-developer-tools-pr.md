# Submission 5 — awesome-developer-tools / awesome-cli

═══════════════════════════════════════════════════════════════════════════════

## Option A — agarrharr/awesome-cli-apps

### Fork
https://github.com/agarrharr/awesome-cli-apps/fork

### Edit readme.md

Find the section **"Development"** (alphabetical), specifically subsection like **"Git"** or **"Code Search"**.

Add alphabetically:

```markdown
- [mneme](https://github.com/patsa2561-art/mneme-ai) - Memory layer for your codebase. Indexes git history + code into local SQLite, queryable via CLI or MCP. Answers "why does this code exist?" by mining commits + PRs + decisions.
```

═══════════════════════════════════════════════════════════════════════════════

## Option B — sindresorhus/awesome-nodejs

If awesome-cli is too crowded, try:
https://github.com/sindresorhus/awesome-nodejs/fork

Add under **"Command-line apps"**:

```markdown
- [mneme](https://github.com/patsa2561-art/mneme-ai) - Codebase memory CLI + MCP server. Hybrid retrieval over git history.
```

═══════════════════════════════════════════════════════════════════════════════

## Commit + PR

**Branch:** `add-mneme`
**Commit:** `Add mneme — codebase memory layer CLI`
**PR Title:** `Add mneme — codebase memory layer for git history`
**PR Body:**
```markdown
[Mneme](https://github.com/patsa2561-art/mneme-ai) is a CLI + MCP server that gives you (and your AI assistant) queryable memory of a codebase.

It indexes git history + code structure into a local SQLite database (FTS5 + WAL), and answers questions like *"why does this code exist?"*, *"who knows this module?"*, and *"will this change be regretted?"* with citations to the actual commits.

Stack: TypeScript · SQLite · MCP · optional Ollama/OpenAI embeddings.
License: MIT · 644 tests passing.
```
