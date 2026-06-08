/**
 * Mneme VS Code extension entry point.
 *
 * Activation flow:
 *   1. Try to attach to a workspace with `.mneme/mneme.db`.
 *   2. Register sidebar (always — degrades gracefully when no DB).
 *   3. Register status bar item (idle until first audit).
 *   4. Register Atrophy Lens code-lens provider for TS/JS/Py/Go.
 *   5. Register hover provider that re-uses the lens cache.
 *   6. Wire the four palette commands.
 *   7. Refresh on save (debounced 1s) and on `mneme.refresh`.
 *
 * Graceful degradation:
 *   - No workspace open                → sidebar shows the no-db hint.
 *   - Workspace exists but no .mneme/  → same.
 *   - DB exists but core fails to load → sidebar shows the no-db hint;
 *                                         lenses emit nothing; status idle.
 *   - DB exists and core loads         → all features wire up.
 *
 * No top-level errors are ever surfaced to the user — Mneme is meant
 * to be a calm background presence.
 */

import * as vscode from "vscode";
import type { AuditCertificate, FileKnowledge } from "@mneme-ai/core/public";
import { attachWorkspace, type ResolvedWorkspace } from "./store.js";
import { MnemeSidebar } from "./views/sidebar.js";
import {
  createAtrophyLensProvider,
  relativeToRepo,
} from "./lenses/atrophyLens.js";
import { createWhyHoverProvider } from "./hovers/whyHover.js";
import { formatVerdict } from "./status/statusBarItem.js";
import { runAsk } from "./commands/ask.js";
import { runWhy } from "./commands/why.js";
import { runAudit } from "./commands/audit.js";
import { runNervousSystem } from "./commands/nervousSystem.js";
import { runImpactRadar } from "./commands/impactRadar.js";

let active: ResolvedWorkspace | null = null;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const sidebar = new MnemeSidebar();
  const treeView = vscode.window.createTreeView("mneme.sidebar", { treeDataProvider: sidebar });
  context.subscriptions.push(treeView);

  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  status.command = "mneme.audit";
  status.show();
  context.subscriptions.push(status);

  // Best-effort attach. Failure → degraded mode.
  active = await attachWorkspace(vscode.workspace.workspaceFolders);
  context.subscriptions.push({
    dispose: () => {
      try {
        active?.store.close();
      } catch {
        // ignore
      }
    },
  });

  const lens = createAtrophyLensProvider({
    vscode,
    isEnabled: () =>
      vscode.workspace.getConfiguration("mneme").get<boolean>("atrophyLens.enabled", true),
    getRepoRoot: () => active?.repoRoot ?? null,
    lookupAtrophy: (rel) => {
      if (!active) return null;
      const halfLifeDays =
        vscode.workspace.getConfiguration("mneme").get<number>("atrophyLens.halfLifeDays", 180);
      try {
        const result = active.api.atrophyForFile(active.store, rel, { halfLifeDays });
        return (result ?? null) as FileKnowledge | null;
      } catch {
        return null;
      }
    },
  });

  context.subscriptions.push(
    vscode.languages.registerCodeLensProvider(
      [
        { language: "typescript" },
        { language: "javascript" },
        { language: "typescriptreact" },
        { language: "javascriptreact" },
        { language: "python" },
        { language: "go" },
      ],
      lens.provider,
    ),
  );

  // Hover provider — peeks at the lens cache only.
  context.subscriptions.push(
    vscode.languages.registerHoverProvider(
      [
        { language: "typescript" },
        { language: "javascript" },
        { language: "typescriptreact" },
        { language: "javascriptreact" },
        { language: "python" },
        { language: "go" },
      ],
      createWhyHoverProvider({
        peekAtrophy: (rel) => lens.cache.get(rel),
        toRelativePath: (fsPath) =>
          active ? relativeToRepo(active.repoRoot, fsPath) : null,
      }),
    ),
  );

  // ─── Palette commands ────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("mneme.ask", () =>
      runAsk(active?.repoRoot ?? null, getCliPath()),
    ),
    vscode.commands.registerCommand("mneme.why", () =>
      runWhy(active?.repoRoot ?? null, getCliPath()),
    ),
    vscode.commands.registerCommand("mneme.audit", () =>
      runAudit(active?.repoRoot ?? null, getCliPath(), (verdict) => {
        const stub: AuditCertificate | null =
          verdict === "idle"
            ? null
            : ({
                sessionId: "",
                capturedAt: new Date().toISOString(),
                overallVerdict: verdict,
                exitCode: verdict === "fail" ? 1 : 0,
                axes: {} as AuditCertificate["axes"],
                forensicAxes: { size: "pass", files: "pass", style: "pass", time: "pass" },
              } satisfies AuditCertificate);
        const badge = formatVerdict(stub);
        status.text = badge.text;
        status.tooltip = badge.tooltip;
        status.backgroundColor = badge.backgroundColor
          ? new vscode.ThemeColor(badge.backgroundColor)
          : undefined;
      }),
    ),
    vscode.commands.registerCommand("mneme.nervousSystem", () =>
      runNervousSystem(active?.repoRoot ?? null),
    ),
    vscode.commands.registerCommand("mneme.impactRadar", () =>
      runImpactRadar(active?.repoRoot ?? null),
    ),
    vscode.commands.registerCommand("mneme.refresh", async () => {
      lens.cache.clear();
      lens.refresh();
      await refreshSidebar(sidebar, status);
    }),
    vscode.commands.registerCommand("mneme.openAtrophyDetail", (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target || !active) return;
      const rel = relativeToRepo(active.repoRoot, target.fsPath);
      const result = lens.cache.get(rel);
      const md = renderAtrophyDetail(rel, result ?? null);
      vscode.workspace.openTextDocument({ content: md, language: "markdown" }).then((doc) => {
        vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
      });
    }),
  );

  // ─── Save → debounce 1s → refresh lens for that file ───────────────
  let saveTimer: NodeJS.Timeout | undefined;
  context.subscriptions.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (!active) return;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(() => {
        const rel = relativeToRepo(active!.repoRoot, doc.uri.fsPath);
        // Drop the cache entry only — don't recompute eagerly; the
        // provider will repopulate on next render.
        // (LruCache doesn't expose delete; clearing is fine for a single
        // saved file because the cache is small.)
        lens.cache.clear();
        lens.refresh();
        void rel;
      }, 1_000);
    }),
  );

  // First paint.
  await refreshSidebar(sidebar, status);
}

