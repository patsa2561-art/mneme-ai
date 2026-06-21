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

interface AupHit { word: string; severity: "high" | "medium" | "benign"; count: number; safe: string; note: string }
interface AupResult { hits: AupHit[]; highCount: number; mediumCount: number; benignCount: number; clean: boolean; scanned: number }
interface LexiconShape { auditAupTriggers: (text: string) => AupResult; formatAupVerdict: (r: AupResult) => string }

async function resolveLexicon(): Promise<LexiconShape | null> {
  try {
    const core = (await import("@mneme-ai/core")) as { lexicon?: LexiconShape };
    if (core.lexicon && typeof core.lexicon.auditAupTriggers === "function") return core.lexicon;
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
    .description("Write/refresh the manifest block in every supported agent file. Sentinel-bracketed -- re-syncs replace in place without touching the rest of each file. --lean writes the compact index (~3k tok) instead of the full manifest (~61k tok) — the real per-session token cost in Claude Code etc.")
    .option("--json", "JSON output.")
    .option("--lean", "Write the LEAN compact manifest (~95% fewer tokens) — a pointer to mneme.boot / mneme.morph instead of the full command catalog. Same as env MNEME_LEAN=1.", false)
    .action(async (opts: CommonOpts & { lean?: boolean }) => {
      const repoRoot = process.cwd();
      if (opts.lean) process.env["MNEME_LEAN_MANIFEST"] = "1"; // honored by renderManifestMarkdown
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

  m.command("doctor")
    .description("Audit the RENDERED manifest (post-lexicon) for AUP 'violative cyber content' triggers that would land in CLAUDE.md and risk an Anthropic Usage-Policy block. Exit code 1 if any HIGH/MEDIUM trigger leaks (CI-friendly); benign command tokens only WARN.")
    .option("--json", "JSON output.")
    .action(async (opts: CommonOpts) => {
      const am = await resolveAgentManifest();
      const lex = await resolveLexicon();
      if (!am || !lex) { writeText(`✗ agent_manifest / lexicon helper unavailable. Upgrade: \`npm install -g mneme-ai@latest\`.`); process.exitCode = 1; return; }
      const version = readMnemeVersion();
      // Audit exactly what lands on disk: the lexicon-tuned markdown block.
      const rendered = am.renderManifestMarkdown(undefined, version);
      const r = lex.auditAupTriggers(rendered);
      if (opts.json) { writeJson({ version, ...r }); process.exitCode = r.clean ? 0 : 1; return; }
      writeText(`Mneme manifest doctor (v${version}) — AUP cyber-content audit`);
      writeText(``);
      writeText(`  ${lex.formatAupVerdict(r)}`);
      writeText(``);
      if (r.hits.length === 0) {
        writeText(`  ✓ No tracked trigger words present at all.`);
      } else {
        for (const h of r.hits) {
          const icon = h.severity === "high" ? "✗" : h.severity === "medium" ? "⚠" : "·";
          const fix = h.safe ? `  → should be "${h.safe}" (lexicon gap!)` : `  (benign: ${h.note})`;
          writeText(`  ${icon} [${h.severity.padEnd(6)}] ${h.word.padEnd(18)} ×${String(h.count).padStart(3)}${fix}`);
        }
      }
      writeText(``);
      if (r.clean) {
        writeText(`  ✓ CLEAN — zero high/medium triggers. Safe to land in CLAUDE.md.`);
      } else {
        writeText(`  ✗ LEAK — ${r.highCount} high + ${r.mediumCount} medium trigger(s) would reach the vendor classifier.`);
        writeText(`    Fix: add a lexicon rule (packages/core/src/lexicon/mappings.ts → PROFILE_ANTHROPIC) mapping each leaked word to its neutral form.`);
      }
      process.exitCode = r.clean ? 0 : 1;
    });
}
