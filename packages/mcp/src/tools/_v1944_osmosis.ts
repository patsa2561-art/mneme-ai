/**
 * v2.19.44 VACCINE OSMOSIS — MCP tools (5)
 *
 *   mneme.osmosis.check                — re-verify a vaccine before AUTO_REFUTE
 *   mneme.osmosis.register             — register a new vaccine in the lattice
 *   mneme.osmosis.update_catalog       — refresh the HLL + drift detector
 *   mneme.osmosis.stats                — dashboard surface for all 8 algorithm metrics
 *   mneme.osmosis.stale_probability    — pure math: P(stale) = 1 - exp(-λ·Δt)
 */

import type { MnemeTool } from "./_types.js";

export const osmosisCheckTool: MnemeTool = {
  name: "mneme.osmosis.check",
  category: "audit",
  description: "🧬 OSMOSIS (v2.19.44) — re-verify a vaccine before short-circuiting AUTO_REFUTE. Returns trustVaccine=false if vaccine is stale (P(stale) > threshold) AND a previously-refuted tool now exists in the live catalog. Self-burns stale vaccines. The N3-overshoot root cause fix.",
  whenToUse: "Wrap every cache-hit return path in the AUTO_REFUTE/vaccine layer. Pre-v2.19.44 vaccines fired on TRUE claims because cache returned without source-check.",
  triggers: ["osmosis check", "vaccine verify", "anti-stale"],
  inputSchema: { type: "object", properties: { lattice: { type: "object" }, vaccine: { type: "object" }, nowMs: { type: "number" } }, required: ["lattice", "vaccine"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is this vaccine still trustworthy?", args: { lattice: {}, vaccine: {} }, expectedOutput: "{ trustVaccine, burned, reason, staleProb, posteriorMean, phAlarm }" }],
  pitfalls: ["The lattice catalogHll must be refreshed via mneme.osmosis.update_catalog before checks; an empty HLL falsely reports all tools as missing."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.vaccineOsmosis.osmosisCheck(
      args["lattice"] as Parameters<typeof core.vaccineOsmosis.osmosisCheck>[0],
      args["vaccine"] as Parameters<typeof core.vaccineOsmosis.osmosisCheck>[1],
      (args["nowMs"] as number | undefined) ?? Date.now(),
    );
    return { data: r, wisdom: `🧬 ${r.trustVaccine ? "trust" : "burn"} · ${r.reason}`, confidence: { level: "high" } };
  },
};

export const osmosisRegisterTool: MnemeTool = {
  name: "mneme.osmosis.register",
  category: "audit",
  description: "🧬 OSMOSIS — register a new vaccine in the lattice (HMAC-chain + Bloom + Reservoir all updated atomically).",
  whenToUse: "After ACGV emits a vaccine, register it into the osmosis lattice so future cache hits can self-burn on drift.",
  triggers: ["osmosis register", "lattice add vaccine"],
  inputSchema: { type: "object", properties: { lattice: { type: "object" }, simhash: { type: "string" }, refutedTools: { type: "array" }, nowMs: { type: "number" } }, required: ["lattice", "simhash", "refutedTools"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Add vaccine to osmosis lattice", args: { lattice: {}, simhash: "abc", refutedTools: ["mneme.fake.tool"] }, expectedOutput: "{ id, simhash, emitTimeMs, posterior, ... }" }],
  pitfalls: ["simhash must be deterministic across mints; reservoir sampling is unbounded if you don't cap the reservoir capacity at lattice creation."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const v = core.vaccineOsmosis.registerVaccine(
      args["lattice"] as Parameters<typeof core.vaccineOsmosis.registerVaccine>[0],
      args["simhash"] as string,
      args["refutedTools"] as string[],
      (args["nowMs"] as number | undefined) ?? Date.now(),
    );
    return { data: v, wisdom: `🧬 vaccine ${v.id.slice(0, 8)} registered (${v.refutedTools.length} refuted tools)`, confidence: { level: "high" } };
  },
};

export const osmosisUpdateCatalogTool: MnemeTool = {
  name: "mneme.osmosis.update_catalog",
  category: "meta",
  description: "🧬 OSMOSIS — refresh the live-catalog HyperLogLog sketch + feed Page-Hinkley + update Kalman volatility estimate. Call after every release / catalog churn event.",
  whenToUse: "After daemon detects a catalog change (new tool registered / tool removed). Triggers drift detection.",
  triggers: ["osmosis update catalog", "lattice refresh"],
  inputSchema: { type: "object", properties: { lattice: { type: "object" }, catalog: { type: "array" }, nowMs: { type: "number" } }, required: ["lattice", "catalog"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Refresh osmosis catalog snapshot", args: { lattice: {}, catalog: ["mneme.a.b"] }, expectedOutput: "{}" }],
  pitfalls: ["Snapshot is destructive — old HLL is replaced; if you need the prior, snapshot it externally first."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    core.vaccineOsmosis.updateCatalogSnapshot(
      args["lattice"] as Parameters<typeof core.vaccineOsmosis.updateCatalogSnapshot>[0],
      args["catalog"] as string[],
      (args["nowMs"] as number | undefined) ?? Date.now(),
    );
    return { data: { ok: true, catalogSize: (args["catalog"] as string[]).length }, wisdom: `🧬 catalog snapshot updated · ${(args["catalog"] as string[]).length} tools`, confidence: { level: "high" } };
  },
};

export const osmosisStatsTool: MnemeTool = {
  name: "mneme.osmosis.stats",
  category: "meta",
  description: "🧬 OSMOSIS — dashboard surface for all 8 algorithm-derived metrics (totalVaccines / burnedLifetime / activeVaccines / catalogCardinality / bloomFpRate / meanPosterior / volatility / phAlerts / reservoirSize).",
  whenToUse: "Daemon-pulse surface + manual lattice introspection.",
  triggers: ["osmosis stats", "lattice health"],
  inputSchema: { type: "object", properties: { lattice: { type: "object" } }, required: ["lattice"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show osmosis lattice stats", args: { lattice: {} }, expectedOutput: "{ totalVaccines, burnedLifetime, activeVaccines, ... }" }],
  pitfalls: [],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.vaccineOsmosis.osmosisStats(args["lattice"] as Parameters<typeof core.vaccineOsmosis.osmosisStats>[0]);
    return { data: s, wisdom: `🧬 ${s.activeVaccines}/${s.totalVaccines} active · ${s.burnedLifetime} burned lifetime · volatility=${s.volatility.toFixed(4)}/sec`, confidence: { level: "high" } };
  },
};

export const osmosisStaleProbabilityTool: MnemeTool = {
  name: "mneme.osmosis.stale_probability",
  category: "meta",
  description: "🧬 OSMOSIS — pure math: P(stale) = 1 - exp(-λ·Δt). Compute the staleness probability of a cache hit without touching the lattice.",
  whenToUse: "When tuning recheck thresholds; or showing the user 'this vaccine is X% likely to be stale' on a dashboard.",
  triggers: ["stale probability", "osmosis decay"],
  inputSchema: { type: "object", properties: { volatilityPerSec: { type: "number" }, ageSeconds: { type: "number" } }, required: ["volatilityPerSec", "ageSeconds"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "How stale is a 1-day-old vaccine at λ=0.01/sec?", args: { volatilityPerSec: 0.01, ageSeconds: 86400 }, expectedOutput: "{ probability: ~1.0 }" }],
  pitfalls: ["λ is per-second; convert per-day rates accordingly. Probability saturates at 1 as t→∞."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const p = core.vaccineOsmosis.staleProbability(args["volatilityPerSec"] as number, args["ageSeconds"] as number);
    return { data: { probability: p, volatilityPerSec: args["volatilityPerSec"], ageSeconds: args["ageSeconds"] }, wisdom: `🧬 P(stale) = ${(p * 100).toFixed(1)}%`, confidence: { level: "high" } };
  },
};

export const V1944_OSMOSIS_TOOLS: MnemeTool[] = [
  osmosisCheckTool, osmosisRegisterTool, osmosisUpdateCatalogTool, osmosisStatsTool, osmosisStaleProbabilityTool,
];
