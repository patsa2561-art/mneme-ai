/**
 * v2.19.25 — SLEEP TRAINING (extends HIPPOCAMPUS) + ENDOCRINE (extends HORMONAL)
 *
 *   💤 SLEEP (4 tools):
 *     mneme.sleep.cycle      — run a sleep cycle (predicted vs actual -> fitness)
 *     mneme.sleep.fitness    — jaccard similarity for a single (pred, actual) pair
 *     mneme.sleep.apply      — apply weight updates from a cycle report
 *     mneme.sleep.digest     — morning digest (improved / regressed top-3)
 *
 *   🧪 ENDOCRINE (4 tools):
 *     mneme.endocrine.produce        — signals -> 4 hormone levels (decay + spike)
 *     mneme.endocrine.effects        — hormones -> cross-organ behaviour adjustments
 *     mneme.endocrine.neutral        — fresh state (all 4 hormones at 0)
 *     mneme.endocrine.list_hormones  — list 4 named hormones + sources + effects
 */

import type { MnemeTool } from "./_types.js";

// ─── SLEEP TRAINING ─────────────────────────────────────────────────

export const sleepCycleTool: MnemeTool = {
  name: "mneme.sleep.cycle",
  category: "audit",
  description:
    "💤 SLEEP TRAINING (extends v2.19.23 HIPPOCAMPUS-DREAMS) — run a sleep cycle: compare yesterday's REFLEX predictions vs the AI agent's actual tool calls; compute jaccard fitness per (pattern, eventSig); return HMAC-signed report with weight deltas + trajectory.",
  whenToUse: "Daemon idle hook (typically 03:00 local time, after consequence ledger settles).",
  triggers: ["sleep cycle", "nightly training"],
  inputSchema: {
    type: "object",
    properties: {
      yesterdayPredictions: { type: "array", items: { type: "object" } },
      yesterdayActualCalls: { type: "array", items: { type: "object" } },
      previousHitRate: { type: "number", description: "Last cycle's hit rate; pass for trajectory tracking" },
      learningRate: { type: "number", description: "Default 0.15" },
    },
    required: ["yesterdayPredictions", "yesterdayActualCalls"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Run last night's sleep training",
    args: {
      yesterdayPredictions: [{ patternId: "p1", eventSig: "sigA", predictedTool: "mneme.ask", confidenceAtPrediction: 0.5, ts: 1 }],
      yesterdayActualCalls: [{ eventSig: "sigA", toolName: "mneme.ask", ts: 1 }],
      previousHitRate: 0.5,
    },
    expectedOutput: "{ hitRate, hitRateDelta, patternFitness, learningRate, sig }",
  }],
  pitfalls: ["Learning rate 0 = no movement; 1 = jump straight to jaccard. Default 0.15 = ~3 nights to fully adopt a new pattern."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.sleepTraining.runSleepCycle({
      yesterdayPredictions: args["yesterdayPredictions"] as Parameters<typeof core.sleepTraining.runSleepCycle>[0]["yesterdayPredictions"],
      yesterdayActualCalls: args["yesterdayActualCalls"] as Parameters<typeof core.sleepTraining.runSleepCycle>[0]["yesterdayActualCalls"],
      previousHitRate: args["previousHitRate"] as number | undefined,
      learningRate: args["learningRate"] as number | undefined,
    });
    return { data: r, wisdom: core.sleepTraining.formatSleepCycleLine(r), confidence: { level: "high" } };
  },
};

export const sleepFitnessTool: MnemeTool = {
  name: "mneme.sleep.fitness",
  category: "audit",
  description: "💤 SLEEP — compute jaccard similarity between a predicted-set and an actual-set. The fitness function the cycle uses internally.",
  whenToUse: "Debug a single (pred, actual) pair when sleep cycle output is surprising.",
  triggers: ["sleep fitness", "jaccard"],
  inputSchema: {
    type: "object",
    properties: {
      predicted: { type: "array", items: { type: "string" } },
      actual: { type: "array", items: { type: "string" } },
    },
    required: ["predicted", "actual"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "How much did this prediction match reality?",
    args: { predicted: ["a", "b", "c"], actual: ["b", "c", "d"] },
    expectedOutput: "{ jaccard: 0.5 }",
  }],
  pitfalls: ["Both empty = 1.0 (vacuous match). One empty = 0.0."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const j = core.sleepTraining.jaccardSimilarity(args["predicted"] as string[], args["actual"] as string[]);
    return { data: { jaccard: j }, wisdom: `💤 jaccard=${j.toFixed(3)}`, confidence: { level: "high" } };
  },
};

