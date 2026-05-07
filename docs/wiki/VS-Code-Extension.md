# VS Code Extension

The official Mneme companion for Visual Studio Code. Surfaces the same memory layer that powers `mneme ask`, `mneme audit`, and the Nervous System dashboard — directly above the code you're editing.

> **Headline:** the **Atrophy Lens**. Above every function and class, a one-line plain-English read of how decayed your team's knowledge of that file is.

---

## Install

```bash
# 1. The CLI (so the extension can call mneme ask / mneme audit)
npm install -g mneme-ai

# 2. Index your repo (one-time, ~90s for 5k commits)
cd <your repo>
mneme index

# 3. The extension — search "Mneme" in the Marketplace, or:
code --install-extension mneme-vscode-0.31.0.vsix
```

The extension activates on startup and searches each workspace folder for `.mneme/mneme.db`. If none is found, the sidebar shows a single hint — never a popup or error.

---

## What you see

### Atrophy Lens (the headline)

Above every TypeScript / JavaScript / Python / Go function and class:

```
🟢 fresh — last expert touched 6 days ago (98%)
export function buildPassport(store, opts) { … }

🟡 fading — top knower 41% fresh, last touched 198 days ago — refresh recommended
export class TokenBucket { … }

🔴 ghost — no live expert, deep history lost (4 prior touches)
function legacyMigrationStep() { … }
```

Click any lens → opens the **Atrophy detail** panel for that file: the full table of every author who ever touched it, with their current knowledge score, last-touch days, and touch count.

The math is the same atrophy clock that powers `mneme atrophy --file <path>` — Ebbinghaus decay over (author × file). No LLM, no per-repo tuning.

<!-- screenshot: docs/screenshots/atrophy-lens.png -->

### Sidebar

The **Mneme** view in the Explorer has three sections:

- **🛡 Audit** — last 5-axis verdict, or a hint to capture a baseline first.
- **⏳ At-risk files** — top 5 files where every remaining knower is fading. Click → opens the file.
- **👤 My passport** — current author's knowledge mass + top 3 expertise files.

<!-- screenshot: docs/screenshots/sidebar.png -->

### Status bar

A single badge at the bottom-left:

| Badge | Meaning |
|---|---|
| `$(check) Mneme · pass` | Last AI session audit was clean. |
| `$(warning) Mneme · warn` | At least one axis needs review. |
| `$(error) Mneme · fail` | The AI's narrative contradicted the diff. |
| `$(info) Mneme · idle` | No audit run yet — capture a baseline. |

Click the badge → re-runs **Mneme: Audit current PR**.

---

## Commands

Open the Command Palette (`Cmd/Ctrl+Shift+P`) and type **Mneme**:

| Command | What it does |
|---|---|
| `Mneme: Ask…` | Opens an input box; runs `mneme ask --json` and renders the cited answer in a Markdown preview. |
| `Mneme: Why this line` | Uses the cursor position; runs `mneme why <file>:<line> --json`; opens the explanation alongside the editor. |
| `Mneme: Audit current PR` | Runs `mneme audit --certify --json`; surfaces the verdict via a notification matched to severity (info / warn / error). |
| `Mneme: Open Nervous System` | Opens the local React dashboard in a webview, with your repo's data injected via `postMessage`. |
| `Mneme: Refresh` | Re-reads `.mneme/mneme.db` and re-renders all lenses. |
| `Mneme: Atrophy detail for current file` | Opens the full per-file knower table for the active editor. |

---

## Settings

| Setting | Default | What it controls |
|---|---|---|
| `mneme.cliPath` | `mneme` | Path to the `mneme` binary. Leave default if it's on `PATH`. |
| `mneme.atrophyLens.enabled` | `true` | Toggle the per-function Atrophy Lens. |
| `mneme.atrophyLens.halfLifeDays` | `180` | Half-life in days for the knowledge-decay curve. After this many days, knowledge decays to ~50%. |

---

## How the Atrophy Lens stays fast

- Per-file results are cached in a 32-entry LRU with a 60-second TTL.
- Recomputation only happens on document save, debounced 1 second — never on cursor movement.
- Symbol detection is regex-only (TS/JS/Py/Go) and runs in < 5 ms even on 5,000-line files. Edge cases are accepted: the lens is a hint, not a refactor tool.

---

## Privacy

- No telemetry. No remote calls.
- Reads `.mneme/mneme.db` (SQLite, local).
- Shells out to the local `mneme` CLI for `ask` / `why` / `audit`.
- The Nervous System webview loads only the bundled `packages/web/dist/` — no remote CDN, strict nonce-based CSP, no `unsafe-eval`.

---

## Source

The package lives in the [Mneme monorepo](https://github.com/patsa2561-art/mneme-ai) under `packages/vscode/`.
