/**
 * v2.19.27 DREAMSPACE PIPELINE — stages 1, 2, 3, 6 (completes the 6-stage loop)
 *
 *   🔬 PROBE (stage 1, 3 tools):
 *     mneme.dreamspace.probe_finalise   — pure aggregator from runs[]
 *     mneme.dreamspace.probe_metrics    — single tool's 4 normalised metrics
 *     mneme.dreamspace.probe_verify     — HMAC verify a probe report
 *
 *   🗺 CARTOGRAPHER (stage 2, 3 tools):
 *     mneme.dreamspace.map_build        — aggregate probe runs into capability map
 *     mneme.dreamspace.map_query        — query map by input args → tools sorted by quality
 *     mneme.dreamspace.map_stats        — totals + meanQuality + highQ + singleProbe counts
 *
 *   💞 PAIR (stage 3, 3 tools):
 *     mneme.dreamspace.pair_score       — score one (A, B) pair via mutual_info
 *     mneme.dreamspace.pair_rank        — rank ALL ordered (A, B) pairs above threshold
 *     mneme.dreamspace.pair_verify      — HMAC verify a pair report
 *
 *   🌍 FEDERATE (stage 6, 3 tools):
 *     mneme.dreamspace.federate_attest    — issue EliteAttestation (refuses below threshold)
 *     mneme.dreamspace.federate_quorum    — aggregate N attestations into blessing band
 *     mneme.dreamspace.federate_starter   — export top-N starter pack for new users
 */

import type { MnemeTool } from "./_types.js";

// ─── PROBE ──────────────────────────────────────────────────────────

export const probeFinaliseTool: MnemeTool = {
  name: "mneme.dreamspace.probe_finalise",
  category: "audit",
  description:
    "🔬 PROBE (stage 1) — pure aggregator: takes a list of probe runs and computes 4 normalised metrics (latency / output entropy / error rate / utility) + geometric-mean fitness. HMAC-signed ToolProbeReport.",
  whenToUse: "After daemon ran a tool against a battery of synthetic + real inputs (use mneme.dreamspace.probe_metrics for invocation).",
  triggers: ["probe finalise", "dreamspace probe"],
  inputSchema: {
    type: "object",
    properties: {
      toolName: { type: "string" },
      runs: { type: "array", items: { type: "object" } },
      latencyBudgetMs: { type: "number" },
      latencyHalfLifeMs: { type: "number" },
      probedAt: { type: "number" },
    },
    required: ["toolName", "runs"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Finalise a probe of mneme.ask",
    args: { toolName: "mneme.ask", runs: [{ inputLabel: "x", inputSource: "synthetic", latencyMs: 50, ok: true, result: { ok: true } }] },
    expectedOutput: "{ metrics: { latencyScore, outputEntropy, errorRate, utilityScore, fitnessScore }, sig }",
  }],
  pitfalls: ["Fitness is geometric mean -- any zero metric drags toward floor. Empty runs -> 0 fitness."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.dreamspaceProbe.finaliseProbe({
      toolName: String(args["toolName"]),
      runs: args["runs"] as Parameters<typeof core.dreamspaceProbe.finaliseProbe>[0]["runs"],
      latencyBudgetMs: args["latencyBudgetMs"] as number | undefined,
      latencyHalfLifeMs: args["latencyHalfLifeMs"] as number | undefined,
      probedAt: args["probedAt"] as number | undefined,
    });
    return { data: r, wisdom: core.dreamspaceProbe.formatProbeLine(r), confidence: { level: "high" } };
  },
};

