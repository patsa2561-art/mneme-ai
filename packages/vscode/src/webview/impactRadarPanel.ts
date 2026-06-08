/**
 * 🛰 Impact Radar webview — show the cross-layer graph (code ↔ data ↔ api ↔ business) for the
 * workspace, focused on a function in the ACTIVE file. The radar HTML from @mneme-ai/core is fully
 * self-contained (inline SVG + JS, no network), so we set it straight as the webview HTML — only a
 * CSP meta is injected to allow the inline script/style inside the sandboxed webview.
 */
import * as vscode from "vscode";
import { crossLayerGraph } from "@mneme-ai/core";
import { readdirSync, statSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";

const SKIP = new Set(["node_modules", ".git", "dist", "build", "out", ".next", "coverage", ".mneme", "vendor"]);
const EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rs|rb|prisma|sql|md|mdx|markdown|txt)$/i;
function scan(root: string, cap = 4000): crossLayerGraph.SourceFile[] {
  const files: crossLayerGraph.SourceFile[] = []; const stack = [root];
  while (stack.length && files.length < cap) {
    const d = stack.pop() as string; let ents: string[] = []; try { ents = readdirSync(d); } catch { continue; }
    for (const e of ents) { if (SKIP.has(e)) continue; const p = join(d, e); let st; try { st = statSync(p); } catch { continue; } if (st.isDirectory()) stack.push(p); else if (EXT.test(e) && st.size < 600_000) { try { files.push({ path: p.slice(root.length + 1), content: readFileSync(p, "utf8") }); } catch { /* */ } } }
  }
  return files;
}

const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; img-src data:;">`;

export function openImpactRadar(repoRoot: string | null, activeFilePath?: string): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel("mneme.impactRadar", "Mneme — Impact Radar", vscode.ViewColumn.Beside, { enableScripts: true, retainContextWhenHidden: true });
  if (!repoRoot) { panel.webview.html = `<body style="font:14px sans-serif;padding:24px;color:#ccc;background:#0b1220"><h3>🛰 Impact Radar</h3><p>Open a folder/workspace to map its cross-layer graph.</p></body>`; return panel; }
  try {
    const g = crossLayerGraph.buildCrossLayerGraph(scan(repoRoot));
    // focus on the first function defined in the active file; else open the project overview (galaxy)
    let focusId: string | undefined;
    if (activeFilePath) {
      const rel = relative(repoRoot, activeFilePath).replace(/\\/g, "/");
      const fn = g.nodes.find((n) => n.type === "function" && (n.file || "").replace(/\\/g, "/") === rel);
      focusId = fn?.id;
    }
    const title = focusId ? `Impact Radar — ${activeFilePath ? activeFilePath.split(/[\\/]/).pop() : ""}` : "Impact Radar — project overview";
    const html = crossLayerGraph.toRadarHtml(g, focusId, { title, overview: !focusId });
    panel.webview.html = html.replace("<head>", `<head>${CSP}`);
  } catch (e) {
    panel.webview.html = `<body style="font:14px sans-serif;padding:24px;color:#f99;background:#0b1220"><h3>🛰 Impact Radar</h3><p>Could not build the graph: ${String((e as Error).message).replace(/[<>&]/g, "")}</p></body>`;
  }
  return panel;
}
