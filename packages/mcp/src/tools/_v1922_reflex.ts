/**
 * v2.19.22 REFLEX (flagship) + CATALOG PARITY (G2 quick-win)
 *
 *   🥇 REFLEX — Automatic Pre-Execution Layer
 *     mneme.reflex.observe       — record (event, followup) into pheromone store
 *     mneme.reflex.predict       — top-N likely follow-up tools for an event
 *     mneme.reflex.cache_write   — write a tool result into the reflex cache
 *     mneme.reflex.cache_read    — read cache for (event, toolName); instant
 *     mneme.reflex.stats         — overall pheromone + cache + hit-rate stats
 *
 *   🪞 CATALOG PARITY — G2 hidden-tool audit
 *     mneme.catalog.parity       — compare CLI commands vs MCP families
 *     mneme.catalog.families     — list MCP family names extracted from catalog
 *
 * The REFLEX caller pattern (daemon-friendly):
 *   1. event fires (file save / git commit / terminal command)
 *   2. caller hashes event, calls mneme.reflex.predict to get top-N tools
 *   3. caller invokes each prediction in parallel (e.g., via MCP server)
 *   4. caller calls mneme.reflex.cache_write per result
 *   5. AI agent later asks → caller calls mneme.reflex.cache_read → instant
 */

import type { MnemeTool } from "./_types.js";

// ─── REFLEX (5 tools) ───────────────────────────────────────────────────

export const reflexObserveTool: MnemeTool = {
  name: "mneme.reflex.observe",
  category: "audit",
  description:
    "🥇 REFLEX — append a (event, followupToolCall) observation to the pheromone store. Store is HMAC-chained; daemon persists. Composes onto v2.19.21 SNN-PROMOTE for self-improving prefetch ranking.",
  whenToUse: "Daemon callback fires AFTER a tool call to record what followed which event.",
  triggers: ["reflex observe", "pheromone trail"],
  inputSchema: {
    type: "object",
    properties: {
      store: { type: "object", description: "Pheromone store JSON envelope; pass {records:[]} on first call" },
      event: { type: "object", description: "ReflexEvent { kind, context, ts }" },
      followup: { type: "object", description: "FollowupToolCall { toolName, args, ts }" },
    },
    required: ["store", "event", "followup"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Record that after git_commit on abc123, AI called mneme.ask",
    args: {
      store: { v: 1, records: [] },
      event: { v: 1, kind: "git_commit", context: { sha: "abc123" }, ts: 1 },
      followup: { toolName: "mneme.ask", args: { q: "what changed" }, ts: 2 },
    },
    expectedOutput: "{ store: { records: [<one record HMAC-chained>] } }",
  }],
  pitfalls: ["Persistence is caller's job; reflex.observe returns updated store JSON."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const out = core.reflex.recordObservation({
      store: args["store"] as Parameters<typeof core.reflex.recordObservation>[0]["store"],
      event: args["event"] as Parameters<typeof core.reflex.recordObservation>[0]["event"],
      followup: args["followup"] as Parameters<typeof core.reflex.recordObservation>[0]["followup"],
    });
    return { data: { store: out }, wisdom: `🥇 +1 obs (total=${out.records.length})`, confidence: { level: "high" } };
  },
};

export const reflexPredictTool: MnemeTool = {
  name: "mneme.reflex.predict",
  category: "audit",
  description:
    "🥇 REFLEX — return top-N likely follow-up tools for an event signature, ranked by frequency in the pheromone store. Deterministic; same input -> same output. The brain of REFLEX prefetch.",
  whenToUse: "Right after an event fires; caller uses predictions to drive prefetch loop.",
  triggers: ["reflex predict", "what will AI call next"],
  inputSchema: {
    type: "object",
    properties: {
      store: { type: "object" },
      event: { type: "object" },
      topN: { type: "number", description: "Default 3" },
    },
    required: ["store", "event"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "What tools will the AI likely call after a git_commit on this repo?",
    args: {
      store: { v: 1, records: [] },
      event: { v: 1, kind: "git_commit", context: { sha: "deadbeef" }, ts: 1 },
      topN: 3,
    },
    expectedOutput: "{ predictions: [{toolName, argsTemplate, confidence, sampleCount}] }",
  }],
  pitfalls: ["Empty store -> empty predictions. Confidence is frequency, not probability."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const predictions = core.reflex.predictFollowup({
      store: args["store"] as Parameters<typeof core.reflex.predictFollowup>[0]["store"],
      event: args["event"] as Parameters<typeof core.reflex.predictFollowup>[0]["event"],
      topN: args["topN"] as number | undefined,
    });
    return {
      data: { predictions, count: predictions.length },
      wisdom: `🥇 predict · ${predictions.length} top picks · max conf=${(predictions[0]?.confidence ?? 0).toFixed(2)}`,
      confidence: { level: "high" },
    };
  },
};

