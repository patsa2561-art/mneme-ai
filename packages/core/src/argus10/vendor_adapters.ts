/**
 * v2.41.0 — ARGUS-11 VENDOR ADAPTERS.
 *
 * One registry of "how vendor X talks to ARGUS-11 search". Each adapter
 * is a small pure-function description (transport / wireFormat / auth)
 * — the actual wire is the HTTP bridge endpoint /v1/argus/search OR
 * the MCP `mneme.argus.search` tool, both of which speak the same
 * request/response shape.
 *
 * Why this matters for the "world's first" claim: a search primitive
 * is only universal if every AI agent can call it. We don't need 9
 * different APIs — we need one canonical surface + an adapter table
 * that proves we KNOW about each integration path.
 *
 * The TRUTH GATE probe (claim.argus11.world_first_multimodal) asserts
 * registered() ≥ 9 — drift below trips the gate.
 */

export type VendorTransport = "mcp" | "http-bridge" | "userscript" | "cli";

export interface VendorAdapter {
  /** Canonical id (lowercase, kebab-case). */
  id: string;
  /** Human-readable name. */
  displayName: string;
  /** How this vendor reaches ARGUS-11. */
  transport: VendorTransport;
  /** Wire format used. */
  wireFormat: "json-rpc-2.0" | "rest" | "tampermonkey-postmessage";
  /** Endpoint the vendor calls (CLI command / URL / tool name). */
  endpoint: string;
  /** Auth model. */
  auth: "stdio-mcp" | "http-token" | "userscript-grant" | "shell";
  /** What works today (verifyable). */
  status: "live" | "ref-impl" | "stub";
  /** Free-form note: what users hit when calling this adapter. */
  notes: string;
}

export const VENDOR_ADAPTERS: ReadonlyArray<VendorAdapter> = [
  // ── Editors with native MCP ─────────────────────────────────────────
  {
    id: "claude-desktop",
    displayName: "Claude Desktop",
    transport: "mcp",
    wireFormat: "json-rpc-2.0",
    endpoint: "mneme.argus.search",
    auth: "stdio-mcp",
    status: "live",
    notes: "stdio MCP — add {command:'mneme',args:['mcp']} to claude_desktop_config.json.",
  },
  {
    id: "cursor",
    displayName: "Cursor",
    transport: "mcp",
    wireFormat: "json-rpc-2.0",
    endpoint: "mneme.argus.search",
    auth: "stdio-mcp",
    status: "live",
    notes: "settings.json → cursor.mcp.servers.mneme.",
  },
  {
    id: "cline",
    displayName: "Cline",
    transport: "mcp",
    wireFormat: "json-rpc-2.0",
    endpoint: "mneme.argus.search",
    auth: "stdio-mcp",
    status: "live",
    notes: "Cline MCP picker — pick @mneme-ai/mcp.",
  },
  {
    id: "continue",
    displayName: "Continue.dev",
    transport: "mcp",
    wireFormat: "json-rpc-2.0",
    endpoint: "mneme.argus.search",
    auth: "stdio-mcp",
    status: "live",
    notes: "continue.config.json mcpServers.mneme.",
  },
  {
    id: "zed",
    displayName: "Zed",
    transport: "mcp",
    wireFormat: "json-rpc-2.0",
    endpoint: "mneme.argus.search",
    auth: "stdio-mcp",
    status: "live",
    notes: "Zed context-server config (MCP).",
  },
  {
    id: "codex",
    displayName: "OpenAI Codex",
    transport: "mcp",
    wireFormat: "json-rpc-2.0",
    endpoint: "mneme.argus.search",
    auth: "stdio-mcp",
    status: "live",
    notes: "OpenAI Codex MCP server registry.",
  },
  {
    id: "claude-code",
    displayName: "Claude Code",
    transport: "mcp",
    wireFormat: "json-rpc-2.0",
    endpoint: "mneme.argus.search",
    auth: "stdio-mcp",
    status: "live",
    notes: "claude mcp add mneme -- mneme mcp.",
  },
  {
    id: "aider",
    displayName: "Aider",
    transport: "cli",
    wireFormat: "rest",
    endpoint: "mneme argus search --query ... --candidates ...",
    auth: "shell",
    status: "live",
    notes: "shell-out from Aider (CLI is JSON-out by default).",
  },
  {
    id: "gemini-cli",
    displayName: "Gemini CLI",
    transport: "cli",
    wireFormat: "rest",
    endpoint: "mneme argus search",
    auth: "shell",
    status: "live",
    notes: "shell-out (Gemini CLI has shell-tool primitive).",
  },
  // ── Web AIs via Tampermonkey + HTTP bridge ──────────────────────────
  {
    id: "chatgpt-web",
    displayName: "ChatGPT (chatgpt.com)",
    transport: "userscript",
    wireFormat: "tampermonkey-postmessage",
    endpoint: "POST http://127.0.0.1:17741/v1/argus/search",
    auth: "userscript-grant",
    status: "live",
    notes: "polygraph userscript proxies fetch via GM_xmlhttpRequest.",
  },
  {
    id: "claude-ai-web",
    displayName: "claude.ai (web)",
    transport: "userscript",
    wireFormat: "tampermonkey-postmessage",
    endpoint: "POST http://127.0.0.1:17741/v1/argus/search",
    auth: "userscript-grant",
    status: "live",
    notes: "polygraph userscript proxies fetch via GM_xmlhttpRequest.",
  },
  {
    id: "gemini-web",
    displayName: "Gemini (gemini.google.com)",
    transport: "userscript",
    wireFormat: "tampermonkey-postmessage",
    endpoint: "POST http://127.0.0.1:17741/v1/argus/search",
    auth: "userscript-grant",
    status: "live",
    notes: "polygraph userscript proxies fetch via GM_xmlhttpRequest.",
  },
  // ── Direct HTTP (any vendor) ────────────────────────────────────────
  {
    id: "http-direct",
    displayName: "Generic HTTP client (any AI agent / cron / curl)",
    transport: "http-bridge",
    wireFormat: "rest",
    endpoint: "POST http://127.0.0.1:17741/v1/argus/search",
    auth: "http-token",
    status: "live",
    notes: "Bridge process started via `mneme bridge --detach`.",
  },
];

export function listAdapters(): ReadonlyArray<VendorAdapter> {
  return VENDOR_ADAPTERS;
}

export function countAdapters(): number {
  return VENDOR_ADAPTERS.filter((a) => a.status === "live").length;
}

export function findAdapter(id: string): VendorAdapter | undefined {
  return VENDOR_ADAPTERS.find((a) => a.id.toLowerCase() === id.toLowerCase());
}

export function adaptersByTransport(t: VendorTransport): ReadonlyArray<VendorAdapter> {
  return VENDOR_ADAPTERS.filter((a) => a.transport === t);
}
