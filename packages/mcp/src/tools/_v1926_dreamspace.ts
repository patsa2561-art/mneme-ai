/**
 * v2.19.26 DREAMSPACE — self-authoring MCP catalog
 *
 *   🌱 GESTATION (4 tools):
 *     mneme.dreamspace.detect_gaps      — filter gap signals above threshold
 *     mneme.dreamspace.propose_spec     — single gap → ProposedToolSpec
 *     mneme.dreamspace.gestation_cycle  — full pass: signals → qualifying gaps → proposals
 *     mneme.dreamspace.verify_proposal  — HMAC verify a proposal
 *
 *   🦋 EVOLUTION (4 tools):
 *     mneme.dreamspace.classify         — single ToolUseRecord → LifecycleVerdict
 *     mneme.dreamspace.mate_pairs       — use-log → co-occurrence pairs
 *     mneme.dreamspace.evolution_cycle  — full pass: lifecycle + mating in one shot
 *     mneme.dreamspace.list_bands       — descriptions of the 4 lifecycle bands
 */

import type { MnemeTool } from "./_types.js";

// ─── GESTATION ──────────────────────────────────────────────────────

export const detectGapsTool: MnemeTool = {
  name: "mneme.dreamspace.detect_gaps",
  category: "audit",
  description:
    "🌱 GESTATION — filter gap signals (REFLEX cache miss / user_chat no-match / pattern co-occurrence) down to those above the configured threshold. Returns sorted gaps; below-threshold signals dropped as noise.",
  whenToUse: "Daemon idle hook collects yesterday's signals; pass them here to find which deserve a tool proposal.",
  triggers: ["dreamspace detect gaps", "tool catalog gap"],
  inputSchema: {
    type: "object",
    properties: {
      signals: { type: "array", items: { type: "object" } },
      minGapCount: { type: "number", description: "Default 3" },
      minCoOccurCount: { type: "number", description: "Default 4 (higher for pair signals)" },
    },
    required: ["signals"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Which gaps from yesterday qualify for a tool proposal?",
    args: { signals: [{ v: 1, kind: "reflex_cache_miss", label: "x", relatedTools: [], count: 5, ts: 1 }] },
    expectedOutput: "{ qualifying: GapSignal[], count: N }",
  }],
  pitfalls: ["Below-threshold signals are dropped silently; raise minGapCount to be stricter."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const qualifying = core.dreamspaceGestation.detectToolGaps({
      signals: args["signals"] as Parameters<typeof core.dreamspaceGestation.detectToolGaps>[0]["signals"],
      minGapCount: args["minGapCount"] as number | undefined,
      minCoOccurCount: args["minCoOccurCount"] as number | undefined,
    });
    return { data: { qualifying, count: qualifying.length }, wisdom: `🌱 ${qualifying.length} qualifying gaps`, confidence: { level: "high" } };
  },
};

export const proposeSpecTool: MnemeTool = {
  name: "mneme.dreamspace.propose_spec",
  category: "audit",
  description: "🌱 GESTATION — propose a brand-new ProposedToolSpec from a single gap signal. Deterministic; HMAC-signed; composer recipe defaults to sequential chaining.",
  whenToUse: "After detect_gaps surfaces a qualifying gap; emit the spec that the daemon will feed to v2.19.9 splice.",
  triggers: ["dreamspace propose", "auto tool spec"],
  inputSchema: {
    type: "object",
    properties: {
      gap: { type: "object" },
      minGapCount: { type: "number" },
    },
    required: ["gap"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Propose a chimera for this co-occurrence pair",
    args: { gap: { v: 1, kind: "pattern_co_occurrence", label: "git_commit:fix", relatedTools: ["mneme.ask", "mneme.why"], count: 6, ts: 1 } },
    expectedOutput: "{ proposedName: 'mneme.auto.ask_then_why', composerRecipe, confidence, sig }",
  }],
  pitfalls: ["Names are deterministic to avoid collisions; daemon renames on promote."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const spec = core.dreamspaceGestation.proposeToolSpec({
      gap: args["gap"] as Parameters<typeof core.dreamspaceGestation.proposeToolSpec>[0]["gap"],
      minGapCount: args["minGapCount"] as number | undefined,
    });
    return { data: spec, wisdom: core.dreamspaceGestation.formatProposalLine(spec), confidence: { level: "high" } };
  },
};