export const probeMetricsTool: MnemeTool = {
  name: "mneme.dreamspace.probe_metrics",
  category: "audit",
  description: "🔬 PROBE — expose the 4 metric primitives (latencyScore / outputShapeEntropy / errorRate / utilityScore + geometric-mean fitness). Useful for AI introspection.",
  whenToUse: "Debugging probe results when fitness looks surprising.",
  triggers: ["probe metrics"],
  inputSchema: {
    type: "object",
    properties: {
      runs: { type: "array", items: { type: "object" } },
      latencyBudgetMs: { type: "number" },
    },
    required: ["runs"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "What's the fitness of these runs?", args: { runs: [] }, expectedOutput: "{ latencyScore, outputEntropy, errorRate, utilityScore, fitnessScore }" }],
  pitfalls: ["Pass already-collected ProbeRun[]; this tool doesn't invoke anything."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const runs = args["runs"] as Parameters<typeof core.dreamspaceProbe.finaliseProbe>[0]["runs"];
    const meanLatency = runs.length === 0 ? 0 : runs.reduce((s, r) => s + r.latencyMs, 0) / runs.length;
    const lat = core.dreamspaceProbe.latencyScore(meanLatency, args["latencyBudgetMs"] as number | undefined);
    const ent = core.dreamspaceProbe.outputShapeEntropy(runs.filter((r) => r.ok).map((r) => r.result));
    const err = core.dreamspaceProbe.errorRate(runs);
    const util = core.dreamspaceProbe.utilityScore(runs);
    const fit = core.dreamspaceProbe.aggregateFitness({ latencyScore: lat, outputEntropy: ent, errorRate: err, utilityScore: util });
    return {
      data: { latencyScore: lat, outputEntropy: ent, errorRate: err, utilityScore: util, fitnessScore: fit },
      wisdom: `🔬 fit=${(fit * 100).toFixed(0)}% (lat=${(lat * 100).toFixed(0)}% ent=${(ent * 100).toFixed(0)}% err=${(err * 100).toFixed(0)}% util=${(util * 100).toFixed(0)}%)`,
      confidence: { level: "high" },
    };
  },
};

