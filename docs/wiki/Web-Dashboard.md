# 🌐 The Mneme Web Dashboard

> *The Nervous System Live — drag, drop, time-scrub. No login, no upload, no backend.*

═══════════════════════════════════════════════════════════════════════════════

## 🎯 What it is

A **single-page browser app** that visualizes the nervous-system data Mneme produces — the same data the CLI emits via `mneme nervous-system --json`, but interactive.

**Live demo:** **[https://patsa2561-art.github.io/mneme-ai/](https://patsa2561-art.github.io/mneme-ai/)** — public showcase loaded with a 7-author / 9-pair synthetic team.

**Three views, one toggle in the header:**

| View | What you see |
|---|---|
| 🧬 **Nervous System** | D3 force-directed graph — authors as nodes (size = knowledge mass, color = atrophy), telepathy as edges (thickness = score). Drag, zoom, click → passport drill-down. |
| ⏳ **Atrophy heatmap** | File × author matrix shaded by knowledge score (0..1). Click a row → highlight knowers; click a column → highlight files known. |
| 👑 **Influence ladder** | Animated PageRank bars; expandable rows show originated patterns + adopters. |

═══════════════════════════════════════════════════════════════════════════════

## 🎬 The headline innovation — Time Scrubber

A horizontal slider above the graph. **Drag to rewind your repo's state.**

- Authors who joined later **fade in**
- Telepathic edges **form and dissolve** based on the time window
- Atrophy **refreshes** at the scrubbed timestamp (not "now")
- ▶ Play button: animates earliest → today over 12 seconds

60fps via `requestAnimationFrame` + GPU-composited transforms. Keyboard nav (arrows / Home / End / Space). **No other git tool ships temporal nervous-system playback.**

═══════════════════════════════════════════════════════════════════════════════

## 🚀 Three ways to view *your own* repo

### 🅰 Hosted page + drop-zone — zero install

Open [the live demo](https://patsa2561-art.github.io/mneme-ai/) → click **"📥 Drop a file"** → drop your own `mneme nervous-system --json` output.

```bash
# in your indexed repo:
mneme nervous-system --json > my-team.json
# then drag-drop my-team.json onto the live page
```

**Privacy:** the file is parsed in your browser via the `FileReader` API. Zero outbound requests. **Nothing is uploaded.** Close the tab and the data is gone.

### 🅱 `mneme dashboard` — the local UI

If you have Mneme installed:

```bash
mneme dashboard                      # opens http://localhost:3737/
mneme dashboard --port 4040          # custom port
mneme dashboard --no-open            # skip launching the browser
mneme dashboard --data my-data.json  # use a pre-computed JSON
```

The CLI command:
1. Computes `buildNervousSystem` against your local `.mneme/mneme.db`
2. Writes `.mneme/dashboard-data.json`
3. Spins a zero-dependency Node `http` server
4. Opens your default browser pointed at the SPA

100% offline. Same UI, no internet required.

### 🅲 VS Code extension webview

Install the [Mneme VS Code extension](VS-Code-Extension), then `Ctrl+Shift+P` → `Mneme: Open Nervous System` — the dashboard renders inside an editor webview, pointed at your workspace's data.

═══════════════════════════════════════════════════════════════════════════════

## 📥 Install

The dashboard ships **bundled with Mneme**. Installing the CLI gives you `mneme dashboard`:

```bash
npm install -g mneme-ai
cd <any indexed repo>
mneme index            # ~90s for 5k commits — one time
mneme dashboard
```

For the **live demo** (no install): just open [https://patsa2561-art.github.io/mneme-ai/](https://patsa2561-art.github.io/mneme-ai/).

═══════════════════════════════════════════════════════════════════════════════

## 🔒 Privacy posture

- **No backend.** The dashboard is static JS + CSS + a `demo.json` fixture, hosted on GitHub Pages. There is no server-side storage, no database, no analytics.
- **No login.** No accounts, no per-user state. Everyone sees the same demo by default.
- **Drop-file mode is browser-only.** `FileReader` parses JSON locally; the page makes zero network requests after the initial asset load.
- **`mneme dashboard` is fully offline** — it spawns a local `http` server on `127.0.0.1`. No external services touched.
- **No telemetry.** No usage tracking, no opt-in/out — it just doesn't exist.

═══════════════════════════════════════════════════════════════════════════════

## 🛠 Build it locally

The dashboard source lives at `packages/web/` in the [main Mneme repo](https://github.com/patsa2561-art/mneme-ai/tree/main/packages/web):

```bash
git clone https://github.com/patsa2561-art/mneme-ai.git
cd mneme-ai && npm install
npm run build --workspace=@mneme-ai/web
# → produces packages/web/dist/ (~82 KB gzipped)
```

For development with hot-reload:

```bash
cd packages/web
npm run dev      # vite dev server
```

Stack: Vite 5 + React 18 + D3.js v7 + TypeScript strict. Self-contained — no external CDN, system-font stack only. Bundle size: **~82 KB gzipped total**.

═══════════════════════════════════════════════════════════════════════════════

## 🗺 When to use which mode

| Scenario | Recommended mode |
|---|---|
| 👀 **First time hearing about Mneme** — want to see what it does | 🅰 Live demo (no install) |
| 📊 **CTO / board meeting** — need to present team analytics | 🅱 `mneme dashboard` locally OR 🅰 live demo + drop-file |
| 💻 **Daily editing** — want context inline as you read code | 🅲 VS Code extension |
| 🔁 **Quarterly review** — share a frozen snapshot with the team | 🅱 generate JSON, drop into 🅰 in a meeting |
| 🛠 **CI artifact** — attach to a PR for non-technical reviewers | `mneme nervous-system --html` (separate flow — a self-contained HTML file) |

═══════════════════════════════════════════════════════════════════════════════

## 📖 Related

- 🧬 **[[Mneme-Nervous-System]]** — the underlying data model + PDF flagship
- 👥 **[[People-Analytics]]** — the six analyzers the dashboard composes
- 📝 **[[VS-Code-Extension]]** — the editor companion (renders the same dashboard in a webview)
- 🔌 **[[Public-API]]** — `@mneme-ai/core/public` — the stable surface external integrations call
- 🏠 **[Repo source · `packages/web/`](https://github.com/patsa2561-art/mneme-ai/tree/main/packages/web)**
