<div align="center">

<h1>μνήμη · Mneme for VS Code</h1>

<p><b><i>What your codebase already knows — now in your editor.</i></b></p>

<p>
  <img src="https://img.shields.io/badge/vscode--marketplace-pre--publish-7c3aed?logo=visualstudiocode" alt="marketplace">
  <img src="https://img.shields.io/badge/license-MIT-blue" alt="license">
  <img src="https://img.shields.io/badge/local--first-yes-2da44e" alt="local-first">
  <img src="https://img.shields.io/badge/no--api--key--required-yes-2da44e" alt="no-key">
  <a href="https://github.com/patsa2561-art/mneme-ai"><img src="https://img.shields.io/badge/source-github-181717?logo=github" alt="github"></a>
</p>

</div>

> The bug came back. The fix from 2022 is in a commit nobody remembers. The author left.
>
> **Mneme finds it in 50ms — with the diff, the rationale, and the related commits.**

This is the official VS Code companion for [Mneme](https://github.com/patsa2561-art/mneme-ai), the local-first memory layer that turns your git history into a queryable knowledge graph. The extension surfaces Mneme's signals **right where you write code**:

- **Atrophy Lens** above every function and class — a one-line read of how decayed your team's knowledge of that file is.
- **Sidebar tree** with audit verdict, at-risk files, and your own author passport.
- **Status bar** showing the latest AI-session audit verdict.
- **Palette commands** for ask, why-this-line, audit, and the Nervous System dashboard.

Mneme does not ship telemetry. It does not require an API key. It is a library, not a librarian — your editor stays the boss.

---

## The headline — Atrophy Lens

```typescript
🟢 fresh — last expert touched 6 days ago (98%)
export function buildPassport(store, opts) {
  ...
}

🟡 fading — top knower 41% fresh, last touched 198 days ago — refresh recommended
export class TokenBucket {
  ...
}

🔴 ghost — no live expert, deep history lost (4 prior touches)
function legacyMigrationStep(): void {
  ...
}
```

Every lens is a single line of plain English. No charts to read. No dashboards to click through. You scroll a file, and you instantly know which functions still live in someone's head — and which ones are about to take half a day to relearn.

The math is the [Mneme atrophy clock](https://github.com/patsa2561-art/mneme-ai/wiki/People-Analytics): an Ebbinghaus decay over (author × file) pairs from your git history. Pure data, no LLM, no heuristics tuned per repo.

<!-- screenshot: docs/screenshots/atrophy-lens.png — Atrophy Lens above three real functions -->

---

## Install

1. Install the [Mneme CLI](https://www.npmjs.com/package/mneme-ai) globally so the extension can call `mneme ask` / `mneme audit`:
   ```bash
   npm install -g mneme-ai
   ```
2. Index your repo (one-time, ~90s for 5k commits):
   ```bash
   cd <your repo>
   mneme index
   ```
3. Install this extension from the VS Code Marketplace (search **"Mneme"**), or from a `.vsix`:
   ```bash
   code --install-extension mneme-vscode-0.31.0.vsix
   ```

The extension activates on startup and looks for `.mneme/mneme.db` in each workspace folder. If it doesn't find one, the sidebar shows a single hint — no errors, no popups.

---

## Commands

Open the Command Palette (`Cmd/Ctrl+Shift+P`) and type **Mneme**:

| Command | What it does |
|---|---|
| **Mneme: Ask…** | Asks Mneme a question; opens a Markdown preview with the cited answer. Refuses cleanly if it can't cite. |
| **Mneme: Why this line** | Pulls the PR + commit that introduced the line under the cursor. |
| **Mneme: Audit current PR** | Runs the 5-axis trust certificate against your latest changes. |
| **Mneme: Open Nervous System** | Loads the local React dashboard in a webview, with your repo's data. |
| **Mneme: Refresh** | Re-reads the DB and re-renders all lenses. |
| **Mneme: Atrophy detail for current file** | Opens the full per-file knower table. |

---

## Sidebar

The **Mneme** view in the Explorer has three sections:

- **🛡 Audit** — last 5-axis verdict (or a hint to capture a baseline first).
- **⏳ At-risk files** — top 5 files where every remaining knower is fading. Click → opens the file.
- **👤 My passport** — your author dossier headline. Click → opens the Nervous System dashboard.

<!-- screenshot: docs/screenshots/sidebar.png — three sections expanded -->

---

## Status bar

A single badge at the bottom-left:

- `$(check) Mneme · pass` — last audit was clean.
- `$(warning) Mneme · warn` — at least one axis needs review.
- `$(error) Mneme · fail` — the AI's narrative contradicted the diff.
- `$(info) Mneme · idle` — no audit run yet.

Click the badge to re-run **Mneme: Audit current PR**.

---

## Settings

| Setting | Default | What it controls |
|---|---|---|
| `mneme.cliPath` | `mneme` | Path to the `mneme` binary. Leave default if it's on `PATH`. |
| `mneme.atrophyLens.enabled` | `true` | Toggle the per-function Atrophy Lens. |
| `mneme.atrophyLens.halfLifeDays` | `180` | Half-life in days for the knowledge-decay curve. After this many days, knowledge decays to ~50%. |

---

## Privacy

The extension talks to **only** two things:

1. The `.mneme/mneme.db` SQLite file in your workspace (read-only).
2. The `mneme` CLI on your machine, invoked locally with no network calls.

No telemetry. No remote calls. No API key required.

---

## Performance

- **Atrophy Lens** is debounced 1 second after a save. Per-file results are cached with a 32-entry LRU and a 60-second TTL.
- **Sidebar** is populated lazily on activation and on `Mneme: Refresh`.
- **Webview CSP** is nonce-based — no `unsafe-eval`, no remote resources.

A 5,000-line TypeScript file renders its lenses in under 5 ms (parsing) plus one SQLite query per file (cached afterwards).

---

## Contributing

This package lives in the [Mneme monorepo](https://github.com/patsa2561-art/mneme-ai) under `packages/vscode/`. Issues and PRs welcome.

```bash
# from the monorepo root
npm install
npm run build --workspace=@mneme-ai/core
cd packages/vscode
npm run build
code --extensionDevelopmentPath=$PWD .
```

## License

MIT. See [LICENSE](./LICENSE).
