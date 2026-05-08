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
import { toCallResult, toErrorResult, type MnemeTool, type ToolResponse, type ToolLifecycle } from "./tools/_types.js";
import { moleculesContaining } from "./tools/_molecules.js";
import { recordInvocation } from "./tools/_lifecycle.js";
import { homeworkForCategory } from "./tools/_homework.js";

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

/** Auto-enrich a tool response with Second Brain layer:
 *    - compose: which molecules this atom participates in
 *    - lifecycle: is this a new combination? should we suggest saving?
 *
 *  If the handler already populated `secondBrain`, we MERGE — handler's
 *  presentation hint wins, and we add compose/lifecycle if missing. */
function enrichWithSecondBrain(
  response: ToolResponse,
  tool: MnemeTool,
  repoRoot: string,
): ToolResponse {
  const compose = moleculesContaining(tool.name);
  let lifecycle: ToolLifecycle | undefined;
  try {
    lifecycle = recordInvocation(repoRoot, tool.name);
  } catch {
    // Lifecycle is best-effort — never fail a tool call because of it.
    lifecycle = undefined;
  }
  // Homework — auto-attach the category's default rubric. The grader
  // tool itself doesn't need homework (it IS the grader); skip those.
  const isGraderItself = tool.name === "mneme.grade.answer" || tool.name === "mneme.capabilities";
  const homework = isGraderItself ? undefined : homeworkForCategory(tool.category);
  const existing = response.secondBrain;
  return {
    ...response,
    secondBrain: {
      presentation: existing?.presentation,
      compose: existing?.compose && existing.compose.length > 0 ? existing.compose : compose,
      lifecycle: existing?.lifecycle ?? lifecycle,
      homework: existing?.homework ?? homework,
    },
  };
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
      // Second Brain — auto-enrich every response with composition hints
      // + lifecycle tracking + homework rubric. The chain reaction +
      // teacher-student loop start here.
      const enriched = enrichWithSecondBrain(response, tool, runtime.meta.rootPath);
      return toCallResult(enriched);
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
