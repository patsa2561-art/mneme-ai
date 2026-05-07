/**
 * Nervous System webview — embeds the @mneme-ai/web dashboard.
 *
 * The dashboard is built as a static React bundle in `packages/web/dist/`.
 * We open a `WebviewPanel`, rewrite asset URLs through
 * `webview.asWebviewUri`, and post the repo's nervous-system data
 * via `postMessage`. CSP is nonce-based — no unsafe-eval, no remote CDN.
 */

import * as vscode from "vscode";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { rewriteHtml, makeNonce } from "../util/render.js";

export { rewriteHtml };

export function openNervousSystem(repoRoot: string | null): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    "mneme.nervousSystem",
    "Mneme — Nervous System",
    vscode.ViewColumn.Active,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: collectResourceRoots(repoRoot),
    },
  );

  const distDir = repoRoot ? join(repoRoot, "packages", "web", "dist") : null;
  if (!distDir || !existsSync(join(distDir, "index.html"))) {
    panel.webview.html = renderMissingDashboard();
    return panel;
  }

  const html = readFileSync(join(distDir, "index.html"), "utf8");
  const nonce = makeNonce();
  panel.webview.html = rewriteHtml(html, panel.webview, vscode.Uri.file(distDir), nonce);

  // Best-effort dashboard data injection — if the user hasn't run the
  // export yet, the bundle falls back to its own demo.json.
  if (repoRoot) {
    const dataPath = join(repoRoot, ".mneme", "dashboard-data.json");
    if (existsSync(dataPath)) {
      try {
        const payload = JSON.parse(readFileSync(dataPath, "utf8"));
        // Wait one tick so the bundle's `message` listener is wired.
        setTimeout(() => {
          panel.webview.postMessage({ type: "data", payload });
        }, 250);
      } catch {
        // ignore — bundle will use its built-in demo
      }
    }
  }

  return panel;
}

function collectResourceRoots(repoRoot: string | null): vscode.Uri[] {
  if (!repoRoot) return [];
  return [vscode.Uri.file(join(repoRoot, "packages", "web", "dist"))];
}

function renderMissingDashboard(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Mneme — Nervous System</title>
<style>
  body { font: 14px/1.6 -apple-system, "Segoe UI", sans-serif; background:#0b0b14; color:#e5e7eb; padding:48px; }
  h1 { font-size: 22px; margin-top: 0; }
  code { background:#1f2937; padding:2px 6px; border-radius:4px; }
</style></head>
<body>
  <h1>Mneme — Nervous System</h1>
  <p>The dashboard bundle isn't built yet in this workspace.</p>
  <p>From your repo root, run:</p>
  <pre><code>npm run build --workspace=@mneme-ai/web</code></pre>
  <p>Then re-open this panel. Mneme will load the local React bundle and post your repo's nervous-system data to it.</p>
</body></html>`;
}
