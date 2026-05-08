/**
 * `mneme adapter <vendor>` — export Mneme's tool catalog as the AI vendor's
 * native function-calling / tool-use format.
 *
 * Strategic role: **make Mneme universal across every AI in the world.**
 * Even AI tools that don't speak MCP can use Mneme — the user (or their AI
 * provider's tool-registration UI) imports the exported manifest and the
 * AI immediately knows how to call all 94+ Mneme tools.
 *
 * Supported vendors (v1.8.0):
 *   • openai      — function-calling JSON for GPT-4 / Codex / o-series
 *   • anthropic   — tool-use JSON for Claude
 *   • gemini      — Vertex AI tool definitions for Gemini
 *   • mcp         — original MCP catalog (passthrough, for sanity check)
 *
 * Usage:
 *   mneme adapter openai > openai-tools.json
 *   mneme adapter anthropic > claude-tools.json
 *   mneme adapter gemini > gemini-tools.json
 *
 * Then the AI vendor's CLI/API loads the file and the AI gains access to
 * Mneme. Each adapter format wraps Mneme tool descriptions, JSON schemas,
 * and the universal calling convention (HTTP POST or local CLI invoke).
 */

import { writeFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import kleur from "kleur";
import { ui } from "../ui.js";

export interface AdapterOptions {
  cwd: string;
  vendor: "openai" | "anthropic" | "gemini" | "mcp";
  out?: string;
  json?: boolean;
}

interface MnemeToolForExport {
  name: string;
  description: string;
  inputSchema: unknown;
  category?: string;
  triggers?: string[];
}

async function loadCatalog(): Promise<MnemeToolForExport[]> {
  // Import the registry from @mneme-ai/mcp at runtime so we don't drag
  // its build into the CLI bundle. The `./tools/registry` subpath was
  // added in @mneme-ai/mcp v1.8.0 — older versions don't expose it.
  try {
    const reg = (await import("@mneme-ai/mcp/tools/registry")) as {
      buildAllTools: () => Array<{
        name: string;
        description: string;
        inputSchema: unknown;
        category: string;
        triggers?: string[];
      }>;
    };
    return reg.buildAllTools().map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
      category: t.category,
      triggers: t.triggers,
    }));
  } catch (err) {
    const msg = (err as Error).message ?? "";
    if (msg.includes("Cannot find module") || msg.includes("ERR_PACKAGE_PATH_NOT_EXPORTED")) {
      throw new Error(
        "mneme adapter requires @mneme-ai/mcp v1.8.0+ (the ./tools/registry export was added then). " +
          "Run `mneme upgrade` (or `npm install -g mneme-ai@latest`) to refresh.",
      );
    }
    throw err;
  }
}

// ──────────────────────────────────────────────────────────────────────
// OpenAI function-calling format (works for GPT-4, GPT-4o, o-series, Codex)
// ──────────────────────────────────────────────────────────────────────
function exportOpenAI(catalog: MnemeToolForExport[]): unknown {
  return {
    schema: "openai/tools/v1",
    description:
      "Mneme tool catalog in OpenAI function-calling format. Register these with the chat-completions or responses API; the model can then invoke any Mneme tool via the standard tool_calls protocol. The actual execution happens by spawning `mneme <command> --json` on the user's machine.",
    invocation: {
      protocol: "local-shell",
      command: "mneme",
      argTransform:
        "Tool name `mneme.<category>.<verb>` maps to CLI subcommand `mneme <verb>` (drop the prefix). For tools without a CLI counterpart, run `mneme mcp` to start the MCP server and connect via stdio.",
    },
    tools: catalog.map((t) => ({
      type: "function",
      function: {
        name: t.name.replace(/\./g, "_"), // OpenAI requires alphanumeric+underscore
        description: t.description,
        parameters: t.inputSchema,
      },
    })),
  };
}

// ──────────────────────────────────────────────────────────────────────
// Anthropic tool-use format (Claude API)
// ──────────────────────────────────────────────────────────────────────
function exportAnthropic(catalog: MnemeToolForExport[]): unknown {
  return {
    schema: "anthropic/tools/v1",
    description:
      "Mneme tool catalog in Anthropic Claude tool-use format. Pass these as the `tools` array on Messages API requests. Claude will call them via the tool_use blocks; the host runtime invokes `mneme <command> --json` and feeds the result back.",
    invocation: {
      protocol: "local-shell",
      command: "mneme",
      preferredPath: "claude code with MCP",
    },
    tools: catalog.map((t) => ({
      name: t.name.replace(/\./g, "_"),
      description: t.description,
      input_schema: t.inputSchema,
    })),
  };
}

// ──────────────────────────────────────────────────────────────────────
// Google Gemini / Vertex AI tool format
// ──────────────────────────────────────────────────────────────────────
function exportGemini(catalog: MnemeToolForExport[]): unknown {
  return {
    schema: "gemini/tools/v1",
    description:
      "Mneme tool catalog in Gemini / Vertex AI function-declaration format. Wrap these in a `tools` parameter on generateContent calls; Gemini will return functionCall objects you execute by spawning `mneme <command> --json`.",
    invocation: {
      protocol: "local-shell",
      command: "mneme",
    },
    function_declarations: catalog.map((t) => ({
      name: t.name.replace(/\./g, "_"),
      description: t.description,
      parameters: t.inputSchema,
    })),
  };
}

// ──────────────────────────────────────────────────────────────────────
// Plain MCP catalog (sanity check / passthrough)
// ──────────────────────────────────────────────────────────────────────
function exportMcp(catalog: MnemeToolForExport[]): unknown {
  return {
    schema: "mcp/tools/v1",
    description: "Mneme MCP tool catalog — same format as ListToolsRequestSchema response.",
    tools: catalog,
  };
}

const ADAPTERS = {
  openai: exportOpenAI,
  anthropic: exportAnthropic,
  gemini: exportGemini,
  mcp: exportMcp,
} as const;

export async function adapterCommand(opts: AdapterOptions): Promise<number> {
  const fn = ADAPTERS[opts.vendor];
  if (!fn) {
    ui.error(`Unknown vendor "${opts.vendor}". Try: ${Object.keys(ADAPTERS).join(" | ")}`);
    return 1;
  }
  const catalog = await loadCatalog();
  const exported = fn(catalog);

  if (opts.out) {
    if (!existsSync(dirname(opts.out))) mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, JSON.stringify(exported, null, 2), "utf8");
    if (!opts.json) {
      ui.success(`${opts.vendor} catalog written to ${opts.out} (${catalog.length} tools)`);
    } else {
      process.stdout.write(JSON.stringify({ exported: opts.vendor, path: opts.out, toolCount: catalog.length }, null, 2) + "\n");
    }
    return 0;
  }
  // Default: print to stdout
  process.stdout.write(JSON.stringify(exported, null, 2) + "\n");
  return 0;
}

// Test exports
export const _exportOpenAIForTests = exportOpenAI;
export const _exportAnthropicForTests = exportAnthropic;
export const _exportGeminiForTests = exportGemini;
