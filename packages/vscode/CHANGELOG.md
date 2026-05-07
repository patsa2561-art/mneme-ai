# Mneme for VS Code — changelog

## 0.31.0 — "Black Sheep"

First public release.

### Added
- **Atrophy Lens** above every TypeScript / JavaScript / Python / Go function and class — a one-line plain-English read of how decayed your team's knowledge of that file is.
- **Sidebar tree view** with three sections: audit verdict, at-risk files, and the active author's passport.
- **Status bar item** showing the latest AI-session audit verdict (`pass` / `warn` / `fail` / `idle`).
- **Hover provider** that re-uses the lens cache to surface the top knower of the file under the cursor.
- **Palette commands**: `Mneme: Ask…`, `Mneme: Why this line`, `Mneme: Audit current PR`, `Mneme: Open Nervous System`, `Mneme: Refresh`, `Mneme: Atrophy detail for current file`.
- **Nervous System webview** — embeds the local React dashboard (`packages/web/dist/`) with a strict nonce-based CSP and posts repo data via `webview.postMessage`.
- **Settings**: `mneme.cliPath`, `mneme.atrophyLens.enabled`, `mneme.atrophyLens.halfLifeDays`.

### Performance
- Atrophy Lens is debounced 1 second after save; results are cached per file in a 32-entry LRU with a 60-second TTL.

### Privacy
- No telemetry. No remote calls. The extension only reads `.mneme/mneme.db` and shells out to the local `mneme` CLI.
