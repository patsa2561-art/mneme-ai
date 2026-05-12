/**
 * v1.74.0 -- PERMEATE P3: EDITOR INTEGRATION MAP.
 *
 * Single source of truth answering "does Mneme work with my editor's
 * AI?" Returns a matrix of every editor-based AI tool + how Mneme
 * connects to it + what (if anything) the user needs to do.
 *
 * Editor AI tools DON'T need a browser extension because they
 * already speak MCP. Mneme parasite-bridge auto-injects + the
 * Schroedinger embedder picks the best memory tier. The user just
 * starts the editor; everything else is automatic.
 */

export type IntegrationKind = "native-mcp" | "parasite-bridge" | "browser-only" | "partial";

export interface EditorIntegration {
  id: string;
  displayName: string;
  vendor: string;
  /** Where the AI runs (editor extension / web / desktop app). */
  surface: "editor-extension" | "cli" | "web" | "desktop-app";
  /** How Mneme connects. */
  integration: IntegrationKind;
  /** Is this connection currently working? */
  status: "working" | "partial" | "manual-setup" | "needs-paste";
  /** Plain-English one-liner. */
  note: string;
}

export const EDITOR_INTEGRATIONS: EditorIntegration[] = [
  // ─── Native MCP (zero setup) ───────────────────────────────────
  {
    id: "claude-code",
    displayName: "Claude Code (CLI/extension)",
    vendor: "Anthropic",
    surface: "cli",
    integration: "native-mcp",
    status: "working",
    note: "Mneme MCP auto-registered. Parasite-bridge updates CLAUDE.md. Zero manual setup.",
  },
  {
    id: "cursor",
    displayName: "Cursor",
    vendor: "Anysphere",
    surface: "editor-extension",
    integration: "native-mcp",
    status: "working",
    note: "MCP servers configurable via Cursor settings. Mneme parasite-bridge writes .cursor/rules/mneme.mdc.",
  },
  {
    id: "continue",
    displayName: "Continue",
    vendor: "Continue.dev",
    surface: "editor-extension",
    integration: "native-mcp",
    status: "working",
    note: "Add Mneme to config.json's mcp.servers array; restart Continue.",
  },
  {
    id: "cline",
    displayName: "Cline (Claude Dev)",
    vendor: "Cline",
    surface: "editor-extension",
    integration: "native-mcp",
    status: "working",
    note: "MCP-native. Adds Mneme via Cline's MCP marketplace UI or settings.json.",
  },
  {
    id: "aider",
    displayName: "Aider",
    vendor: "paul-gauthier",
    surface: "cli",
    integration: "native-mcp",
    status: "working",
    note: "Aider supports MCP server config; Mneme connects local-first.",
  },
  {
    id: "zed",
    displayName: "Zed AI",
    vendor: "Zed Industries",
    surface: "editor-extension",
    integration: "native-mcp",
    status: "working",
    note: "Zed has MCP support in recent versions. Mneme connects natively.",
  },
  {
    id: "codex",
    displayName: "Codex",
    vendor: "OpenAI",
    surface: "editor-extension",
    integration: "parasite-bridge",
    status: "working",
    note: "Parasite-bridge writes AGENTS.md (auto-gitignored by v1.72 Ghost Sniper).",
  },
  {
    id: "windsurf",
    displayName: "Windsurf",
    vendor: "Codeium",
    surface: "editor-extension",
    integration: "parasite-bridge",
    status: "working",
    note: "Parasite-bridge writes .windsurfrules (auto-gitignored).",
  },
  {
    id: "copilot-chat",
    displayName: "GitHub Copilot Chat",
    vendor: "GitHub",
    surface: "editor-extension",
    integration: "native-mcp",
    status: "working",
    note: "Recent Copilot Chat versions support MCP. Mneme connects via VS Code's MCP settings.",
  },
  // ─── Partial ──────────────────────────────────────────────────
  {
    id: "jetbrains-ai",
    displayName: "JetBrains AI Assistant",
    vendor: "JetBrains",
    surface: "editor-extension",
    integration: "partial",
    status: "partial",
    note: "JetBrains MCP support is rolling out. Currently parasite-bridge writes .jetbrains/copilot-instructions.md as fallback.",
  },
  // ─── Browser-only (needs paste or PERMEATE userscript) ────────
  {
    id: "chatgpt-web",
    displayName: "ChatGPT (web)",
    vendor: "OpenAI",
    surface: "web",
    integration: "browser-only",
    status: "needs-paste",
    note: "Sandboxed browser. Use v1.73 soul prompt paste OR v1.74 PERMEATE userscript.",
  },
  {
    id: "gemini-web",
    displayName: "Gemini (web)",
    vendor: "Google",
    surface: "web",
    integration: "browser-only",
    status: "needs-paste",
    note: "Sandboxed browser. Use soul prompt paste OR PERMEATE userscript.",
  },
  {
    id: "claude-ai",
    displayName: "Claude.ai (web)",
    vendor: "Anthropic",
    surface: "web",
    integration: "browser-only",
    status: "needs-paste",
    note: "Sandboxed browser. Use soul prompt paste OR PERMEATE userscript. Claude Connectors coming.",
  },
  {
    id: "copilot-web",
    displayName: "Copilot (web)",
    vendor: "Microsoft",
    surface: "web",
    integration: "browser-only",
    status: "needs-paste",
    note: "Browser sandbox. PERMEATE userscript injects soul prompt.",
  },
  {
    id: "deepseek-web",
    displayName: "DeepSeek (web)",
    vendor: "DeepSeek",
    surface: "web",
    integration: "browser-only",
    status: "needs-paste",
    note: "Browser sandbox. Soul prompt paste works.",
  },
];

export interface IntegrationReport {
  total: number;
  working: number;
  partial: number;
  needsPaste: number;
  byKind: Record<IntegrationKind, number>;
  /** Plain-English summary. */
  headline: string;
}

export function reportIntegrations(): IntegrationReport {
  const byKind: Record<IntegrationKind, number> = {
    "native-mcp": 0, "parasite-bridge": 0, "browser-only": 0, "partial": 0,
  };
  let working = 0, partial = 0, needsPaste = 0;
  for (const i of EDITOR_INTEGRATIONS) {
    byKind[i.integration] += 1;
    if (i.status === "working") working += 1;
    else if (i.status === "partial") partial += 1;
    else if (i.status === "needs-paste") needsPaste += 1;
  }
  const headline = `${EDITOR_INTEGRATIONS.length} AI tools tracked: ${working} working / ${partial} partial / ${needsPaste} browser-only (use PERMEATE userscript or soul-prompt paste).`;
  return { total: EDITOR_INTEGRATIONS.length, working, partial, needsPaste, byKind, headline };
}

/** Filter integrations by status or surface. */
export function filterIntegrations(opts: { status?: EditorIntegration["status"]; surface?: EditorIntegration["surface"] } = {}): EditorIntegration[] {
  return EDITOR_INTEGRATIONS.filter((i) => {
    if (opts.status && i.status !== opts.status) return false;
    if (opts.surface && i.surface !== opts.surface) return false;
    return true;
  });
}
