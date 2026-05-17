/**
 * v2.19.29 SYNAPSE GENESIS — 3 phases · 10 MCP tools
 *
 *   🧬 HEBBIAN (5):  mneme.synapse.{reinforce, decide_fire, query, prune, stats}
 *   🌞 CIRCADIAN (3): mneme.circadian.{classify, gate, list_phases}
 *   🔀 FUSION (2):    mneme.synapse.fusion_cycle + mneme.synapse.fuse_pair
 */

import type { MnemeTool } from "./_types.js";

// ─── HEBBIAN ────────────────────────────────────────────────────────

export const synapseReinforceTool: MnemeTool = {
  name: "mneme.synapse.reinforce",
  category: "audit",
  description: "🧬 SYNAPSE GENESIS — Hebbian reinforcement: append (event, tool, satisfaction) observation; weight updates with decay; auto-marks permanent when weight crosses FIRE_THRESHOLD. Defensive on malformed input.",
  whenToUse: "After every observed (event → tool) outcome with satisfaction signal.",
  triggers: ["synapse reinforce", "hebbian update"],
  inputSchema: {
    type: "object",
    properties: {
      store: { type: "object" },
      event: { type: "object" },
      toolCall: { type: "object" },
      satisfaction: { type: "string", enum: ["positive", "negative", "neutral"] },
      nowMs: { type: "number" },
    },
    required: ["store", "event", "toolCall", "satisfaction"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Reinforce that git_commit:fix-prefix → mneme.bug_prophet works well",
    args: { store: { v: 1, weights: [], lastDecayedAtMs: null, sig: "" }, event: { pattern: "git_commit:fix", ts: 1 }, toolCall: { toolName: "mneme.bug_prophet", ts: 1 }, satisfaction: "positive" },
    expectedOutput: "{ store, synapseKey, born, becamePermanent, newWeight }",
  }],
  pitfalls: ["Malformed event/tool returns store unchanged + born=false; never throws."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.synapseGenesis.reinforceSynapse({
      store: args["store"] as Parameters<typeof core.synapseGenesis.reinforceSynapse>[0]["store"],
      event: args["event"] as Parameters<typeof core.synapseGenesis.reinforceSynapse>[0]["event"],
      toolCall: args["toolCall"] as Parameters<typeof core.synapseGenesis.reinforceSynapse>[0]["toolCall"],
      satisfaction: args["satisfaction"] as Parameters<typeof core.synapseGenesis.reinforceSynapse>[0]["satisfaction"],
      nowMs: args["nowMs"] as number | undefined,
    });
    return { data: r, wisdom: `🧬 ${r.born ? "BORN" : r.becamePermanent ? "PERMANENT" : "reinforced"} · w=${r.newWeight.toFixed(2)}`, confidence: { level: "high" } };
  },
};

export const synapseDecideFireTool: MnemeTool = {
  name: "mneme.synapse.decide_fire",
  category: "audit",
  description: "🧬 SYNAPSE — pure decision: should this synapse fire NOW? Priority: tampered_store > no_synapse > pruned > permanent > above_threshold > juvenile.",
  whenToUse: "Daemon / REFLEX: before calling a tool, check if the learned synapse says fire.",
  triggers: ["synapse decide_fire", "should fire"],
  inputSchema: { type: "object", properties: { store: { type: "object" }, eventPattern: { type: "string" }, toolName: { type: "string" } }, required: ["store", "eventPattern", "toolName"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Should mneme.bug_prophet fire for git_commit:fix?", args: { store: { v: 1, weights: [], lastDecayedAtMs: null, sig: "" }, eventPattern: "git_commit:fix", toolName: "mneme.bug_prophet" }, expectedOutput: "{ shouldFire, reason, weight, permanent }" }],
  pitfalls: ["Tampered store always returns shouldFire=false (fail-safe)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const d = core.synapseGenesis.decideFire({
      store: args["store"] as Parameters<typeof core.synapseGenesis.decideFire>[0]["store"],
      eventPattern: String(args["eventPattern"]),
      toolName: String(args["toolName"]),
    });
    return { data: d, wisdom: core.synapseGenesis.formatFireLine(d), confidence: { level: "high" } };
  },
};

export const synapseQueryTool: MnemeTool = {
  name: "mneme.synapse.query",
  category: "audit",
  description: "🧬 SYNAPSE — query all learned pathways for an event pattern; returns tools sorted by weight desc with relativeConfidence + permanent flag.",
  whenToUse: "REFLEX / SCHEDULER planning: 'what tools should I pre-execute for this event?'",
  triggers: ["synapse query", "list pathways"],
  inputSchema: { type: "object", properties: { store: { type: "object" }, eventPattern: { type: "string" }, topN: { type: "number" }, includeNegative: { type: "boolean" } }, required: ["store", "eventPattern"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What pathways exist for git_commit:fix?", args: { store: { v: 1, weights: [], lastDecayedAtMs: null, sig: "" }, eventPattern: "git_commit:fix" }, expectedOutput: "{ pathways: PathwayPrediction[] }" }],
  pitfalls: ["Empty result on unknown event — cold-start path (becomes DREAMSPACE candidate)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const paths = core.synapseGenesis.queryPathways({
      store: args["store"] as Parameters<typeof core.synapseGenesis.queryPathways>[0]["store"],
      eventPattern: String(args["eventPattern"]),
      topN: args["topN"] as number | undefined,
      includeNegative: args["includeNegative"] as boolean | undefined,
    });
    return { data: { pathways: paths, count: paths.length }, wisdom: `🧬 ${paths.length} pathway(s)`, confidence: { level: "high" } };
  },
};

