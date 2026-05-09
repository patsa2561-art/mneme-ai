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
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  CompleteRequestSchema,
  type CallToolResult,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";

import { buildRuntime } from "./tools/_runtime.js";
import { buildAllTools, buildToolMap } from "./tools/_registry.js";
import { toCallResult, toErrorResult, type MnemeTool, type ToolResponse, type ToolLifecycle } from "./tools/_types.js";
import { moleculesContaining } from "./tools/_molecules.js";
import { recordInvocation } from "./tools/_lifecycle.js";
import { homeworkForCategory } from "./tools/_homework.js";
import { recordReplay } from "./tools/_replay.js";
import { recordObservation, recordKarmaEvent } from "./tools/_aletheia.js";
import { listResources, readResource } from "./mcp_primitives/resources.js";
import { listPrompts, getPrompt } from "./mcp_primitives/prompts.js";
import { completeArgument } from "./mcp_primitives/completion.js";
import { lineage, versionCheck, karmaStreaks, nucleus, inbox } from "@mneme-ai/core";

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
 *  rich description so AI tool-selection has full WHEN-to-use guidance).
 *
 *  v1.18.0 — when a tool defines `outputSchema`, we pass it through to the
 *  MCP SDK so MCP-spec-2025-06-18-compliant clients can reason about response
 *  shape before they call. The SDK type accepts the field as `outputSchema`
 *  on the Tool spec; we cast to keep the SDK boundary loose. */
function toMcpTools(all: MnemeTool[]): Tool[] {
  return all.map((t) => {
    const base: Tool = {
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    };
    if (t.outputSchema) {
      (base as Tool & { outputSchema?: unknown }).outputSchema = t.outputSchema;
    }
    return base;
  });
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

  // ─── v1.20.0 — Mneme Glow brand + streak banner + lineage credit ───
  // Make Mneme's contribution visible in EVERY response so the agent
  // (and downstream user) feel the value at inference time.
  const enrichedWisdom = wrapWithGlow(repoRoot, response.wisdom, tool.name);

  return {
    ...response,
    wisdom: enrichedWisdom,
    secondBrain: {
      presentation: existing?.presentation,
      compose: existing?.compose && existing.compose.length > 0 ? existing.compose : compose,
      lifecycle: existing?.lifecycle ?? lifecycle,
      homework: existing?.homework ?? homework,
    },
  };
}

/** v1.20.0 — Mneme Glow: prefix wisdom with sparkle + append streak banner
 *  and (when relevant) cross-AI lineage credit. Best-effort; falls through
 *  to the original wisdom on any error. */
