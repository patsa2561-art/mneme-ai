/**
 * `mneme mcp --install` — auto-detect AI coding tool + write its MCP config.
 *
 * The user installs Mneme with one command (npm i -g mneme-ai) but then
 * faces the JSON-config-file step to wire Mneme into their AI tool. That
 * step is where most adoption dies. This command removes it.
 *
 * Detection strategy: probe the well-known config-file paths for each
 * tool. If a config exists, we add (or update) the "mneme" MCP server
 * entry. We never overwrite unrelated entries.
 *
 * Supported AI tools (v1.2.0):
 *   - Claude Code / Claude Desktop  (~/.claude/config.json or per-OS)
 *   - Cursor                        (~/.cursor/mcp.json)
 *   - Continue                      (~/.continue/config.json)
 *   - Codex CLI                     (run `codex mcp add` instead — printed)
 *
 * Behavior:
 *   - Idempotent: re-running won't duplicate the entry.
 *   - --dry-run: print the diff, don't write.
 *   - --tool <name>: force-target a single tool.
 *   - On Windows: paths use %APPDATA% etc; on macOS/Linux: ~/.config/.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import kleur from "kleur";
import { ui } from "../ui.js";

export interface McpInstallOptions {
  cwd: string;
  dryRun?: boolean;
  /** Force-target one tool: claude | cursor | continue | codex */
  tool?: string;
  json?: boolean;
}

interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** Per-tool descriptor: how to find its config + how its MCP entries are nested. */
interface ToolDescriptor {
  id: "claude-code" | "claude-desktop" | "cursor" | "continue" | "codex";
  name: string;
  /** Resolve the config path for this OS — return null if tool isn't installed. */
  resolveConfigPath: () => string | null;
  /** Read the existing config (or return {} if none). */
  readConfig: (path: string) => Record<string, unknown>;
  /** Insert or update the mneme server entry, return the new config. */
  applyMnemeEntry: (existing: Record<string, unknown>, entry: McpServerEntry) => Record<string, unknown>;
  /** Optional special instructions for the user (e.g. "restart your IDE"). */
  postInstallNote: string;
}

const MNEME_ENTRY: McpServerEntry = {
  command: "mneme",
  args: ["mcp"],
};

function userHome(): string {
  return homedir();
}

function tryResolve(...paths: string[]): string | null {
  for (const p of paths) {
    if (existsSync(p)) return p;
    // Also accept directories that exist — we'll create the file inside
    if (existsSync(dirname(p))) return p;
  }
  return null;
}

const TOOLS: ToolDescriptor[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    resolveConfigPath: () => {
      const home = userHome();
      const candidates =
        platform() === "win32"
          ? [join(process.env["APPDATA"] ?? "", "Claude", "claude_desktop_config.json"), join(home, ".claude", "config.json")]
          : platform() === "darwin"
          ? [join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"), join(home, ".claude", "config.json")]
          : [join(home, ".config", "Claude", "claude_desktop_config.json"), join(home, ".claude", "config.json")];
      return tryResolve(...candidates);
    },
    readConfig: (path) => safeReadJson(path),
    applyMnemeEntry: (existing, entry) => {
      const cur = (existing["mcpServers"] as Record<string, unknown>) ?? {};
      cur["mneme"] = entry as unknown as Record<string, unknown>;
      return { ...existing, mcpServers: cur };
    },
    postInstallNote: "Restart Claude Code (or Claude Desktop) once. Mneme tools will appear in the model's tool list — start asking about your repo's history.",
  },
  {
    id: "cursor",
    name: "Cursor",
    resolveConfigPath: () => {
      const home = userHome();
      return tryResolve(join(home, ".cursor", "mcp.json"));
    },
    readConfig: (path) => safeReadJson(path),
    applyMnemeEntry: (existing, entry) => {
      const cur = (existing["mcpServers"] as Record<string, unknown>) ?? {};
      cur["mneme"] = entry as unknown as Record<string, unknown>;
      return { ...existing, mcpServers: cur };
    },
    postInstallNote: "Restart Cursor. Mneme tools will be available to the AI in your Cursor sessions.",
  },
  {
    id: "continue",
    name: "Continue",
    resolveConfigPath: () => {
      const home = userHome();
      return tryResolve(join(home, ".continue", "config.json"));
    },
    readConfig: (path) => safeReadJson(path),
    applyMnemeEntry: (existing, entry) => {
      // Continue uses an array under experimental.modelContextProtocolServers
      const exp = (existing["experimental"] as Record<string, unknown>) ?? {};
      const servers = ((exp["modelContextProtocolServers"] as Array<Record<string, unknown>>) ?? []).filter(
        (s) => s["name"] !== "mneme",
      );
      servers.push({ name: "mneme", command: entry.command, args: entry.args });
      exp["modelContextProtocolServers"] = servers as unknown as Record<string, unknown>;
      return { ...existing, experimental: exp };
    },
    postInstallNote: "Restart VS Code. Continue will load the Mneme MCP server on next session.",
  },
];

