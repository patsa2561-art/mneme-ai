/**
 * v1.79.0 -- MCP wrappers for NEURON PROTOCOL.
 */

import type { MnemeTool } from "./_types.js";

/** Build the lazy tool catalog the NEURON modules need.
 *  Lives behind a function so we don't trigger circular imports at load. */
async function getToolCatalog(): Promise<Array<{ name: string; triggers?: readonly string[]; description?: string; whenToUse?: string }>> {
  const { buildAllTools } = await import("./_registry.js");
  return buildAllTools().map((t) => ({
    name: t.name,
    triggers: t.triggers,
    description: t.description,
    whenToUse: t.whenToUse,
  }));
}

export const neuronTriageTool: MnemeTool = {
  name: "mneme.neuron.triage",
  category: "meta",
  description:
    "NEURON triage -- 4-strategy router (exact lattice / auto-derived / fuzzy trigram / keyword) across ALL 100+ Mneme tools. Returns ranked candidates with confidence + a confusion flag.",
  whenToUse:
    "Whenever the user's prompt MIGHT correspond to a Mneme tool but you're not sure which one. Run this FIRST -- if confusion=true, ask user; otherwise route.",
  triggers: ["which tool for this", "route prompt", "triage intent"],
  inputSchema: {
    type: "object",
    properties: { userPrompt: { type: "string" } },
    required: ["userPrompt"],
  },
  outputSchema: { type: "object" },
  examples: [
    {
      userQuery: "Where should 'upgrde mneme' (with a typo) route?",
      args: { userPrompt: "upgrde mneme" },
      expectedOutput: "{ recommended: { tool: 'mneme.system.upgrade', confidence: ~0.85 } }",
    },
  ],
  pitfalls: [
    "Confusion=true means surface 2-3 options to the user; do NOT auto-execute a low-confidence pick.",
    "Triage operates over the full live tool catalog -- no manual registration per tool needed.",
  ],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const catalog = await getToolCatalog();
    const report = core.neuron.telepathicTriage(String(args["userPrompt"] ?? ""), catalog);
    return {
      data: report,
      wisdom: report.summary,
      confidence: { level: report.recommended && !report.confusion ? "high" : "medium" },
    };
  },
};

export const neuronOracleTool: MnemeTool = {
  name: "mneme.neuron.oracle",
  category: "meta",
  description:
    "NEURON ORACLE -- predict the NEXT Mneme tool the user is about to invoke, before they finish typing. Combines prefix fuzzy match + recency bias from recent tool calls.",
  whenToUse:
    "Autocompletion-style hint surfacing. Useful when watching the user type a long prompt and you want a primed tool candidate before they hit enter.",
  triggers: ["predict next tool", "oracle prefix", "autocomplete intent"],
  inputSchema: {
    type: "object",
    properties: {
      promptPrefix: { type: "string" },
      recentCalls: {
        type: "array",
        items: {
          type: "object",
          properties: { tool: { type: "string" }, ts: { type: "string" } },
        },
      },
      topK: { type: "integer" },
    },
    required: ["promptPrefix"],
  },
  outputSchema: { type: "object" },
  examples: [
    {
      userQuery: "Predict from prefix 'updat'",
      args: { promptPrefix: "updat" },
      expectedOutput: "{ best: { tool: 'mneme.system.upgrade', probability: ~0.7 } }",
    },
  ],
  pitfalls: ["Don't auto-execute predictions; surface them as hints unless probability > 0.9 AND user explicitly invited auto-pilot."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const catalog = await getToolCatalog();
    const r = core.neuron.oraclePredict({
      promptPrefix: String(args["promptPrefix"] ?? ""),
      recentCalls: (args["recentCalls"] as { tool: string; ts: string }[] | undefined) ?? [],
      toolCatalog: catalog,
      topK: args["topK"] as number | undefined,
    });
    return {
      data: r,
      wisdom: r.summary,
      confidence: { level: r.best && r.best.probability > 0.7 ? "high" : "medium" },
    };
  },
};

export const NEURON_TOOLS: MnemeTool[] = [neuronTriageTool, neuronOracleTool];
