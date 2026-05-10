/**
 * `mneme hooks` / `mneme integrate` -- wire Mneme into every supported
 * AI agent's *own* configuration shape.
 *
 *   mneme hooks status        per-adapter state across all agents
 *   mneme hooks install       install everywhere applicable (auto-detect)
 *   mneme hooks uninstall     remove from everywhere
 *   mneme hooks repair        auto-fix the v1.25.2 broken Claude Code schema
 *
 *   mneme hooks install --only claude-code,cursor   restrict to ids
 *   mneme hooks install --force                     overwrite foreign config
 *   mneme hooks list                                 list known adapters
 *
 * The previous v1.25.2 implementation wrote a STRING shorthand
 * "UserPromptSubmit": "mneme nucleus pulse --quiet" into Claude
 * Code's settings.json. Per official Claude Code hook docs that
 * format is silently rejected. v1.26.1 ships:
 *   - the correct array-of-objects schema for Claude Code
 *   - per-agent adapters (Cursor, Codex, Gemini, Windsurf, ...) for
 *     agents that lack a real exec-hook surface
 *   - auto-detect + auto-repair for the broken v1.25.2 string format
 *   - multi-layer error handling at every adapter
 */

import type { Command } from "commander";
import { integrations } from "@mneme-ai/core";

interface CommonOpts { json?: boolean }

function writeJson(payload: unknown): void {
  process.stdout.write(JSON.stringify(payload, null, 2) + "\n");
}

function writeText(s: string): void {
  process.stdout.write(s + "\n");
}

function fmtStatus(state: string): string {
  switch (state) {
    case "ok": return "OK";
    case "drift": return "DRIFT";
    case "absent": return "absent";
    case "no-config": return "n/a";
    default: return state;
  }
}

function fmtInstallStatus(s: string): string {
  switch (s) {
    case "installed": return "INSTALLED";
    case "already-installed": return "ok";
    case "repaired": return "REPAIRED";
    case "refused": return "REFUSED";
    case "error": return "ERROR";
    default: return s;
  }
}

