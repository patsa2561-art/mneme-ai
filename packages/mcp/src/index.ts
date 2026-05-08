/**
 * Mneme MCP Server — entrypoint.
 *
 * Architecture (since v1.2.0):
 *   tools/_types.ts       — MnemeTool + ToolResponse + wisdom envelope
 *   tools/_runtime.ts     — buildRuntime() + passthroughHandler() + runCliJson()
 *   tools/_registry.ts    — buildAllTools() merges every category file
 *   tools/_capabilities.ts — syllabus tool (the curriculum AI calls first)
 *   tools/_smart_do.ts    — fallback NL dispatcher
 *   tools/<category>.ts   — memory · people · audit · forensics · insights ·
 *                           quality · quant · lab · meta
 *
 * Positioning: Mneme is the TEACHER, AI is the STUDENT. Every tool returns a
 * `{data, wisdom, followUp, confidence}` envelope so AI clients get the data
 * + an interpretive wisdom string + cross-references in one shot. The AI
 * doesn't need to interpret raw JSON; Mneme pre-digests every finding.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { buildRuntime } from "./tools/_runtime.js";
import { buildAllTools, buildToolMap } from "./tools/_registry.js";
import { toCallResult, toErrorResult, type MnemeTool } from "./tools/_types.js";

export interface McpOptions {
  cwd: string;
}

function resolveVersion(): string {
  try {
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8")) as {
      version?: string;
    };
    return pkg.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

/** Convert MnemeTool[] to MCP's Tool[] shape (drops handler + triggers, keeps the
 *  rich description so AI tool-selection has full WHEN-to-use guidance). */
function toMcpTools(all: MnemeTool[]): Tool[] {
  return all.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema,
  }));
}

export async function startMcpServer(opts: McpOptions): Promise<void> {
  const runtime = await buildRuntime(opts.cwd);
  const allTools = buildAllTools();
  const toolMap = buildToolMap();

  const server = new Server(
    { name: "mneme", version: resolveVersion() },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: toMcpTools(allTools),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const tool = toolMap.get(req.params.name);
    if (!tool) {
      return toErrorResult(
        `unknown tool: ${req.params.name}. Call mneme.capabilities to list available tools.`,
      );
    }
    try {
      const args = (req.params.arguments ?? {}) as Record<string, unknown>;
      const response = await tool.handler(runtime, args);
      return toCallResult(response);
    } catch (err) {
      return toErrorResult(
        `${req.params.name} failed: ${(err as Error).message}. ` +
          `If this tool requires the index, ask the user to run \`mneme index\`.`,
      );
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