export const reflexCacheWriteTool: MnemeTool = {
  name: "mneme.reflex.cache_write",
  category: "audit",
  description:
    "🥇 REFLEX — write a tool result into the reflex cache (TTL=5min default). HMAC-signed; tampered entries refuse to hit. Caller invokes prefetch tool externally, then writes here.",
  whenToUse: "After caller invokes a prediction; cache the result for the AI agent's later read.",
  triggers: ["reflex cache write", "save prefetch result"],
  inputSchema: {
    type: "object",
    properties: {
      cache: { type: "object" },
      event: { type: "object" },
      toolName: { type: "string" },
      args: { type: "object" },
      result: {},
      ttlMs: { type: "number", description: "Default 300000 (5min)" },
    },
    required: ["cache", "event", "toolName", "args", "result"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Cache mneme.ask result for git_commit:abc",
    args: {
      cache: { v: 1, entries: {} },
      event: { v: 1, kind: "git_commit", context: { sha: "abc" }, ts: 1 },
      toolName: "mneme.ask",
      args: { q: "what changed" },
      result: { answer: "added 3 files" },
    },
    expectedOutput: "{ cache: { entries: {...} } }",
  }],
  pitfalls: ["TTL ticks from nowMs at write; aging entries auto-MISS on read."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const out = core.reflex.writeCacheEntry({
      cache: args["cache"] as Parameters<typeof core.reflex.writeCacheEntry>[0]["cache"],
      event: args["event"] as Parameters<typeof core.reflex.writeCacheEntry>[0]["event"],
      toolName: String(args["toolName"]),
      args: (args["args"] ?? {}) as Record<string, unknown>,
      result: args["result"],
      ttlMs: args["ttlMs"] as number | undefined,
    });
    return { data: { cache: out }, wisdom: `🥇 cache · wrote ${String(args["toolName"])}`, confidence: { level: "high" } };
  },
};

export const reflexCacheReadTool: MnemeTool = {
  name: "mneme.reflex.cache_read",
  category: "audit",
  description:
    "🥇 REFLEX — read the reflex cache for (event, toolName). HIT returns the cached result instantly (0ms); MISS returns reason. The AI agent's prefetch hook.",
  whenToUse: "AI agent asks a question; BEFORE invoking the cold tool, check reflex cache.",
  triggers: ["reflex cache read", "check prefetch"],
  inputSchema: {
    type: "object",
    properties: {
      cache: { type: "object" },
      event: { type: "object" },
      toolName: { type: "string" },
    },
    required: ["cache", "event", "toolName"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Did Mneme already prefetch the answer for this event?",
    args: {
      cache: { v: 1, entries: {} },
      event: { v: 1, kind: "git_commit", context: { sha: "abc" }, ts: 1 },
      toolName: "mneme.ask",
    },
    expectedOutput: "{ hit: true|false, entry?, reason? }",
  }],
  pitfalls: ["MISS reasons: no fresh entry / HMAC mismatch (tampered) / TTL expired."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.reflex.readCache({
      cache: args["cache"] as Parameters<typeof core.reflex.readCache>[0]["cache"],
      event: args["event"] as Parameters<typeof core.reflex.readCache>[0]["event"],
      toolName: String(args["toolName"]),
    });
    return { data: r, wisdom: r.hit ? `🥇 HIT` : `· miss (${r.reason})`, confidence: { level: "high" } };
  },
};