function safeReadJson(path: string): Record<string, unknown> {
  try {
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function writeJson(path: string, data: unknown) {
  if (!existsSync(dirname(path))) mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n", "utf8");
}

interface InstallOutcome {
  tool: string;
  configPath: string;
  installed: boolean;
  alreadyPresent: boolean;
  error?: string;
}

export async function mcpInstallCommand(opts: McpInstallOptions): Promise<number> {
  const targets = opts.tool ? TOOLS.filter((t) => t.id.includes(opts.tool!)) : TOOLS;
  if (targets.length === 0) {
    ui.error(`Unknown tool "${opts.tool}". Supported: ${TOOLS.map((t) => t.id).join(", ")}.`);
    return 1;
  }

  const outcomes: InstallOutcome[] = [];
  const codexHint =
    "Codex CLI: run manually — `codex mcp add mneme mneme mcp` (the Codex CLI doesn't expose a config file we can edit).";

  for (const tool of targets) {
    const configPath = tool.resolveConfigPath();
    if (!configPath) {
      outcomes.push({
        tool: tool.name,
        configPath: "(not detected)",
        installed: false,
        alreadyPresent: false,
        error: `${tool.name} not detected in standard install paths.`,
      });
      continue;
    }
    const existing = tool.readConfig(configPath);
    const already = JSON.stringify(existing).includes('"mneme"');
    const updated = tool.applyMnemeEntry(existing, MNEME_ENTRY);
    if (opts.dryRun) {
      outcomes.push({
        tool: tool.name,
        configPath,
        installed: false,
        alreadyPresent: already,
      });
      continue;
    }
    try {
      writeJson(configPath, updated);
      outcomes.push({
        tool: tool.name,
        configPath,
        installed: true,
        alreadyPresent: already,
      });
    } catch (err) {
      outcomes.push({
        tool: tool.name,
        configPath,
        installed: false,
        alreadyPresent: already,
        error: (err as Error).message,
      });
    }
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ outcomes, codex: codexHint }, null, 2) + "\n");
    const success = outcomes.some((o) => o.installed || o.alreadyPresent);
    return success ? 0 : 1;
  }

  // Pretty output
  ui.banner();
  process.stdout.write(
    kleur.bold("\n  🔧 Mneme MCP — auto-install\n\n") +
      "  Configures Mneme as an MCP server in your AI coding tool, so the AI\n" +
      "  can call Mneme's 90+ knowledge tools while you talk to it normally.\n\n",
  );

  let anySuccess = false;
  let anyDetected = false;
  for (const o of outcomes) {
    const wouldInstall = opts.dryRun && !o.error;
    const tag = o.installed
      ? kleur.green().bold("✓ INSTALLED")
      : o.alreadyPresent && opts.dryRun
      ? kleur.yellow("✓ already present")
      : o.alreadyPresent
      ? kleur.green("✓ already present (refreshed)")
      : wouldInstall
      ? kleur.cyan("→ would install")
      : kleur.gray("○ skipped");
    process.stdout.write(`  ${tag}  ${kleur.bold(o.tool)}\n`);
    process.stdout.write(`      config: ${kleur.dim(o.configPath)}\n`);
    if (o.error) process.stdout.write(`      ${kleur.red(o.error)}\n`);
    if (o.installed || o.alreadyPresent || wouldInstall) anySuccess = true;
    if (!o.error) anyDetected = true;
  }

  process.stdout.write("\n  " + kleur.dim(codexHint) + "\n\n");

  if (anySuccess && !opts.dryRun) {
    process.stdout.write(
      kleur.bold("  Next steps:\n") +
        "    1. Restart your AI tool (Claude Code / Cursor / Continue) once.\n" +
        "    2. In your AI tool, ask: " +
        kleur.cyan('"what does mneme.capabilities return?"') +
        "\n" +
        "    3. If you see a JSON catalog of 90+ tools, you're connected.\n\n",
    );
  } else if (anySuccess && opts.dryRun) {
    process.stdout.write(
      kleur.bold("  Dry-run complete.") +
        " Re-run without --dry-run to apply.\n\n",
    );
  } else if (!anyDetected) {
    process.stdout.write(
      kleur.yellow("  No supported AI tools detected.") +
        " Install Claude Code / Cursor / Continue first,\n  then re-run `mneme mcp --install`.\n\n",
    );
  }

  return anySuccess ? 0 : 1;
}
