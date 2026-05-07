/**
 * Mneme: Open Nervous System — palette command thin wrapper.
 */

import * as vscode from "vscode";
import { openNervousSystem } from "../webview/nervousSystemPanel.js";

export function runNervousSystem(repoRoot: string | null): void {
  if (!repoRoot) {
    vscode.window.showWarningMessage(
      "Mneme: open a workspace folder first — the Nervous System needs a repo to inspect.",
    );
    return;
  }
  openNervousSystem(repoRoot);
}