export const gestationCycleTool: MnemeTool = {
  name: "mneme.dreamspace.gestation_cycle",
  category: "audit",
  description: "🌱 GESTATION — full cycle: signals → detect_gaps → propose_spec per qualifying gap → HMAC-signed GestationReport. One call per dream window.",
  whenToUse: "Daemon dream-tier idle hook (typically 03:00 local time).",
  triggers: ["dreamspace gestation cycle"],
  inputSchema: {
    type: "object",
    properties: {
      signals: { type: "array", items: { type: "object" } },
      minGapCount: { type: "number" },
      minCoOccurCount: { type: "number" },
    },
    required: ["signals"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Run last night's gestation cycle over my signals",
    args: { signals: [] },
    expectedOutput: "{ totalSignals, qualifyingGaps, proposals: ProposedToolSpec[], sig }",
  }],
  pitfalls: ["Empty signals -> empty proposals; not an error."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.dreamspaceGestation.runGestationCycle({
      signals: args["signals"] as Parameters<typeof core.dreamspaceGestation.runGestationCycle>[0]["signals"],
      minGapCount: args["minGapCount"] as number | undefined,
      minCoOccurCount: args["minCoOccurCount"] as number | undefined,
    });
    return { data: r, wisdom: `🌱 ${r.qualifyingGaps} gaps -> ${r.proposals.length} proposals`, confidence: { level: "high" } };
  },
};

