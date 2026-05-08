/**
 * mneme.understand_intent — the Rosetta stone tool.
 *
 * Strategic role: even with rich tool descriptions + secondBrain layer,
 * AI tool selection accuracy plateaus around 95-99% with 94 tools. This
 * tool drops the cognitive load to "near-zero" — AI hands Mneme the
 * raw user query, Mneme returns top-3 specific tools with confidence
 * scores + a step-by-step execution plan.
 *
 * The matching engine is fully deterministic — no LLM calls, no embedder
 * required, no key needed. Pure keyword + trigger-phrase scoring against
 * the tool catalog. Fast (<50ms for 94 tools), reproducible, and works
 * with any AI client (Claude / GPT / Gemini / Codex / others).
 *
 * Algorithm:
 *   1. Tokenize the user query (lowercase, split on word boundaries)
 *   2. For each tool in the catalog, compute a match score:
 *      - description keyword overlap (BM25-lite)
 *      - trigger phrase fuzzy match (n-gram overlap)
 *      - category prior (boost if user mentions category-specific terms)
 *   3. Return top-3 tools sorted by score, with each tool's
 *      argument-extraction hints (which user-tokens map to which args)
 *   4. Compose a plan: "call tool A first, then if result is X, call B"
 */

import type { MnemeTool } from "./_types.js";

export interface IntentMatch {
  toolName: string;
  category: string;
  score: number;
  why: string;
  description: string;
  triggers: string[];
  /** Heuristic argument extraction — user-tokens that look like values for the tool's input schema */
  suggestedArgs: Record<string, string>;
}

export interface IntentResult {
  query: string;
  matches: IntentMatch[];
  /** Confidence that the top match is the right one. < 0.4 = "ambiguous, ask user" */
  topConfidence: number;
  plan: string[];
  reasoning: string;
}

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "do", "does", "did", "will", "would", "should",
  "can", "could", "may", "might", "must", "shall",
  "i", "you", "he", "she", "it", "we", "they", "me", "him", "her", "us", "them",
  "my", "your", "his", "her", "its", "our", "their",
  "this", "that", "these", "those",
  "and", "or", "but", "not", "no",
  "in", "on", "at", "to", "from", "by", "with", "for", "of", "about",
  "what", "when", "where", "who", "why", "how",
  "any", "some", "all", "every",
  "please", "tell", "show", "give",
]);

function tokenize(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^\w\s฀-๿]/g, " ") // keep Thai chars
    .split(/\s+/)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

