# Contributing to Mneme

Thank you for considering a contribution. Mneme is a small project with big ambitions, and PRs are very welcome — especially in the areas listed below.

## Quick start

```bash
# fork & clone
git clone https://github.com/<your-fork>/mneme.git
cd mneme

# install + build
npm install
npm run build

# point the binary at any local repo
cd /some/git/repo
node /path/to/mneme/packages/cli/bin/mneme.js init
node /path/to/mneme/packages/cli/bin/mneme.js index
node /path/to/mneme/packages/cli/bin/mneme.js ask "..."
```

Requirements: **Node ≥ 20**, **git ≥ 2.30**. For semantic search install **[Ollama](https://ollama.com)** and `ollama pull nomic-embed-text`.

## Development workflow

```bash
npm run build:watch   # incremental TypeScript build across all packages
npm run dev -- --help # run the CLI from source
```

The repo is a TypeScript monorepo with project references. Build order:

```
core ← embeddings ← mcp ← cli
            ↑
         correlator
```

Adding a new file? Place it inside the relevant package's `src/` and re-run `npm run build`.

## What we love PRs for

| Area | Why it matters |
|---|---|
| **Phase 3 adapters** — Sentry, Datadog, GitHub Actions, custom logs | This is the moat — error correlation. Every adapter unlocks a new market. |
| **`gh` / GitHub REST adapter for PR & issue bodies** | The single biggest quality jump for `ask` quality. |
| **Tree-sitter entity parser** (phase 2) | Unlocks semantic clone detection. |
| **`sqlite-vec` integration** | Lets Mneme scale past 1M chunks. |
| **Tests** | Especially around the RRF fusion math, the parser edge cases, and the temporal correlation engine. |
| **Bug reports with reproductions** | A failing test is the most valuable bug report. |

## Style

- TypeScript strict mode, no `any` unless commented.
- Default to *no comments*. Code should explain what; comments only explain *why* when non-obvious.
- Public APIs live in each package's `src/index.ts` — keep the surface small and stable.
- Schema additions are append-only (never break existing tables — see `packages/core/src/store/schema.ts`).

## Commit messages

We're a tool that reads commit messages. We try to write good ones.

```
phase3(sentry): map issue.firstSeen to Incident.occurredAt

Sentry's `firstSeen` is the first event timestamp; `dateCreated` is the
issue creation time. The former is what we want for temporal correlation.
Refs #42.
```

Bad commit messages aren't a deal-breaker but rich PR descriptions definitely help.

## Filing issues

When opening an issue, please include:

1. Mneme version (`mneme --version`)
2. Output of `mneme status` (redacted as needed)
3. Node + git versions
4. A minimal reproduction or the smallest repo where it fails

For phase-3 / correlation issues, include the adapter you're using and the time window.

## Code of conduct

Be kind. Be specific. Don't ship code you wouldn't want to inherit.

## License

All contributions are accepted under the [MIT license](./LICENSE).
