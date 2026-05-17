/**
 * v2.19.28 AUTONOMIC SCHEDULER (5 MCP tools) — wakes up LIMBIC + DREAMSPACE 24/7
 */

import type { MnemeTool } from "./_types.js";

export const schedulerDecideTool: MnemeTool = {
  name: "mneme.scheduler.decide",
  category: "audit",
  description: "🩺 SCHEDULER (v2.19.28 ROOT-CAUSE FIX) — pure decision: which LIMBIC + DREAMSPACE organs should tick right now? Priority ladder: circuit_open > event_triggered > interval_due/idle_threshold > skip.",
  whenToUse: "Daemon heartbeat (typically every 30-60s) calls this then invokes each shouldTick organ.",
  triggers: ["scheduler decide", "tick plan"],
  inputSchema: {
    type: "object",
    properties: {
      schedules: { type: "array", items: { type: "object" } },
      health: { type: "array", items: { type: "object" } },
      events: { type: "object" },
      nowMs: { type: "number" },
    },
    required: ["health", "events", "nowMs"],
  },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Plan the next tick cycle", args: { health: [], events: {}, nowMs: 1_000_000 }, expectedOutput: "{ entries: TickPlanEntry[], sig }" }],
  pitfalls: ["Pure function; doesn't invoke anything. Use mneme.scheduler.run for end-to-end."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const p = core.autonomicScheduler.decideTicks({
      schedules: args["schedules"] as Parameters<typeof core.autonomicScheduler.decideTicks>[0]["schedules"],
      health: args["health"] as Parameters<typeof core.autonomicScheduler.decideTicks>[0]["health"],
      events: args["events"] as Parameters<typeof core.autonomicScheduler.decideTicks>[0]["events"],
      nowMs: Number(args["nowMs"]),
    });
    return { data: p, wisdom: core.autonomicScheduler.formatPlanLine(p), confidence: { level: "high" } };
  },
};

export const schedulerStatsTool: MnemeTool = {
  name: "mneme.scheduler.stats",
  category: "audit",
  description: "🩺 SCHEDULER — totals + successRate + healthy/cooldown counts across all tracked organs.",
  whenToUse: "Periodic health check; pulse digest.",
  triggers: ["scheduler stats"],
  inputSchema: { type: "object", properties: { health: { type: "array", items: { type: "object" } }, nowMs: { type: "number" } }, required: ["health", "nowMs"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Scheduler health overview", args: { health: [], nowMs: 1000 }, expectedOutput: "{ totalOrgans, successRate, organsHealthy }" }],
  pitfalls: ["successRate is 1.0 when zero ticks have run (vacuously perfect)."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const s = core.autonomicScheduler.computeStats(args["health"] as Parameters<typeof core.autonomicScheduler.computeStats>[0], Number(args["nowMs"]));
    return { data: s, wisdom: core.autonomicScheduler.formatStatsLine(s), confidence: { level: "high" } };
  },
};

export const schedulerFreshHealthTool: MnemeTool = {
  name: "mneme.scheduler.fresh_health",
  category: "audit",
  description: "🩺 SCHEDULER — produce a fresh OrganHealthRecord (all counters at 0). Use to seed a new daemon's health array.",
  whenToUse: "First-run init; or daily reset.",
  triggers: ["scheduler fresh health"],
  inputSchema: { type: "object", properties: { organ: { type: "string", enum: ["breath", "reflex", "sleep", "dreamspace", "hormonal"] } }, required: ["organ"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Fresh breath record", args: { organ: "breath" }, expectedOutput: "{ organ, lastTickMs: 0, totalTicks: 0, ... }" }],
  pitfalls: [],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const h = core.autonomicScheduler.freshHealthRecord(args["organ"] as Parameters<typeof core.autonomicScheduler.freshHealthRecord>[0]);
    return { data: h, wisdom: `🩺 fresh ${h.organ}`, confidence: { level: "high" } };
  },
};

export const schedulerVerifyPlanTool: MnemeTool = {
  name: "mneme.scheduler.verify_plan",
  category: "audit",
  description: "🩺 SCHEDULER — HMAC-verify a TickPlan; rejects forged plans before daemon trusts the tick decisions.",
  whenToUse: "Before consuming a plan from another instance (federation).",
  triggers: ["scheduler verify plan"],
  inputSchema: { type: "object", properties: { plan: { type: "object" } }, required: ["plan"] },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Verify this scheduler plan", args: { plan: {} }, expectedOutput: "{ ok: true|false }" }],
  pitfalls: ["Verification fails on any byte tamper; do NOT trust unverified plans."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const ok = core.autonomicScheduler.verifyTickPlan(args["plan"] as Parameters<typeof core.autonomicScheduler.verifyTickPlan>[0]);
    return { data: { ok }, wisdom: ok ? "🩺 verified" : "💀 tampered", confidence: { level: "high" } };
  },
};

export const schedulerDefaultSchedulesTool: MnemeTool = {
  name: "mneme.scheduler.default_schedules",
  category: "audit",
  description: "🩺 SCHEDULER — list the 5 DEFAULT_SCHEDULES (breath/reflex/sleep/dreamspace/hormonal) with intervals + event triggers + idle requirements.",
  whenToUse: "AI introspection: 'what does the daemon do automatically?'",
  triggers: ["scheduler default schedules"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Show default schedules", expectedOutput: "{ schedules: OrganSchedule[] }" }],
  pitfalls: [],
  handler: async (_rt, _args) => {
    const core = await import("@mneme-ai/core");
    return { data: { schedules: [...core.autonomicScheduler.DEFAULT_SCHEDULES], count: core.autonomicScheduler.DEFAULT_SCHEDULES.length }, wisdom: `🩺 ${core.autonomicScheduler.DEFAULT_SCHEDULES.length} default schedules`, confidence: { level: "high" } };
  },
};

export const V1928_SCHEDULER_TOOLS: MnemeTool[] = [
  schedulerDecideTool, schedulerStatsTool, schedulerFreshHealthTool, schedulerVerifyPlanTool, schedulerDefaultSchedulesTool,
];