export const reflexStatsTool: MnemeTool = {
  name: "mneme.reflex.stats",
  category: "audit",
  description:
    "🥇 REFLEX — compute pheromone + cache + hit-rate stats. Use to verify your daemon's REFLEX layer is learning + caching effectively over time.",
  whenToUse: "Periodic health check; users see 'is REFLEX paying off?' instantly.",
  triggers: ["reflex stats", "hit rate"],
  inputSchema: {
    type: "object",
    properties: {
      store: { type: "object" },
      cache: { type: "object" },
      telemetry: { type: "object", description: "{ hits, misses } from caller-side fetch counter" },
    },
    required: ["store", "cache"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "What's my REFLEX hit rate this week?",
    args: { store: { v: 1, records: [] }, cache: { v: 1, entries: {} }, telemetry: { hits: 7, misses: 3 } },
    expectedOutput: "{ totalRecords, uniqueEventSigs, hitRate, freshCacheEntries, ... }",
  }],
  pitfalls: ["Hit rate only meaningful after warmup period (default 10+ same-event observations)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.reflex.computeStats({
      store: args["store"] as Parameters<typeof core.reflex.computeStats>[0]["store"],
      cache: args["cache"] as Parameters<typeof core.reflex.computeStats>[0]["cache"],
      telemetry: args["telemetry"] as Parameters<typeof core.reflex.computeStats>[0]["telemetry"],
    });
    return { data: s, wisdom: core.reflex.formatStatsLine(s), confidence: { level: "high" } };
  },
};

// ─── CATALOG PARITY (2 tools) ───────────────────────────────────────────

export const catalogParityTool: MnemeTool = {
  name: "mneme.catalog.parity",
  category: "audit",
  description:
    "🪞 CATALOG-PARITY (G2 fix) — compare CLI top-level commands vs MCP tool families. Surfaces 'hidden tool' UX gaps (MCP tools without CLI shortcut) and legacy lenses (CLI commands without MCP wrapper). HMAC-signed report.",
  whenToUse: "User reports 'AI mentioned a tool I can't find via mneme --help' — run this audit.",
  triggers: ["catalog parity", "hidden tools", "cli vs mcp"],
  inputSchema: {
    type: "object",
    properties: {
      cliTopLevelCommands: { type: "array", items: { type: "string" }, description: "List from program.commands.map(c => c.name())" },
      mcpToolNames: { type: "array", items: { type: "string" }, description: "List from buildAllTools().map(t => t.name)" },
    },
    required: ["cliTopLevelCommands", "mcpToolNames"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Compare my CLI surface to my MCP catalog",
    args: { cliTopLevelCommands: ["ghost", "status"], mcpToolNames: ["mneme.ghost.distill", "mneme.arena.judge"] },
    expectedOutput: "{ sharedFamilies, mcpOnlyFamilies, legacyOnlyCommands, parityRatio }",
  }],
  pitfalls: ["mcpOnlyFamilies isn't a bug -- v2.19.21 router auto-registers them as standalone children. Use mneme.cli.mounted_families to see clash-mounted families."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.catalogParity.computeParity({
      cliTopLevelCommands: args["cliTopLevelCommands"] as string[],
      mcpToolNames: args["mcpToolNames"] as string[],
    });
    return { data: r, wisdom: core.catalogParity.formatParityLine(r), confidence: { level: "high" } };
  },
};

export const catalogFamiliesTool: MnemeTool = {
  name: "mneme.catalog.families",
  category: "audit",
  description: "🪞 CATALOG-PARITY — extract unique MCP families from a list of `mneme.<family>.<action>` tool names. Companion to mneme.catalog.parity.",
  whenToUse: "When you have a flat tool list and need just the family names.",
  triggers: ["catalog families", "list mcp families"],
  inputSchema: {
    type: "object",
    properties: {
      mcpToolNames: { type: "array", items: { type: "string" } },
    },
    required: ["mcpToolNames"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "What families are in my MCP catalog?",
    args: { mcpToolNames: ["mneme.arena.judge", "mneme.arena.leaderboard", "mneme.badge.issue"] },
    expectedOutput: "{ families: ['arena','badge'], count: 2 }",
  }],
  pitfalls: ["Tools with parts.length !== 3 are skipped (e.g., legacy 2-part names)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const fams = Array.from(core.catalogParity.extractMcpFamilies(args["mcpToolNames"] as string[])).sort();
    return { data: { families: fams, count: fams.length }, wisdom: `🪞 ${fams.length} families`, confidence: { level: "high" } };
  },
};

export const V1922_REFLEX_TOOLS: MnemeTool[] = [
  reflexObserveTool, reflexPredictTool, reflexCacheWriteTool, reflexCacheReadTool, reflexStatsTool,
  catalogParityTool, catalogFamiliesTool,
];
