# Mneme Web Dashboard

> *The Nervous System Live — visual face of `@mneme-ai`.*

Self-contained single-page app (Vite + React + D3) that renders the
[Nervous System data](../../docs/wiki/Mneme-Nervous-System.md) live
in your browser.

## Live demo

**https://patsa2561-art.github.io/mneme-ai/**

Click **"🎬 Try the demo"** to load the bundled 7-author / 9-pair
synthetic showcase.

## Three views

- **🧬 Nervous System** — D3 force-directed graph; nodes = authors,
  edges = telepathy, size = knowledge mass, color = atrophy.
- **⏳ Atrophy heatmap** — file × author matrix shaded by knowledge
  score.
- **👑 Influence ladder** — PageRank ranking with expandable rows
  showing originated patterns + adopters.

## The headline innovation — Time Scrubber

A horizontal slider above the graph. **Drag to rewind the repo state.**
As you drag, the force layout re-positions, telepathic edges form and
dissolve, atrophy re-decays. ▶ Play button animates min→max over 12
seconds. Smooth at 60fps via `requestAnimationFrame` + GPU-composited
transforms.

No other git tool ships temporal nervous-system playback.

## Three input modes — local-first

1. **🎬 Try the demo** — bundled `public/demo.json` showcase.
2. **📥 Drop a file** — drag-drop or paste your own `mneme nervous-system --json`
   output. Parsed in the browser via `FileReader` — **never uploaded
   to a server**.
3. **🔗 Load from URL** — paste a hosted JSON URL (CORS permitting).

## Open it on your own repo

```bash
mneme dashboard                      # auto-opens http://localhost:3737
mneme dashboard --port 4040          # custom port
mneme dashboard --no-open            # don't launch the browser
mneme dashboard --data my-data.json  # use an existing JSON file
```

The CLI command spins a zero-dep Node `http` server, computes
`buildNervousSystem` against the local `.mneme/mneme.db`, writes
`.mneme/dashboard-data.json`, and points the SPA at it.

## Build it locally

From the repo root:

```bash
npm install                                      # workspaces install
npm run build --workspace=@mneme-ai/web          # produces packages/web/dist/
```

Or from this folder:

```bash
cd packages/web
npm run dev      # vite dev server with HMR
npm run build    # production bundle (~82 KB gzipped)
npm run preview  # serve dist/ locally
```

## Bundle size

Production build at v0.31.1:

| Asset | Size | Gzipped |
|---|---|---|
| `index.html` | 0.87 KB | 0.47 KB |
| `style.css` | 20.46 KB | 4.73 KB |
| `index.js` | 31.76 KB | 10.61 KB |
| `d3.js` | 61.43 KB | 21.01 KB |
| `react.js` | 140.86 KB | 45.26 KB |
| **Total** | ~255 KB | **~82 KB** |

Self-contained — no external CDN, no runtime backend, system-font stack.

## Privacy posture

- All data stays local. No telemetry, no analytics, no upload.
- The "Drop a file" mode parses the JSON in the browser via
  `FileReader`. Nothing leaves your machine.
- The hosted demo at `patsa2561-art.github.io/mneme-ai/` only
  loads its own bundled `demo.json` — the page makes zero outbound
  requests after the initial asset load.

## Related

- [`Mneme Nervous System` wiki](../../docs/wiki/Mneme-Nervous-System.md) — concept + flagship report
- [`People-Analytics` wiki](../../docs/wiki/People-Analytics.md) — the six analyzers behind the dashboard
- [`Public-API` wiki](../../docs/wiki/Public-API.md) — `@mneme-ai/core/public` exports the dashboard composes
- [Repo root README](../../README.md)
