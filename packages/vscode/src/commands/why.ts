/**
 * Mneme: Why this line — palette command.
 *
 * Resolves the cursor position in the active editor, calls
 * `mneme why <file>:<line> --json`, and shows the result as a
 * peek/hover-style information message.
 */

import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { relative } from "node:path";
import { renderWhyMarkdown } from "../util/render.js";

export { renderWhyMarkdown };

export async function runWhy(repoRoot: string | null, cliPath: string): Promise<void> {
  const editor = vscode.window.activeTextEditor;
  if (!editor) {
    vscode.window.showWarningMessage(
      "Mneme: open a file and place your cursor on a line first.",
    );
    return;
  }
  if (!repoRoot) {
    vscode.window.showWarningMessage(
      "Mneme: no indexed workspace open. Run `mneme index` first.",
    );
    return;
  }
  const fsPath = editor.document.uri.fsPath;
  const rel = relative(repoRoot, fsPath).replace(/\\/g, "/");
  const line = editor.selection.active.line + 1;
  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Mneme: why ${rel}:${line}…` },
    async () => {
      const raw = await runCli(cliPath, ["why", `${rel}:${line}`, "--json"], repoRoot);
      const md = renderWhyMarkdown(rel, line, raw);
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
    const child = spawn(cli, args, { cwd, shell: process.platform === "win32" });
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