export const sleepApplyTool: MnemeTool = {
  name: "mneme.sleep.apply",
  category: "audit",
  description: "💤 SLEEP — apply weight updates from a sleep cycle report to a pattern-weight map. Clamps confidence to [0.01, 1.0].",
  whenToUse: "After mneme.sleep.cycle returns; persist the updated patterns to disk for tomorrow's REFLEX boot.",
  triggers: ["sleep apply", "weight update"],
  inputSchema: {
    type: "object",
    properties: {
      patterns: { type: "array", items: { type: "object" }, description: "[{patternId, confidence}]" },
      report: { type: "object", description: "SleepCycleReport from mneme.sleep.cycle" },
    },
    required: ["patterns", "report"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Apply sleep cycle deltas to my patterns",
    args: { patterns: [{ patternId: "p1", confidence: 0.5 }], report: {} },
    expectedOutput: "{ updated: [{patternId, confidence}], changes: [{patternId, before, after, delta}] }",
  }],
  pitfalls: ["Unknown patternId in report starts at neutral 0.5 then adjusts; clamps to [0.01, 1.0]."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const out = core.sleepTraining.applyWeightUpdates({
      patterns: args["patterns"] as Parameters<typeof core.sleepTraining.applyWeightUpdates>[0]["patterns"],
      report: args["report"] as Parameters<typeof core.sleepTraining.applyWeightUpdates>[0]["report"],
    });
    return { data: out, wisdom: `💤 ${out.changes.length} pattern weights updated`, confidence: { level: "high" } };
  },
};

export const sleepDigestTool: MnemeTool = {
  name: "mneme.sleep.digest",
  category: "audit",
  description: "💤 SLEEP — morning digest (one-line + top improved + top regressed). What to show the user at the start of their day.",
  whenToUse: "First pulse of the morning; surface yesterday's learning.",
  triggers: ["sleep digest", "morning report"],
  inputSchema: { type: "object", properties: { report: { type: "object" } }, required: ["report"] },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Show yesterday's sleep training summary",
    args: { report: {} },
    expectedOutput: "{ hitRate, hitRateDelta, topImproved, topRegressed, oneLine }",
  }],
  pitfalls: ["Empty report -> empty top lists; not an error."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const d = core.sleepTraining.morningDigest(args["report"] as Parameters<typeof core.sleepTraining.morningDigest>[0]);
    return { data: d, wisdom: d.oneLine, confidence: { level: "high" } };
  },
};

// ─── ENDOCRINE ──────────────────────────────────────────────────────

export const endocrineProduceTool: MnemeTool = {
  name: "mneme.endocrine.produce",
  category: "audit",
  description:
    "🧪 ENDOCRINE (extends v2.19.23 HORMONAL) — produce new hormone state from environmental signals (commit text / error count / hour / streaks / co-authors / idle). 4 hormones: cortisol/dopamine/melatonin/oxytocin. Half-life decay applied first, then signal deltas added.",
  whenToUse: "Daemon hook on every observable event (commit / error / idle tick / co-author).",
  triggers: ["endocrine produce", "hormone update"],
  inputSchema: {
    type: "object",
    properties: {
      state: { type: "object" },
      signals: { type: "object", description: "{ commitMessage?, errorCountWindow?, hourOfDay?, greenStreakCount?, testPassStreakCount?, idleMs?, hasCoAuthor?, distinctAuthorsHour?, elapsedMs }" },
    },
    required: ["state", "signals"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Update hormones: latest commit says 'wtf damn finally' + 5 errors in window",
    args: {
      state: { v: 1, cortisol: 0, dopamine: 0, melatonin: 0, oxytocin: 0, ts: 0 },
      signals: { commitMessage: "wtf damn finally", errorCountWindow: 5, elapsedMs: 0 },
    },
    expectedOutput: "{ cortisol: 0.x, dopamine: 0, melatonin: 0, oxytocin: 0, ts: 0 }",
  }],
  pitfalls: ["All 4 hormones clamped to [0, 1]; elapsedMs drives half-life decay before adding new spike."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.endocrine.produceFromSignals({
      state: args["state"] as Parameters<typeof core.endocrine.produceFromSignals>[0]["state"],
      signals: args["signals"] as Parameters<typeof core.endocrine.produceFromSignals>[0]["signals"],
    });
    return { data: s, wisdom: core.endocrine.formatEndocrineLine(s), confidence: { level: "high" } };
  },
};