export const verifyProposalTool: MnemeTool = {
  name: "mneme.dreamspace.verify_proposal",
  category: "audit",
  description: "🌱 GESTATION — HMAC-verify a ProposedToolSpec; rejects tampered specs before daemon promotes them via v2.19.9 splice.",
  whenToUse: "Before acting on a proposal received from another instance (federation).",
  triggers: ["dreamspace verify proposal"],
  inputSchema: { type: "object", properties: { proposal: { type: "object" } }, required: ["proposal"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Verify this auto-proposed tool spec", args: { proposal: {} }, expectedOutput: "{ ok: true|false }" }],
  pitfalls: ["Verification fails on any byte tamper; do NOT auto-promote unverified specs."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const ok = core.dreamspaceGestation.verifyProposal(args["proposal"] as Parameters<typeof core.dreamspaceGestation.verifyProposal>[0]);
    return { data: { ok }, wisdom: ok ? "🌱 verified" : "💀 tampered", confidence: { level: "high" } };
  },
};

// ─── EVOLUTION ──────────────────────────────────────────────────────

export const classifyTool: MnemeTool = {
  name: "mneme.dreamspace.classify",
  category: "audit",
  description:
    "🦋 EVOLUTION — classify a single tool's lifecycle band (🥚 gestating / 🐣 juvenile / 🦋 mature / 🍂 atrophied). Pure function; deterministic over (record, nowMs, config).",
  whenToUse: "Per-tool health check; or feed all tool records to evolution_cycle for batch.",
  triggers: ["dreamspace classify", "tool lifecycle"],
  inputSchema: {
    type: "object",
    properties: {
      record: { type: "object", description: "{ toolName, bornTs, useCount, lastUseTs }" },
      nowMs: { type: "number" },
      config: { type: "object", description: "Optional thresholds override" },
    },
    required: ["record", "nowMs"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Is this tool mature or atrophied?",
    args: { record: { toolName: "x", bornTs: 0, useCount: 100, lastUseTs: 100 }, nowMs: 31 * 86400 * 1000 },
    expectedOutput: "{ band: 'mature'|..., recommendation: 'keep'|'promote'|'sunset' }",
  }],
  pitfalls: ["Tools < 7 days old are ALWAYS gestating regardless of use count."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const v = core.dreamspaceEvolution.classifyLifecycle({
      record: args["record"] as Parameters<typeof core.dreamspaceEvolution.classifyLifecycle>[0]["record"],
      nowMs: Number(args["nowMs"]),
      config: args["config"] as Parameters<typeof core.dreamspaceEvolution.classifyLifecycle>[0]["config"],
    });
    return { data: v, wisdom: core.dreamspaceEvolution.formatVerdictLine(v), confidence: { level: "high" } };
  },
};

export const matePairsTool: MnemeTool = {
  name: "mneme.dreamspace.mate_pairs",
  category: "audit",
  description: "🦋 EVOLUTION — scan a use-log for ordered (A then B) pairs that co-occur within windowMs. Pairs above minCount become mating candidates for new chimeras.",
  whenToUse: "After a use-log accumulates >=24 hours; pass to evolution_cycle for daily mating round.",
  triggers: ["dreamspace mate", "tool pairs"],
  inputSchema: {
    type: "object",
    properties: {
      log: { type: "array", items: { type: "object" } },
      windowMs: { type: "number", description: "Default 60_000 (1 minute)" },
      minCount: { type: "number", description: "Default 4" },
    },
    required: ["log"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Find frequently co-occurring tool pairs",
    args: { log: [{ toolName: "a", ts: 0 }, { toolName: "b", ts: 10000 }] },
    expectedOutput: "{ pairs: MatingPair[], count: N }",
  }],
  pitfalls: ["A→B and B→A are DIFFERENT pairs. Self-pairs excluded."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const pairs = core.dreamspaceEvolution.selectMatingPairs({
      log: args["log"] as Parameters<typeof core.dreamspaceEvolution.selectMatingPairs>[0]["log"],
      windowMs: args["windowMs"] as number | undefined,
      minCount: args["minCount"] as number | undefined,
    });
    return { data: { pairs, count: pairs.length }, wisdom: `🦋 ${pairs.length} mating pairs`, confidence: { level: "high" } };
  },
};

export const evolutionCycleTool: MnemeTool = {
  name: "mneme.dreamspace.evolution_cycle",
  category: "audit",
  description: "🦋 EVOLUTION — full cycle: classify each record into a lifecycle band + select mating pairs from the use-log + HMAC-signed EvolutionReport.",
  whenToUse: "Daemon dream-tier idle hook; runs once per day after gestation_cycle.",
  triggers: ["dreamspace evolution cycle"],
  inputSchema: {
    type: "object",
    properties: {
      records: { type: "array", items: { type: "object" } },
      log: { type: "array", items: { type: "object" } },
      nowMs: { type: "number" },
      config: { type: "object" },
      matingWindowMs: { type: "number" },
      matingMinCount: { type: "number" },
    },
    required: ["records", "log", "nowMs"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Run today's evolution cycle",
    args: { records: [], log: [], nowMs: 0 },
    expectedOutput: "{ verdicts, matingPairs, bandCounts, promoteCount, sunsetCount, sig }",
  }],
  pitfalls: ["Recommendations (promote/sunset/keep) are HINTS; caller (daemon) applies them."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.dreamspaceEvolution.runEvolutionCycle({
      records: args["records"] as Parameters<typeof core.dreamspaceEvolution.runEvolutionCycle>[0]["records"],
      log: args["log"] as Parameters<typeof core.dreamspaceEvolution.runEvolutionCycle>[0]["log"],
      nowMs: Number(args["nowMs"]),
      config: args["config"] as Parameters<typeof core.dreamspaceEvolution.runEvolutionCycle>[0]["config"],
      matingWindowMs: args["matingWindowMs"] as number | undefined,
      matingMinCount: args["matingMinCount"] as number | undefined,
    });
    return { data: r, wisdom: core.dreamspaceEvolution.formatEvolutionLine(r), confidence: { level: "high" } };
  },
};

export const listBandsTool: MnemeTool = {
  name: "mneme.dreamspace.list_bands",
  category: "audit",
  description: "🦋 EVOLUTION — list the 4 lifecycle bands with their thresholds + emoji + recommendation defaults. Useful for AI introspection + UX docs.",
  whenToUse: "When the AI agent wants to explain the tool lifecycle to a user.",
  triggers: ["dreamspace list bands", "lifecycle bands"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What are the 4 lifecycle bands?", expectedOutput: "{ bands: [{band, emoji, criteria, recommendation}] }" }],
  pitfalls: [],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const bands = [
      { band: "gestating", emoji: core.dreamspaceEvolution.LIFECYCLE_EMOJI.gestating, criteria: "age < 7 days (newborn)", recommendation: "keep" },
      { band: "juvenile", emoji: core.dreamspaceEvolution.LIFECYCLE_EMOJI.juvenile, criteria: "age 7..30 days OR uses 5..49", recommendation: "keep" },
      { band: "mature", emoji: core.dreamspaceEvolution.LIFECYCLE_EMOJI.mature, criteria: "age >= 30 days AND uses >= 50", recommendation: "promote" },
      { band: "atrophied", emoji: core.dreamspaceEvolution.LIFECYCLE_EMOJI.atrophied, criteria: "age >= 30 days AND uses < 1/week", recommendation: "sunset" },
    ];
    return { data: { bands, count: bands.length }, wisdom: `🦋 ${bands.length} lifecycle bands`, confidence: { level: "high" } };
  },
};

export const V1926_DREAMSPACE_TOOLS: MnemeTool[] = [
  detectGapsTool, proposeSpecTool, gestationCycleTool, verifyProposalTool,
  classifyTool, matePairsTool, evolutionCycleTool, listBandsTool,
];
