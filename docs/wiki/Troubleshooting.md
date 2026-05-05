# Troubleshooting

═══════════════════════════════════════════════════════════════════════════════

## Install

### `command not found: mneme` after global install

Your shell hasn't refreshed the PATH. Open a new terminal.

On Windows, `npm install -g` writes to `%APPDATA%\npm\` — confirm that's on PATH (`echo $env:PATH` or `echo %PATH%`).

### `EACCES permission denied` on global install

Use a Node version manager (nvm, fnm, volta) so npm doesn't need sudo:

```bash
# Linux/macOS
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 22
npm install -g mneme-ai
```

Or for one-off use: `npx -y mneme-ai <cmd>`.

### Build fails: `Cannot find module @mneme-ai/...`

```bash
npm cache clean --force
rm -rf node_modules packages/*/node_modules packages/*/dist
npm install
npm run build
```

═══════════════════════════════════════════════════════════════════════════════

## Indexing

### `Memory is empty. Run mneme index first.`

Self-explanatory — run `mneme index`. Re-running is incremental.

### Indexing hangs / very slow

Try `mneme index --embedder hash` to bypass Ollama/OpenAI. If hash is fast, the bottleneck is the embedder.

For Ollama: confirm `ollama list` shows the model. Pull if missing:

```bash
ollama pull nomic-embed-text
```

### `Ollama not reachable at http://localhost:11434`

```bash
ollama serve     # in another terminal — keeps the server running
```

Or set `embeddings.baseUrl` in `.mneme/config.json` to a custom endpoint.

### Schema migration warning on re-index

When upgrading from v0.9 → v0.10, the FTS5 tokenizer changes from `porter unicode61` → `trigram`. The migration runs automatically and is non-destructive (re-populates from existing chunks). First re-index is normal speed.

═══════════════════════════════════════════════════════════════════════════════

## Querying

### `mneme ask` returns "no context found" for what should be a real question

Three causes in order of likelihood:

1. **Indexing didn't include relevant commits.** Check `mneme status` — does the commit count look right? If you used `--max 100`, the commit might not be in the corpus.

2. **The query is too vague.** Mneme's intent classifier short-circuits "how to improve my code" with a redirect. Use specific question forms: "why does X exist?", "when did we change Y?", "who wrote Z?".

3. **Confidence floor is too strict for your repo.** Override with `--no-confidence-floor` (planned in v0.11; for now, edit the threshold in source).

### Thai / CJK / Arabic queries return nothing

The FTS tokenizer is `trigram` since v0.10.0 — it should work for any language. If results are still poor:

- Verify schema migrated: `mneme status` should show schema version 3+
- Re-run `mneme index` to repopulate the FTS table

### `mneme ask` is slow

First call after start has ~500ms cold-load latency for embeddings. Subsequent calls are fast (p50 ≈ 1.3 ms). If consistently slow:

- `mneme status` — check DB size; if > 1GB, consider `sqlite-vec` (see [Architecture](Architecture))
- Switch to hash embedder for fastest queries: edit config or pass `--no-llm`

═══════════════════════════════════════════════════════════════════════════════

## MCP

### Claude Code / Cursor doesn't see `mneme_*` tools

1. Check JSON syntax in the config file (one comma in the wrong place breaks it)
2. **Restart the AI client** — config is loaded once at launch
3. Verify `npx -y mneme-ai mcp` works in your terminal (it should hang silently on stdin — that's a working stdio server)
4. Check `cwd` is an absolute path to a git repo with `.mneme/` initialized

### MCP server crashes

```bash
mneme mcp --debug 2> mneme-mcp.log
```

Then attach `mneme-mcp.log` to a [bug report](https://github.com/patsa2561-art/mneme-ai/issues).

═══════════════════════════════════════════════════════════════════════════════

## Wisdom Mutant Engine

### `mneme calibrate` says "Not enough positive feedback yet"

Default gate: ≥ 10 positive examples. Build feedback by:

- Using `mneme ask` regularly (every query becomes a pending feedback row)
- Running `mneme why <commit>` on results — this implicitly marks them helpful
- Explicit feedback: `mneme feedback <id> up`

### `mneme watch` daemon stops responding

Most likely a long-running indexing job + concurrent commit. The watcher debounces HEAD changes by 1.5s; ensure your tooling isn't writing `.git/HEAD` repeatedly faster than that.

To restart cleanly: Ctrl-C (graceful via SIGINT), then `mneme watch` again.

═══════════════════════════════════════════════════════════════════════════════

## Quant commands (Sprint 5)

### `mneme black-swan` returns empty

Black-swan needs incidents indexed:

```bash
mneme correlate --source manual --file ./incidents.json
```

Without incidents, no file is associated with severity → no tail risk to surface.

### `mneme paradox` returns empty

Paradox extracts decisions from commit messages. If your repo doesn't have many "decided to X" / "switched from A to B" / "replaced X with Y" patterns, there's nothing to flip-flop. Use `mneme decisions` first to see what was extracted.

### `mneme implied-volatility` shows IV = 0

Either commit messages are very calm (good!) or you have < 4 weeks of history (insufficient for trend). Output will explicitly say `insufficient-data` in that case.

═══════════════════════════════════════════════════════════════════════════════

## Reporting bugs

When opening an issue ([github.com/patsa2561-art/mneme-ai/issues](https://github.com/patsa2561-art/mneme-ai/issues)), include:

```bash
mneme --version
mneme doctor
mneme status                # if relevant to a query bug
```

Plus the exact command that failed and any error output. Tokens are auto-redacted from `mneme doctor` output.