export const synapsePruneTool: MnemeTool = {
  name: "mneme.synapse.prune",
  category: "audit",
  description: "🧬 SYNAPSE — remove near-zero-weight synapses; permanent ones NEVER pruned. Run during CIRCADIAN SLEEP_NREM phase for daily cleanup.",
  whenToUse: "Nightly: daemon idle, during deep sleep phase.",
  triggers: ["synapse prune"],
  inputSchema: { type: "object", properties: { store: { type: "object" } }, required: ["store"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Clean dead pathways tonight", args: { store: { v: 1, weights: [], lastDecayedAtMs: null, sig: "" } }, expectedOutput: "{ store, prunedCount, remainingCount }" }],
  pitfalls: ["Pruning is destructive — pathways below PRUNE_THRESHOLD lost. Permanent are safe."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.synapseGenesis.pruneStore({ store: args["store"] as Parameters<typeof core.synapseGenesis.pruneStore>[0]["store"] });
    return { data: r, wisdom: `🧹 pruned ${r.prunedCount}; remaining ${r.remainingCount}`, confidence: { level: "high" } };
  },
};

export const synapseStatsTool: MnemeTool = {
  name: "mneme.synapse.stats",
  category: "audit",
  description: "🧬 SYNAPSE — totals + permanent / juvenile / prunable counts + avg/max weight + total observations. Health check for the learning engine.",
  whenToUse: "Pulse digest; weekly review.",
  triggers: ["synapse stats"],
  inputSchema: { type: "object", properties: { store: { type: "object" } }, required: ["store"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How much has Mneme learned?", args: { store: { v: 1, weights: [], lastDecayedAtMs: null, sig: "" } }, expectedOutput: "{ totalSynapses, permanentSynapses, totalObservations, ... }" }],
  pitfalls: ["Empty store returns all zeros (defensive)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.synapseGenesis.computeStats(args["store"] as Parameters<typeof core.synapseGenesis.computeStats>[0]);
    return { data: s, wisdom: core.synapseGenesis.formatStatsLine(s), confidence: { level: "high" } };
  },
};

// ─── CIRCADIAN ──────────────────────────────────────────────────────

export const circadianClassifyTool: MnemeTool = {
  name: "mneme.circadian.classify",
  category: "audit",
  description: "🌞 CIRCADIAN — classify the current moment into 5 phases (WAKE_TRANSITION / AWAKE / DROWSY / SLEEP_NREM / SLEEP_REM). Recent user activity overrides to WAKE_TRANSITION.",
  whenToUse: "Every scheduler tick: ask circadian which phase governs organ activation.",
  triggers: ["circadian classify", "current phase"],
  inputSchema: { type: "object", properties: { hourOfDay: { type: "number" }, msSinceLastActivity: { type: "number" }, boundaries: { type: "object" } }, required: ["hourOfDay"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What phase are we in right now?", args: { hourOfDay: 14 }, expectedOutput: "{ phase: 'AWAKE', reason, sig }" }],
  pitfalls: ["NaN/out-of-range hour → AWAKE fallback (defensive, never crashes)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.circadian.classifyPhase({
      hourOfDay: Number(args["hourOfDay"]),
      msSinceLastActivity: args["msSinceLastActivity"] as number | undefined,
      boundaries: args["boundaries"] as Parameters<typeof core.circadian.classifyPhase>[0]["boundaries"],
    });
    return { data: r, wisdom: core.circadian.formatPhaseLine(r), confidence: { level: "high" } };
  },
};

export const circadianGateTool: MnemeTool = {
  name: "mneme.circadian.gate",
  category: "audit",
  description: "🌞 CIRCADIAN — pure decision: should this tool fire in the current phase? Lookup → exact match > wildcard > fallback AWAKE-only.",
  whenToUse: "Scheduler asks before invoking any organ; gating decision audit trail.",
  triggers: ["circadian gate"],
  inputSchema: { type: "object", properties: { toolName: { type: "string" }, currentPhase: { type: "string" } }, required: ["toolName", "currentPhase"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Should mneme.dreamspace.probe_metrics fire at 14:00 AWAKE?", args: { toolName: "mneme.dreamspace.probe_metrics", currentPhase: "AWAKE" }, expectedOutput: "{ shouldFire: false, matchedRule, reason }" }],
  pitfalls: ["Empty toolName → no fire (defensive)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const d = core.circadian.decideGating({
      toolName: String(args["toolName"]),
      currentPhase: args["currentPhase"] as Parameters<typeof core.circadian.decideGating>[0]["currentPhase"],
    });
    return { data: d, wisdom: core.circadian.formatGatingLine(d), confidence: { level: "high" } };
  },
};

export const circadianListPhasesTool: MnemeTool = {
  name: "mneme.circadian.list_phases",
  category: "audit",
  description: "🌞 CIRCADIAN — list the 5 phases + their default hour boundaries + default per-tool preference map entries. AI introspection.",
  whenToUse: "AI agent first-time discovery.",
  triggers: ["circadian list phases"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What phases does Mneme have?", expectedOutput: "{ phases: [...], boundaries: {...}, preferences: [...] }" }],
  pitfalls: [],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    const phases = ["WAKE_TRANSITION", "AWAKE", "DROWSY", "SLEEP_NREM", "SLEEP_REM"].map((p) => ({
      phase: p,
      emoji: core.circadian.PHASE_EMOJI[p as keyof typeof core.circadian.PHASE_EMOJI],
    }));
    const preferences = Array.from(core.circadian.DEFAULT_PHASE_PREFERENCE.entries()).map(([rule, phases]) => ({ rule, phases: [...phases] }));
    return {
      data: { phases, boundaries: core.circadian.DEFAULT_BOUNDARIES, preferences },
      wisdom: `🌞 ${phases.length} phases, ${preferences.length} preference rules`,
      confidence: { level: "high" },
    };
  },
};

// ─── FUSION ─────────────────────────────────────────────────────────

export const synapseFusionCycleTool: MnemeTool = {
  name: "mneme.synapse.fusion_cycle",
  category: "audit",
  description: "🔀 FUSION — full cycle: scan tool-call log for adjacent (A→B) pairs co-occurring within 500ms above 80% ratio; emit FusedSynapse list with estimated speedup. Run during SLEEP_REM.",
  whenToUse: "Daemon dream-tier idle hook; nightly fusion discovery.",
  triggers: ["synapse fusion_cycle"],
  inputSchema: { type: "object", properties: { log: { type: "array", items: { type: "object" } }, temporalGapMs: { type: "number" }, cooccurrenceThreshold: { type: "number" }, minCount: { type: "number" }, estimatedLatencyMs: { type: "number" } }, required: ["log"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Find tools that always fire together", args: { log: [] }, expectedOutput: "{ fusedSynapses: FusedSynapse[], totalObservations, sig }" }],
  pitfalls: ["Empty log → empty result; defensive against NaN ts."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.synapseFusion.runFusionCycle({
      log: args["log"] as Parameters<typeof core.synapseFusion.runFusionCycle>[0]["log"],
      temporalGapMs: args["temporalGapMs"] as number | undefined,
      cooccurrenceThreshold: args["cooccurrenceThreshold"] as number | undefined,
      minCount: args["minCount"] as number | undefined,
      estimatedLatencyMs: args["estimatedLatencyMs"] as number | undefined,
    });
    return { data: r, wisdom: core.synapseFusion.formatFusionReportLine(r), confidence: { level: "high" } };
  },
};

export const synapseFusePairTool: MnemeTool = {
  name: "mneme.synapse.fuse_pair",
  category: "audit",
  description: "🔀 FUSION — fuse a single (A, B) AdjacentPair into a FusedSynapse with deterministic id + estimated parallel-execution speedup.",
  whenToUse: "After fusion_cycle returns candidate pairs; promote each into a real chimera via v2.19.9 splice.",
  triggers: ["synapse fuse_pair"],
  inputSchema: { type: "object", properties: { pair: { type: "object" }, estimatedLatencyA: { type: "number" }, estimatedLatencyB: { type: "number" } }, required: ["pair"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Fuse truth.forensic + bug_prophet into chimera", args: { pair: { toolA: "mneme.truth.forensic", toolB: "mneme.bug_prophet", cooccurrenceCount: 5, totalACount: 5, cooccurrenceRatio: 1, meanGapMs: 100 } }, expectedOutput: "{ id, parallel, estimatedSpeedup }" }],
  pitfalls: ["Equal latencies → ~50% speedup. Very different latencies → speedup approaches min/sum."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const f = core.synapseFusion.fuseSynapses({
      pair: args["pair"] as Parameters<typeof core.synapseFusion.fuseSynapses>[0]["pair"],
      estimatedLatencyA: args["estimatedLatencyA"] as number | undefined,
      estimatedLatencyB: args["estimatedLatencyB"] as number | undefined,
    });
    return { data: f, wisdom: core.synapseFusion.formatFusedLine(f), confidence: { level: "high" } };
  },
};

export const V1929_SYNAPSE_GENESIS_TOOLS: MnemeTool[] = [
  synapseReinforceTool, synapseDecideFireTool, synapseQueryTool, synapsePruneTool, synapseStatsTool,
  circadianClassifyTool, circadianGateTool, circadianListPhasesTool,
  synapseFusionCycleTool, synapseFusePairTool,
];
