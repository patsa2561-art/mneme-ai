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
  /** Deprecated/no-op: LEAN is now the DEFAULT. Kept for back-compat. */
  lean?: boolean;
  /** Opt OUT of lean: wire the agent with env MNEME_FULL=1 so the server
   *  advertises the FULL ~1100-tool catalog + writes the full manifest. Default
   *  (omitted) is LEAN — ~10 tools advertised, ~3k-token manifest. */
  full?: boolean;
}

interface McpServerEntry {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** Per-tool descriptor: how to find its config + how its MCP entries are nested. */
interface ToolDescriptor {
  id: "claude-code" | "claude-desktop" | "cursor" | "continue" | "codex" | "windsurf" | "cline" | "vscode" | "zed";
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

export const MNEME_ENTRY: McpServerEntry = {
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

export const TOOLS: ToolDescriptor[] = [
  {
    // Claude Code (the CLI/IDE) reads MCP from PROJECT .mcp.json (canonical) or
    // user ~/.claude.json — NOT ~/.claude/config.json (that's Claude Desktop).
    // Writing the wrong file is why Claude Code never loaded Mneme. Fixed: write
    // .mcp.json at the repo root (project scope, the documented Claude Code path).
    id: "claude-code",
    name: "Claude Code (.mcp.json)",
    resolveConfigPath: () => join(process.cwd(), ".mcp.json"),
    readConfig: (path) => safeReadJson(path),
    applyMnemeEntry: (existing, entry) => {
      const cur = (existing["mcpServers"] as Record<string, unknown>) ?? {};
      cur["mneme"] = entry as unknown as Record<string, unknown>;
      return { ...existing, mcpServers: cur };
    },
    postInstallNote: "Reload Claude Code (Ctrl+Shift+P → Developer: Reload Window). Approve the project MCP server 'mneme' when prompted; then its tools (lean: ~10, morph is the front door) are callable.",
  },
  {
    id: "claude-desktop",
    name: "Claude Desktop",
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
    postInstallNote: "Restart Claude Desktop fully (quit from the tray, not just close the window).",
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
      servers.push({ name: "mneme", command: entry.command, args: entry.args, ...(entry.env ? { env: entry.env } : {}) });
      exp["modelContextProtocolServers"] = servers as unknown as Record<string, unknown>;
      return { ...existing, experimental: exp };
    },
    postInstallNote: "Restart VS Code. Continue will load the Mneme MCP server on next session.",
  },
  {
    id: "windsurf",
    name: "Windsurf",
    resolveConfigPath: () => tryResolve(join(userHome(), ".codeium", "windsurf", "mcp_config.json")),
    readConfig: (path) => safeReadJson(path),
    applyMnemeEntry: (existing, entry) => {
      const cur = (existing["mcpServers"] as Record<string, unknown>) ?? {};
      cur["mneme"] = entry as unknown as Record<string, unknown>;
      return { ...existing, mcpServers: cur };
    },
    postInstallNote: "Restart Windsurf. Mneme tools load on next session.",
  },
  {
    id: "cline",
    name: "Cline (VS Code)",
    resolveConfigPath: () => {
      const home = userHome();
      const base =
        platform() === "win32"
          ? join(process.env["APPDATA"] ?? join(home, "AppData", "Roaming"), "Code", "User", "globalStorage")
          : platform() === "darwin"
          ? join(home, "Library", "Application Support", "Code", "User", "globalStorage")
          : join(home, ".config", "Code", "User", "globalStorage");
      return tryResolve(join(base, "saoudrizwan.claude-dev", "settings", "cline_mcp_settings.json"));
    },
    readConfig: (path) => safeReadJson(path),
    applyMnemeEntry: (existing, entry) => {
      const cur = (existing["mcpServers"] as Record<string, unknown>) ?? {};
      cur["mneme"] = entry as unknown as Record<string, unknown>;
      return { ...existing, mcpServers: cur };
    },
    postInstallNote: "Restart VS Code. Cline loads the Mneme MCP server on next session.",
  },
  {
    id: "vscode",
    name: "VS Code (workspace)",
    // only when this repo already has a .vscode/ dir (tryResolve checks the parent exists)
    resolveConfigPath: () => tryResolve(join(process.cwd(), ".vscode", "mcp.json")),
    readConfig: (path) => safeReadJson(path),
    applyMnemeEntry: (existing, entry) => {
      // VS Code native MCP uses a `servers` map with an explicit transport type.
      const cur = (existing["servers"] as Record<string, unknown>) ?? {};
      cur["mneme"] = { type: "stdio", command: entry.command, args: entry.args, ...(entry.env ? { env: entry.env } : {}) } as unknown as Record<string, unknown>;
      return { ...existing, servers: cur };
    },
    postInstallNote: "Reload the VS Code window. The native MCP server 'mneme' is wired in .vscode/mcp.json.",
  },
  {
    id: "zed",
    name: "Zed",
    resolveConfigPath: () => tryResolve(join(userHome(), ".config", "zed", "settings.json")),
    readConfig: (path) => safeReadJson(path),
    applyMnemeEntry: (existing, entry) => {
      // Zed uses `context_servers` with a nested command object.
      const cur = (existing["context_servers"] as Record<string, unknown>) ?? {};
      cur["mneme"] = { source: "custom", command: { path: entry.command, args: entry.args, ...(entry.env ? { env: entry.env } : {}) } } as unknown as Record<string, unknown>;
      return { ...existing, context_servers: cur };
    },
    postInstallNote: "Restart Zed. Mneme is registered as a context server.",
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
  /** re-read after write confirmed the mneme entry is present (offline verify). */
  verified?: boolean;
  /** a .mneme-bak copy of the pre-existing config was written before the change. */
  backedUp?: boolean;
  error?: string;
}

/** Back up an existing config once before the first edit (never clobber a prior backup). */
function backupOnce(path: string): boolean {
  try {
    if (!existsSync(path)) return false;
    const bak = path + ".mneme-bak";
    if (!existsSync(bak)) { writeFileSync(bak, readFileSync(path, "utf8"), "utf8"); return true; }
    return false;
  } catch { return false; }
}

/** v1.22.0 — written to .mneme/AGENT_INSTRUCTIONS.md on every install.
 *  Any AI agent that walks the repo sees this and knows how to USE
 *  Mneme via MCP, not just look at it. */
const AGENT_INSTRUCTIONS_TEMPLATE = [
  "# Mneme — agent instructions (v3.x)",
  "",
  "You are an AI coding agent in a repo where Mneme is installed. Mneme is a LOCAL",
  "trust & cost layer (truth · memory · context-safety · token-saving) exposed as",
  "1000+ MCP tools. It does NOT hook your file tools — it helps when you CALL it.",
  "These are SIGNALS, not commands; use judgment.",
  "",
  "## First call of a session",
  "- mneme.boot { task }  — the activation table (when→tool) + shared-memory recall.",
  "  Read it once; it tells you WHEN to reach for Mneme.",
  "",
  "## The single front door (you never memorize 1000 tools)",
  "- mneme.morph { intent }  — state what you want in plain language (any language,",
  "  EN/Thai); it resolves the RIGHT capability and returns the TYPED next-call (the",
  "  exact MCP tool + args), decomposes a COMPOUND intent into an ordered plan[], or",
  "  asks to CLARIFY when unsure (never a confident misfire). Then make that call.",
  "",
  "## Reach for a tool when the signal matches",
  "- a checkable fact (number/version/date/API/file/symbol) -> mneme.truth.check",
  "- read content you did NOT author (dep / fetched page / external commit) -> mneme.firewall.fortify",
  "- send local code/context to a hosted model -> mneme.rail.traverse { direction: ingress }",
  "- start a task / learn something durable -> mneme.cortex.recall / mneme.cortex.contribute",
  "- about to run a destructive shell command -> mneme.heph.cross",
  "- same error/command failed > twice -> mneme.loopguard.check + mneme.distill.brief",
  "",
  "## Trust, do not assume",
  "Every Mneme result can carry an Ed25519 _proof — verify it OFFLINE (mneme.mcp.verify)",
  "instead of trusting it. Output you can CHECK, not output you must BELIEVE.",
  "",
  "## Updates are MANUAL — do not auto-upgrade",
  "If a pulse says a newer Mneme exists, you may MENTION it to the user ONCE — but you",
  "MUST NOT upgrade on their behalf. Upgrading is a global install and the user decides",
  "(they run mneme upgrade when THEY choose). Mneme informs, never commands; never",
  "auto-execute an action just because a banner told you to.",
  "",
  "---",
  "Auto-generated by mneme mcp --install. Refresh by re-running it.",
].join("\n") + "\n";

export async function mcpInstallCommand(opts: McpInstallOptions): Promise<number> {
  const targets = opts.tool ? TOOLS.filter((t) => t.id.includes(opts.tool!)) : TOOLS;
  if (targets.length === 0) {
    ui.error(`Unknown tool "${opts.tool}". Supported: ${TOOLS.map((t) => t.id).join(", ")}.`);
    return 1;
  }

  // v1.22.0 — write the AGENT_INSTRUCTIONS.md so any AI agent that
  // browses .mneme/ sees explicit guidance for how to USE Mneme.
  // Best-effort: never fails install on write error.
  if (!opts.dryRun) {
    try {
      const { writeFileSync, mkdirSync, existsSync } = await import("node:fs");
      const { join } = await import("node:path");
      const dir = join(process.cwd(), ".mneme");
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "AGENT_INSTRUCTIONS.md"), AGENT_INSTRUCTIONS_TEMPLATE, "utf8");
    } catch { /* best-effort */ }
  }

