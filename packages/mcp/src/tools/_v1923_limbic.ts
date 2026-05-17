/**
 * v2.19.23 MNEME LIMBIC — autonomic nervous system (6 organs, 12 MCP tools)
 *
 *   🫁 BREATH (G1 killer):
 *     mneme.breath.decide          — should the daemon be respawned?
 *     mneme.breath.stats           — uptime ratio from breath ledger
 *
 *   🌊 THALAMUS (sensory router):
 *     mneme.thalamus.classify      — event → which tier handles it?
 *
 *   🪞 PROPRIOCEPTION (G2 deeper):
 *     mneme.proprioception.build   — unified catalog (cli + mcp -> one)
 *     mneme.proprioception.find    — resolve any alias to canonical entry
 *     mneme.proprioception.stats   — unified-ratio metric
 *
 *   ⚡ SPINAL REFLEX (G3+G4):
 *     mneme.spinal.blend           — blend builtin rule priors + observation posteriors
 *     mneme.spinal.list_rules      — list 8 builtin rules
 *
 *   💤 HIPPOCAMPUS (consolidation):
 *     mneme.hippocampus.consolidate — yesterday's trail -> tomorrow's priors
 *
 *   💊 HORMONAL (cross-organ tuning):
 *     mneme.hormonal.update        — observation -> new state
 *     mneme.hormonal.tune          — state -> tuned config for all organs
 *     mneme.hormonal.neutral       — fresh neutral state
 *
 *   🩺 LIMBIC stats:
 *     mneme.limbic.health          — overall organism health digest
 */

import type { MnemeTool } from "./_types.js";

// ─── BREATH ──────────────────────────────────────────────────────────

export const breathDecideTool: MnemeTool = {
  name: "mneme.breath.decide",
  category: "audit",
  description:
    "🫁 BREATH (G1 killer) — decide whether daemon needs respawning given a heartbeat probe. Pure function; caller does the actual spawn. Composes onto existing packages/cli/src/commands/daemon.ts.",
  whenToUse: "Every `mneme <cmd>` invocation; caller does silent PID check then calls this.",
  triggers: ["breath decide", "daemon respawn"],
  inputSchema: {
    type: "object",
    properties: {
      probe: { type: "object", description: "BreathProbe { pidIsAlive, pidFileExists, pid, pidFileMtimeMs, nowMs }" },
      respawnBudgetMs: { type: "number", description: "Default 500ms" },
      windowsHide: { type: "boolean", description: "Default true (ghost-sniper)" },
      detached: { type: "boolean", description: "Default true" },
      silentStdio: { type: "boolean", description: "Default true" },
    },
    required: ["probe"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Should I respawn the daemon? PID 1234 not responding.",
    args: { probe: { pidIsAlive: false, pidFileExists: true, pid: 1234, pidFileMtimeMs: 1000000, nowMs: 1000000 } },
    expectedOutput: "{ shouldRespawn: true, shouldCleanStalePidFile: true, reason: 'dead_pid: ...' }",
  }],
  pitfalls: ["DECIDES never SPAWNS. Caller (CLI bin or daemon supervisor) does the actual spawn."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const d = core.autonomicBreath.decideBreath({
      probe: args["probe"] as Parameters<typeof core.autonomicBreath.decideBreath>[0]["probe"],
      respawnBudgetMs: args["respawnBudgetMs"] as number | undefined,
      windowsHide: args["windowsHide"] as boolean | undefined,
      detached: args["detached"] as boolean | undefined,
      silentStdio: args["silentStdio"] as boolean | undefined,
    });
    return { data: d, wisdom: `🫁 BREATH · ${d.shouldRespawn ? "respawn needed" : "alive"} · ${d.reason}`, confidence: { level: "high" } };
  },
};