export const probeVerifyTool: MnemeTool = {
  name: "mneme.dreamspace.probe_verify",
  category: "audit",
  description: "🔬 PROBE — HMAC-verify a ToolProbeReport; rejects tampered reports before daemon trusts the fitness signal.",
  whenToUse: "Before acting on a probe report received from another instance (federation).",
  triggers: ["probe verify"],
  inputSchema: { type: "object", properties: { report: { type: "object" } }, required: ["report"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Verify this probe report", args: { report: {} }, expectedOutput: "{ ok: true|false }" }],
  pitfalls: ["Verification fails on any byte tamper; do NOT trust unverified reports for promotion decisions."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const ok = core.dreamspaceProbe.verifyProbeReport(args["report"] as Parameters<typeof core.dreamspaceProbe.verifyProbeReport>[0]);
    return { data: { ok }, wisdom: ok ? "🔬 verified" : "💀 tampered", confidence: { level: "high" } };
  },
};

// ─── CARTOGRAPHER ───────────────────────────────────────────────────

export const mapBuildTool: MnemeTool = {
  name: "mneme.dreamspace.map_build",
  category: "audit",
  description: "🗺 CARTOGRAPHER (stage 2) — aggregate probe runs into a 2D capability map: (toolName, patternSig) → quality. EWMA merges multiple probes per cell. HMAC-signed CapabilityMap.",
  whenToUse: "After PROBE produced N reports across many tools; daemon builds the map for REFLEX queries.",
  triggers: ["dreamspace map build", "capability map"],
  inputSchema: {
    type: "object",
    properties: {
      probes: { type: "array", items: { type: "object" } },
      builtAt: { type: "number" },
      blendWeight: { type: "number", description: "Default 0.3 (slow EWMA drift)" },
    },
    required: ["probes"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Build the capability map from my probes",
    args: { probes: [] },
    expectedOutput: "{ cells, totalProbes, uniquePatterns, uniqueTools, sig }",
  }],
  pitfalls: ["Pattern signatures are conservative (object key names, sorted, lowercased) — they don't infer semantic intent."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const m = core.dreamspaceCartographer.buildCapabilityMap({
      probes: args["probes"] as Parameters<typeof core.dreamspaceCartographer.buildCapabilityMap>[0]["probes"],
      builtAt: args["builtAt"] as number | undefined,
      blendWeight: args["blendWeight"] as number | undefined,
    });
    return { data: m, wisdom: `🗺 ${m.cells.length} cells across ${m.uniqueTools} tools`, confidence: { level: "high" } };
  },
};

export const mapQueryTool: MnemeTool = {
  name: "mneme.dreamspace.map_query",
  category: "audit",
  description: "🗺 CARTOGRAPHER — REFLEX's entry point: given input args, return tools that handle this pattern signature, sorted by quality desc.",
  whenToUse: "REFLEX predict-next-tool: before frequency-only ranking, ask the map for evidence-backed candidates.",
  triggers: ["dreamspace map query", "capability lookup"],
  inputSchema: {
    type: "object",
    properties: {
      map: { type: "object" },
      args: {},
      topN: { type: "number" },
      minQuality: { type: "number" },
    },
    required: ["map", "args"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Which tools handle inputs shaped like { question, repoRoot }?",
    args: { map: { v: 1, cells: [], totalProbes: 0, uniquePatterns: 0, uniqueTools: 0, builtAt: 0, sig: "" }, args: { question: "x", repoRoot: "/x" } },
    expectedOutput: "{ tools: CapabilityCell[] }",
  }],
  pitfalls: ["Unknown pattern -> empty result; not an error. minQuality filters per-cell."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const tools = core.dreamspaceCartographer.queryCapability({
      map: args["map"] as Parameters<typeof core.dreamspaceCartographer.queryCapability>[0]["map"],
      args: args["args"],
      topN: args["topN"] as number | undefined,
      minQuality: args["minQuality"] as number | undefined,
    });
    return { data: { tools, count: tools.length }, wisdom: `🗺 ${tools.length} candidates`, confidence: { level: "high" } };
  },
};

export const mapStatsTool: MnemeTool = {
  name: "mneme.dreamspace.map_stats",
  category: "audit",
  description: "🗺 CARTOGRAPHER — totals + meanQuality + highQualityCells + singleProbeCells. Health check for the capability map.",
  whenToUse: "Periodic audit: is the map well-covered or sparse?",
  triggers: ["dreamspace map stats"],
  inputSchema: { type: "object", properties: { map: { type: "object" } }, required: ["map"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How well-mapped is my catalog?", args: { map: {} }, expectedOutput: "{ totalCells, uniqueTools, meanQuality, highQualityCells, singleProbeCells }" }],
  pitfalls: ["High singleProbeCells = many low-confidence estimates; run more probes."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.dreamspaceCartographer.computeMapStats(args["map"] as Parameters<typeof core.dreamspaceCartographer.computeMapStats>[0]);
    return { data: s, wisdom: core.dreamspaceCartographer.formatMapLine(s), confidence: { level: "high" } };
  },
};

// ─── PAIR ───────────────────────────────────────────────────────────

export const pairScoreTool: MnemeTool = {
  name: "mneme.dreamspace.pair_score",
  category: "audit",
  description: "💞 PAIR (stage 3) — score a single (A, B) pair via mutual-info approximation (requiredCoverage + optionalCoverage + keyOverlap). Returns 4 sub-scores + final mutual_info.",
  whenToUse: "When debugging why a specific pair did or didn't qualify for mating.",
  triggers: ["dreamspace pair score"],
  inputSchema: {
    type: "object",
    properties: {
      toolA: { type: "string" },
      outputsA: { type: "array", items: { type: "object" } },
      schemaB: { type: "object" },
    },
    required: ["toolA", "outputsA", "schemaB"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "How complementary is mneme.truth.forensic to mneme.bug_prophet?",
    args: { toolA: "mneme.truth.forensic", outputsA: [{ toolName: "mneme.truth.forensic", result: { claim: "x", evidence: [] } }], schemaB: { toolName: "mneme.bug_prophet", requiredProps: ["claim", "evidence"], optionalProps: [] } },
    expectedOutput: "{ keyOverlapScore, requiredCoverage, optionalCoverage, mutualInfoScore }",
  }],
  pitfalls: ["Required coverage dominates the blend (weight 0.5) because missing required props = B throws."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.dreamspacePair.scorePair({
      toolA: String(args["toolA"]),
      outputsA: args["outputsA"] as Parameters<typeof core.dreamspacePair.scorePair>[0]["outputsA"],
      schemaB: args["schemaB"] as Parameters<typeof core.dreamspacePair.scorePair>[0]["schemaB"],
    });
    return { data: s, wisdom: core.dreamspacePair.formatPairLine(s), confidence: { level: "high" } };
  },
};

export const pairRankTool: MnemeTool = {
  name: "mneme.dreamspace.pair_rank",
  category: "audit",
  description: "💞 PAIR — rank ALL ordered (A, B) pairs across the supplied tools; filter above minScore; top-N sorted by mutual_info desc. Feeds GESTATION pattern_co_occurrence signals with QUALITY (not just frequency).",
  whenToUse: "Daemon dream cycle: discover all candidate mating pairs across the whole catalog.",
  triggers: ["dreamspace pair rank"],
  inputSchema: {
    type: "object",
    properties: {
      toolOutputs: { type: "array", items: { type: "array", items: { type: "object" } } },
      toolSchemas: { type: "array", items: { type: "object" } },
      minScore: { type: "number", description: "Default 0.3" },
      topN: { type: "number", description: "Default 25" },
    },
    required: ["toolOutputs", "toolSchemas"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Rank all complementary pairs in my catalog",
    args: { toolOutputs: [], toolSchemas: [] },
    expectedOutput: "{ pairs: PairScore[], totalCandidatePairs, qualifyingPairs, sig }",
  }],
  pitfalls: ["Self-pairs (A→A) excluded; A→B and B→A are DIFFERENT pairs ranked separately."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.dreamspacePair.rankAllPairs({
      toolOutputs: args["toolOutputs"] as Parameters<typeof core.dreamspacePair.rankAllPairs>[0]["toolOutputs"],
      toolSchemas: args["toolSchemas"] as Parameters<typeof core.dreamspacePair.rankAllPairs>[0]["toolSchemas"],
      minScore: args["minScore"] as number | undefined,
      topN: args["topN"] as number | undefined,
    });
    return { data: r, wisdom: `💞 ${r.qualifyingPairs}/${r.totalCandidatePairs} qualifying`, confidence: { level: "high" } };
  },
};

export const pairVerifyTool: MnemeTool = {
  name: "mneme.dreamspace.pair_verify",
  category: "audit",
  description: "💞 PAIR — HMAC-verify a PairReport; rejects forged pairs before daemon promotes them as mating signals.",
  whenToUse: "Before consuming a pair report from another instance (federation).",
  triggers: ["dreamspace pair verify"],
  inputSchema: { type: "object", properties: { report: { type: "object" } }, required: ["report"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Verify pair report", args: { report: {} }, expectedOutput: "{ ok: true|false }" }],
  pitfalls: ["Don't trust unverified reports for chimera creation."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const ok = core.dreamspacePair.verifyPairReport(args["report"] as Parameters<typeof core.dreamspacePair.verifyPairReport>[0]);
    return { data: { ok }, wisdom: ok ? "💞 verified" : "💀 tampered", confidence: { level: "high" } };
  },
};

// ─── FEDERATE ───────────────────────────────────────────────────────

export const federateAttestTool: MnemeTool = {
  name: "mneme.dreamspace.federate_attest",
  category: "audit",
  description: "🌍 FEDERATE (stage 6) — issue an EliteAttestation for a locally-elite tool. REFUSES below minFitness (default 0.7); we never attest mediocre tools.",
  whenToUse: "Daemon dream-cycle: after PROBE shows fitness >= 0.7 on a MATURE tool, attest it to the federation.",
  triggers: ["dreamspace federate attest"],
  inputSchema: {
    type: "object",
    properties: {
      instanceId: { type: "string", description: "From v2.19.16 FEDERATED createInstanceIdentity" },
      toolName: { type: "string" },
      localFitness: { type: "number" },
      localUseCount: { type: "number" },
      ts: { type: "number" },
      minFitness: { type: "number", description: "Default 0.7" },
    },
    required: ["instanceId", "toolName", "localFitness", "localUseCount"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Attest that mneme.ask is elite on my instance",
    args: { instanceId: "inst_abc", toolName: "mneme.ask", localFitness: 0.85, localUseCount: 234 },
    expectedOutput: "EliteAttestation | null (null if below threshold)",
  }],
  pitfalls: ["Returns null silently when below threshold; caller MUST check for null before propagating."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const a = core.dreamspaceFederate.attestElite({
      instanceId: String(args["instanceId"]),
      toolName: String(args["toolName"]),
      localFitness: Number(args["localFitness"]),
      localUseCount: Number(args["localUseCount"]),
      ts: args["ts"] as number | undefined,
      minFitness: args["minFitness"] as number | undefined,
    });
    return { data: { attestation: a }, wisdom: a ? `🌍 attested elite ${a.toolName}` : `· refused (below threshold)`, confidence: { level: "high" } };
  },
};

export const federateQuorumTool: MnemeTool = {
  name: "mneme.dreamspace.federate_quorum",
  category: "audit",
  description: "🌍 FEDERATE — aggregate attestations for a single tool across N instances into a 6-band quorum (unanimous/supermajority/majority/minority/conflict/orphan). One-vote-per-instance (latest by ts); forged attestations dropped on verify.",
  whenToUse: "After collecting attestations from federation transport; produces the blessed/not-blessed verdict.",
  triggers: ["dreamspace federate quorum"],
  inputSchema: {
    type: "object",
    properties: {
      toolName: { type: "string" },
      attestations: { type: "array", items: { type: "object" } },
      totalInstancesKnown: { type: "number" },
    },
    required: ["toolName", "attestations", "totalInstancesKnown"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "What's the federation verdict on mneme.ask?",
    args: { toolName: "mneme.ask", attestations: [], totalInstancesKnown: 100 },
    expectedOutput: "{ band, isBlessed, validAttestations, forgedDropped, meanFitness, totalUseCount }",
  }],
  pitfalls: ["isBlessed only true for unanimous/supermajority. Below that = not yet broadly trusted."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const q = core.dreamspaceFederate.aggregateBlessing({
      toolName: String(args["toolName"]),
      attestations: args["attestations"] as Parameters<typeof core.dreamspaceFederate.aggregateBlessing>[0]["attestations"],
      totalInstancesKnown: Number(args["totalInstancesKnown"]),
    });
    return { data: q, wisdom: core.dreamspaceFederate.formatQuorumLine(q), confidence: { level: "high" } };
  },
};

export const federateStarterTool: MnemeTool = {
  name: "mneme.dreamspace.federate_starter",
  category: "audit",
  description: "🌍 FEDERATE — export top-N starter pack for new users. Sorted: blessed-first → meanFitness desc → attestation count desc. HMAC-signed StarterPack ready for download.",
  whenToUse: "New user just installed Mneme; serve them the federation's blessed catalog as bootstrap.",
  triggers: ["dreamspace federate starter pack"],
  inputSchema: {
    type: "object",
    properties: {
      quorums: { type: "array", items: { type: "object" } },
      topN: { type: "number", description: "Default 100" },
    },
    required: ["quorums"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Export the top-100 starter pack",
    args: { quorums: [], topN: 100 },
    expectedOutput: "{ entries: StarterPackEntry[], sig }",
  }],
  pitfalls: ["Pack contains TOOL NAMES + bands only — actual composer recipes ship via v2.19.9 splice on download."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const p = core.dreamspaceFederate.exportStarterPack({
      quorums: args["quorums"] as Parameters<typeof core.dreamspaceFederate.exportStarterPack>[0]["quorums"],
      topN: args["topN"] as number | undefined,
    });
    return { data: p, wisdom: core.dreamspaceFederate.formatStarterPackLine(p), confidence: { level: "high" } };
  },
};

export const V1927_DREAMSPACE_PIPELINE_TOOLS: MnemeTool[] = [
  probeFinaliseTool, probeMetricsTool, probeVerifyTool,
  mapBuildTool, mapQueryTool, mapStatsTool,
  pairScoreTool, pairRankTool, pairVerifyTool,
  federateAttestTool, federateQuorumTool, federateStarterTool,
];
