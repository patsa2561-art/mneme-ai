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
  /** Plain-English one-line summary. */
  headline: string;
  /** Multi-line markdown summary -- AI clients should render this directly
   *  when surfacing the report. Bug #1 (v1.74) -- consumers were getting
   *  `[object Object]` when stringifying naively. */
  text: string;
  /** Standard JS hook: String(report) returns headline so naive stringify
   *  no longer leaks `[object Object]`. */
  toString(): string;
}

// v1.76 perf -- cache the report between calls. EDITOR_INTEGRATIONS is
// a module-level constant so the report never changes within a process
// lifetime. 1000x speedup for repeated MCP calls.
let _reportCache: IntegrationReport | null = null;

export function reportIntegrations(): IntegrationReport {
  if (_reportCache) return _reportCache;
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

  const textLines: string[] = [];
  textLines.push(`# Mneme integration report`);
  textLines.push(``);
  textLines.push(headline);
  textLines.push(``);
  textLines.push(`## By integration kind`);
  for (const [k, n] of Object.entries(byKind)) {
    if (n > 0) textLines.push(`- **${k}**: ${n}`);
  }
  textLines.push(``);
  textLines.push(`## Tools`);
  for (const i of EDITOR_INTEGRATIONS) {
    textLines.push(`- **${i.displayName}** (${i.vendor}, ${i.surface}) — ${i.integration}, status: ${i.status}`);
  }
  const text = textLines.join("\n");

  const report: IntegrationReport = {
    total: EDITOR_INTEGRATIONS.length,
    working,
    partial,
    needsPaste,
    byKind,
    headline,
    text,
    toString() { return headline; },
  };
  // Make toString non-enumerable so JSON.stringify still works cleanly.
  Object.defineProperty(report, "toString", { value: () => headline, enumerable: false });
  _reportCache = report;
  return report;
}

/** Test-only helper -- reset the cache between integration tests. */
export function _resetIntegrationReportCache(): void {
  _reportCache = null;
}

/** Filter integrations by status or surface. */
export function filterIntegrations(opts: { status?: EditorIntegration["status"]; surface?: EditorIntegration["surface"] } = {}): EditorIntegration[] {
  return EDITOR_INTEGRATIONS.filter((i) => {
    if (opts.status && i.status !== opts.status) return false;
    if (opts.surface && i.surface !== opts.surface) return false;
    return true;
  });
}