export const breathStatsTool: MnemeTool = {
  name: "mneme.breath.stats",
  category: "audit",
  description: "🫁 BREATH — compute uptime ratio from the breath ledger (alive vs respawned vs failed).",
  whenToUse: "Periodic daemon health audit; shows 'was I dead when user invoked me?' over time.",
  triggers: ["breath stats", "daemon uptime"],
  inputSchema: { type: "object", properties: { ledger: { type: "object" } }, required: ["ledger"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What's my daemon uptime?", args: { ledger: { v: 1, records: [] } }, expectedOutput: "{ totalChecks, alreadyAlive, respawned, uptimeRatio }" }],
  pitfalls: ["uptimeRatio is over THIS ledger only; rotate ledger weekly for a meaningful window."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.autonomicBreath.computeStats(args["ledger"] as Parameters<typeof core.autonomicBreath.computeStats>[0]);
    return { data: s, wisdom: `🫁 uptime ${(s.uptimeRatio * 100).toFixed(1)}% (${s.alreadyAlive}/${s.totalChecks})`, confidence: { level: "high" } };
  },
};

// ─── THALAMUS ────────────────────────────────────────────────────────

export const thalamusClassifyTool: MnemeTool = {
  name: "mneme.thalamus.classify",
  category: "audit",
  description: "🌊 THALAMUS — classify an event into reflex/cortex/dream/breath tier. Deterministic; HMAC-signed for audit.",
  whenToUse: "Daemon callback: which organ should handle this event? Routing is pure-function.",
  triggers: ["thalamus classify", "route event"],
  inputSchema: {
    type: "object",
    properties: {
      event: { type: "object" },
      context: { type: "object", description: "{ hasReflexCacheHit, daemonAlive, idleMs, dreamIdleThresholdMs? }" },
    },
    required: ["event", "context"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Where should this tool_call event be routed?",
    args: {
      event: { v: 1, kind: "tool_call", context: {}, ts: 1 },
      context: { hasReflexCacheHit: true, daemonAlive: true, idleMs: 0 },
    },
    expectedOutput: "{ tier: 'reflex', reason: '...', sig: '...' }",
  }],
  pitfalls: ["Priority: breath > reflex > dream > cortex. Daemon dead always wins."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const d = core.thalamus.classifyEvent({
      event: args["event"] as Parameters<typeof core.thalamus.classifyEvent>[0]["event"],
      context: args["context"] as Parameters<typeof core.thalamus.classifyEvent>[0]["context"],
    });
    return { data: d, wisdom: core.thalamus.formatRoute(d), confidence: { level: "high" } };
  },
};

// ─── PROPRIOCEPTION ──────────────────────────────────────────────────

export const proprioceptionBuildTool: MnemeTool = {
  name: "mneme.proprioception.build",
  category: "audit",
  description: "🪞 PROPRIOCEPTION (G2 deeper) — build unified CLI+MCP catalog. ONE structure both AI and user query through; info drift goes to zero.",
  whenToUse: "Boot-time or post-upgrade; produce the single source of truth for tool discovery.",
  triggers: ["proprioception build", "unified catalog"],
  inputSchema: {
    type: "object",
    properties: {
      cliCommands: { type: "array", items: { type: "object" } },
      mcpTools: { type: "array", items: { type: "object" } },
    },
    required: ["cliCommands", "mcpTools"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Give me the unified catalog so AI and user see the same thing",
    args: { cliCommands: [{ name: "ghost" }], mcpTools: [{ name: "mneme.ghost.distill" }] },
    expectedOutput: "{ entries: [{ canonical, kind: 'both', aliases, surface: ['cli','mcp'], description }], sharedCount: 1 }",
  }],
  pitfalls: ["Entries sorted by canonical name (stable order); aliases lowercased + deduplicated."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const cat = core.proprioception.buildUnifiedCatalog({
      cliCommands: args["cliCommands"] as Array<{ name: string; description?: string }>,
      mcpTools: args["mcpTools"] as Array<{ name: string; description?: string }>,
    });
    return { data: cat, wisdom: core.proprioception.formatCatalogLine(core.proprioception.computeCatalogStats(cat)), confidence: { level: "high" } };
  },
};

export const proprioceptionFindTool: MnemeTool = {
  name: "mneme.proprioception.find",
  category: "audit",
  description: "🪞 PROPRIOCEPTION — resolve any alias (kebab/snake/camel/no-delim) to its canonical entry. Case-insensitive.",
  whenToUse: "User typed 'ghost_code' or 'GHOSTCODE' — find the real command/tool.",
  triggers: ["proprioception find", "resolve alias"],
  inputSchema: { type: "object", properties: { catalog: { type: "object" }, alias: { type: "string" } }, required: ["catalog", "alias"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Find 'ghost_code'", args: { catalog: { v: 1, entries: [], totalCli: 0, totalMcp: 0, sharedCount: 0, sig: "" }, alias: "ghost_code" }, expectedOutput: "{ entry?: UnifiedCatalogEntry }" }],
  pitfalls: ["Unknown alias returns null entry; not an error."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const e = core.proprioception.findByAlias(args["catalog"] as Parameters<typeof core.proprioception.findByAlias>[0], String(args["alias"]));
    return { data: { entry: e ?? null }, wisdom: e ? `🪞 ${e.canonical} (${e.kind})` : `· unknown alias`, confidence: { level: "high" } };
  },
};

export const proprioceptionStatsTool: MnemeTool = {
  name: "mneme.proprioception.stats",
  category: "audit",
  description: "🪞 PROPRIOCEPTION — unified-ratio metric (both / total); shows how much of the catalog is silo-free.",
  whenToUse: "Quick health check on catalog parity.",
  triggers: ["proprioception stats", "unified ratio"],
  inputSchema: { type: "object", properties: { catalog: { type: "object" } }, required: ["catalog"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How unified is my catalog?", args: { catalog: { v: 1, entries: [], totalCli: 0, totalMcp: 0, sharedCount: 0, sig: "" } }, expectedOutput: "{ totalEntries, both, cliOnly, mcpOnly, unifiedRatio }" }],
  pitfalls: ["Empty catalog returns unifiedRatio=0 (avoid divide-by-zero)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.proprioception.computeCatalogStats(args["catalog"] as Parameters<typeof core.proprioception.computeCatalogStats>[0]);
    return { data: s, wisdom: core.proprioception.formatCatalogLine(s), confidence: { level: "high" } };
  },
};

// ─── SPINAL REFLEX ───────────────────────────────────────────────────

export const spinalBlendTool: MnemeTool = {
  name: "mneme.spinal.blend",
  category: "audit",
  description: "⚡ SPINAL (G3+G4) — blend BUILTIN rule priors + observation posteriors. Cold-start REFLEX works from day one because rules ship priors.",
  whenToUse: "Right after REFLEX predictFollowup returns; enrich with built-in domain knowledge.",
  triggers: ["spinal blend", "cold start reflex"],
  inputSchema: {
    type: "object",
    properties: {
      eventKind: { type: "string" },
      context: { type: "object" },
      observations: { type: "array", items: { type: "object" } },
      topN: { type: "number" },
    },
    required: ["eventKind", "context", "observations"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Predict next tools after a git_commit; I have no observations yet",
    args: { eventKind: "git_commit", context: { sha: "abc" }, observations: [] },
    expectedOutput: "{ predictions: [{ toolName, confidence, source: 'rule_only'|'blended', ... }] }",
  }],
  pitfalls: ["Sample count >= 5 dominates prior; sparse data lets prior dominate."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const predictions = core.spinalReflex.blendPredictions({
      eventKind: args["eventKind"] as Parameters<typeof core.spinalReflex.blendPredictions>[0]["eventKind"],
      context: args["context"] as Record<string, unknown>,
      observations: args["observations"] as Parameters<typeof core.spinalReflex.blendPredictions>[0]["observations"],
      topN: args["topN"] as number | undefined,
    });
    return { data: { predictions }, wisdom: `⚡ ${predictions.length} blended`, confidence: { level: "high" } };
  },
};

export const spinalListRulesTool: MnemeTool = {
  name: "mneme.spinal.list_rules",
  category: "audit",
  description: "⚡ SPINAL — list the 8 BUILTIN_RULES that ship as cold-start priors.",
  whenToUse: "When the AI agent or user wants to know what's wired by default.",
  triggers: ["spinal list rules", "builtin reflex rules"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show built-in REFLEX rules", expectedOutput: "{ rules: BuiltinReflexRule[] }" }],
  pitfalls: ["These are PRIORS only; observation history overrides when posterior is rich."],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const rules = core.spinalReflex.listBuiltinRules();
    return { data: { rules, count: rules.length }, wisdom: `⚡ ${rules.length} builtin rules`, confidence: { level: "high" } };
  },
};

// ─── HIPPOCAMPUS ─────────────────────────────────────────────────────

export const hippocampusConsolidateTool: MnemeTool = {
  name: "mneme.hippocampus.consolidate",
  category: "audit",
  description: "💤 HIPPOCAMPUS — consolidate yesterday's REFLEX observations into promoted priors for tomorrow. HMAC-signed report.",
  whenToUse: "Daemon dream-tier idle hook (typically 03:00 local); runs once per day.",
  triggers: ["hippocampus consolidate", "dream consolidation"],
  inputSchema: {
    type: "object",
    properties: {
      yesterdayObservations: { type: "array", items: { type: "object" } },
      consolidatedAt: { type: "number" },
      promotionThreshold: { type: "number", description: "Default 3 occurrences" },
    },
    required: ["yesterdayObservations"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Consolidate yesterday's pheromone trail into priors",
    args: { yesterdayObservations: [{ eventKind: "git_commit", eventSig: "sigA", toolName: "mneme.ask", args: {}, ts: 1 }] },
    expectedOutput: "{ promotedRules: [...], crystallisationRatio: N }",
  }],
  pitfalls: ["Patterns below threshold are dropped, not stored — set threshold based on your trail density."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.hippocampusDreams.consolidateMemory({
      yesterdayObservations: args["yesterdayObservations"] as Parameters<typeof core.hippocampusDreams.consolidateMemory>[0]["yesterdayObservations"],
      consolidatedAt: args["consolidatedAt"] as number | undefined,
      promotionThreshold: args["promotionThreshold"] as number | undefined,
    });
    return { data: r, wisdom: core.hippocampusDreams.formatConsolidationLine(r), confidence: { level: "high" } };
  },
};

// ─── HORMONAL ────────────────────────────────────────────────────────

export const hormonalUpdateTool: MnemeTool = {
  name: "mneme.hormonal.update",
  category: "audit",
  description: "💊 HORMONAL — apply observation feed (errors / cache hits / commits) to evolve focus/fatigue/mood state. Natural decay toward baselines.",
  whenToUse: "Daemon hook at every observable event; cheap (microseconds).",
  triggers: ["hormonal update"],
  inputSchema: {
    type: "object",
    properties: {
      state: { type: "object" },
      observation: { type: "object", description: "{ cacheHit?, toolError?, successfulCommit?, rapidAction?, elapsedMs }" },
    },
    required: ["state", "observation"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "An AI tool just errored — bump fatigue",
    args: { state: { v: 1, focus: 0.5, fatigue: 0.0, mood: 0.5, ts: 0 }, observation: { toolError: true, elapsedMs: 0 } },
    expectedOutput: "{ focus, fatigue: 0.05, mood, ts }",
  }],
  pitfalls: ["All signals clamp to [0,1]; elapsedMs drives natural decay toward baseline."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.hormonal.updateHormones({
      state: args["state"] as Parameters<typeof core.hormonal.updateHormones>[0]["state"],
      observation: args["observation"] as Parameters<typeof core.hormonal.updateHormones>[0]["observation"],
    });
    return { data: s, wisdom: core.hormonal.formatHormonalLine(s), confidence: { level: "high" } };
  },
};

export const hormonalTuneTool: MnemeTool = {
  name: "mneme.hormonal.tune",
  category: "audit",
  description: "💊 HORMONAL — derive cross-organ tuned config (BREATH heartbeat / REFLEX prefetch / DREAM threshold / NEGEV tax) from current state.",
  whenToUse: "Periodically (e.g., every 60s in daemon); feeds new tuned values to other organs.",
  triggers: ["hormonal tune"],
  inputSchema: { type: "object", properties: { state: { type: "object" } }, required: ["state"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What organ settings should I use given current hormones?", args: { state: { v: 1, focus: 0.5, fatigue: 0.0, mood: 0.5, ts: 0 } }, expectedOutput: "{ breathHeartbeatMs, reflexPrefetchBudgetMs, dreamIdleThresholdMs, negevTaxMultiplier }" }],
  pitfalls: ["Caller pushes tuned values to each organ; tuning is meta, not enforcement."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const c = core.hormonal.tuneFromHormones(args["state"] as Parameters<typeof core.hormonal.tuneFromHormones>[0]);
    return { data: c, wisdom: `💊 breath=${c.breathHeartbeatMs}ms · prefetch=${c.reflexPrefetchBudgetMs}ms · dream=${c.dreamIdleThresholdMs}ms · negev×${c.negevTaxMultiplier.toFixed(2)}`, confidence: { level: "high" } };
  },
};

export const hormonalNeutralTool: MnemeTool = {
  name: "mneme.hormonal.neutral",
  category: "audit",
  description: "💊 HORMONAL — emit a fresh neutral state (focus=0.5, fatigue=0.0, mood=0.5).",
  whenToUse: "First-run initialisation; or daily reset after consolidation.",
  triggers: ["hormonal neutral", "hormonal reset"],
  inputSchema: { type: "object", properties: { ts: { type: "number", description: "Default 0" } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Reset hormones to baseline", args: { ts: 0 }, expectedOutput: "{ focus: 0.5, fatigue: 0.0, mood: 0.5, ts: 0 }" }],
  pitfalls: [],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.hormonal.neutralState((args["ts"] as number | undefined) ?? 0);
    return { data: s, wisdom: core.hormonal.formatHormonalLine(s), confidence: { level: "high" } };
  },
};

// ─── LIMBIC overall health ───────────────────────────────────────────

export const limbicHealthTool: MnemeTool = {
  name: "mneme.limbic.health",
  category: "audit",
  description: "🩺 LIMBIC — one-line organism health digest (breath uptime + reflex hit rate + catalog unified ratio + hormonal balance).",
  whenToUse: "Top-of-pulse summary; replaces 4 separate stats calls.",
  triggers: ["limbic health", "organism status"],
  inputSchema: {
    type: "object",
    properties: {
      breathStats: { type: "object", description: "from mneme.breath.stats" },
      reflexStats: { type: "object", description: "from mneme.reflex.stats" },
      catalogStats: { type: "object", description: "from mneme.proprioception.stats" },
      hormonalState: { type: "object", description: "current HormonalState" },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show organism health", expectedOutput: "{ digest, breath, reflex, catalog, hormones, score: 0..100 }" }],
  pitfalls: ["Score = mean of the 4 sub-metrics; cosmetic, not gating."],
  handler: async (_rt, args) => {
    const breath = (args["breathStats"] as { uptimeRatio?: number } | undefined)?.uptimeRatio ?? 1;
    const reflex = (args["reflexStats"] as { hitRate?: number } | undefined)?.hitRate ?? 0;
    const catalog = (args["catalogStats"] as { unifiedRatio?: number } | undefined)?.unifiedRatio ?? 0;
    const hormones = args["hormonalState"] as { focus?: number; fatigue?: number; mood?: number } | undefined;
    const hormoneScore = hormones ? ((hormones.focus ?? 0.5) + (1 - (hormones.fatigue ?? 0)) + (hormones.mood ?? 0.5)) / 3 : 0.5;
    const score = Math.round((breath + reflex + catalog + hormoneScore) / 4 * 100);
    const digest = `🩺 LIMBIC ${score}/100 · 🫁 ${(breath * 100).toFixed(0)}% · ⚡ ${(reflex * 100).toFixed(0)}% · 🪞 ${(catalog * 100).toFixed(0)}% · 💊 ${(hormoneScore * 100).toFixed(0)}%`;
    return {
      data: { digest, score, breath, reflex, catalog, hormones: hormoneScore },
      wisdom: digest,
      confidence: { level: "high" },
    };
  },
};

export const V1923_LIMBIC_TOOLS: MnemeTool[] = [
  breathDecideTool, breathStatsTool,
  thalamusClassifyTool,
  proprioceptionBuildTool, proprioceptionFindTool, proprioceptionStatsTool,
  spinalBlendTool, spinalListRulesTool,
  hippocampusConsolidateTool,
  hormonalUpdateTool, hormonalTuneTool, hormonalNeutralTool,
  limbicHealthTool,
];
