# mneme-ai

The Mneme CLI. **The memory layer of your codebase.**

```bash
npm install -g mneme-ai
# or
npx -y mneme-ai init
```

## Commands

```bash
mneme init              # initialize Mneme in the current git repo
mneme index             # index commits, PRs, embeddings
mneme ask "question"    # natural-language search over git history
mneme why <file>:<line> # blame + RAG explanation
mneme status            # what's indexed
mneme correlate         # phase 3 — incident correlation
mneme mcp               # run as an MCP server
mneme wisdom            # daily meditation from the manifesto
mneme manifesto         # full canon of meditations
```

## Connect to Claude Code / Cursor / Continue

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

## Full documentation

→ https://github.com/patsa2561-art/mneme-ai

## License

MIT.
