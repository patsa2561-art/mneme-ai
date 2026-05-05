# Installation

Three install paths. Pick by use case.

═══════════════════════════════════════════════════════════════════════════════

## Option 1 — `npx` (zero install, run anything once)

Best for: trying Mneme on a single repo, demos, one-off queries.

```bash
npx -y mneme-ai init
npx -y mneme-ai index
npx -y mneme-ai ask "why does the webhook retry?"
```

`npx -y` downloads `mneme-ai` to a temp cache, runs once, then evicts. Nothing global, nothing persistent.

═══════════════════════════════════════════════════════════════════════════════

## Option 2 — Global install (recommended for daily use)

Best for: anyone who runs `mneme` more than once a week.

```bash
npm install -g mneme-ai
```

After install, the `mneme` command works in every git repo:

```bash
cd /path/to/your/repo
mneme init
mneme index
mneme --help        # 8 essentials. mneme advanced for the rest.
mneme --version     # confirm what version you have
```

### Upgrade

```bash
mneme --version                       # 1. see what you have
npm install -g mneme-ai@latest        # 2. pull latest
mneme --version                       # 3. verify
```

If the version doesn't change after step 2, **open a fresh terminal**. On Windows, `npm install -g` writes to `%APPDATA%\npm\` which the parent shell only re-reads on launch.

### Uninstall

```bash
npm uninstall -g mneme-ai
```

═══════════════════════════════════════════════════════════════════════════════

## Option 3 — Clone from source

Best for: reading the source, modifying behavior, contributing back.

```bash
git clone https://github.com/patsa2561-art/mneme-ai.git
cd mneme-ai

npm install        # uses npm workspaces — installs all 6 packages at once
npm run build      # compile TypeScript → JavaScript
npm test           # 613 tests should pass
npm run eval       # retrieval-quality eval

# run from the local build:
node packages/cli/bin/mneme.js --help

# (optional) make `mneme` available globally from this checkout:
cd packages/cli
npm link
mneme --help        # now works from any folder
```

To pull future updates: `git pull && npm install && npm run build`.

═══════════════════════════════════════════════════════════════════════════════

## Per-OS notes

### Windows

- Use Git Bash or PowerShell. Both work.
- `npm install -g` writes to `%APPDATA%\npm\` — make sure that's on your PATH.
- For Ollama: install the Windows app → start the service → `ollama pull nomic-embed-text`.

### macOS

- Homebrew works: `brew install node ollama`. Then `ollama pull nomic-embed-text`.
- Apple Silicon supported.

### Linux

- Node 20+ required. Most distros: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs`.
- Ollama: `curl -fsSL https://ollama.com/install.sh | sh`.

### Air-gapped / offline

Mneme works without any network. Use the `hash` embedder (built-in, zero deps) or pull Ollama models on a connected machine and copy `~/.ollama/` over.

```bash
mneme index --embedder hash
mneme ask "why does X exist?" --no-llm
```

═══════════════════════════════════════════════════════════════════════════════

## After install — the same 60-second flow

Whichever option you picked:

```bash
cd /path/to/any/git/repo
mneme init                       # creates .mneme/ inside the repo
mneme index                      # ~90 seconds for 5,000 commits with Ollama
mneme ask "why does X exist?"    # query the memory
```

Now go to **[Quickstart](Quickstart)** for the next 5 minutes, or **[Configuration](Configuration)** if you want to tune the embedder / indexer / redaction layer.
