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

import { nucleus } from "@mneme-ai/core";
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
    "Apply N mutation cycles to the Nucleus. v1.20 scaffold: increments " +
    "mutation counter for tracking. v1.21 will mutate molecule recipes + " +
    "karma deltas with structured noise to drive evolution under selection " +
    "pressure (verified outcomes promoted, hallucinations suppressed). Use " +
    "WHEN you want to nudge the nucleus toward exploration vs exploitation.",
  whenToUse: "You want to track mutation cycles applied to the nucleus (v1.20 scaffold).",
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
    },
  },
  examples: [{ userQuery: "Mutate the nucleus once" }],
  pitfalls: ["v1.20 scaffold: counts mutations but doesn't yet evolve molecule recipes (v1.21)."],
  composeWith: ["mneme.nucleus.tick", "mneme.nucleus.dna"],
  handler: async (rt, args) => {
    const cycles = Math.max(1, Math.min(100, typeof args["cycles"] === "number" ? (args["cycles"] as number) : 1));
    const n = nucleus.mutate(rt.meta.rootPath, cycles);
    return {
      data: { mutations: n.mutations, tick: n.tick, dnaHash: n.dnaHash },
      wisdom: `Applied ${cycles} mutation cycle${cycles === 1 ? "" : "s"} — nucleus now at ${n.mutations} total mutations · DNA ${n.dnaHash}.`,
      confidence: { level: "high" },
    };
  },
};

export const nucleusTools: MnemeTool[] = [nucleusTickTool, nucleusDnaTool, nucleusMutateTool];
