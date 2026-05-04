# @mneme-ai/mcp

MCP server that exposes [Mneme](https://github.com/patsa2561-art/mneme-ai) to AI clients (Claude Code, Cursor, Continue, Copilot via MCP).

You normally don't import this directly — the `mneme-ai` CLI exposes it via:

```bash
mneme mcp     # start server on stdio
```

## Tools exposed to the AI client

| Tool | Purpose |
|---|---|
| `mneme_ask` | natural-language search over git history |
| `mneme_why` | blame + RAG explanation for any file/line range |
| `mneme_search_commits` | hybrid (BM25 + vector) commit search |
| `mneme_status` | what's indexed |

## Client config

```json
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

## License

MIT.