export const endocrineEffectsTool: MnemeTool = {
  name: "mneme.endocrine.effects",
  category: "audit",
  description: "🧪 ENDOCRINE — translate current hormone levels into cross-organ behavior adjustments (reflex aggressiveness / daemon quietness / dream depth / notification suppression / trinity surfacing).",
  whenToUse: "Periodic policy refresh — feed effects to every organ at their own cadence.",
  triggers: ["endocrine effects", "hormone behavior"],
  inputSchema: { type: "object", properties: { state: { type: "object" } }, required: ["state"] },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "What should organs do given current hormones?",
    args: { state: { v: 1, cortisol: 0.8, dopamine: 0, melatonin: 0, oxytocin: 0, ts: 0 } },
    expectedOutput: "{ reflexAggressiveness, daemonQuietness, dreamCycleDepth, notificationsSuppressed, surfaceTrinityAndConfessional, dominantMood }",
  }],
  pitfalls: ["Effects are POLICIES; each organ decides when to honour them."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const e = core.endocrine.crossOrganEffects(args["state"] as Parameters<typeof core.endocrine.crossOrganEffects>[0]);
    return { data: e, wisdom: `🧪 dominantMood=${e.dominantMood} · reflex=${e.reflexAggressiveness.toFixed(2)} · quiet=${e.daemonQuietness.toFixed(2)}`, confidence: { level: "high" } };
  },
};

export const endocrineNeutralTool: MnemeTool = {
  name: "mneme.endocrine.neutral",
  category: "audit",
  description: "🧪 ENDOCRINE — emit fresh neutral state (all 4 hormones at 0).",
  whenToUse: "First-run init; or after sleep cycle when caller wants a clean slate.",
  triggers: ["endocrine neutral", "hormone reset"],
  inputSchema: { type: "object", properties: { ts: { type: "number" } } },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Reset endocrine", args: { ts: 0 }, expectedOutput: "{ cortisol: 0, dopamine: 0, melatonin: 0, oxytocin: 0, ts: 0 }" }],
  pitfalls: [],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.endocrine.neutralEndocrineState((args["ts"] as number | undefined) ?? 0);
    return { data: s, wisdom: core.endocrine.formatEndocrineLine(s), confidence: { level: "high" } };
  },
};

export const endocrineListHormonesTool: MnemeTool = {
  name: "mneme.endocrine.list_hormones",
  category: "audit",
  description: "🧪 ENDOCRINE — list 4 named hormones with source detectors + effect targets. Useful for AI introspection + user docs.",
  whenToUse: "When the AI agent wants to know what biological signals Mneme reads.",
  triggers: ["endocrine list hormones", "list hormones"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What hormones does Mneme produce?", expectedOutput: "{ hormones: [{ hormone, emoji, sources, effects }] }" }],
  pitfalls: ["Sources are HEURISTICS not biological measurements."],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const info = core.endocrine.listHormoneInfo();
    return { data: { hormones: info, count: info.length }, wisdom: `🧪 ${info.length} named hormones`, confidence: { level: "high" } };
  },
};

export const V1925_SLEEP_ENDOCRINE_TOOLS: MnemeTool[] = [
  sleepCycleTool, sleepFitnessTool, sleepApplyTool, sleepDigestTool,
  endocrineProduceTool, endocrineEffectsTool, endocrineNeutralTool, endocrineListHormonesTool,
];
