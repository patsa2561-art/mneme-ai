/**
 * `mneme manifest` (v1.31.0) -- sync the AGENT COMMAND MANIFEST into
 * every agent file in the repo so the AI agent in the user's editor
 * always knows the latest command surface.
 *
 *   mneme manifest sync         -- write/refresh the manifest block in
 *                                  CLAUDE.md / AGENTS.md / GEMINI.md /
 *                                  .cursor/rules/mneme.mdc / .cursorrules /
 *                                  .windsurfrules. Sentinel-bracketed --
 *                                  re-syncs replace in place without
 *                                  touching the rest of each file.
 *   mneme manifest list         -- print the catalog (no file writes).
 *   mneme manifest preview      -- show what the rendered block looks like.
 */

import type { Command } from "commander";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface CommonOpts { json?: boolean }

function writeJson(payload: unknown): void { process.stdout.write(JSON.stringify(payload, null, 2) + "\n"); }
function writeText(line: string): void { process.stdout.write(line + "\n"); }

interface AgentManifestShape {
  MNEME_COMMAND_CATALOG: Array<{
    command: string; alias?: string; since: string; what: string; when: string; group: string;
  }>;
  renderManifestMarkdown: (catalog?: AgentManifestShape["MNEME_COMMAND_CATALOG"], v?: string) => string;
  renderManifestPlain: (catalog?: AgentManifestShape["MNEME_COMMAND_CATALOG"], v?: string) => string;
  syncManifest: (repoRoot: string, opts?: { mnemeVersion?: string }) => Array<{
    target: { path: string; label: string; format: string };
    action: "created" | "replaced" | "unchanged" | "skipped" | "failed";
    detail?: string;
  }>;
}

async function resolveAgentManifest(): Promise<AgentManifestShape | null> {
  try {
    const core = (await import("@mneme-ai/core")) as { agentManifest?: AgentManifestShape };
    if (core.agentManifest && typeof core.agentManifest.syncManifest === "function") return core.agentManifest;
  } catch { /* */ }
  return null;
}

function readMnemeVersion(): string {
  try {
    // ESM-safe lookup: walk up from this module's directory to the
    // closest package.json. Replaces the v1.x require()-based version
    // that crashed under "type":"module".
    const here = dirname(fileURLToPath(import.meta.url));
    let dir = here;
    for (let i = 0; i < 6; i++) {
      const candidate = join(dir, "package.json");
      if (existsSync(candidate)) {
        const pkg = JSON.parse(readFileSync(candidate, "utf8")) as { version?: string };
        if (pkg.version) return pkg.version;
      }
      dir = dirname(dir);
    }
    return "?";
  } catch {
    return "?";
  }
}

export function registerManifestCommands(program: Command): void {
  const m = program
    .command("manifest")
    .description("Sync the Mneme AGENT COMMAND MANIFEST into every agent file (CLAUDE.md, AGENTS.md, .cursor/rules, GEMINI.md, .windsurfrules) so the AI agent in your editor always knows the latest command surface.");

  m.command("sync")
    .description("Write/refresh the manifest block in every supported agent file. Sentinel-bracketed -- re-syncs replace in place without touching the rest of each file.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const repoRoot = process.cwd();
      const am = await resolveAgentManifest();
      if (!am) {
        const msg = "agent_manifest helper unavailable in this @mneme-ai/core. Upgrade: `npm install -g mneme-ai@latest`.";
        if (opts.json) { writeJson({ ok: false, error: msg }); return; }
        writeText(`✗ ${msg}`);
        process.exitCode = 1;
        return;
      }
      const version = readMnemeVersion();
      const results = am.syncManifest(repoRoot, { mnemeVersion: version });
      const tally = {
        created: results.filter((r) => r.action === "created").length,
        replaced: results.filter((r) => r.action === "replaced").length,
        unchanged: results.filter((r) => r.action === "unchanged").length,
        failed: results.filter((r) => r.action === "failed").length,
      };
      if (opts.json) { writeJson({ version, results, tally }); return; }
      writeText(`Mneme manifest sync (v${version})`);
      writeText(``);
      for (const r of results) {
        const tag = r.action === "created" ? "✓ created"
          : r.action === "replaced" ? "✓ refreshed"
          : r.action === "unchanged" ? "· unchanged"
          : r.action === "skipped" ? "- skipped"
          : "✗ FAILED";
        const det = r.detail ? `  -- ${r.detail}` : "";
        writeText(`  [${tag.padEnd(13)}] ${r.target.label.padEnd(30)} ${r.target.path}${det}`);
      }
      writeText(``);
      writeText(`Tally: ${tally.created} created · ${tally.replaced} refreshed · ${tally.unchanged} unchanged · ${tally.failed} failed`);
      writeText(``);
      writeText(`Every supported agent file now contains the v${version} command manifest -- AI agent will see the latest commands on its next prompt.`);
    });

  m.command("list")
    .description("Print the manifest catalog (no file writes). Useful for piping to grep or jq.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const am = await resolveAgentManifest();
      if (!am) { writeText(`✗ agent_manifest helper unavailable. Upgrade: \`npm install -g mneme-ai@latest\`.`); process.exitCode = 1; return; }
      if (opts.json) { writeJson(am.MNEME_COMMAND_CATALOG); return; }
      for (const c of am.MNEME_COMMAND_CATALOG) {
        const alias = c.alias ? ` (alias: ${c.alias})` : "";
        writeText(`${c.command}${alias}  [v${c.since}, ${c.group}]`);
        writeText(`  what: ${c.what}`);
        writeText(`  when: ${c.when}`);
      }
    });

  m.command("preview")
    .description("Print what the rendered manifest block looks like (no file writes).")
    .option("--format <f>", "markdown | plain", "markdown")
    .action(async (opts: { format?: string }) => {
      const am = await resolveAgentManifest();
      if (!am) { writeText(`✗ agent_manifest helper unavailable. Upgrade: \`npm install -g mneme-ai@latest\`.`); process.exitCode = 1; return; }
      const version = readMnemeVersion();
      const block = opts.format === "plain"
        ? am.renderManifestPlain(undefined, version)
        : am.renderManifestMarkdown(undefined, version);
      writeText(block);
    });
}
