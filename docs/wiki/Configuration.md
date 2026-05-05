# Configuration

Mneme reads three layers of configuration, in order of precedence:

1. **CLI flags** (highest priority) — `--embedder hash`, `--no-llm`, `--no-redact`
2. **`.mneme/config.json`** — per-repo settings
3. **Environment variables** (lowest) — `MNEME_NO_LLM`, `OPENAI_API_KEY`, `GITHUB_TOKEN`

═══════════════════════════════════════════════════════════════════════════════

## `.mneme/config.json`

Created by `mneme init`. Default contents:

```json
{
  "schemaVersion": 3,
  "embeddings": {
    "provider": "auto",
    "model": null,
    "baseUrl": null
  },
  "index": {
    "since": null,
    "maxCount": 5000
  },
  "incidents": {},
  "webPort": 4711,
  "deterministic": false
}
```

### `embeddings.provider`

| Value | Behavior |
|---|---|
| `auto` (default) | Probe Ollama → OpenAI → hash, in that order |
| `ollama` | Force Ollama (errors if not reachable) |
| `openai` | Force OpenAI (errors if no API key) |
| `hash` | Force hash fallback (no network, deterministic, lower quality) |

### `embeddings.model`

Override the default model name:

- Ollama default: `nomic-embed-text` (274MB, fast on CPU)
- OpenAI default: `text-embedding-3-small`
- Hash default: `fnv-256` (256-dim FNV-1a hash projection)

### `embeddings.baseUrl`

Override the API endpoint:

- Ollama default: `http://localhost:11434`
- OpenAI default: `https://api.openai.com/v1`

For self-hosted Ollama clusters or LiteLLM proxies, set this.

### `index.since` / `index.maxCount`

Limit indexing scope:

```json
{ "index": { "since": "2024-01-01", "maxCount": 10000 } }
```

### `deterministic`

When `true`, every LLM-touching command refuses to run or falls back to a non-LLM path. For air-gapped, regulated, or strictly reproducible environments. Equivalent to passing `--no-llm` on every command.

═══════════════════════════════════════════════════════════════════════════════

## Environment variables

| Variable | Purpose |
|---|---|
| `OPENAI_API_KEY` | Enables the OpenAI embedder + LLM enricher |
| `GITHUB_TOKEN` | Hydrates PR/issue bodies for private GitHub repos |
| `GITLAB_TOKEN` | Hydrates MR bodies for GitLab |
| `MNEME_NO_LLM` | `1` or `true` — same as `--no-llm` on every command |
| `MNEME_DEBUG` | `1` — verbose logs (tokens redacted) |
| `NO_COLOR` | `1` — disable terminal colors (CI / piped output) |

═══════════════════════════════════════════════════════════════════════════════

## Token storage

Tokens are NEVER logged. Stored in `.mneme/secrets/`:

```
.mneme/secrets/
├── openai.txt       (mode 0600, gitignored)
├── github.txt
├── gitlab.txt
├── sentry.txt
└── datadog.txt
```

The whole `.mneme/secrets/` is in the [`.gitignore`](https://github.com/patsa2561-art/mneme-ai/blob/main/.gitignore) template that `mneme init` writes.

═══════════════════════════════════════════════════════════════════════════════

## Redaction

`mneme index` redacts secrets BEFORE storing chunk text or sending to a remote embedder. Default rules:

- AWS access keys (`AKIA...`)
- GitHub PATs (`ghp_...`, `github_pat_...`)
- GitLab PATs (`glpat-...`)
- OpenAI / Anthropic / Stripe / Slack / Google API keys
- npm tokens
- JWTs
- PEM private keys
- Bearer tokens

CLI flags:

| Flag | Behavior |
|---|---|
| (default) | Built-in 12 high-confidence rules ON |
| `--no-redact` | Disable redaction (escape hatch — only for trusted internal repos) |
| `--aggressive-redact` | Add lower-confidence rules: `password=...`, long hex blobs |

See [Privacy and Security](Privacy-and-Security) for the full threat model.

═══════════════════════════════════════════════════════════════════════════════

## Watch (Wisdom Mutant Engine)

`mneme watch` runs a 24/7 daemon. Defaults:

- **Re-index** on every `.git/HEAD` change (debounced 1.5s)
- **Calibrate** search knobs every 1 hour against feedback
- **Self-eval** every 24 hours, write a row to `wisdom_eval_run`

Override via:

```bash
mneme watch --calibrate-ms 600000 --self-eval-ms 3600000 --quiet
```
