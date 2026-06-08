/**
 * Mneme: Impact Radar — palette command. Maps the active file into the cross-layer graph and opens
 * the interactive radar (code ↔ data ↔ api ↔ business) in a side panel.
 */
import * as vscode from "vscode";
import { openImpactRadar } from "../webview/impactRadarPanel.js";

export function runImpactRadar(repoRoot: string | null): void {
  if (!repoRoot) {
    vscode.window.showWarningMessage("Mneme: open a workspace folder first — the Impact Radar needs a repo to map.");
    return;
  }
  const active = vscode.window.activeTextEditor?.document.uri.fsPath;
  openImpactRadar(repoRoot, active);
}
