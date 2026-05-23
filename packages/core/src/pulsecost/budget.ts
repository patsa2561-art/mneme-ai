/**
 * v2.33.0 — PULSECOST enforcement primitive.
 *
 * Given a response text + an `X-Context-Available-Tokens` budget,
 * trim the text to fit + emit the three response headers. Token
 * estimation is words-per-token (0.75 default). Conservative trim
 * keeps full sentences; falls back to char-truncation if a single
 * sentence already exceeds the budget.
 */

import type { PulseCostBudget, PulseCostResult, PulseCostSpec } from "./types.js";

const SPEC_VERSION = "0.1" as const;

export const SPEC: PulseCostSpec = {
  version: SPEC_VERSION,
  headers: {
    requestAvailable: "X-Context-Available-Tokens",
    responseUsed: "X-Context-Used-Tokens",
    responseTrimmed: "X-Context-Trimmed",
  },
  body: [
    "# Mneme PulseCost / MCP Context-Budget Extension v" + SPEC_VERSION,
    "",
    "## Problem",
    "Every MCP server emits unbounded responses. Agents have to budget context across many tool calls per turn, but no protocol mechanism lets them ask 'how big will your answer be?' or constrain it.",
    "",
    "## Proposal",
    "Three optional HTTP-style headers in MCP request/response framing:",
    "",
    "- `X-Context-Available-Tokens: <int>` (request) — agent's budget for THIS response",
    "- `X-Context-Used-Tokens: <int>` (response) — actual tokens the server emitted",
    "- `X-Context-Trimmed: true|false` (response) — was the output trimmed to fit?",
    "",
    "Servers SHOULD honour the request header by trimming the response to fit. If they cannot trim semantically, they MAY emit the unbounded response and set `X-Context-Trimmed: false` + `X-Context-Used-Tokens` to the actual usage. Agents can then either accept the over-budget response or re-issue with a different tool / smaller scope.",
    "",
    "## Token estimation",
    "MCP-CANDOR/PulseCost recommends words-per-token = 0.75 (matches GPT/Claude tokenisation within 10%). Servers MAY swap for their own model's tokenizer when known.",
    "",
    "## Compatibility",
    "Headers are OPTIONAL. Clients without the spec ignore the response headers. Servers without the spec ignore the request header (no trimming, no header emission) — same behavior as today.",
    "",
    "## Reference implementation",
    "Mneme v2.33.0 ships `mneme.pulsecost.budget` as the reference implementation. Call it with `{ text, availableTokens }` to receive a trimmed string + the three response headers. Any MCP server can compose this primitive into their handlers without re-implementing token math.",
  ].join("\n"),
};

const DEFAULTS: PulseCostBudget = {
  availableTokens: 8192,
  defaultBudget: 8192,
  wordsPerToken: 0.75,
};

export function estimateTokens(text: string, wordsPerToken = DEFAULTS.wordsPerToken): number {
  if (!text) return 0;
  const words = text.trim().split(/\s+/).filter(Boolean).length;
  return Math.ceil(words / wordsPerToken);
}

/**
 * Trim by sentence boundary first; if a single sentence already
 * exceeds the budget, fall back to char-truncation at a word boundary.
 */
export function trimToBudget(text: string, budget: PulseCostBudget): PulseCostResult {
  const originalTokens = estimateTokens(text, budget.wordsPerToken);
  if (originalTokens <= budget.availableTokens) {
    return {
      output: text, usedTokens: originalTokens, originalTokens, trimmed: false,
      headers: {
        [SPEC.headers.responseUsed]: String(originalTokens),
        [SPEC.headers.responseTrimmed]: "false",
      },
    };
  }
  // Sentence-aware trim. We split on `.` / `!` / `?` followed by space or EOS.
  const sentences = text.split(/(?<=[.!?])\s+/);
  const accumulated: string[] = [];
  let runningTokens = 0;
  for (const s of sentences) {
    const t = estimateTokens(s, budget.wordsPerToken);
    if (runningTokens + t > budget.availableTokens) break;
    accumulated.push(s);
    runningTokens += t;
  }
  let output = accumulated.join(" ");
  // Single sentence already too big → char-truncate at word boundary.
  if (output.length === 0 && sentences.length > 0) {
    const approxChars = Math.max(1, Math.floor(budget.availableTokens * 4)); // ~4 chars/token rough
    const cut = sentences[0]!.slice(0, approxChars);
    const lastSpace = cut.lastIndexOf(" ");
    output = lastSpace > 0 ? cut.slice(0, lastSpace) + "…" : cut + "…";
  }
  const usedTokens = estimateTokens(output, budget.wordsPerToken);
  return {
    output, usedTokens, originalTokens, trimmed: true,
    headers: {
      [SPEC.headers.responseUsed]: String(usedTokens),
      [SPEC.headers.responseTrimmed]: "true",
    },
  };
}

/** Convenience: pull the request header from any { headers } shape. */
export function readRequestBudget(headers: Record<string, string | string[] | undefined>, fallback = DEFAULTS): PulseCostBudget {
  const raw = headers[SPEC.headers.requestAvailable] ?? headers[SPEC.headers.requestAvailable.toLowerCase()];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const parsed = value ? parseInt(String(value), 10) : NaN;
  return {
    availableTokens: Number.isFinite(parsed) && parsed > 0 ? parsed : fallback.defaultBudget,
    defaultBudget: fallback.defaultBudget,
    wordsPerToken: fallback.wordsPerToken,
  };
}
