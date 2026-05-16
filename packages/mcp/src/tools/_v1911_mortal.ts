/**
 * v2.19.11 MORTAL + REINCARNATING WRAPPERS — LIVING MCP (8 tools).
 *
 *   mneme.mortal.birth        — register a mortal wrapper around a base tool name
 *   mneme.mortal.list         — enumerate all wrappers (alive + deprecated) in the registry
 *   mneme.mortal.tick         — one reincarnation cycle (daemon-callable; budgeted)
 *   mneme.mortal.resolve      — translate a mortal alias call back to base tool + args
 *   mneme.mortal.invoke       — convenience: resolve + record calibration in one step
 *   mneme.mortal.calibration  — per-caller adaptiveness score (world_class/good/drifting/over_fit)
 *   mneme.mortal.stats        — global stats: alive / deprecated / mutation histogram
 *   mneme.mortal.verify       — verify a mortal wrapper's HMAC signature
 *
 * Honest scope: the mortal layer lives in `mneme.mortal.*` ONLY. Real Mneme
 * tools (mneme.arena.*, mneme.proof.*, ...) stay backwards-compatible forever.
 * Mortal wrappers are an OPT-IN calibration tripwire for AI-agent adaptiveness.
 */

import type { MnemeTool } from "./_types.js";

// In-memory registry singleton scoped to this MCP server process. Persistence
// is intentionally out of scope for v2.19.11 — AI agent supplies state for
// cross-restart continuity, or stores it via `mneme.memory.*` if needed.
let registry: import("@mneme-ai/core").mortalWrappers.MortalRegistryState | null = null;
async function getRegistry(): Promise<import("@mneme-ai/core").mortalWrappers.MortalRegistryState> {
  if (!registry) {
    const core = await import("@mneme-ai/core");
    registry = core.mortalWrappers.emptyState();
  }
  return registry;
}
async function setRegistry(next: import("@mneme-ai/core").mortalWrappers.MortalRegistryState): Promise<void> {
  registry = next;
}

