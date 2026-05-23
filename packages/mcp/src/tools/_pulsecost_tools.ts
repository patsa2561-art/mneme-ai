/**
 * v2.33.0 — MCP wrappers for PULSECOST (MCP context-budget extension v0.1).
 *
 * 3 tools:
 *   mneme.pulsecost.spec    — emit the spec markdown for ratification
 *   mneme.pulsecost.budget  — trim a payload to fit a token budget + emit headers
 *   mneme.pulsecost.estimate — token-count an arbitrary string
 */

import type { MnemeTool } from "./_types.js";

export const pulsecostSpecTool: MnemeTool = {
  name: "mneme.pulsecost.spec",
  category: "meta",
  description: "PULSECOST — return the proposed MCP context-budget extension spec v0.1 (markdown). Ship this in the protocol ratification PR.",
  whenToUse: "Proposing the X-Context-Available-Tokens extension; documentation.",
  triggers: ["pulsecost spec", "context budget spec"],
  inputSchema: { type: "object", properties: {} },
  outputSchema: { type: "object" },
  handler: async () => {
    const core = await import("@mneme-ai/core");
    return {
      data: { spec: core.pulsecost.SPEC },
      wisdom: `MCP PulseCost extension v${core.pulsecost.SPEC.version} ready for ratification.`,
      followUp: ["mneme.pulsecost.budget"],
      confidence: { level: "high" as const },
    };
  },
};

export const pulsecostBudgetTool: MnemeTool = {
  name: "mneme.pulsecost.budget",
  category: "meta",
  description: "PULSECOST — reference implementation. Trim a text payload to fit availableTokens + return the 3 response headers (X-Context-Used-Tokens / X-Context-Trimmed).",
  whenToUse: "Any MCP server that wants to honour the X-Context-Available-Tokens request header.",
  triggers: ["pulsecost budget", "context budget"],
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
      availableTokens: { type: "integer", description: "Default 8192." },
      wordsPerToken: { type: "number", description: "Default 0.75." },
    },
    required: ["text"],
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const text = String(args["text"] ?? "");
    const budget = {
      availableTokens: typeof args["availableTokens"] === "number" ? (args["availableTokens"] as number) : 8192,
      defaultBudget: typeof args["availableTokens"] === "number" ? (args["availableTokens"] as number) : 8192,
      wordsPerToken: typeof args["wordsPerToken"] === "number" ? (args["wordsPerToken"] as number) : 0.75,
    };
    const r = core.pulsecost.trimToBudget(text, budget);
    return {
      data: r,
      wisdom: r.trimmed
        ? `Trimmed: ${r.originalTokens} → ${r.usedTokens} tokens (budget ${budget.availableTokens}).`
        : `Within budget: ${r.usedTokens} tokens used of ${budget.availableTokens}.`,
      followUp: [],
      confidence: { level: "high" as const },
    };
  },
};

export const pulsecostEstimateTool: MnemeTool = {
  name: "mneme.pulsecost.estimate",
  category: "meta",
  description: "PULSECOST — token-count an arbitrary string (default ratio 0.75 words-per-token).",
  whenToUse: "Quick budget check; capability sizing.",
  triggers: ["pulsecost estimate", "estimate tokens"],
  inputSchema: {
    type: "object",
    properties: {
      text: { type: "string" },
      wordsPerToken: { type: "number" },
    },
    required: ["text"],
  },
  outputSchema: { type: "object" },
  handler: async (_rt, args) => {
    const core = await import("@mneme-ai/core");
    const text = String(args["text"] ?? "");
    const wpt = typeof args["wordsPerToken"] === "number" ? (args["wordsPerToken"] as number) : 0.75;
    const n = core.pulsecost.estimateTokens(text, wpt);
    return {
      data: { tokens: n, chars: text.length, wordsPerToken: wpt },
      wisdom: `${n} tokens (~${text.length} chars).`,
      followUp: [],
      confidence: { level: "high" as const },
    };
  },
};

export const PULSECOST_TOOLS: MnemeTool[] = [
  pulsecostSpecTool,
  pulsecostBudgetTool,
  pulsecostEstimateTool,
];
