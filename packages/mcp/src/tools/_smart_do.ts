/**
 * mneme.smart_do — the FALLBACK DISPATCHER.
 *
 * Wraps the existing `mneme do "<intent>"` smart-dispatcher. When the AI
 * student can't match the user's request to a specific tool in the catalog,
 * it can fall back here: hand the natural-language intent to Mneme, and
 * Mneme's smart-dispatcher routes it to the appropriate command.
 *
 * Net effect: even niche or unmodelled use cases reach the right command,
 * so the user never feels "AI couldn't help me with that."
 */

import { runCliJson } from "./_runtime.js";
import type { MnemeTool } from "./_types.js";

export const smartDoTool: MnemeTool = {
  name: "mneme.smart_do",
  category: "meta",
  description:
    "Fallback dispatcher — give it a NATURAL-LANGUAGE intent, it routes to the appropriate Mneme command and runs it. " +
    "Use this WHEN no specific tool from `mneme.capabilities` matches the user's request, or when the user's intent " +
    "spans multiple commands. Equivalent to running `mneme do '<intent>'` from the CLI. Prefer specific tools when " +
    "possible — this dispatcher is slower because it runs an additional planning step.",
  triggers: [
    "do something I haven't named explicitly",
    "I want X but I don't know which tool",
  ],
  inputSchema: {
    type: "object",
    properties: {
      intent: { type: "string", description: "Natural-language description of what the user wants" },
    },
    required: ["intent"],
  },
  handler: async (rt, args) => {
    const intent = String(args["intent"] ?? "");
    if (!intent) {
      return {
        data: {},
        wisdom: "smart_do requires an `intent` string.",
        confidence: { level: "low" },
      };
    }
    const data = await runCliJson(rt.meta.rootPath, "do", [intent]);
    return {
      data,
      wisdom:
        "smart_do routed the intent to Mneme's smart-dispatcher. The data shows which command was chosen + its result.",
      followUp: [],
      confidence: { level: "medium" },
    };
  },
};
