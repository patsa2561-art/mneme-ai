/**
 * Lab — the Periodic Table + Second Brain + Wisdom Mutant engine.
 * Compose, library, run, calibrate, adapt, feedback.
 */

import { passthroughHandler } from "./_runtime.js";
import type { MnemeTool } from "./_types.js";

const lab = (
  name: string,
  description: string,
  triggers: string[],
  cli: string,
  argMap: (a: Record<string, unknown>) => string[] = () => [],
  inputSchema: MnemeTool["inputSchema"] = { type: "object", properties: {} },
  followUp: string[] = [],
  wisdom: (d: unknown) => string = () => "Result returned — summarize key fields for the user.",
): MnemeTool => ({
  name,
  category: "lab",
  description,
  triggers,
  inputSchema,
  handler: passthroughHandler(cli, argMap, { wisdom, followUp, confidence: "medium" }),
});

export const labTools: MnemeTool[] = [
  lab(
    "mneme.lab.periodic_table",
    "Browse Mneme's compositional layers — elements (primitives), atoms (parameterized), molecules (commands), compounds. Use WHEN user asks: 'what primitives does Mneme have?', 'show the periodic table', 'compose new tools'.",
    ["show periodic table", "what primitives are available"],
    "periodic-table",
    (a) => {
      const out: string[] = [];
      if (a["id"]) out.push(String(a["id"]));
      if (a["kind"]) out.push("--kind", String(a["kind"]));
      if (a["tag"]) out.push("--tag", String(a["tag"]));
      return out;
    },
    {
      type: "object",
      properties: {
        id: { type: "string", description: "Optional primitive id to focus" },
        kind: { type: "string", description: "element | atom | molecule | compound" },
        tag: { type: "string" },
      },
    },
  ),
  lab(
    "mneme.lab.compose",
    "Translate natural-language intent into a runnable molecule plan from the periodic table. Use WHEN user asks: 'compose a workflow for X', 'plan steps to do Y'.",
    ["compose a workflow", "plan steps for goal"],
    "compose",
    (a) => {
      const out = [String(a["intent"] ?? "")];
      if (a["execute"]) out.push("--execute");
      return out;
    },
    {
      type: "object",
      properties: {
        intent: { type: "string", description: "Natural-language goal" },
        execute: { type: "boolean", description: "Run the plan after composing" },
      },
      required: ["intent"],
    },
    ["mneme.lab.run", "mneme.lab.library"],
  ),
  lab(
    "mneme.lab.run",
    "Run a saved molecule plan by alias or id. Use WHEN user asks: 'run X recipe', 'execute saved plan'.",
    ["run saved recipe", "execute molecule plan"],
    "run",
    (a) => {
      const out = [String(a["needle"] ?? "")];
      if (a["execute"]) out.push("--execute");
      return out;
    },
    {
      type: "object",
      properties: {
        needle: { type: "string", description: "Alias or id of the recipe" },
        execute: { type: "boolean", description: "Actually run (default dry-run)" },
      },
      required: ["needle"],
    },
  ),
  lab(
    "mneme.lab.library",
    "List/manage saved molecule recipes. Use WHEN user asks: 'show saved recipes', 'promote a recipe', 'forget recipe'.",
    ["show saved recipes", "library of plans"],
    "library",
    (a) => {
      const out: string[] = [];
      if (a["promote"]) out.push("--promote", String(a["promote"]));
      if (a["alias"]) out.push("--alias", String(a["alias"]));
      if (a["eligible"]) out.push("--eligible");
      if (a["archived"]) out.push("--archived");
      if (a["forget"]) out.push("--forget", String(a["forget"]));
      return out;
    },
    {
      type: "object",
      properties: {
        promote: { type: "string" },
        alias: { type: "string" },
        eligible: { type: "boolean" },
        archived: { type: "boolean" },
        forget: { type: "string" },
      },
    },
  ),
  lab(
    "mneme.lab.adapt",
    "Mneme inspects this repo and recommends 1-3 next commands. Use WHEN user asks: 'what should I run next?', 'recommend commands for me'.",
    ["what should I run next", "recommend commands"],
    "adapt",
  ),
  lab(
    "mneme.lab.feedback",
    "Tell Mneme an answer was helpful (up) or wrong (down) — feeds the Wisdom Mutant calibrator. Use WHEN user gives feedback on a previous answer.",
    ["this answer was good/bad", "feedback on previous result"],
    "feedback",
    (a) => [String(a["id"] ?? ""), String(a["vote"] ?? "")],
    {
      type: "object",
      properties: {
        id: { type: "string", description: "Answer id from a previous call" },
        vote: { type: "string", description: "up | down" },
      },
      required: ["id", "vote"],
    },
  ),
  lab(
    "mneme.lab.calibrate",
    "Re-tune search knobs against accumulated feedback. Use WHEN user asks: 'recalibrate Mneme', 're-tune search'.",
    ["recalibrate Mneme", "retune"],
    "calibrate",
  ),
  lab(
    "mneme.lab.htc_stats",
    "Coverage + compression ratio of HTC (hierarchical compressed memory) — how much of the repo is summarised. Use WHEN user asks: 'HTC coverage', 'compression stats'.",
    ["HTC coverage", "compression stats"],
    "htc-stats",
  ),
];
