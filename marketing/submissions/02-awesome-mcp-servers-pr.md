# Submission 2 — awesome-mcp-servers (punkpeye)

**Why:** Most popular community-curated MCP server list. ~5k stars and growing.

═══════════════════════════════════════════════════════════════════════════════

## Step 1 · Fork

https://github.com/punkpeye/awesome-mcp-servers/fork

═══════════════════════════════════════════════════════════════════════════════

## Step 2 · Edit README.md

Click ✏️ on README.md in your fork.

Find the section that fits Mneme best — search for:

```markdown
### 🛠️ Developer Tools
```

(or `### 💻 Code Execution` / `### 📚 Knowledge & Memory` depending on the current categorization).

Add this entry **alphabetically by repo name**:

```markdown
- [patsa2561-art/mneme-ai](https://github.com/patsa2561-art/mneme-ai) 📇 🏠 - The memory layer of your codebase. Indexes git history + code structure into local SQLite, exposes via MCP so AI coding assistants can query the WHY, the WHAT, and the WHERE-IT-BREAKS. Hybrid retrieval (BM25 + cosine + RRF), Ollama/OpenAI optional, MIT licensed.
```

Note: `📇` = TypeScript, `🏠` = local installation.  Check the README's emoji legend and adjust if conventions changed.

═══════════════════════════════════════════════════════════════════════════════

## Step 3 · Commit + PR

**Branch name:** `add-mneme`

**Commit message:**
```
Add Mneme — codebase memory layer for AI coding assistants
```

**PR Title:**
```
Add Mneme — codebase memory layer for AI coding assistants
```

**PR Body:**
```markdown
Adds [Mneme](https://github.com/patsa2561-art/mneme-ai) — an MCP server that gives AI assistants persistent, queryable memory of a codebase (git history + code + decisions).

Hybrid retrieval (BM25 + cosine + Reciprocal Rank Fusion), local-first SQLite, optional Ollama/OpenAI embeddings, MIT licensed, 644 tests passing.

Tools exposed: `mneme_ask`, `mneme_why`, `mneme_search_commits`, `mneme_status`, `mneme_list_entities`, `mneme_find_similar`, `mneme_blast`.
```
