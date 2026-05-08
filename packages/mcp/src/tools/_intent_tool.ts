/**
 * mneme.understand_intent — exposed as an MCP tool.
 *
 * Any AI client (Claude, GPT, Gemini, Codex, others) calls this with the
 * raw user query string. Mneme returns top-3 specific tools + suggested
 * args + execution plan.
 *
 * This drops the cognitive load on the AI from "pick from 94 tools" to
 * "follow this plan". Critical for less-capable AI tools or when the
 * user's intent is ambiguous.
 */

import { understandIntent } from "./_intent.js";
import { buildAllTools } from "./_registry.js";
import type { MnemeTool } from "./_types.js";

export const understandIntentTool: MnemeTool = {
  name: "mneme.understand_intent",
  category: "meta",
  description:
    "Translate a natural-language user query into a step-by-step plan over Mneme's 94+ tools. " +
    "Returns top-3 best-matching tools with confidence scores, suggested arguments extracted from the query, " +
    "and a concrete execution plan. The MOST POWERFUL tool when you (the AI client) are not sure which tool " +
    "fits. Always cheap (<50ms, no LLM, no embedder). Call this BEFORE picking individual tools when the user " +
    "request is ambiguous or you don't recognize the intent immediately.",
  triggers: [
    "I'm not sure which mneme tool to use",
    "translate this user query into mneme calls",
    "what mneme tool fits this question",
    "plan a mneme workflow for this intent",
  ],
  inputSchema: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description: "The user's natural-language request, exactly as they phrased it",
      },
    },
    required: ["query"],
  },
  handler: async (_rt, args) => {
    const query = String(args["query"] ?? "");
    if (!query.trim()) {
      return {
        data: { error: "empty-query" },
        wisdom: "understand_intent requires a non-empty query string.",
        confidence: { level: "low" },
      };
    }
    const result = understandIntent(query, buildAllTools());
    return {
      data: result,
      wisdom:
        result.matches.length === 0
          ? `No Mneme tool matched "${query}". Ask the user to clarify which area their question is about (memory / people / audit / forensics / insights / quality / quant / lab).`
          : `Top match: ${result.matches[0]!.toolName} (${(result.topConfidence * 100).toFixed(0)}% confidence). ${result.reasoning}`,
      followUp: result.matches.slice(0, 3).map((m) => m.toolName),
      confidence: { level: result.topConfidence > 0.6 ? "high" : result.topConfidence > 0.3 ? "medium" : "low" },
      secondBrain: {
        presentation:
          "Follow the plan in data.plan exactly. Use data.matches[0].suggestedArgs as the starting argument set. " +
          "If topConfidence < 0.4, ask the user to clarify before invoking any specific tool.",
      },
    };
  },
};