export function registerHooksCommands(program: Command): void {
  const hooks = program
    .command("hooks")
    .alias("integrate")
    .description("Wire Mneme into your AI tool(s). Supports Claude Code (real hook), Cursor, Codex, Gemini, Windsurf, and project AGENTS.md.");

  // -----------------------------------------------------------------
  // mneme hooks list
  // -----------------------------------------------------------------
  hooks
    .command("list")
    .description("List known adapter ids and where each writes.")
    .option("--json", "JSON output.")
    .action((opts: CommonOpts) => {
      const rows = integrations.ALL_ADAPTERS.map((a) => ({
        id: a.id, label: a.label, scope: a.scope,
      }));
      if (opts.json) { writeJson(rows); return; }
      writeText(`Known adapters:`);
      writeText(``);
      for (const r of rows) {
        writeText(`  ${r.id.padEnd(22)} (${r.scope.padEnd(7)}) -- ${r.label}`);
      }
    });

  // -----------------------------------------------------------------
  // mneme hooks status
  // -----------------------------------------------------------------
  hooks
    .command("status")
    .description("Show per-adapter integration state.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const repoRoot = process.cwd();
      const results = await integrations.statusAll(repoRoot);
      if (opts.json) { writeJson(results); return; }
      writeText(`Mneme integrations -- per-agent state`);
      writeText(``);
      for (const r of results) {
        const tag = fmtStatus(r.result.state);
        const repair = r.result.canRepair ? "  [repair available]" : "";
        writeText(`  [${tag.padEnd(6)}] ${r.id.padEnd(22)} ${r.result.details}${repair}`);
        if (r.result.path) writeText(`             ${r.result.path}`);
      }
      const drifts = results.filter((r) => r.result.canRepair);
      if (drifts.length > 0) {
        writeText(``);
        writeText(`Run \`mneme hooks repair\` to fix ${drifts.length} drift(s).`);
      }
    });

  // -----------------------------------------------------------------
  // mneme hooks install
  // -----------------------------------------------------------------
  hooks
    .command("install")
    .description("Install Mneme into every detected agent (or restrict via --only).")
    .option("--only <ids>", "comma-separated adapter ids (e.g. claude-code,cursor)", (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean))
    .option("--all", "install into every known adapter, even undetected ones")
    .option("--force", "overwrite foreign config / merge alongside existing hooks")
    .option("--json", "JSON output.")
    .action(async (opts: { only?: string[]; all?: boolean; force?: boolean } & CommonOpts) => {
      const repoRoot = process.cwd();
      const results = await integrations.installAll(repoRoot, {
        ids: opts.only,
        force: opts.force,
        onlyDetected: !opts.all && !opts.only,
      });
      if (opts.json) { writeJson(results); return; }
      writeText(`Mneme integrations -- install`);
      writeText(``);
      for (const r of results) {
        const tag = fmtInstallStatus(r.result.status);
        writeText(`  [${tag.padEnd(10)}] ${r.id.padEnd(22)} ${r.result.message}`);
        if (r.result.path) writeText(`               ${r.result.path}`);
        if (r.result.fix) writeText(`               fix: ${r.result.fix}`);
      }
      const refused = results.filter((r) => r.result.status === "refused");
      if (refused.length > 0) {
        writeText(``);
        writeText(`${refused.length} adapter(s) refused. Re-run with --force to override.`);
      }
      writeText(``);
      writeText(`Restart your AI tool(s) to pick up the new wiring.`);
    });

  // -----------------------------------------------------------------
  // mneme hooks uninstall
  // -----------------------------------------------------------------
  hooks
    .command("uninstall")
    .description("Remove Mneme blocks/hooks from all agents (or --only ids).")
    .option("--only <ids>", "comma-separated adapter ids", (v: string) => v.split(",").map((s) => s.trim()).filter(Boolean))
    .option("--json", "JSON output.")
    .action(async (opts: { only?: string[] } & CommonOpts) => {
      const repoRoot = process.cwd();
      const results = await integrations.uninstallAll(repoRoot, { ids: opts.only });
      if (opts.json) { writeJson(results); return; }
      writeText(`Mneme integrations -- uninstall`);
      writeText(``);
      for (const r of results) {
        writeText(`  [${r.result.status.padEnd(15)}] ${r.id.padEnd(22)} ${r.result.message}`);
      }
    });

  // -----------------------------------------------------------------
  // mneme hooks repair  -- auto-fix v1.25.2 drift
  // -----------------------------------------------------------------
  hooks
    .command("repair")
    .description("Auto-repair the v1.25.2 broken Claude Code string-shorthand drift (and any other repairable drifts).")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const repoRoot = process.cwd();
      const sts = await integrations.statusAll(repoRoot);
      const drifts = sts.filter((s) => s.result.canRepair);
      if (drifts.length === 0) {
        if (opts.json) { writeJson({ repaired: 0, results: [] }); return; }
        writeText(`No drifts detected. Everything looks correct.`);
        return;
      }
      const repaired = await Promise.all(drifts.map(async (d) => {
        const adapter = integrations.adapterById(d.id);
        if (!adapter) {
          return { id: d.id, label: d.label, result: { ok: false, status: "error" as const, mode: "unsupported" as const, message: "adapter missing" } };
        }
        return { id: d.id, label: d.label, result: await adapter.install(repoRoot, { force: false }) };
      }));
      if (opts.json) { writeJson({ repaired: repaired.length, results: repaired }); return; }
      writeText(`Mneme integrations -- repair`);
      writeText(``);
      for (const r of repaired) {
        const tag = fmtInstallStatus(r.result.status);
        writeText(`  [${tag.padEnd(10)}] ${r.id.padEnd(22)} ${r.result.message}`);
      }
    });

  // -----------------------------------------------------------------
  // Backwards-compat top-level: `mneme hooks` with no subcommand prints status.
  // -----------------------------------------------------------------
  hooks.action(async () => {
    const repoRoot = process.cwd();
    const results = await integrations.statusAll(repoRoot);
    writeText(`Mneme integrations -- per-agent state (run \`mneme hooks --help\` for actions)`);
    writeText(``);
    for (const r of results) {
      const tag = fmtStatus(r.result.state);
      writeText(`  [${tag.padEnd(6)}] ${r.id.padEnd(22)} ${r.result.details}`);
    }
  });
}
