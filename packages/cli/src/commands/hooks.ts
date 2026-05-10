/**
 * `mneme hooks install/uninstall/status` -- wire Mneme into Claude
 * Code's UserPromptSubmit hook so every user keystroke triggers a
 * pulse injection. The closest thing the protocol allows to a
 * continuous AI <-> Mneme heartbeat.
 *
 * Settings file location:
 *   - Claude Code: ~/.claude/settings.json (per-user)
 *   - We never touch project-local .claude/settings.json (out of scope)
 *
 * Atomicity: read existing JSON, merge our hook entry, write back.
 * Refuses to overwrite an existing hook with a different command.
 */

import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir, platform as osPlatform } from "node:os";

const HOOK_KEY = "UserPromptSubmit";
const HOOK_COMMAND = "mneme nucleus pulse --quiet";

interface CommonOpts { json?: boolean }

function settingsPath(): string {
  return join(homedir(), ".claude", "settings.json");
}

interface ClaudeSettings {
  hooks?: Record<string, string | { command: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

function readSettings(): { exists: boolean; data: ClaudeSettings } {
  const path = settingsPath();
  if (!existsSync(path)) return { exists: false, data: {} };
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as ClaudeSettings;
    return { exists: true, data };
  } catch {
    return { exists: true, data: {} };
  }
}

function writeSettings(data: ClaudeSettings): void {
  const path = settingsPath();
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2), "utf8");
}

export function registerHooksCommands(program: Command): void {
  const hooks = program
    .command("hooks")
    .description("Wire Mneme into your AI tool's hooks (Claude Code UserPromptSubmit).");

  hooks
    .command("status")
    .description("Show whether the Mneme pulse hook is installed.")
    .option("--json", "JSON output.")
    .action((opts: CommonOpts) => {
      const r = readSettings();
      const installed = isInstalled(r.data);
      if (opts.json) {
        process.stdout.write(JSON.stringify({ settingsPath: settingsPath(), settingsExists: r.exists, hookInstalled: installed }, null, 2) + "\n");
        return;
      }
      process.stdout.write(`Settings file: ${settingsPath()}${r.exists ? "" : " (does not exist yet)"}\n`);
      process.stdout.write(`Pulse hook:    ${installed ? "INSTALLED" : "not installed"}\n`);
      if (!installed) {
        process.stdout.write(`\nInstall with:  mneme hooks install\n`);
      }
    });

  hooks
    .command("install")
    .description("Install the UserPromptSubmit hook in ~/.claude/settings.json. Safe to re-run.")
    .option("--force", "Overwrite if a different command is already wired to the hook.")
    .option("--json", "JSON output.")
    .action((opts: { force?: boolean } & CommonOpts) => {
      const r = readSettings();
      const data = r.data;
      data.hooks = data.hooks ?? {};
      const existing = data.hooks[HOOK_KEY];
      const existingCmd = typeof existing === "string" ? existing : existing?.command;
      if (existingCmd && existingCmd !== HOOK_COMMAND && !opts.force) {
        const payload = {
          installed: false,
          reason: `${HOOK_KEY} is already wired to: ${existingCmd}`,
          fix: "Re-run with --force to overwrite, or merge manually.",
          settingsPath: settingsPath(),
        };
        if (opts.json) { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); }
        else {
          process.stdout.write(`✗ ${payload.reason}\n  ${payload.fix}\n`);
        }
        process.exit(1);
        return;
      }
      data.hooks[HOOK_KEY] = HOOK_COMMAND;
      writeSettings(data);
      const platformNote = osPlatform() === "win32"
        ? "Windows: ensure `mneme.cmd` is on PATH (it is after `npm install -g mneme-ai`)."
        : "Ensure `mneme` is on PATH.";
      const payload = {
        installed: true,
        settingsPath: settingsPath(),
        hookKey: HOOK_KEY,
        hookCommand: HOOK_COMMAND,
        note: platformNote,
      };
      if (opts.json) { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); }
      else {
        process.stdout.write(`OK Installed Mneme pulse hook in ${settingsPath()}\n`);
        process.stdout.write(`   ${HOOK_KEY} -> ${HOOK_COMMAND}\n`);
        process.stdout.write(`   ${platformNote}\n`);
        process.stdout.write(`\nRestart Claude Code to pick up the new hook.\n`);
        process.stdout.write(`From now on, every user message you type triggers a Mneme pulse:\n`);
        process.stdout.write(`AI sees current Mneme version + inbox + auto-actions on every turn.\n`);
      }
    });

  hooks
    .command("uninstall")
    .description("Remove the Mneme pulse hook from ~/.claude/settings.json.")
    .option("--json", "JSON output.")
    .action((opts: CommonOpts) => {
      const r = readSettings();
      if (!r.exists || !r.data.hooks) {
        const payload = { uninstalled: false, reason: "no hooks configured" };
        if (opts.json) { process.stdout.write(JSON.stringify(payload) + "\n"); }
        else process.stdout.write(`(no settings file or hooks block; nothing to uninstall)\n`);
        return;
      }
      const existing = r.data.hooks[HOOK_KEY];
      const existingCmd = typeof existing === "string" ? existing : existing?.command;
      if (existingCmd !== HOOK_COMMAND) {
        const payload = { uninstalled: false, reason: `${HOOK_KEY} hook is not the Mneme pulse (${existingCmd ?? "unset"})` };
        if (opts.json) { process.stdout.write(JSON.stringify(payload) + "\n"); }
        else process.stdout.write(`(${HOOK_KEY} hook not installed by Mneme)\n`);
        return;
      }
      delete r.data.hooks[HOOK_KEY];
      writeSettings(r.data);
      const payload = { uninstalled: true, settingsPath: settingsPath() };
      if (opts.json) { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); }
      else process.stdout.write(`OK Removed Mneme pulse hook from ${settingsPath()}\n`);
    });
}

function isInstalled(settings: ClaudeSettings): boolean {
  const h = settings.hooks?.[HOOK_KEY];
  const cmd = typeof h === "string" ? h : h?.command;
  return cmd === HOOK_COMMAND;
}
