# MCP Integration — wire Mneme into Claude Code, Cursor, Continue, Copilot

The flagship use case. Mneme exposes 7 tools over MCP (Model Context Protocol). Your AI assistant gets read access to your repo's history and stops guessing.

═══════════════════════════════════════════════════════════════════════════════

## Tools exposed

| Tool | Purpose |
|---|---|
| `mneme_ask` | Natural-language search over git history with synthesis |
| `mneme_why` | Blame + RAG explanation for any file/line range |
| `mneme_search_commits` | Hybrid (BM25 + vector) commit search |
| `mneme_status` | What's indexed, embedder used, DB stats |
| `mneme_list_entities` | Phase 2 entity listing (TS/JS/Python/Go) |
| `mneme_find_similar` | Phase 2 clone detection by cosine |
| `mneme_blast` | Phase 3 incident blast-radius prediction |

═══════════════════════════════════════════════════════════════════════════════

## Claude Code (desktop)

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

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

Restart Claude Code. The `mneme_*` tools appear in the tool picker.

═══════════════════════════════════════════════════════════════════════════════

## Cursor

Edit `.cursor/mcp.json` (per-project) or the global one:

```jsonc
{
  "mcpServers": {
    "mneme": {
      "command": "npx",
      "args": ["-y", "mneme-ai", "mcp"]
    }
  }
}
```

Cursor auto-detects the workspace folder, so `cwd` is usually optional.

═══════════════════════════════════════════════════════════════════════════════

## Continue

Add to `~/.continue/config.json`:

```jsonc
{
  "mcpServers": [
    {
      "name": "mneme",
      "command": "npx",
      "args": ["-y", "mneme-ai", "mcp"],
      "cwd": "/abs/path/to/your/repo"
    }
  ]
}
```

═══════════════════════════════════════════════════════════════════════════════

## GitHub Copilot Chat / Copilot Workspace

If your Copilot client supports MCP servers (newer versions do), use the same config pattern. If it doesn't yet — Copilot will get MCP support soon. Until then, use Claude Code or Cursor as the "smart shell" and let Copilot inline-complete inside it.

═══════════════════════════════════════════════════════════════════════════════

## Verify the integration works

After config + client restart:

1. Open the AI client.
2. Ask: *"Use mneme_ask to find why we use a retry on the webhook handler."*
3. The AI should call the tool and return commit hashes from your repo, not generic guesses.

If nothing happens, check:

- `npx -y mneme-ai mcp` works in your terminal? (it should hang silently — that's the stdio server waiting)
- `cwd` is the absolute path to a git repo with `.mneme/` initialized?
- `mneme index` has been run (otherwise the DB is empty)?

═══════════════════════════════════════════════════════════════════════════════

## Run with auto-update (live memory)

For repos under active development:

```bash
mneme watch    # in a tmux/screen/systemd session
```

The watcher re-indexes on every commit. Your AI gets fresh memory the moment new commits land, no manual `mneme index`.

═══════════════════════════════════════════════════════════════════════════════

## Self-hosted / air-gapped MCP

If your environment can't run `npx`, install globally and point to the absolute path:

```jsonc
{
  "mcpServers": {
    "mneme": {
      "command": "/usr/local/bin/mneme",
      "args": ["mcp"],
      "cwd": "/abs/path/to/your/repo"
    }
  }
}
```

Combine with deterministic mode for fully offline operation:

```bash
echo '{ "deterministic": true }' > /abs/path/to/your/repo/.mneme/config.json
mneme index --no-llm
```

═══════════════════════════════════════════════════════════════════════════════

## Troubleshooting

See [Troubleshooting](Troubleshooting). Common issues:

- **Tools don't appear** → restart the AI client; check JSON syntax
- **AI says "memory is empty"** → run `mneme index` first
- **"Not in a git repo"** → `cwd` must be a git repo root
- **Slow first response** → embeddings cold-load on first query; subsequent are fast
