/**
 * Mneme: Audit current PR — palette command.
 *
 * Runs `mneme audit --certify --json`, surfaces the verdict via a
 * notification (info/warn/error matching the verdict severity), and
 * opens a Markdown detail panel for the full breakdown.
 */

import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { parseVerdict, renderAuditMarkdown } from "../util/render.js";

export { parseVerdict, renderAuditMarkdown };

export type RunAuditCallback = (verdict: "pass" | "warn" | "fail" | "idle") => void;

export async function runAudit(
  repoRoot: string | null,
  cliPath: string,
  onVerdict?: RunAuditCallback,
): Promise<void> {
  if (!repoRoot) {
    vscode.window.showWarningMessage(
      "Mneme: no indexed workspace open. Run `mneme index` first.",
    );
    return;
  }
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: "Mneme: certifying…" },
    async () => {
      const raw = await runCli(cliPath, ["audit", "--certify", "--json"], repoRoot);
      const md = renderAuditMarkdown(raw);
      const verdict = parseVerdict(raw);
      if (onVerdict) onVerdict(verdict);

      if (verdict === "pass") {
        vscode.window.showInformationMessage("Mneme audit: pass — AI claims line up with reality.");
      } else if (verdict === "warn") {
        vscode.window.showWarningMessage("Mneme audit: warn — review one or more axes.");
      } else if (verdict === "fail") {
        vscode.window.showErrorMessage("Mneme audit: fail — AI narrative contradicted the diff.");
      } else {
        vscode.window.showInformationMessage("Mneme audit complete — see panel for details.");
      }

      const doc = await vscode.workspace.openTextDocument({
        content: md,
        language: "markdown",
      });
      await vscode.window.showTextDocument(doc, { preview: true, viewColumn: vscode.ViewColumn.Beside });
    },
  );
}

function runCli(cli: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve) => {
    // v1.11.0 security hardening: argv-only invocation, no shell:true.
    const exe = process.platform === "win32" && !cli.endsWith(".cmd") ? `${cli}.cmd` : cli;
    const child = spawn(exe, args, { cwd, shell: false });
    const out: Buffer[] = [];
    const err: Buffer[] = [];
    child.stdout.on("data", (b: Buffer) => out.push(b));
    child.stderr.on("data", (b: Buffer) => err.push(b));
    child.on("close", () => {
      const stdout = Buffer.concat(out).toString("utf8");
      resolve(stdout || Buffer.concat(err).toString("utf8"));
    });
    child.on("error", () => resolve(""));
  });
}