function wrapWithGlow(repoRoot: string, wisdom: string, toolName: string): string {
  try {
    const parts: string[] = [];

    // ─── v1.23.0 — Inbox Force-Push channel ──────────────────────────
    // Read up to 3 unsent inbox messages and PREPEND them to wisdom.
    // This is how Mneme (especially the daemon) talks to the user FIRST,
    // mid-conversation, without the user typing anything Mneme-related.
    // popUnsent flips the sent flag so each message surfaces exactly once.
    try {
      const pending = inbox.popUnsent(repoRoot, 3);
      const block = inbox.formatForWisdom(pending);
      if (block) parts.push(block);
    } catch {
      // Best-effort. Never block a tool call on inbox I/O.
    }

    parts.push(`✨ ${wisdom}`);

    // Streak banner — only when there's something noteworthy to surface.
    const streaks = karmaStreaks.readStreaks(repoRoot);
    const banner = karmaStreaks.streakBanner(streaks);
    if (banner) parts.push(`\n[${banner}]`);

    // Lineage credit footer — show on memory/people/insights tools where
    // inheriting context is most relevant. Only when chromosomes exist.
    const showLineage =
      toolName.startsWith("mneme.memory.") ||
      toolName.startsWith("mneme.people.") ||
      toolName.startsWith("mneme.insights.") ||
      toolName === "mneme.welcome" ||
      toolName === "mneme.capabilities";
    if (showLineage) {
      const ids = lineage.listChromosomes(repoRoot);
      if (ids.length > 0) {
        const ped = lineage.buildPedigree(repoRoot);
        const vendors = ped.vendors.map((v) => v.vendor).slice(0, 3);
        if (vendors.length > 0) {
          parts.push(`\n[guided by Mneme · informed by ${ids.length} prior session${ids.length === 1 ? "" : "s"} across ${vendors.join(" + ")}]`);
        }
      }
    }
    return parts.join("");
  } catch {
    return wisdom;
  }
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

  // ─── v1.20.0 — record boot timestamp for mneme.system.health uptime ──
  (globalThis as { __mnemeBootedAt?: number }).__mnemeBootedAt = Date.now();

  // ─── v1.19.2 — fire-and-forget version check at boot ──────────────
  // Hits the npm registry once per 24h (cached). Result stashed in
  // globalThis so the welcome contract + resource handler can read it
  // without re-fetching. Never blocks the server boot path.
  void (async () => {
    try {
      const current = resolveVersion();
      const status = await versionCheck.checkVersion(runtime.meta.rootPath, current);
      (globalThis as { __mnemeUpdateStatus?: unknown }).__mnemeUpdateStatus = status;
    } catch {
      // best-effort
    }
  })();


  // ─── MneMeiosis (v1.19) — boot the working-memory session + fertilize ────
  // Detect AI vendor from MCP client info if available (best-effort —
  // falls back to "unknown-mcp-client" so chromosomes are still attributable).
  const lineageSettings = lineage.readSettings(runtime.meta.rootPath);
  const sessionVendor = process.env["MNEME_AI_VENDOR"] ?? "unknown-mcp-client";
  const machineId = lineage.machineFingerprint(runtime.meta.rootPath);
  const sessionId = `${new Date().toISOString().replace(/[:.]/g, "")}-${sessionVendor}-${machineId.slice(0, 6)}`;

  if (!lineageSettings.optedOut) {
    lineage.startSession({ sessionId, vendor: sessionVendor, machineId });

    // Auto-fertilize at boot — agent gets the inheritance bundle via
    // mneme://lineage/inheritance resource (best-effort; non-blocking).
    try {
      const bundle = lineage.fertilize(runtime.meta.rootPath, { topN: 3 });
      if (bundle) {
        // Stash the bundle in working memory so the resource handler
        // surfaces it on first read (no need to recompute on every read).
        // We rely on a process-global var — single MCP process per session.
        (globalThis as { __mnemeInheritanceBundle?: typeof bundle }).__mnemeInheritanceBundle = bundle;
      }
    } catch { /* best-effort */ }

    // Auto-crystallize on process exit signals.
    const onExit = (reason: "exit-signal" | "idle-timeout") => {
      try {
        const result = lineage.crystallize(runtime.meta.rootPath, { endReason: reason });
        if (result) lineage.addToTree(runtime.meta.rootPath, result.chromosome);
      } catch { /* best-effort */ }
    };
    process.on("SIGTERM", () => { onExit("exit-signal"); process.exit(0); });
    process.on("SIGINT", () => { onExit("exit-signal"); process.exit(0); });
    process.on("beforeExit", () => onExit("exit-signal"));

    // Idle-timeout crystallize — every 45 min of no MCP calls.
    const IDLE_MS = 45 * 60 * 1000;
    let idleTimer: NodeJS.Timeout | null = null;
    const resetIdleTimer = () => {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        const result = lineage.crystallize(runtime.meta.rootPath, { endReason: "idle-timeout" });
        if (result) {
          lineage.addToTree(runtime.meta.rootPath, result.chromosome);
          // Start a fresh session post-idle for the next round of work.
          lineage.startSession({ sessionId: `${sessionId}-idle-${Date.now()}`, vendor: sessionVendor, machineId });
        }
      }, IDLE_MS);
    };
    // Stash so the dispatch path can call it.
    (globalThis as { __mnemeResetIdleTimer?: () => void }).__mnemeResetIdleTimer = resetIdleTimer;
    resetIdleTimer();
  }

  const server = new Server(
    { name: "mneme", version: resolveVersion() },
    {
      capabilities: {
        tools: {},
        // v1.18.0 — Mneme advertises 4 MCP primitives + tools (was: tools only).
        // resources    — read-only views of constitution / catalog / karma
        // prompts      — pre-baked workflow templates (slash commands)
        // completions  — tab-complete tool / category / arg values
        // logging      — sink for forensic + lifecycle events
        resources: { subscribe: false, listChanged: true },
        prompts: { listChanged: false },
        completions: {},
        logging: {},
      },
    },
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

  // ─── MCP primitives — resources / prompts / completion ──────────────
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: listResources(runtime),
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async (req) => ({
    contents: [readResource(runtime, req.params.uri)],
  }));
  server.setRequestHandler(ListPromptsRequestSchema, async () => ({
    prompts: listPrompts(),
  }));
  server.setRequestHandler(GetPromptRequestSchema, async (req) => {
    const args: Record<string, string> = {};
    if (req.params.arguments) {
      for (const [k, v] of Object.entries(req.params.arguments)) {
        args[k] = String(v);
      }
    }
    // SDK type unions GetPromptResult with a task-bearing variant; our
    // shape matches GetPromptResult exactly. Cast to satisfy the union.
    return getPrompt(req.params.name, args) as never;
  });
  server.setRequestHandler(CompleteRequestSchema, async (req) => {
    const ref = req.params.ref;
    const argName = req.params.argument.name;
    const partial = String(req.params.argument.value ?? "");
    const toolName = ref.type === "ref/prompt" ? ref.name : "";
    const values = completeArgument(toolName, argName, partial);
    return {
      completion: { values, total: values.length, hasMore: false },
    };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const tool = toolMap.get(req.params.name);
    if (tool) {
      try {
        const args = (req.params.arguments ?? {}) as Record<string, unknown>;
        // v1.18.0 — record observation for ALETHEIA immune profile (best-effort).
        recordObservation(runtime.meta.rootPath, tool.name, args);
        // v1.19.0 — record atom in MneMeiosis working memory + reset idle timer.
        try {
          lineage.recordAtom(runtime.meta.rootPath, tool.name, args);
          const resetIdle = (globalThis as { __mnemeResetIdleTimer?: () => void }).__mnemeResetIdleTimer;
          if (resetIdle) resetIdle();
        } catch { /* best-effort */ }
        const response = await tool.handler(runtime, args);
        const enriched = enrichWithSecondBrain(response, tool, runtime.meta.rootPath);
        // v1.18.0 — record HMAC-chained replay entry for audit (best-effort).
        recordReplay(runtime.meta.rootPath, tool.name, args, enriched);
        // v1.18.0 — increment karma invocations.
        recordKarmaEvent(runtime.meta.rootPath, tool.name, "invocation");
        // v1.20.0 — Infinity Wisdom Brain: auto-tick the nucleus on EVERY
        // tool dispatch. This is the `while(is_talking) learn/teach`
        // loop — as long as the AI agent talks to Mneme, the nucleus
        // grows. Best-effort, never blocks dispatch.
        try {
          // Throttle: tick at most once every 5 seconds to avoid
          // thrashing disk on rapid-fire calls. Reads global timestamp.
          const g = globalThis as { __mnemeLastTickAt?: number };
          const now = Date.now();
          if (!g.__mnemeLastTickAt || now - g.__mnemeLastTickAt >= 5000) {
            nucleus.tick(runtime.meta.rootPath);
            g.__mnemeLastTickAt = now;
          }
        } catch { /* best-effort */ }
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

  // ─── v1.22.0 — RECURRING version-check + push notification ─────────
  // Checks every 6 hours and PUSHES an MCP notification when a new
  // version is detected. AI agents that subscribed to
  // mneme://updates/status receive resources/updated and surface "Mneme
  // v1.X is available, want me to upgrade?" on the next response.
  // Idempotent: never re-pushes for the same version.
  let lastNotifiedVersion: string | null = null;
  const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
  const tickVersionCheck = async () => {
    try {
      const current = resolveVersion();
      const status = await versionCheck.checkVersion(runtime.meta.rootPath, current);
      (globalThis as { __mnemeUpdateStatus?: unknown }).__mnemeUpdateStatus = status;
      if (status.updateAvailable && status.latest && status.latest !== lastNotifiedVersion) {
        lastNotifiedVersion = status.latest;
        try {
          (server as unknown as { notification: (n: { method: string; params: unknown }) => Promise<void> | void })
            .notification({
              method: "notifications/resources/updated",
              params: { uri: "mneme://updates/status" },
            });
        } catch { /* best-effort */ }
      }
    } catch { /* best-effort */ }
  };
  setTimeout(() => {
    void tickVersionCheck();
    setInterval(() => { void tickVersionCheck(); }, RECHECK_INTERVAL_MS).unref?.();
  }, 30 * 60 * 1000).unref?.();

  // CRITICAL (v1.19.5): keep the event loop alive after connect() resolves.
  // The SDK registers a stdin 'data' listener but does NOT call resume(),
  // so on some platforms (notably Windows piped stdin) Node considers the
  // event loop idle and exits 0 BEFORE the first JSON-RPC frame is read.
  // Result: every MCP client got "Connection closed" before initialize.
  // Fix: explicitly resume stdin + await a never-resolving promise that
  // is rejected only when the transport closes (SIGTERM / EOF / explicit
  // close()). The transport's onclose handler resolves it for us.
  process.stdin.resume();
  await new Promise<void>((resolve) => {
    transport.onclose = () => resolve();
    process.on("SIGINT", () => resolve());
    process.on("SIGTERM", () => resolve());
  });
}
