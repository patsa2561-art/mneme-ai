/**
 * v1.78.0 -- MCP wrappers for LATTICE PROTOCOL.
 */

import type { MnemeTool } from "./_types.js";

export const latticeRouteTool: MnemeTool = {
  name: "mneme.lattice.route",
  category: "meta",
  description:
    "LATTICE -- route a user prompt to the correct Mneme tool via hardcoded intent atoms. Use this BEFORE blending with conversational context whenever the user mentions Mneme / soul prompt / upgrade / etc.",
  whenToUse:
    "Mandatory first step for any prompt that contains a Mneme keyword. Stops the 'update mneme ดีไหม' → 'let me optimize your One Piece shipping' disaster.",
  triggers: ["route intent", "what tool for this", "lattice match"],
  inputSchema: {
    type: "object",
    properties: { userPrompt: { type: "string" } },
    required: ["userPrompt"],
  },
  outputSchema: { type: "object" },
  examples: [
    {
      userQuery: "What tool should I call for 'update mneme ดีไหม'?",
      args: { userPrompt: "update mneme ดีไหม" },
      expectedOutput: "{ atom.tool: 'mneme.system.upgrade', absolute: true, ... }",
    },
  ],
  pitfalls: ["null result means free-form interpretation is OK. Otherwise honor the absolute routing."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const m = core.lattice.routeIntent(String(args["userPrompt"] ?? ""));
    return {
      data: { match: m },
      wisdom: m
        ? `Route to ${m.atom.tool} (${m.atom.priority}) -- matched "${m.matchedTrigger}".`
        : "no intent atom matched -- free-form interpretation allowed.",
      confidence: { level: m?.absolute ? "high" : m ? "medium" : "low" },
    };
  },
};

export const latticeScoreTool: MnemeTool = {
  name: "mneme.lattice.score",
  category: "meta",
  description:
    "LATTICE -- compute a 5-axis grounding score (0-100) for an AI's reply: intent_match + context_purity + pulse_compliance + codename_silence + response_clarity. Use to measure cross-vendor reply quality.",
  whenToUse:
    "After receiving an AI reply, especially across the vendor boundary. Compute the score; if < 70, re-prompt or re-route.",
  triggers: ["grounding score", "rate reply quality", "วัดคุณภาพคำตอบ"],
  inputSchema: {
    type: "object",
    properties: {
      userPrompt: { type: "string" },
      aiReply: { type: "string" },
      pulseText: { type: "string", description: "Optional pulse text to extract contracts from." },
      priorContext: { type: "string" },
    },
    required: ["userPrompt", "aiReply"],
  },
  outputSchema: { type: "object" },
  examples: [
    {
      userQuery: "Score this Gemini reply",
      args: { userPrompt: "update mneme", aiReply: "Done.", pulseText: "(say: 'update mneme' and I'll handle it.)" },
      expectedOutput: "{ total: 85, axes: {...} }",
    },
  ],
  pitfalls: ["Score is heuristic, not absolute truth. Use as a relative quality dial."],
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const pulseText = args["pulseText"] as string | undefined;
    const contracts = pulseText ? core.lattice.parsePulseContracts(pulseText) : [];
    const score = core.lattice.scoreGrounding({
      userPrompt: String(args["userPrompt"] ?? ""),
      aiReply: String(args["aiReply"] ?? ""),
      pulseContracts: contracts,
      priorContext: args["priorContext"] as string | undefined,
    });
    return {
      data: score,
      wisdom: score.summary,
      confidence: { level: score.total >= 80 ? "high" : score.total >= 60 ? "medium" : "low" },
    };
  },
};

export const latticeDictionaryTool: MnemeTool = {
  name: "mneme.lattice.dictionary",
  category: "meta",
  description:
    "LATTICE -- render the Mneme keyword dictionary (definitions + isNot lists). Embed in custom prompts so receiving AIs know what 'Mneme' literally IS (the npm package, NOT a generic protocol).",
  whenToUse: "Build a custom prompt that needs the same grounding receiving AIs get from soul prompts.",
  triggers: ["dictionary", "what does mneme mean", "Mneme คือ"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  examples: [{ userQuery: "Give me the Mneme dictionary", args: {}, expectedOutput: "Markdown dictionary block." }],
  pitfalls: ["Static catalog; updates ship with each Mneme release."],
  handler: async () => {
    const core = await import("@mneme-ai/core");
    const md = core.lattice.renderDictionary();
    return {
      data: { dictionary: md },
      wisdom: `Dictionary (${core.lattice.MNEME_DICTIONARY.length} entries).`,
      confidence: { level: "high" },
      secondBrain: { presentation: md },
    };
  },
};

export const LATTICE_TOOLS: MnemeTool[] = [latticeRouteTool, latticeScoreTool, latticeDictionaryTool];
