/**
 * v2.63.0 — TIME-CRYSTAL MCP tool surface.
 *
 *   mneme.time_crystal.lookup     — query wisdom for a problem
 *   mneme.time_crystal.contribute — record a (problem, approach, outcome) row
 *   mneme.time_crystal.stats      — contributor stats summary
 *   mneme.time_crystal.audit      — verify HMAC-chained wisdom ledger
 *
 * Wraps core/src/time_crystal/. Agents call `lookup` BEFORE attempting
 * a fix (to read what worked for others) and `contribute` AFTER (so the
 * next agent benefits). Network effect that compounds.
 */

import type { MnemeTool } from "./_types.js";

export const timeCrystalLookupTool: MnemeTool = {
  name: "mneme.time_crystal.lookup",
  category: "meta",
  description:
    "🌌 TIME-CRYSTAL — query federated agent wisdom for a problem. Returns ranked approaches (Wilson-LB success rate + recency decay + env grounding), auto-detected gotchas (env conditions where the approach failed), and related buckets (similar problem fingerprints). Pre-Mneme: StackOverflow is static. TIME-CRYSTAL = aggregated AI agent behavior on real outcomes.",
  whenToUse:
    "BEFORE attempting a fix or recommending an approach. Especially error-debugging contexts. Read the top-3 approaches + gotchas; bias toward high-Wilson-LB-on-recent-data answers.",
  triggers: ["how do I fix", "what worked for", "time_crystal lookup", "agent wisdom"],
  inputSchema: {
    type: "object",
    required: ["problem"],
    properties: {
      problem: { type: "string", description: "Problem description (will be canonicalized + clustered)." },
      env: { type: "object", description: "Optional env to ground ranking (node=22 pm=pnpm framework=next)." },
      topN: { type: "number", description: "Max approaches to return (default 5)." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = core.timeCrystal.lookupWisdom({
        problem: String(args["problem"] ?? ""),
        env: args["env"] as Record<string, string> | undefined,
        topN: typeof args["topN"] === "number" ? args["topN"] as number : 5,
        cwd,
      });
      return {
        data: r,
        wisdom: r.summary,
        followUp: r.approaches.length > 0 ? ["mneme.time_crystal.contribute"] : ["mneme.verify"],
        confidence: { level: r.totalContributors >= 5 ? "high" as const : r.totalContributors >= 1 ? "medium" as const : "low" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "lookup failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const timeCrystalContributeTool: MnemeTool = {
  name: "mneme.time_crystal.contribute",
  category: "meta",
  description:
    "🌌 TIME-CRYSTAL — contribute a (problem, approach, outcome) record to the wisdom ledger. Outcome: success | failure | partial. Optional env (node/pm/framework versions) enables env-grounded gotcha detection. HMAC-chained — tamper-evident.",
  whenToUse:
    "AFTER the agent verified a fix worked (or failed). Always contribute — every agent contributing makes the next agent smarter. Especially valuable for failures (the GOTCHA detector needs them).",
  triggers: ["contribute wisdom", "record solution", "time_crystal contribute"],
  inputSchema: {
    type: "object",
    required: ["problem", "approach", "outcome", "agent"],
    properties: {
      problem: { type: "string" },
      approach: { type: "string" },
      outcome: { type: "string", enum: ["success", "failure", "partial"] },
      agent: { type: "string" },
      env: { type: "object", description: "Optional env map for grounding (e.g. { node: '22', pm: 'pnpm' })." },
      note: { type: "string", description: "Optional gotcha note (free text)." },
    },
  },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const r = core.timeCrystal.contribute({
        problem: String(args["problem"] ?? ""),
        approach: String(args["approach"] ?? ""),
        outcome: args["outcome"] as import("@mneme-ai/core").timeCrystal.Outcome,
        agent: String(args["agent"] ?? "unknown"),
        env: args["env"] as Record<string, string> | undefined,
        note: typeof args["note"] === "string" ? args["note"] : undefined,
        cwd,
      });
      return {
        data: r,
        wisdom: r.hint,
        followUp: ["mneme.time_crystal.lookup"],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "contribute failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const timeCrystalStatsTool: MnemeTool = {
  name: "mneme.time_crystal.stats",
  category: "meta",
  description:
    "🌌 TIME-CRYSTAL — contributor stats summary (total contributions, distinct agents, distinct problem fingerprints, top contributing agents, top discussed problems, outcome distribution).",
  whenToUse: "Onboarding new agent (show wisdom corpus size); periodic health review of the federated wisdom store.",
  triggers: ["wisdom stats", "time_crystal stats"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async (rt) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const stats = core.timeCrystal.contributorStats(cwd);
      return {
        data: stats,
        wisdom: `${stats.totalContributions} contributions · ${stats.distinctAgents} agents · ${stats.distinctProblems} distinct problems`,
        followUp: ["mneme.time_crystal.lookup"],
        confidence: { level: "high" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "stats failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const timeCrystalAuditTool: MnemeTool = {
  name: "mneme.time_crystal.audit",
  category: "meta",
  description:
    "🌌 TIME-CRYSTAL — verify HMAC-chained wisdom ledger + last N entries. Tamper-evident audit trail.",
  whenToUse: "Compliance audit; suspected tampering; chain integrity check.",
  triggers: ["time_crystal audit", "wisdom audit"],
  inputSchema: { type: "object", properties: { limit: { type: "number" } } },
  outputSchema: { type: "object" },
  handler: async (rt, args) => {
    try {
      const core = await import("@mneme-ai/core");
      const cwd = rt.meta?.rootPath ?? process.cwd();
      const led = core.timeCrystal.verifyLedgerChain(cwd);
      const rows = core.timeCrystal.readLedger(cwd);
      const limit = typeof args["limit"] === "number" ? args["limit"] as number : 20;
      return {
        data: { ok: led.ok, totalRows: led.rows, brokenAt: led.brokenAt, recent: rows.slice(-limit) },
        wisdom: led.ok ? `chain intact (${led.rows} rows)` : `chain BROKEN at row ${led.brokenAt}`,
        followUp: [],
        confidence: { level: led.ok ? "high" as const : "medium" as const },
      };
    } catch (e) {
      return { data: { ok: false, error: (e as Error).message }, wisdom: "audit failed", followUp: [], confidence: { level: "low" as const } };
    }
  },
};

export const TIME_CRYSTAL_TOOLS: MnemeTool[] = [
  timeCrystalLookupTool,
  timeCrystalContributeTool,
  timeCrystalStatsTool,
  timeCrystalAuditTool,
];