export function deactivate(): void {
  try {
    active?.store.close();
  } catch {
    // ignore
  }
  active = null;
}

function getCliPath(): string {
  return vscode.workspace.getConfiguration("mneme").get<string>("cliPath", "mneme");
}

async function refreshSidebar(
  sidebar: MnemeSidebar,
  status: vscode.StatusBarItem,
): Promise<void> {
  if (!active) {
    sidebar.setData({
      hasDb: false,
      hasBaseline: false,
      certificate: null,
      atrophy: null,
      passport: null,
    });
    const idle = formatVerdict(null);
    status.text = idle.text;
    status.tooltip = idle.tooltip;
    return;
  }

  let certificate: AuditCertificate | null = null;
  let hasBaseline = false;
  try {
    const baseline = active.api.loadBaseline(active.repoRoot);
    hasBaseline = baseline != null;
  } catch {
    hasBaseline = false;
  }

  // Try to pull a cached certificate from disk.
  try {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const certPath = path.join(active.repoRoot, ".mneme", "audit", "certificate.json");
    if (fs.existsSync(certPath)) {
      certificate = JSON.parse(fs.readFileSync(certPath, "utf8")) as AuditCertificate;
    }
  } catch {
    certificate = null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let atrophyReport: any = null;
  try {
    atrophyReport = active.api.atrophy(active.store, { topN: 5 });
  } catch {
    atrophyReport = null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let passport: any = null;
  try {
    const built = await active.api.buildPassport(active.store, { cwd: active.repoRoot });
    if (built && typeof built === "object") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b = built as any;
      passport = {
        name: b?.author?.name ?? b?.name ?? "(unknown)",
        email: b?.author?.email ?? b?.email ?? "",
        knowledgeMass: b?.atrophy?.knowledgeMass ?? b?.knowledgeMass,
        topFiles: b?.atrophy?.topFiles ?? b?.topFiles ?? [],
      };
    }
  } catch {
    passport = null;
  }

  sidebar.setData({
    hasDb: true,
    hasBaseline,
    certificate,
    atrophy: atrophyReport,
    passport,
  });

  const badge = formatVerdict(certificate);
  status.text = badge.text;
  status.tooltip = badge.tooltip;
  status.backgroundColor = badge.backgroundColor
    ? new vscode.ThemeColor(badge.backgroundColor)
    : undefined;
}

function renderAtrophyDetail(rel: string, file: FileKnowledge | null): string {
  const out: string[] = [];
  out.push(`# Mneme — atrophy detail for \`${rel}\``);
  out.push("");
  if (!file) {
    out.push("No commit history for this file yet — Mneme has nothing to score.");
    return out.join("\n");
  }
  out.push(`**Tier:** ${file.tier} · **Total touches:** ${file.totalTouches} · **Live experts:** ${file.liveExperts.length}`);
  out.push("");
  out.push("## Who still knows this file");
  out.push("");
  out.push("| Expert | Email | Knowledge | Last touch (days) | Touches |");
  out.push("| --- | --- | ---: | ---: | ---: |");
  for (const e of file.allKnowers) {
    const pct = Math.round(e.knowledge * 100);
    out.push(`| ${e.name} | \`${e.email}\` | ${pct}% | ${Math.round(e.lastTouchDaysAgo)} | ${e.touchCount} |`);
  }
  return out.join("\n");
}
