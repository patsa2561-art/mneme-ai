/**
 * v2.6.0 -- MCP wrappers for TRUTH KERNEL + WORMHOLE.
 *
 *   mneme.truth.check    — fuse multiple hallucination gates into one verdict
 *   mneme.wormhole.send  — race every available transport, take the winner
 *
 * Each wrapper accepts a CALLER-SUPPLIED sensor/channel list because the
 * kernel + wormhole are intentionally sensor-agnostic. The MCP server
 * passes through whatever the AI agent or daemon has wired up.
 */

import type { MnemeTool } from "./_types.js";

export const truthCheckMultiTool: MnemeTool = {
  name: "mneme.truth.check_multi",
  category: "audit",
  description:
    "TRUTH KERNEL -- run every Mneme hallucination gate in parallel against ONE claim, fuse the verdicts via weighted log-odds Bayesian fusion, and surface disagreement as uncertainty signal. Use INSTEAD OF picking flash / apoptosis / xray / twins individually.",
  whenToUse: "Any non-trivial factual claim where you'd otherwise have to pick a gate. Replace per-gate calls with one kernel call.",
  triggers: ["fuse truth gates", "multi-sensor truth", "truth kernel", "ความจริงทุกมิติ"],
  inputSchema: {
    type: "object",
    properties: {
      claim: { type: "string" },
      sensors: {
        type: "array",
        description: "Pre-computed verdicts from individual gates the caller already ran. Each element: { sensor, verdict (TRUE|FALSE|UNCERTAIN|INAPPLICABLE), confidence (0..1), rationale?, weight? }.",
        items: { type: "object" },
      },
    },
    required: ["claim", "sensors"],
  },
  outputSchema: { type: "object" },
  examples: [{
    userQuery: "Fuse flash + apoptosis verdicts on this claim",
    args: {
      claim: "Postgres can scale to 10k QPS on a single node",
      sensors: [
        { sensor: "flash", verdict: "UNCERTAIN", confidence: 0.4, rationale: "claim depends on workload" },
        { sensor: "apoptosis", verdict: "TRUE", confidence: 0.8, rationale: "AWS reference architecture exists" },
      ],
    },
    expectedOutput: "{ pTrue, verdict, disagreement, sensorOutputs, dominantSensor, outlierSensor }",
  }],
  pitfalls: [
    "DISPUTED verdict is the ALARM — pTrue near 0.5 with high disagreement means the gates fundamentally disagree; do NOT pick one and ignore the others.",
    "INCONCLUSIVE means every sensor was UNCERTAIN — call more / better gates before deciding.",
  ],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const sensorOutputs = ((args["sensors"] as Array<{ sensor: string; verdict: string; confidence: number; rationale?: string; weight?: number }>) ?? []);
    // Wrap pre-computed outputs as instant-return adapters so the kernel
    // can fuse without re-running anything.
    const adapters = sensorOutputs.map((s) => ({
      id: s.sensor,
      weight: typeof s.weight === "number" ? s.weight : 1.0,
      run: () => ({
        sensor: s.sensor,
        verdict: (s.verdict as "TRUE" | "FALSE" | "UNCERTAIN" | "INAPPLICABLE"),
        confidence: typeof s.confidence === "number" ? s.confidence : 0,
        rationale: s.rationale,
      }),
    }));
    const r = await core.truthKernel.checkTruth({ claim: String(args["claim"] ?? ""), sensors: adapters });
    return {
      data: r,
      wisdom: core.truthKernel.formatTruthKernelPulseLine(r),
      followUp: r.verdict === "DISPUTED" ? ["mneme.apoptosis.witness", "mneme.flash.run"] : [],
      confidence: { level: r.verdict === "INCONCLUSIVE" ? "low" : (r.disagreement > 0.5 ? "medium" : "high"), notes: r.verdict === "DISPUTED" ? "Sensors disagree — pTrue is near 0.5; investigate the outlier sensor." : undefined },
    };
  },
};

export const wormholeStatusTool: MnemeTool = {
  name: "mneme.wormhole.status",
  category: "meta",
  description:
    "WORMHOLE -- summarise the EWMA stats for every transport channel (anchor / aura / relay / synapse / rainbow / etc) so the AI knows which channels have been winning lately and which are flaky.",
  whenToUse: "Before suggesting a transport to the user, or after a cross-device send to understand why a particular channel won.",
  triggers: ["wormhole status", "which transport works", "channel scores"],
  inputSchema: {
    type: "object",
    properties: {
      stats: {
        type: "object",
        description: "Caller-supplied stats map { channel -> { trials, succeeded, ewmaSuccess, ewmaLatencyMs } }. Empty object = cold start.",
      },
    },
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Which transport should I use?", args: { stats: {} }, expectedOutput: "{ ranked: [{ channel, score, ewmaSuccess, ewmaLatencyMs }] }" }],
  pitfalls: ["Cold-start stats give every channel 0.5 success — wait for ≥10 trials per channel before trusting the ranking."],
  handler: async (_rt, args) => {
    const stats = (args["stats"] as Record<string, { channel: string; trials: number; succeeded: number; ewmaSuccess: number; ewmaLatencyMs: number }>) ?? {};
    const ranked = Object.values(stats)
      .map((s) => ({
        channel: s.channel,
        score: s.ewmaSuccess * (1 / (1 + s.ewmaLatencyMs / 1000)),
        ewmaSuccess: s.ewmaSuccess,
        ewmaLatencyMs: s.ewmaLatencyMs,
        trials: s.trials,
        succeeded: s.succeeded,
      }))
      .sort((a, b) => b.score - a.score);
    return {
      data: { ranked },
      wisdom: ranked.length > 0
        ? `WORMHOLE · top channel=${ranked[0]!.channel} score=${ranked[0]!.score.toFixed(2)} (${ranked.length} tracked)`
        : `WORMHOLE · COLD-START · no stats yet; every channel starts at neutral 0.5`,
      confidence: { level: ranked.length > 10 ? "high" : "low", notes: ranked.length <= 10 ? "Wait for ≥10 trials per channel before trusting the ranking." : undefined },
    };
  },
};

export const TRUTH_WORMHOLE_TOOLS: MnemeTool[] = [
  truthCheckMultiTool,
  wormholeStatusTool,
];
