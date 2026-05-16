/**
 * v2.19.9 WRAPPER GENESPLICING — MCP tools.
 *
 *   mneme.genome.splice            — create a chimera from a recipe
 *   mneme.genome.execute_chimera   — run a chimera with the live tool registry
 *   mneme.genome.list              — list active chimeras
 *   mneme.genome.promote           — flag a popular chimera for permanent status
 *   mneme.genome.gc                — garbage-collect expired chimeras
 *   mneme.genome.stats             — total / promoted / mostUsed / avgCallCount
 *
 * Note: execute_chimera builds the tool registry on-demand from
 * buildAllTools() so each call sees the latest catalog (including chimeras
 * spliced earlier in the same session).
 */

import type { MnemeTool } from "./_types.js";

export const genomeSpliceTool: MnemeTool = {
  name: "mneme.genome.splice",
  category: "lab",
  description:
    "🧬 GENESPLICE — runtime chimera composition. AI agent passes a recipe (list of existing tool names) + composer (sequential / fan_out / first_success) + TTL; Mneme synthesises a NEW tool, signs the recipe, returns chimera name. Content-addressed dedup.",
  whenToUse: "When the AI needs a one-call wrapper around several existing tools (e.g., 'audit then assess risk then issue badge' as one call). Saves multiple round-trips.",
  triggers: ["genome splice", "chimera tool", "compose wrappers"],
  inputSchema: {
    type: "object",
    properties: {
      recipe: { type: "array", items: { type: "string" }, description: "Ordered list of existing tool names (1-16)." },
      composer: { type: "string", enum: ["sequential", "fan_out", "first_success"], description: "Default 'sequential'." },
      argMapping: { type: "object", description: "Optional rename map between steps (advanced)." },
      ttlSec: { type: "number", description: "Default 600 (10 min)." },
    },
    required: ["recipe"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Compose: arena.judge then oracle.assess_risk then badge.issue", args: { recipe: ["mneme.arena.judge", "mneme.oracle.assess_risk", "mneme.badge.issue"], composer: "sequential" }, expectedOutput: "{ chimeraName, sig, ttlSec, expiresAt }" }],
  pitfalls: ["Same (recipe + composer + argMapping) → same chimeraName (free dedup). Re-call with the same recipe returns the existing chimera (resets nothing)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const c = core.wrapperGenesplicing.defaultGenesplicing().splice(args as unknown as Parameters<typeof core.wrapperGenesplicing.WrapperGenesplicing.prototype.splice>[0]);
    return { data: c, wisdom: core.wrapperGenesplicing.formatChimeraLine(c), confidence: { level: "high" } };
  },
};

export const genomeExecuteTool: MnemeTool = {
  name: "mneme.genome.execute_chimera",
  category: "lab",
  description:
    "🧬 GENESPLICE — execute a previously-spliced chimera with the live MCP tool registry. Returns signed ExecutionResult with per-step durations, outputs, errors.",
  whenToUse: "After mneme.genome.splice returns a chimera name; or to re-invoke a popular chimera.",
  triggers: ["execute chimera", "run chimera"],
  inputSchema: {
    type: "object",
    properties: {
      chimeraName: { type: "string" },
      inputs: { type: "object" },
    },
    required: ["chimeraName", "inputs"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run chimera mneme.chimera.abc with {prompt: '...'}", args: { chimeraName: "mneme.chimera.abc", inputs: { prompt: "..." } }, expectedOutput: "{ steps, finalOutput, ok, totalDurationMs, sig }" }],
  pitfalls: ["Chimera names are time-bounded (TTL); ExpiredError surfaces when you call past expiresAt. Re-splice if needed."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    // Build registry on-demand from the live tool catalog
    const reg = new Map<string, (a: Record<string, unknown>) => Promise<unknown> | unknown>();
    const { buildAllTools } = await import("../tools/_registry.js");
    const allTools = buildAllTools();
    for (const t of allTools) {
      reg.set(t.name, async (a) => {
        const out = await t.handler(_rt, a);
        return out;
      });
    }
    const r = await core.wrapperGenesplicing.defaultGenesplicing().execute({
      chimeraName: String(args["chimeraName"]),
      inputs: args["inputs"] as Record<string, unknown>,
      registry: reg as unknown as Parameters<typeof core.wrapperGenesplicing.WrapperGenesplicing.prototype.execute>[0]["registry"],
    });
    return { data: r, wisdom: core.wrapperGenesplicing.formatExecutionLine(r), confidence: { level: r.ok ? "high" : "low" } };
  },
};

export const genomeListTool: MnemeTool = {
  name: "mneme.genome.list",
  category: "lab",
  description:
    "🧬 GENESPLICE — list all active chimeras (in-process; not persisted across MCP restart).",
  whenToUse: "User asks 'what chimeras are alive right now?'.",
  triggers: ["genome list", "list chimeras"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show active chimeras", args: {}, expectedOutput: "{ chimeras: [...] }" }],
  pitfalls: ["Chimeras live in MCP-server memory. If you need persistence, splice again on restart."],
  handler: async (_rt) => {
    const core = await import("@mneme-ai/core");
    const chimeras = core.wrapperGenesplicing.defaultGenesplicing().list();
    return { data: { chimeras }, wisdom: `🧬 ${chimeras.length} active chimera(s)`, confidence: { level: "high" } };
  },
};

export const genomePromoteTool: MnemeTool = {
  name: "mneme.genome.promote",
  category: "lab",
  description:
    "🧬 GENESPLICE — flag a popular chimera (callCount >= threshold) for permanent status. Extends TTL 100× + sets promoted=true.",
  whenToUse: "After mneme.genome.stats surfaces a chimera with high call count.",
  triggers: ["genome promote", "promote chimera"],
  inputSchema: { type: "object", properties: { chimeraName: { type: "string" } }, required: ["chimeraName"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Promote chimera mneme.chimera.xxx", args: { chimeraName: "mneme.chimera.xxx" }, expectedOutput: "{ promoted: true, expiresAt }" }],
  pitfalls: ["Promotion is in-process. To make a chimera survive restarts permanently, hand-write a proper MCP tool with the same recipe — promotion is the bridge."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.wrapperGenesplicing.defaultGenesplicing().promote(String(args["chimeraName"]));
    return { data: r, wisdom: r ? `🌟 promoted ${r.chimeraName}` : "🧬 chimera not found", confidence: { level: r ? "high" : "low" } };
  },
};

export const genomeGcTool: MnemeTool = {
  name: "mneme.genome.gc",
  category: "lab",
  description:
    "🧬 GENESPLICE — garbage-collect expired chimeras (promoted chimeras are preserved).",
  whenToUse: "Periodic cleanup; also runs lazily on every splice() call.",
  triggers: ["genome gc", "garbage collect chimeras"],
  inputSchema: { type: "object", properties: { nowMs: { type: "number", description: "For testing." } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Clean up expired chimeras", args: {}, expectedOutput: "{ removed, remaining }" }],
  pitfalls: ["Idempotent — calling repeatedly is safe."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.wrapperGenesplicing.defaultGenesplicing().gc(args["nowMs"] !== undefined ? Number(args["nowMs"]) : undefined);
    return { data: r, wisdom: `🧬 GC · removed ${r.removed} · remaining ${r.remaining}`, confidence: { level: "high" } };
  },
};

export const genomeStatsTool: MnemeTool = {
  name: "mneme.genome.stats",
  category: "lab",
  description:
    "🧬 GENESPLICE — total/promoted/expired/avgCallCount/mostUsed across all chimeras.",
  whenToUse: "Periodic health check; finding promotion candidates.",
  triggers: ["genome stats", "chimera stats"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What's the chimera leaderboard?", args: {}, expectedOutput: "{ total, promoted, mostUsed }" }],
  pitfalls: ["Stats reflect THIS process's memory; multi-instance setups need to aggregate via colony broadcast."],
  handler: async (_rt) => {
    const core = await import("@mneme-ai/core");
    const s = core.wrapperGenesplicing.defaultGenesplicing().stats();
    return { data: s, wisdom: `🧬 STATS · ${s.total} chimeras · ${s.promoted} promoted · mostUsed=${s.mostUsed?.name ?? "(none)"}`, confidence: { level: "high" } };
  },
};

export const V199_GENESPLICING_TOOLS: MnemeTool[] = [
  genomeSpliceTool,
  genomeExecuteTool,
  genomeListTool,
  genomePromoteTool,
  genomeGcTool,
  genomeStatsTool,
];