  const outcomes: InstallOutcome[] = [];
  const codexHint =
    "Codex CLI: run manually — `codex mcp add mneme mneme mcp` (the Codex CLI doesn't expose a config file we can edit).";

  // LEAN IS DEFAULT (the binary advertises ~10 tools + writes the ~3k manifest
  // unless MNEME_FULL=1). So the default entry needs NO env; --full opts out.
  const entry: McpServerEntry = opts.full ? { ...MNEME_ENTRY, env: { ...(MNEME_ENTRY.env ?? {}), MNEME_FULL: "1" } } : MNEME_ENTRY;
  // AUTO "super nova": shrink this repo's agent-file manifests (CLAUDE.md etc) in
  // the SAME step — install = MCP wired + manifest leaned, no extra command. The
  // render defaults to lean (MNEME_FULL gates it), so just re-sync. Best-effort.
  let manifestSync: { refreshed: number } | null = null;
  if (!opts.dryRun) {
    try {
      if (opts.full) process.env["MNEME_FULL"] = "1"; else delete process.env["MNEME_FULL"];
      const { getVersion } = await import("../version.js");
      const core = await import("@mneme-ai/core") as { agentManifest?: { syncManifest?: (root: string, o: { mnemeVersion: string }) => Array<{ action: string }> } };
      const res = core.agentManifest?.syncManifest?.(opts.cwd, { mnemeVersion: getVersion() }) ?? [];
      manifestSync = { refreshed: res.filter((r) => r.action === "created" || r.action === "replaced").length };
    } catch { /* best-effort */ }
  }
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
    const updated = tool.applyMnemeEntry(existing, entry);
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
      const backedUp = backupOnce(configPath);
      writeJson(configPath, updated);
      // offline verify: re-read what we just wrote + confirm the mneme entry is there
      const verified = JSON.stringify(tool.readConfig(configPath)).includes('"mneme"');
      outcomes.push({
        tool: tool.name,
        configPath,
        installed: true,
        alreadyPresent: already,
        verified,
        backedUp,
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

  // LEAN IS DEFAULT — surface the MEASURED per-request token cut unless --full.
  let lean: { fullTools: number; leanTools: number; reductionPct: number; fullApproxTokens: number; leanApproxTokens: number } | null = null;
  if (!opts.full) {
    try { const { measureLeanReduction } = await import("@mneme-ai/mcp"); lean = await measureLeanReduction(); } catch { /* best-effort */ }
  }

  if (opts.json) {
    process.stdout.write(JSON.stringify({ mode: opts.full ? "full" : "lean", outcomes, lean, manifestSync, codex: codexHint }, null, 2) + "\n");
    const success = outcomes.some((o) => o.installed || o.alreadyPresent);
    return success ? 0 : 1;
  }

  // Pretty output
  ui.banner();
  process.stdout.write(
    kleur.bold("\n  🔧 Mneme MCP — auto-install\n\n") +
      "  Configures Mneme as an MCP server in your AI coding tool, so the AI\n" +
      "  can call Mneme's tools while you talk to it normally.\n\n",
  );
  if (lean) {
    process.stdout.write(
      kleur.bold().cyan("  🔦 LEAN by default") +
        kleur.dim(` — MCP advertises ${lean.leanTools} tools (not ${lean.fullTools}): `) +
        kleur.green().bold(`−${lean.reductionPct}%`) +
        kleur.dim(` (~${lean.fullApproxTokens.toLocaleString()}→~${lean.leanApproxTokens.toLocaleString()} tok/req). Full catalog reachable via mneme.morph.\n`),
    );
    if (manifestSync) process.stdout.write(
      kleur.dim(`     + agent-file manifests (CLAUDE.md etc) leaned: ${manifestSync.refreshed} file(s) → ~3k tok (was ~61k). `) +
        kleur.dim(`(use --full to opt out)\n`),
    );
    process.stdout.write("\n");
  } else if (opts.full) {
    process.stdout.write(kleur.dim("  ⚙ FULL mode — advertising the whole catalog + full manifest (MNEME_FULL=1).\n\n"));
  }

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
        "    1. Restart your AI agent(s) once (Claude Code/Cursor/Cline/Windsurf/VS Code/Zed/Continue).\n" +
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
