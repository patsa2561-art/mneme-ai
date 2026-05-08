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

// ─── v1.13.0 — Dynamic MCP wiring ────────────────────────────────────
//
// At server start we:
//   1. Detect ecosystems in the repo
//   2. Load all packs (bundled + user + repo)
//   3. Compile active tool catalog (only packs whose detection passes)
//   4. Merge dynamic tools INTO the static catalog (no name collisions
//      possible — dynamic tools are namespaced mneme.<pack>.<tool>)
//
// Tool-call dispatch checks dynamic tools AFTER static — so static wins
// on the rare collision (defensive).
import { dynamic } from "@mneme-ai/core";
type BuiltMcpTool = ReturnType<typeof dynamic.buildActiveToolCatalog>[number];
type Pack = ReturnType<typeof dynamic.loadAllPacks>["packs"][number];

interface DynamicState {
  /** Built tool catalog (compiled at boot). */
  catalog: BuiltMcpTool[];
  /** All loaded packs (used at dispatch time to look up tool definitions). */
  packs: Pack[];
}

function loadDynamicState(repoRoot: string): DynamicState {
  if (process.env["MNEME_NO_DYNAMIC_MCP"] === "1") {
    return { catalog: [], packs: [] };
  }
  try {
    const detection = dynamic.detectEcosystems(repoRoot);
    const paths = dynamic.getDefaultPackSearchPaths(repoRoot, dynamic.getBundledPacksDir());
    const loaded = dynamic.loadAllPacks(paths);
    // Pack failures are best-effort — don't block startup
    const catalog = dynamic.buildActiveToolCatalog({
      detection,
      packs: loaded.packs,
      // For Phase 1 we attach minimal augmentation (only base description).
      // Phase 2 will pre-fetch tribal-knowledge facts and pass them here.
      augmentDescription: (base, tool) => {
        const a = dynamic.augmentDescription(base, tool.augmentation, dynamic.EMPTY_AUGMENTATION_INPUT);
        return a.full;
      },
    });
    return { catalog, packs: loaded.packs };
  } catch {
    // Never fail MCP startup because of dynamic-tool issues
    return { catalog: [], packs: [] };
  }
}

async function dispatchDynamicTool(
  toolName: string,
  args: Record<string, unknown>,
  repoRoot: string,
  packs: Pack[],
): Promise<{ ok: true; result: CallToolResult } | { ok: false }> {
  const found = dynamic.lookupTool(toolName, packs);
  if (!found) return { ok: false };

  // Execute query + format
  const queryResult = dynamic.executeQuery(found.tool.query, repoRoot);
  if (!queryResult.ok) {
    return {
      ok: true,
      result: {
        content: [{
          type: "text",
          text: JSON.stringify({
            data: null,
            error: {
              kind: queryResult.error.kind,
              stage: queryResult.error.stage,
              message: queryResult.error.message,
            },
            wisdom: `Dynamic tool ${toolName} could not execute: ${queryResult.error.message}`,
          }, null, 2),
        }],
      },
    };
  }

  // v1.15.0: Build REAL augmentation input from Mneme stores
  // (atrophy, forensics, constitution, deprecations, git-blame).
  const hits = queryResult.result.kind === "code-search" ? queryResult.result.hits : [];
  let augInput: ReturnType<typeof dynamic.buildAugmentationInput>;
  try {
    augInput = dynamic.buildAugmentationInput({ hits, repoRoot });
  } catch {
    augInput = dynamic.EMPTY_AUGMENTATION_INPUT;
  }
  const aug = dynamic.augmentDescription(found.tool.description, found.tool.augmentation, augInput);

  return {
    ok: true,
    result: {
      content: [{
        type: "text",
        text: JSON.stringify({
          data: queryResult.result,
          wisdom: aug.full,
          followUp: [],
          confidence: { level: "medium" },
          provenance: {
            packId: found.pack.id,
            toolId: found.tool.id,
            packVersion: found.pack.version,
            schemaVersion: found.pack.schemaVersion,
            args,
          },
        }, null, 2),
      }],
    },
  };
}

export async function startMcpServer(opts: McpOptions): Promise<void> {
  const runtime = await buildRuntime(opts.cwd);
  const allTools = buildAllTools();
  const toolMap = buildToolMap();
  const dynamic = loadDynamicState(runtime.meta.rootPath);

  const server = new Server(
    { name: "mneme", version: resolveVersion() },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      ...toMcpTools(allTools),
      ...dynamic.catalog.map((t) => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema as Tool["inputSchema"],
      })),
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const tool = toolMap.get(req.params.name);
    if (tool) {
      try {
        const args = (req.params.arguments ?? {}) as Record<string, unknown>;
        const response = await tool.handler(runtime, args);
        const enriched = enrichWithSecondBrain(response, tool, runtime.meta.rootPath);
        return toCallResult(enriched);
      } catch (err) {
        return toErrorResult(
          `${req.params.name} failed: ${(err as Error).message}. ` +
            `If this tool requires the index, ask the user to run \`mneme index\`.`,
        );
      }
    }
    // Dynamic-tool dispatch (only if static didn't claim this name)
    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const dyn = await dispatchDynamicTool(req.params.name, args, runtime.meta.rootPath, dynamic.packs);
    if (dyn.ok) return dyn.result;

    return toErrorResult(
      `unknown tool: ${req.params.name}. Call mneme.capabilities to list available tools.`,
    );
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
