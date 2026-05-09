/**
 * NUCLEUS MCP tools (v1.20.0 scaffold) — Infinity Wisdom Brain.
 *
 *   • mneme.nucleus.tick   — apply one tick; returns growth delta + new lesson
 *   • mneme.nucleus.dna    — snapshot the current DNA state (for the agent to read)
 *   • mneme.nucleus.mutate — apply N mutation cycles (v1.21 will evolve karma + recipes)
 *
 * The user's vision: every conversation feeds the nucleus, the nucleus
 * never sleeps, every next conversation inherits a fitter version. The
 * AI agent that uses Mneme regularly accumulates compounding wisdom that
 * NO non-Mneme AI can match. v1.20 ships the scaffold; v1.21 will add
 * the persistent daemon + auto-tick on every MCP dispatch.
 */

import { nucleus, nucleusDaemon } from "@mneme-ai/core";
import type { MnemeTool } from "./_types.js";

export const nucleusTickTool: MnemeTool = {
  name: "mneme.nucleus.tick",
  category: "meta",
  description:
    "Apply one tick to the Infinity Wisdom Brain (the Nucleus). Aggregates " +
    "current DNA from all chromosomes + streaks, computes growth deltas " +
    "since last tick, synthesizes an optional new lesson, and persists. " +
    "Returns the updated tick counter, DNA hash, wisdom score, and any " +
    "lesson generated. Use WHEN you want to feed Mneme's nucleus a fresh " +
    "observation cycle (e.g., after every meaningful interaction with the " +
    "user, or at session start to inherit the latest evolved DNA).",
  whenToUse:
    "After an interaction worth recording, OR at session start to pick up the latest evolved DNA + read recent lessons.",
  triggers: ["nucleus tick", "feed mneme", "evolve dna"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: {
    type: "object",
    properties: {
      state: { type: "object" },
      delta: { type: "object" },
    },
  },
  examples: [
    {
      userQuery: "Tick the nucleus and tell me what evolved",
      expectedOutput: "Returns { state: { tick, dnaHash, wisdomScore, lessons }, delta: { growthSinceLastTick, wisdomScoreDelta, newLesson } }. wisdomScore is monotonically non-decreasing.",
    },
  ],
  pitfalls: [
    "Wisdom score is a heuristic — it reflects accumulated activity + verified outcomes, not absolute correctness.",
    "Calling tick repeatedly with no new chromosomes / streak changes won't grow the score (sub-linear formula).",
    "v1.20 ships the scaffold; auto-tick on every MCP dispatch lands in v1.21.",
  ],
  composeWith: ["mneme.nucleus.dna", "mneme.nucleus.mutate", "mneme.lineage.fertilize"],
  handler: async (rt) => {
    const result = nucleus.tick(rt.meta.rootPath);
    const lessonText = result.delta.newLesson ? ` 💡 NEW LESSON: ${result.delta.newLesson.text}` : "";
    return {
      data: result,
      wisdom: `${nucleus.dnaBanner(result.state)} · ${result.delta.wisdomScoreDelta >= 0 ? "+" : ""}${result.delta.wisdomScoreDelta} wisdom this tick.${lessonText}`,
      confidence: { level: "high" },
      followUp: result.delta.newLesson ? ["mneme.nucleus.dna"] : [],
    };
  },
};

export const nucleusDnaTool: MnemeTool = {
  name: "mneme.nucleus.dna",
  category: "meta",
  description:
    "Read the current DNA snapshot of the Nucleus — tick number, DNA hash, " +
    "wisdom score, growth metrics, and the last 50 synthesized lessons. " +
    "Use WHEN you want to know what Mneme has learned about THIS repo + " +
    "lineage so far, or to surface accumulated wisdom to the user.",
  whenToUse: "You want to see the nucleus's accumulated wisdom + recent lessons.",
  triggers: ["read dna", "nucleus state", "mneme wisdom"],
  inputSchema: {
    type: "object",
    properties: {
      lessonLimit: { type: "number", description: "Max lessons to return (default 10, max 50)." },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      tick: { type: "number" },
      bornAt: { type: "string" },
      dnaHash: { type: "string" },
      wisdomScore: { type: "number" },
      growth: { type: "object" },
      lessons: { type: "array" },
    },
  },
  examples: [
    {
      userQuery: "What has Mneme learned about my repo?",
      expectedOutput: "Returns the nucleus state — tick count, DNA hash, wisdom score (monotonically grows), and recent lessons.",
    },
  ],
  pitfalls: ["Returns the LAST tick's state — call mneme.nucleus.tick first if you want fresh aggregation."],
  composeWith: ["mneme.nucleus.tick", "mneme.lineage.pedigree"],
  handler: async (rt, args) => {
    const limit = Math.min(50, typeof args["lessonLimit"] === "number" ? (args["lessonLimit"] as number) : 10);
    const n = nucleus.readNucleus(rt.meta.rootPath);
    const data = {
      tick: n.tick,
      bornAt: n.bornAt,
      lastTick: n.lastTick,
      dnaHash: n.dnaHash,
      wisdomScore: n.wisdomScore,
      growth: n.growth,
      mutations: n.mutations,
      consolidations: n.consolidations,
      lessons: n.lessons.slice(-limit).reverse(),
    };
    return {
      data,
      wisdom: nucleus.dnaBanner(n),
      confidence: { level: "high" },
    };
  },
};

export const nucleusMutateTool: MnemeTool = {
  name: "mneme.nucleus.mutate",
  category: "meta",
  description:
    "Apply N REAL mutation cycles (v1.21) — each cycle takes the most-recent " +
    "chromosome, applies ±5% karma noise + drops one atom from the lowest-karma " +
    "molecule, persists as a NEW chromosome with parent = original. Selection " +
    "pressure is implicit: fertilize picks ancestors by recency × karma, so " +
    "fitter mutations win inheritance over time. Use WHEN you want to push the " +
    "nucleus toward exploration vs exploitation.",
  whenToUse: "You want to evolve the lineage by introducing structured noise + selection pressure.",
  triggers: ["mutate nucleus", "evolve dna"],
  inputSchema: {
    type: "object",
    properties: {
      cycles: { type: "number", description: "Number of mutation cycles. Default 1, max 100." },
    },
  },
  outputSchema: {
    type: "object",
    properties: {
      mutations: { type: "number" },
      tick: { type: "number" },
      dnaHash: { type: "string" },
      mutatedChromosomeIds: { type: "array", items: { type: "string" } },
    },
  },
  examples: [{ userQuery: "Mutate the nucleus once" }],
  pitfalls: [
    "v1.21 ships REAL evolution. Each mutation creates a new chromosome on disk — don't run hundreds in a tight loop.",
    "Returns null mutatedChromosomeIds when lineage is empty (nothing to mutate from).",
  ],
  composeWith: ["mneme.nucleus.tick", "mneme.nucleus.dna"],
  handler: async (rt, args) => {
    const cycles = Math.max(1, Math.min(100, typeof args["cycles"] === "number" ? (args["cycles"] as number) : 1));
    const mutatedIds: string[] = [];
    for (let i = 0; i < cycles; i++) {
      const id = await nucleus.evolveOnce(rt.meta.rootPath);
      if (id) mutatedIds.push(id);
    }
    const n = nucleus.mutate(rt.meta.rootPath, cycles);
    return {
      data: { mutations: n.mutations, tick: n.tick, dnaHash: n.dnaHash, mutatedChromosomeIds: mutatedIds },
      wisdom: `Applied ${cycles} mutation cycle${cycles === 1 ? "" : "s"} — ${mutatedIds.length} new mutated chromosome${mutatedIds.length === 1 ? "" : "s"} born · DNA ${n.dnaHash}. Selection pressure will pick fitter ones over time.`,
      confidence: { level: "high" },
    };
  },
};

// ─── nucleus.heartbeat — daemon liveness check ───────────────────────
export const nucleusHeartbeatTool: MnemeTool = {
  name: "mneme.nucleus.heartbeat",
  category: "meta",
  description:
    "Check if the persistent nucleus daemon is alive (runs in background " +
    "via `mneme nucleus daemon start`). Returns pid + uptime + tick count + " +
    "last DNA banner + healthy flag. Use WHEN you want to verify the infinity " +
    "loop is actually running outside of MCP sessions.",
  whenToUse: "You want to verify the nucleus daemon is alive between MCP sessions.",
  triggers: ["nucleus heartbeat", "daemon status"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: {
    type: "object",
    properties: {
      running: { type: "boolean" },
      pid: { type: ["number", "null"] },
      heartbeat: { type: ["object", "null"] },
      lastTickSecondsAgo: { type: ["number", "null"] },
      healthy: { type: "boolean" },
    },
  },
  examples: [{ userQuery: "Is the nucleus daemon alive?" }],
  pitfalls: [
    "Returns running=false + healthy=false when no daemon was ever started (run `mneme nucleus daemon start` from a terminal).",
  ],
  composeWith: ["mneme.nucleus.tick", "mneme.nucleus.dna"],
  handler: async (rt) => {
    const status = nucleusDaemon.daemonStatus(rt.meta.rootPath);
    // v1.23.5 — when the daemon is dead, embed an autoAction telling the
    // AI agent to surface the missing daemon to the user (just announce,
    // no auto-spawn -- the daemon must run from the user's terminal so
    // it survives the MCP server restart). requiresUserConfirm=true here
    // because spawning a long-running process from MCP is the wrong scope.
    const autoActions = !status.running
      ? [{
          id: "daemon-dead-prompt-restart",
          tool: "mneme.inbox.push" as const,
          args: {
            title: "Nucleus daemon is not running",
            body: "Restart it from a terminal: `mneme nucleus daemon --detach` -- the infinity wisdom loop only ticks while a daemon process is alive.",
            priority: "high",
            source: "heartbeat-check",
            cta: "run: mneme nucleus daemon --detach",
          },
          announceBefore: "Nucleus daemon is offline -- queuing a reminder in the inbox.",
          announceAfter: "Reminder queued. To start the daemon: run `mneme nucleus daemon --detach` from your terminal.",
        }]
      : undefined;
    return {
      data: status,
      wisdom: status.running
        ? `✓ Nucleus daemon alive (pid ${status.pid}) · ${status.heartbeat?.tickCount ?? 0} ticks · ${status.heartbeat?.mutationsApplied ?? 0} mutations applied · last tick ${status.lastTickSecondsAgo ?? "?"}s ago`
        : `✗ No nucleus daemon running. Start with \`mneme nucleus daemon --detach\` to keep the infinity loop alive between MCP sessions.`,
      confidence: { level: "high" },
      secondBrain: { autoActions },
    };
  },
};

// ─── nucleus.export — anonymized export for v1.22 leaderboard ───────
export const nucleusExportTool: MnemeTool = {
  name: "mneme.nucleus.export",
  category: "meta",
  description:
    "Export an anonymized snapshot of the nucleus DNA — wisdom score, growth " +
    "metrics, per-vendor stats (vendor name + verified rate, no PII), recent " +
    "lessons, mutation count. Designed for v1.22 public AI-vendor trust " +
    "leaderboard at lineage.mneme.dev. Use WHEN you want to share your " +
    "nucleus state externally without leaking repo content.",
  whenToUse: "You want to export anonymized DNA for a public benchmark or share.",
  triggers: ["export dna", "nucleus snapshot"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: {
    type: "object",
    properties: {
      dnaHash: { type: "string" },
      wisdomScore: { type: "number" },
      tick: { type: "number" },
      growth: { type: "object" },
      vendors: { type: "array", items: { type: "object" } },
      lessons: { type: "array", items: { type: "object" } },
      mutations: { type: "number" },
    },
  },
  examples: [{ userQuery: "Export my nucleus DNA" }],
  pitfalls: [
    "Output is suitable for sharing — vendor names + counts + scores only, no commit hashes / file paths / emails.",
    "v1.22 will provide a one-line publish command; for now, take the JSON yourself.",
  ],
  composeWith: ["mneme.nucleus.dna", "mneme.lineage.pedigree"],
  handler: async (rt) => {
    // Lazy-import lineage to avoid load on every MCP boot.
    const { lineage } = await import("@mneme-ai/core");
    const n = nucleus.readNucleus(rt.meta.rootPath);
    const ped = lineage.buildPedigree(rt.meta.rootPath);
    const data = {
      dnaHash: n.dnaHash,
      wisdomScore: n.wisdomScore,
      tick: n.tick,
      growth: n.growth,
      vendors: ped.vendors.map((v) => ({
        vendor: v.vendor,
        chromosomeCount: v.chromosomeCount,
        totalKarma: v.totalKarma,
        verifiedRate: v.verifiedRate,
      })),
      lessons: n.lessons.slice(-10).map((l) => ({ tick: l.tick, text: l.text })),
      mutations: n.mutations,
      exportedAt: new Date().toISOString(),
    };
    return {
      data,
      wisdom: `Exported anonymized nucleus snapshot — wisdom ${n.wisdomScore} · tick ${n.tick} · ${ped.vendors.length} vendor${ped.vendors.length === 1 ? "" : "s"}.`,
      confidence: { level: "high" },
    };
  },
};

export const nucleusTools: MnemeTool[] = [
  nucleusTickTool,
  nucleusDnaTool,
  nucleusMutateTool,
  nucleusHeartbeatTool,
  nucleusExportTool,
];