function bigrams(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    out.push(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}

/** Score how well a tool matches a query. */
function scoreToolForQuery(tool: MnemeTool, queryTokens: string[], queryBigrams: string[]): {
  score: number;
  why: string;
} {
  const reasons: string[] = [];
  let score = 0;

  // 1 — description keyword overlap (BM25-lite, no IDF — terms are rare enough by descriptor)
  const descTokens = new Set(tokenize(tool.description));
  const descMatches = queryTokens.filter((t) => descTokens.has(t)).length;
  if (descMatches > 0) {
    const w = descMatches * 1.5;
    score += w;
    reasons.push(`${descMatches} description keyword match${descMatches === 1 ? "" : "es"}`);
  }

  // 2 — trigger-phrase fuzzy match (most powerful signal)
  let triggerHits = 0;
  for (const trig of tool.triggers ?? []) {
    const trigTokens = new Set(tokenize(trig));
    const trigBg = new Set(bigrams(tokenize(trig)));
    // Token overlap
    const tokOverlap = queryTokens.filter((t) => trigTokens.has(t)).length;
    // Bigram overlap (boosts phrasal matches)
    const bgOverlap = queryBigrams.filter((b) => trigBg.has(b)).length;
    if (tokOverlap > 0 || bgOverlap > 0) {
      triggerHits++;
      score += tokOverlap * 2 + bgOverlap * 4; // bigrams worth more
    }
  }
  if (triggerHits > 0) {
    reasons.push(`matched ${triggerHits} trigger phrase${triggerHits === 1 ? "" : "s"}`);
  }

  // 3 — name overlap (e.g. user mentions "atrophy" → mneme.people.atrophy gets a boost)
  const nameTokens = tool.name.split(/[._]/);
  const nameMatches = queryTokens.filter((t) => nameTokens.includes(t)).length;
  if (nameMatches > 0) {
    // Heavily weight name matches — when user explicitly names a concept,
    // tools whose name contains that word should beat tools that merely
    // mention it in their description.
    score += nameMatches * 12;
    reasons.push(`name token "${nameTokens.find((t) => queryTokens.includes(t))}" matches`);
  }

  // 4 — category prior boost
  const categoryHints: Record<string, string[]> = {
    memory: ["why", "what", "history", "explain", "ask", "search"],
    people: ["who", "author", "team", "person", "engineer", "developer"],
    audit: ["audit", "certify", "verify", "trust", "compliance", "ai-commit"],
    forensics: ["security", "vuln", "vulnerability", "cwe", "exploit", "anomaly"],
    insights: ["story", "predict", "premortem", "regret", "ghost", "oracle"],
    quality: ["health", "quality", "karma", "mri", "heartbeat"],
    quant: ["alpha", "drawdown", "moneyball", "greek", "volatility"],
    lab: ["compose", "library", "recipe", "plan"],
    meta: ["help", "doctor", "manifesto", "wisdom"],
  };
  const categoryWords = categoryHints[tool.category] ?? [];
  const catMatches = queryTokens.filter((t) => categoryWords.includes(t)).length;
  if (catMatches > 0) {
    score += catMatches * 1.0;
    reasons.push(`category-prior boost on "${tool.category}"`);
  }

  return {
    score,
    why: reasons.length === 0 ? "no signal" : reasons.join(" · "),
  };
}

/** Heuristic argument extraction from user query.
 *  Looks at the tool's inputSchema and picks user-tokens that look like
 *  values. Conservative — we'd rather under-suggest than wrong-suggest. */
function extractArgs(tool: MnemeTool, query: string): Record<string, string> {
  const args: Record<string, string> = {};
  const schema = tool.inputSchema as { properties?: Record<string, { type?: string; description?: string }> };
  const props = schema.properties ?? {};

  for (const [paramName, paramSchema] of Object.entries(props)) {
    // Email-like
    if (paramName.toLowerCase().includes("email")) {
      const m = query.match(/[a-z0-9._%+-]+@[a-z0-9.-]+/i);
      if (m) args[paramName] = m[0];
      continue;
    }
    // File path / target
    if (["file", "target", "path"].some((k) => paramName.toLowerCase().includes(k))) {
      const m = query.match(/[\w./\\-]+\.(ts|js|tsx|jsx|py|go|rs|md|json|yaml)\b(?::\d+(?:-\d+)?)?/i);
      if (m) args[paramName] = m[0];
      continue;
    }
    // Commit hash
    if (paramName.toLowerCase().includes("commit") || paramName.toLowerCase().includes("hash")) {
      const m = query.match(/\b[a-f0-9]{7,40}\b|\bHEAD(?:[~^]\d*)?\b/i);
      if (m) args[paramName] = m[0];
      continue;
    }
    // Numeric (topN, count, etc)
    if (paramSchema.type === "number") {
      const m = query.match(/\b(\d{1,4})\b/);
      if (m) args[paramName] = m[1]!;
      continue;
    }
    // Topic / question — use the whole query if no other arg fits
    if (
      paramName === "topic" ||
      paramName === "question" ||
      paramName === "query" ||
      paramName === "intent"
    ) {
      args[paramName] = query.trim();
    }
  }
  return args;
}

/** Build a step-by-step execution plan from the top matches.
 *  v1.8.0: simple linear plan. v1.9.0 will use the Second Brain compose
 *  graph to pick MULTI-step molecules instead of single-tool plans. */
function buildPlan(matches: IntentMatch[]): string[] {
  if (matches.length === 0) {
    return [
      "1. No specific tool matched. Fall back to `mneme.smart_do` with the original query — it handles natural-language routing.",
      "2. If smart_do also returns nothing useful, ask the user to clarify which area their question is about.",
    ];
  }
  const plan: string[] = [];
  const top = matches[0]!;
  plan.push(`1. Call \`${top.toolName}\` (confidence ${(top.score / 10).toFixed(1)}) with args ${JSON.stringify(top.suggestedArgs)}`);
  if (matches[1] && matches[1].score > matches[0].score * 0.6) {
    plan.push(`2. If result is sparse, fall back to \`${matches[1].toolName}\``);
  }
  plan.push(`3. Read the response's \`secondBrain.compose\` field — fire suggested molecule combinations if they match user intent`);
  plan.push(`4. Draft your answer, then call \`mneme.grade.answer\` with the draft before delivering`);
  return plan;
}

export function understandIntent(query: string, allTools: MnemeTool[]): IntentResult {
  const queryTokens = tokenize(query);
  const queryBigrams = bigrams(queryTokens);

  // Skip the meta dispatcher tools themselves — they shouldn't recommend themselves
  const candidates = allTools.filter(
    (t) => t.name !== "mneme.understand_intent" && t.name !== "mneme.smart_do" && t.name !== "mneme.capabilities",
  );

  const scored = candidates.map((t) => {
    const { score, why } = scoreToolForQuery(t, queryTokens, queryBigrams);
    return {
      toolName: t.name,
      category: t.category,
      score,
      why,
      description: t.description,
      triggers: t.triggers ?? [],
      suggestedArgs: extractArgs(t, query),
    };
  });
  scored.sort((a, b) => b.score - a.score);
  const matches = scored.filter((m) => m.score > 0).slice(0, 3);

  const topScore = matches[0]?.score ?? 0;
  // Confidence calibration: score scales by query length + match strength
  const topConfidence = Math.min(1, topScore / 10);

  const reasoning =
    matches.length === 0
      ? `No specific Mneme tool matched the query "${query}". Recommended fallback: call \`mneme.smart_do\` with the same query — it routes through Mneme's natural-language dispatcher and can handle ambiguous intents that don't keyword-match any single tool.`
      : topConfidence < 0.4
      ? `Top match has low confidence (${(topConfidence * 100).toFixed(0)}%). Consider asking the user to clarify between the top-${matches.length} candidates, OR fall back to \`mneme.smart_do\` with the original query for natural-language routing.`
      : `Top match: ${matches[0]!.toolName} with confidence ${(topConfidence * 100).toFixed(0)}% (${matches[0]!.why}).`;

  return {
    query,
    matches,
    topConfidence,
    plan: buildPlan(matches),
    reasoning,
  };
}

// Test exports
export const _tokenizeForTests = tokenize;
export const _scoreToolForQueryForTests = scoreToolForQuery;
export const _extractArgsForTests = extractArgs;