export const mortalBirthTool: MnemeTool = {
  name: "mneme.mortal.birth",
  category: "lab",
  description:
    "🧬 MORTAL — register a new mortal wrapper around a base tool. Born with a TTL; will be reincarnated with a drifted signature on tick. Use to stress-test AI-agent adaptiveness (forces re-reading of mneme.tools every cycle).",
  whenToUse: "Opt-in. When you want to publish a wrapper alias that intentionally drifts over time as a calibration tripwire.",
  triggers: ["mortal birth", "mortal register", "living wrapper"],
  inputSchema: {
    type: "object",
    properties: {
      baseToolName: { type: "string", description: "Real Mneme MCP tool name to wrap (e.g., mneme.arena.judge)." },
      baseArgs: { type: "array", items: { type: "string" }, description: "Canonical arg names of the base tool, in call order." },
      ttlMs: { type: "number", description: "Lifetime in ms before reincarnation eligibility. Default 24h." },
      deprecationGravityMs: { type: "number", description: "How long the old generation stays callable after reincarnation. Default 1h." },
    },
    required: ["baseToolName", "baseArgs"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Birth a mortal wrapper around arena.judge", args: { baseToolName: "mneme.arena.judge", baseArgs: ["topic", "limit"] }, expectedOutput: "{ wrapper: { alias: 'mneme.mortal.arena.judge.gen1', ... } }" }],
  pitfalls: ["Mortal aliases live in mneme.mortal.* only — never collides with the real MCP catalog.", "AI agents that bake in 'mneme.mortal.x.gen5' = they will break when gen6 reincarnates. That's the point."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const w = core.mortalWrappers.birthMortalWrapper(args as unknown as Parameters<typeof core.mortalWrappers.birthMortalWrapper>[0]);
    const state = await getRegistry();
    await setRegistry({ ...state, wrappers: [...state.wrappers, w] });
    return { data: { wrapper: w }, wisdom: core.mortalWrappers.formatWrapperLine(w), confidence: { level: "high" } };
  },
};

export const mortalListTool: MnemeTool = {
  name: "mneme.mortal.list",
  category: "lab",
  description:
    "🧬 MORTAL — enumerate every wrapper in the registry. Returns alive + deprecated (still callable during gravity).",
  whenToUse: "Whenever an AI agent wants to (re-)discover which mortal aliases are currently callable. Should be called every turn for fully-adaptive agents.",
  triggers: ["mortal list", "what mortals are alive"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What mortal wrappers are alive?", expectedOutput: "{ alive: [...], deprecated: [...] }" }],
  pitfalls: ["The catalog changes on every tick. Re-read before each chain of tool calls."],
  handler: async (_rt, _args) => {
    const state = await getRegistry();
    const alive = state.wrappers.filter((w) => w.alive);
    const deprecated = state.wrappers.filter((w) => !w.alive);
    return {
      data: { alive, deprecated, totalGenerations: state.wrappers.length },
      wisdom: `🧬 ${alive.length} alive · ${deprecated.length} deprecated (gravity window)`,
      confidence: { level: "high" },
    };
  },
};

export const mortalTickTool: MnemeTool = {
  name: "mneme.mortal.tick",
  category: "lab",
  description:
    "🧬 MORTAL — one reincarnation cycle. Eligible (expired) wrappers reincarnate with a drifted signature; parents enter deprecation gravity; long-dead parents are evicted.",
  whenToUse: "Hourly via daemon. Returns expired + reincarnated lists for telemetry.",
  triggers: ["mortal tick", "reincarnation cycle"],
  inputSchema: {
    type: "object",
    properties: {
      baseToolArgs: { type: "object", description: "Map of baseToolName -> canonical arg names. Required to mutate signatures correctly." },
      budget: { type: "number", description: "Mutations per tick (default 2, capped at 3)." },
      rngSeed: { type: "number", description: "Optional deterministic seed for testing." },
    },
    required: ["baseToolArgs"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run mortal tick", args: { baseToolArgs: { "mneme.arena.judge": ["topic", "limit"] } }, expectedOutput: "{ expired, reincarnated, skippedAtMaxGen }" }],
  pitfalls: ["MAX_GENERATIONS_PER_BASE=100 hard loop guard. Hitting it means you've been reincarnating one base for ages — review whether to retire it."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const state = await getRegistry();
    const out = core.mortalWrappers.tickReincarnation({
      state,
      baseToolArgs: args["baseToolArgs"] as Record<string, string[]>,
      budget: args["budget"] as number | undefined,
      rngSeed: args["rngSeed"] as number | undefined,
    });
    await setRegistry(out.state);
    return {
      data: {
        expired: out.expired,
        reincarnated: out.reincarnated,
        skippedAtMaxGen: out.skippedAtMaxGen,
      },
      wisdom: `🧬 TICK · ${out.expired.length} expired → ${out.reincarnated.length} reincarnated (${out.skippedAtMaxGen.length} skipped at max-gen)`,
      confidence: { level: "high" },
    };
  },
};

export const mortalResolveTool: MnemeTool = {
  name: "mneme.mortal.resolve",
  category: "lab",
  description:
    "🧬 MORTAL — translate a mortal alias call to its base tool + args. Fails (with hint) if the alias is past gravity or the AI sent overfit/stale args.",
  whenToUse: "Before invoking any mneme.mortal.* alias — confirms the alias is alive and your args match the current signature.",
  triggers: ["mortal resolve", "translate mortal call"],
  inputSchema: {
    type: "object",
    properties: {
      alias: { type: "string", description: "Mortal alias the AI agent intends to call (e.g., mneme.mortal.arena.judge.gen3)." },
      args: { type: "object", description: "Args the AI agent is about to pass." },
      callerKey: { type: "string", description: "Optional. If supplied, the outcome is logged to calibration telemetry." },
    },
    required: ["alias", "args"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Resolve mneme.mortal.arena.judge.gen3 with these args", args: { alias: "mneme.mortal.arena.judge.gen3", args: { topic_g3: "AI" } }, expectedOutput: "{ ok, baseToolName, baseArgs, deprecated?, hint? }" }],
  pitfalls: ["If you get a 'schema drifted' error, your prompt has stale arg names. Re-read mneme.mortal.list."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const state = await getRegistry();
    const r = core.mortalWrappers.resolveMortalCall({
      alias: String(args["alias"]),
      args: (args["args"] as Record<string, unknown>) ?? {},
      state,
      callerKey: args["callerKey"] as string | undefined,
    });
    if (args["callerKey"]) {
      await setRegistry(core.mortalWrappers.recordCalibration({
        state,
        callerKey: String(args["callerKey"]),
        alias: String(args["alias"]),
        ok: r.ok,
      }));
    }
    return {
      data: r,
      wisdom: r.ok
        ? `🧬 resolved → ${r.baseToolName}${r.deprecated ? " (DEPRECATED — still in gravity)" : ""}`
        : `💀 ${r.reason}${r.hint ? ` · hint: ${r.hint}` : ""}`,
      confidence: { level: "high" },
    };
  },
};

export const mortalInvokeTool: MnemeTool = {
  name: "mneme.mortal.invoke",
  category: "lab",
  description:
    "🧬 MORTAL — resolve + telemetry-record in one step. Returns the resolved baseToolName + translated args; AI agent then calls the real tool itself.",
  whenToUse: "AI agent shorthand: 'I want to call this mortal, give me what to actually invoke and log my calibration.'",
  triggers: ["mortal invoke", "mortal call"],
  inputSchema: {
    type: "object",
    properties: {
      alias: { type: "string" },
      args: { type: "object" },
      callerKey: { type: "string" },
    },
    required: ["alias", "args", "callerKey"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Invoke a mortal", args: { alias: "mneme.mortal.arena.judge.gen2", args: {}, callerKey: "ck-abc" }, expectedOutput: "{ resolve, calibration }" }],
  pitfalls: ["This DOES NOT actually call the base tool — it returns instructions for the caller to do so. Mneme keeps tool dispatch explicit."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const state = await getRegistry();
    const resolved = core.mortalWrappers.resolveMortalCall({
      alias: String(args["alias"]),
      args: (args["args"] as Record<string, unknown>) ?? {},
      state,
      callerKey: String(args["callerKey"]),
    });
    const updated = core.mortalWrappers.recordCalibration({
      state,
      callerKey: String(args["callerKey"]),
      alias: String(args["alias"]),
      ok: resolved.ok,
    });
    await setRegistry(updated);
    const score = core.mortalWrappers.calibrationScore({ state: updated, callerKey: String(args["callerKey"]) });
    return {
      data: { resolve: resolved, calibration: score },
      wisdom: resolved.ok
        ? `🧬 invoke OK → call ${resolved.baseToolName} · adaptiveness=${score.adaptivenessScore.toFixed(2)} (${score.verdict})`
        : `💀 invoke FAILED · adaptiveness=${score.adaptivenessScore.toFixed(2)} (${score.verdict}) · ${resolved.reason}`,
      confidence: { level: "high" },
    };
  },
};

export const mortalCalibrationTool: MnemeTool = {
  name: "mneme.mortal.calibration",
  category: "lab",
  description:
    "🧬 MORTAL — adaptiveness score for one AI caller. Verdict: world_class (≥0.95) / good (≥0.80) / drifting (≥0.50 OR <5 calls) / over_fit (<0.50).",
  whenToUse: "Daily/weekly review of how well an AI client adapts to schema drift.",
  triggers: ["mortal calibration", "adaptiveness score"],
  inputSchema: { type: "object", properties: { callerKey: { type: "string" } }, required: ["callerKey"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How adaptive is ck-claude-1?", args: { callerKey: "ck-claude-1" }, expectedOutput: "{ totalCalls, adaptivenessScore, verdict }" }],
  pitfalls: ["Low sample size (<5) → 'drifting' verdict by default — not enough signal."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const state = await getRegistry();
    const s = core.mortalWrappers.calibrationScore({ state, callerKey: String(args["callerKey"]) });
    return {
      data: s,
      wisdom: `🧬 ${s.callerKey} · score=${s.adaptivenessScore.toFixed(2)} · verdict=${s.verdict} (${s.successfulCalls}/${s.totalCalls})`,
      confidence: { level: "high" },
    };
  },
};

export const mortalStatsTool: MnemeTool = {
  name: "mneme.mortal.stats",
  category: "lab",
  description:
    "🧬 MORTAL — global registry stats: alive count, deprecated count, total generations, mutation kind histogram.",
  whenToUse: "Health check on the LIVING MCP ecosystem.",
  triggers: ["mortal stats", "living mcp health"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What's the mortal ecosystem look like?", expectedOutput: "{ alive, deprecated, totalGenerationsAcrossLineages, totalMutationsApplied, uniqueBaseTools, mutationKindHistogram }" }],
  pitfalls: ["Stats reset on MCP restart unless state is externally persisted."],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const state = await getRegistry();
    const s = core.mortalWrappers.globalStats(state);
    return {
      data: s,
      wisdom: `🧬 GLOBAL · ${s.alive} alive · ${s.deprecated} deprecated · ${s.totalGenerationsAcrossLineages} total gens · ${s.uniqueBaseTools} unique bases · ${s.totalMutationsApplied} mutations`,
      confidence: { level: "high" },
    };
  },
};

export const mortalVerifyTool: MnemeTool = {
  name: "mneme.mortal.verify",
  category: "lab",
  description:
    "🧬 MORTAL — verify a mortal wrapper's HMAC. Catches forged wrappers (fake 'ancient' lineages that were never actually born).",
  whenToUse: "Before trusting any mortal wrapper received from an untrusted source.",
  triggers: ["mortal verify", "verify wrapper sig"],
  inputSchema: { type: "object", properties: { wrapper: { type: "object" } }, required: ["wrapper"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is this wrapper real?", args: { wrapper: {} }, expectedOutput: "{ ok, reason? }" }],
  pitfalls: ["Verifies sig only, not whether the wrapper is alive. Use mneme.mortal.list to check liveness."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.mortalWrappers.verifyMortalWrapper(
      args["wrapper"] as Parameters<typeof core.mortalWrappers.verifyMortalWrapper>[0],
    );
    return {
      data: r,
      wisdom: r.ok ? "🧬 wrapper sig VALID" : `💀 ${r.reason}`,
      confidence: { level: "high" },
    };
  },
};

export const V1911_MORTAL_TOOLS: MnemeTool[] = [
  mortalBirthTool,
  mortalListTool,
  mortalTickTool,
  mortalResolveTool,
  mortalInvokeTool,
  mortalCalibrationTool,
  mortalStatsTool,
  mortalVerifyTool,
];
