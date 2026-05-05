# Submission 4 — awesome-ai-dev-tools / awesome-claude

═══════════════════════════════════════════════════════════════════════════════

## Option A — hesreallyhim/awesome-claude-code (high-traffic)

### Fork
https://github.com/hesreallyhim/awesome-claude-code/fork

### Edit README.md

Look for sections like:
- **"Slash Commands"** (skip — Mneme isn't a slash command)
- **"MCP Servers"** ← this is our home
- **"Knowledge & Memory"**

Add:

```markdown
- [Mneme](https://github.com/patsa2561-art/mneme-ai) - Codebase memory MCP server. Indexes git history + code → SQLite, gives Claude Code the WHY of every line. Hybrid retrieval, local-first, MIT.
```

═══════════════════════════════════════════════════════════════════════════════

## Option B — yzfly/Awesome-AI-Code-Tools

### Fork
https://github.com/yzfly/Awesome-AI-Code-Tools/fork

Add under "Tools" or "Memory & Context":

```markdown
- [Mneme](https://github.com/patsa2561-art/mneme-ai) — Memory layer for AI coding assistants. Indexes git + code via MCP. Local-first SQLite, MIT.
```

═══════════════════════════════════════════════════════════════════════════════

## PR title / body (same as previous submissions)

**Title:**
```
Add Mneme — codebase memory layer (MCP server)
```

**Body:**
```markdown
[Mneme](https://github.com/patsa2561-art/mneme-ai) is an MCP server that indexes a codebase's git history + code structure into a local SQLite database, exposing them as tools to AI coding assistants (Claude Code, Cursor, Continue, Codex, etc.).

Stack: TypeScript · SQLite + FTS5 · Hybrid retrieval (BM25 + cosine + RRF) · MCP. Local-first by default; optional Ollama (offline) or OpenAI embeddings.

License: MIT · Tests: 644 passing.
```
