/**
 * Mneme: Ask… — palette command.
 *
 * Runs `mneme ask <question> --json` against the configured CLI binary,
 * renders the answer in a Markdown preview pane, and turns each
 * citation row into a clickable file link.
 *
 * We shell out for `ask` rather than calling the public API: the answer
 * pipeline depends on optional embedding providers + a streaming
 * reasoning loop that's owned by the CLI layer. Re-implementing it
 * here would split the truth.
 */

import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFileSync } from "node:fs";
import { renderAskMarkdown } from "../util/render.js";

export { renderAskMarkdown };

export async function runAsk(repoRoot: string | null, cliPath: string): Promise<void> {
  const question = await vscode.window.showInputBox({
    title: "Mneme — ask anything about your codebase",
    prompt:
      "Mneme will refuse if it can't cite. Try: 'why does parseAmount use try/catch?'",
    placeHolder: "Why does this code exist?",
    ignoreFocusOut: true,
  });
  if (!question) return;

  if (!repoRoot) {
    vscode.window.showWarningMessage(
      "Mneme: no indexed workspace open. Run `mneme index` first.",
    );
    return;
  }

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.Notification,
      title: "Mneme is thinking…",
      cancellable: false,
    },
    async () => {
      const json = await runCli(cliPath, ["ask", question, "--json"], repoRoot);
      const md = renderAskMarkdown(question, json);
      const path = join(tmpdir(), `mneme-ask-${Date.now()}.md`);
      writeFileSync(path, md, "utf8");
      const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(path));
      await vscode.commands.executeCommand("markdown.showPreview", doc.uri);
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
