/**
 * v2.19.48 CHRONOSHEAF — MCP tools (P3 + P4 live algorithm surface).
 *
 *   mneme.chronosheaf.update     — single ChronoSheafUpdate cycle
 *   mneme.chronosheaf.slo        — SLO summary across the state
 *   mneme.chronosheaf.preflight  — budget guard before update
 *   mneme.chronosheaf.h1         — Čech H¹ on a supplied cover (one-shot)
 *   mneme.chronosheaf.cover      — build a default self-audit cover
 */

import type { MnemeTool } from "./_types.js";

export const chronoSheafUpdateTool: MnemeTool = {
  name: "mneme.chronosheaf.update",
  category: "audit",
  description: "🌌 CHRONOSHEAF (v2.19.48) — single ChronoSheafUpdate cycle. Takes a cover + claims + evidence + optional probe candidates + reflexive stalks. Returns alarms / probe selection / persistence diagram update. The live algorithm composing all 7 P2 primitives.",
  whenToUse: "Per commit (or per claim batch) to detect contradictions the pairwise paradox sniffer misses — H¹ ≠ 0 means structural inconsistency.",
  triggers: ["chronosheaf update", "h1 detect", "topological contradiction"],
  inputSchema: {
    type: "object",
    properties: {
      input: { type: "object", description: "UpdateInput shape (commit, nowMs, cover, claims, evidence, ...)" },
      state: { type: "object", description: "UpdateState (caller-owned; passed back round-trip)" },
    },
    required: ["input"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Run a CHRONOSHEAF cycle on this commit", args: { input: { commit: "abc", nowMs: 0, cover: [], claims: [], evidence: [] } }, expectedOutput: "{ summary: {h1, alarmsFired, probeSelected, ...}, events: [...], state }" }],
  pitfalls: ["Caller owns the state object; passing a fresh one each call defeats persistence-diagram tracking."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const input = args["input"] as Parameters<typeof core.chronosheaf.liveUpdate.chronoSheafUpdate>[0];
    const state = (args["state"] as Parameters<typeof core.chronosheaf.liveUpdate.chronoSheafUpdate>[1] | undefined)
      ?? core.chronosheaf.liveUpdate.newUpdateState();
    const events: Parameters<Parameters<typeof core.chronosheaf.liveUpdate.chronoSheafUpdate>[2]>[0][] = [];
    const summary = core.chronosheaf.liveUpdate.chronoSheafUpdate(input, state, (e) => events.push(e));
    return { data: { summary, events, state }, wisdom: `🌌 H¹=${summary.h1} · alarms=${summary.alarmsFired} · probe=${summary.probeSelected ?? "none"} · ${summary.ms}ms`, confidence: { level: "high" } };
  },
};

export const chronoSheafSloTool: MnemeTool = {
  name: "mneme.chronosheaf.slo",
  category: "meta",
  description: "🌌 CHRONOSHEAF — SLO summary: totalCycles / contradictionsDetected / activeContradictions / meanLivedMs / promotedRelevant / selfInconsistencies.",
  whenToUse: "Dashboard / weekly review surface. Pair with mneme.proof.mint for billing-grade evidence.",
  triggers: ["chronosheaf slo", "contradiction dashboard"],
  inputSchema: { type: "object", properties: { state: { type: "object" } }, required: ["state"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show CHRONOSHEAF SLO", args: { state: {} }, expectedOutput: "{ totalCycles, contradictionsDetected, activeContradictions, ... }" }],
  pitfalls: [],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const slo = core.chronosheaf.liveUpdate.chronoSlo(args["state"] as Parameters<typeof core.chronosheaf.liveUpdate.chronoSlo>[0]);
    return { data: slo, wisdom: `🌌 cycles=${slo.totalCycles} · detected=${slo.contradictionsDetected} · active=${slo.activeContradictions} · self-inc=${slo.selfInconsistencies}`, confidence: { level: "high" } };
  },
};

export const chronoSheafPreflightTool: MnemeTool = {
  name: "mneme.chronosheaf.preflight",
  category: "meta",
  description: "🌌 CHRONOSHEAF — budget guard: rejects covers / claim batches that would exceed the O(k²·d) live-budget. Returns { ok, reason }.",
  whenToUse: "Before mneme.chronosheaf.update on a large batch to avoid runaway compute.",
  triggers: ["chronosheaf preflight", "budget check"],
  inputSchema: { type: "object", properties: { input: { type: "object" }, maxCoverSize: { type: "number" }, maxClaims: { type: "number" } }, required: ["input"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Is this cover within budget?", args: { input: { commit: "c", nowMs: 0, cover: [], claims: [], evidence: [] } }, expectedOutput: "{ ok: true }" }],
  pitfalls: [],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.chronosheaf.liveUpdate.preflightBudget(
      args["input"] as Parameters<typeof core.chronosheaf.liveUpdate.preflightBudget>[0],
      args["maxCoverSize"] as number | undefined,
      args["maxClaims"] as number | undefined,
    );
    return { data: r, wisdom: r.ok ? "🌌 within budget" : `🌌 ${r.reason}`, confidence: { level: "high" } };
  },
};

export const chronoSheafH1Tool: MnemeTool = {
  name: "mneme.chronosheaf.h1",
  category: "audit",
  description: "🌌 CHRONOSHEAF — one-shot Čech H¹ on a supplied SheafCover (sites + overlaps + optional triples). Returns dim H¹ + minimal obstruction witnesses. Pure-function; doesn't touch live state.",
  whenToUse: "Diagnostic / verifier — quickly compute H¹ for any cover shape.",
  triggers: ["chronosheaf h1", "compute cohomology"],
  inputSchema: { type: "object", properties: { cover: { type: "object" } }, required: ["cover"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Compute H¹ for this cover", args: { cover: { sites: ["A","B","C"], overlaps: [["A","B"],["B","C"],["A","C"]] } }, expectedOutput: "{ h1: 1, hasObstruction: true, obstructions: [...] }" }],
  pitfalls: ["Cover with no triple overlaps over a cycle always yields H¹ ≥ 1 — that's the canonical 'local OK, global contradiction' signal."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const r = core.chronosheaf.sheaf.cohomologyH1(args["cover"] as Parameters<typeof core.chronosheaf.sheaf.cohomologyH1>[0]);
    return { data: r, wisdom: `🌌 H¹=${r.h1} · components=${r.components} · ${r.hasObstruction ? "OBSTRUCTION" : "consistent"}`, confidence: { level: "high" } };
  },
};

export const chronoSheafCoverTool: MnemeTool = {
  name: "mneme.chronosheaf.cover",
  category: "meta",
  description: "🌌 CHRONOSHEAF — build a default self-audit cover from a list of verifier site names + commit + time window. Convenience for the Mneme self-audit pattern (PAIN-001/003/005).",
  whenToUse: "Bootstrapping a CHRONOSHEAF cycle when caller doesn't have its own cover.",
  triggers: ["chronosheaf cover", "build self-audit cover"],
  inputSchema: {
    type: "object",
    properties: {
      rootCommit: { type: "string" }, sites: { type: "array" }, nowMs: { type: "number" }, windowMs: { type: "number" }, scale: { type: "string" },
    },
    required: ["rootCommit", "sites"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Build a self-audit cover", args: { rootCommit: "abc", sites: ["registry","cli","release_manifest"] }, expectedOutput: "{ cover: [...3 opens] }" }],
  pitfalls: ["Scale defaults to 'repo'; pass scale: 'org' for cross-repo audits."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    // Fresh dag is fine for cover construction; dag is only used for intersection downstream.
    const dag = new core.chronosheaf.baseSpace.CommitDag();
    dag.addCommit(args["rootCommit"] as string, []);
    const cover = core.chronosheaf.liveUpdate.buildSelfAuditCover(
      dag,
      args["rootCommit"] as string,
      args["sites"] as string[],
      (args["nowMs"] as number | undefined) ?? Date.now(),
      args["windowMs"] as number | undefined,
      args["scale"] as Parameters<typeof core.chronosheaf.liveUpdate.buildSelfAuditCover>[5] | undefined,
    );
    return { data: { cover }, wisdom: `🌌 cover built · ${cover.length} sites`, confidence: { level: "high" } };
  },
};

export const V1948_CHRONOSHEAF_TOOLS: MnemeTool[] = [
  chronoSheafUpdateTool,
  chronoSheafSloTool,
  chronoSheafPreflightTool,
  chronoSheafH1Tool,
  chronoSheafCoverTool,
];
