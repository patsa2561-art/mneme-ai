# Submission 1 — MCP Registry PR (modelcontextprotocol/servers)

**Goal:** Get Mneme listed in the official MCP server registry. Highest impact submission — every Claude Desktop / Claude Code / Cursor user browsing for MCP servers will see it.

═══════════════════════════════════════════════════════════════════════════════

## Step 1 · Fork the repo (10 seconds)

Click this link → press **"Create fork"**:

https://github.com/modelcontextprotocol/servers/fork

═══════════════════════════════════════════════════════════════════════════════

## Step 2 · Edit the README

After the fork appears under your account, GitHub will redirect you. Click the **README.md** in the file list, then click the **pencil icon ✏️** (top right of the file).

Use **`Ctrl+F`** in the editor to find the section header:

```markdown
### 🌎 Community Servers
```

Scroll down to the **alphabetical list of community servers** (it's a long bullet list). Find the spot where `M` entries would go (alphabetical) and add this **single line**:

```markdown
- **[Mneme](https://github.com/patsa2561-art/mneme-ai)** - The memory layer of your codebase: indexes git history + code + decisions, exposes them via MCP. Hybrid retrieval (BM25 + cosine + RRF), local-first SQLite, MIT licensed.
```

═══════════════════════════════════════════════════════════════════════════════

## Step 3 · Commit message

Scroll down to the **"Commit changes"** section. Use:

**Commit message (top input):**
```
Add Mneme — codebase memory layer for AI coding assistants
```

**Extended description (optional, in body):**
```
Mneme indexes git history, code structure, and past decisions into a
local SQLite database, exposes them via MCP so AI coding assistants
can query the codebase's memory directly. Hybrid retrieval (BM25 +
cosine, fused via RRF), confidence scoring, optional Ollama / OpenAI
embeddings.

License: MIT.
```

Select **"Create a new branch"** option → name it `add-mneme` → click **Propose changes**.

═══════════════════════════════════════════════════════════════════════════════

## Step 4 · Open the Pull Request

GitHub will redirect to a "Comparing changes" page. Click **"Create pull request"**.

**PR Title:**
```
Add Mneme — codebase memory layer for AI coding assistants
```

**PR Body (paste this):**
```markdown
## What

Adds **Mneme** to the Community Servers list.

## Why

Mneme is an MCP server that gives AI coding assistants persistent, queryable memory of a codebase — git history, code structure, past decisions — so they can answer "why does this code exist?" with real context instead of guesses.

## Implementation

- Hybrid retrieval: BM25 (FTS5) + cosine similarity, fused via Reciprocal Rank Fusion
- Local-first: SQLite + WAL, optional Ollama (offline) or OpenAI embeddings
- Confidence scoring — refuses to answer when uncertain
- 644 tests passing (including 16 property-based × 10k cases each)

## Tools exposed via MCP

`mneme_ask`, `mneme_why`, `mneme_search_commits`, `mneme_status`, `mneme_list_entities`, `mneme_find_similar`, `mneme_blast`

## Repo

- GitHub: https://github.com/patsa2561-art/mneme-ai
- npm: https://www.npmjs.com/package/mneme-ai
- License: MIT
- Maintainer: solo developer @patsa2561-art

I'm happy to address any feedback or follow the contribution conventions more strictly if needed. Thank you for maintaining this list.
```

Click **"Create pull request"**. ✅

═══════════════════════════════════════════════════════════════════════════════

## What happens next

- A maintainer will review (usually 1-7 days)
- They may ask for tweaks (description length, formatting)
- Reply politely and adjust
- Once merged → instant exposure to thousands of MCP users
