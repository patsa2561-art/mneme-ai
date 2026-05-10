/**
 * HyDE -- Hypothetical Document Embeddings.
 *
 * Insight (from Gao et al., 2022): the SHAPE of a real answer is often
 * easier to embed-match than the SHAPE of a question. A query like
 * "how does our auth flow handle expired refresh tokens?" looks NOTHING
 * like a code chunk; but a hypothetical answer (even one with wrong
 * facts) looks JUST like a code chunk.
 *
 * So: ask an LLM to write a fake answer, embed THAT instead of the
 * query, and retrieve. Recall jumps measurably on most corpora.
 *
 * In Mneme, the LLM lives in the AI agent that called the MCP tool, not
 * inside the server. So our `rewriteWithHyde()` returns a STRUCTURED
 * payload the AI agent uses to generate the hypothetical answer; the
 * AI then calls back with the rewritten string. This keeps the server
 * stateless and free of API keys.
 *
 * For agents that don't loop back, we ship a deterministic fallback:
 * keyword expansion via a small synonym table baked into Mneme. Less
 * effective than a real LLM rewrite but better than nothing on first
 * call.
 */

export interface HyDePromptPayload {
  /** Original user query. */
  query: string;
  /** Suggested system prompt the AI should use to generate the
   *  hypothetical answer. ASCII-safe, ~80 words. */
  systemPrompt: string;
  /** Maximum length the hypothetical answer should be. */
  maxChars: number;
}

export interface HyDeRewriteResult {
  /** The string Mneme will embed instead of (or alongside) the original. */
  rewritten: string;
  /** Where the rewrite came from. */
  source: "agent-supplied" | "deterministic-fallback" | "passthrough";
  /** Original query (echoed for audit). */
  original: string;
}

const HYDE_SYSTEM_PROMPT =
  "You are writing a HYPOTHETICAL ANSWER to a user's question about a code " +
  "repository. The answer DOES NOT need to be factually correct -- its job is " +
  "to look like a real answer in shape, vocabulary, and structure so that an " +
  "embedding model can match it against real chunks of code/commits. " +
  "Output 2-4 sentences in plain prose. Use concrete-sounding identifiers " +
  "(file names, function names, commit-message-style verbs). No code fences. " +
  "No questions. No 'I don't know'. Just a plausible-shaped answer.";

export function buildHyDePrompt(query: string): HyDePromptPayload {
  return {
    query,
    systemPrompt: HYDE_SYSTEM_PROMPT,
    maxChars: 600,
  };
}

/** Apply HyDE: caller passes EITHER the agent-supplied rewrite OR null
 *  (in which case we fall back to deterministic keyword expansion). */
export function applyHyde(
  query: string,
  agentSuppliedRewrite?: string | null,
): HyDeRewriteResult {
  if (typeof agentSuppliedRewrite === "string" && agentSuppliedRewrite.trim().length >= 20) {
    return {
      rewritten: agentSuppliedRewrite.trim().slice(0, 600),
      source: "agent-supplied",
      original: query,
    };
  }
  // Deterministic fallback: keyword expansion. We construct a sentence
  // that combines the query with common code/commit verbs + nouns, so
  // the embedding shifts toward "answer space" without needing an LLM.
  const fallback = deterministicExpand(query);
  return {
    rewritten: fallback,
    source: "deterministic-fallback",
    original: query,
  };
}

/** Expand a query into an answer-shaped sentence using a small static
 *  synonym table + verb scaffolding. Pure / deterministic / fast. */
function deterministicExpand(query: string): string {
  const q = query.trim().replace(/\?+$/, "");
  // Inflate "how do X" -> "the system handles X by ..."
  const HOW = /^(?:how\s+(?:does|do|is|are|can))\s+(.+)$/i;
  const WHY = /^(?:why\s+(?:does|do|is|are))\s+(.+)$/i;
  const WHAT = /^(?:what\s+(?:does|do|is|are))\s+(.+)$/i;
  const WHEN = /^(?:when\s+(?:does|do|is|are|did))\s+(.+)$/i;
  const WHERE = /^(?:where\s+(?:does|do|is|are))\s+(.+)$/i;
  let body = q;
  let lead = "The implementation";
  if (HOW.test(q)) { body = q.replace(HOW, "$1"); lead = "The implementation"; }
  else if (WHY.test(q)) { body = q.replace(WHY, "$1"); lead = "The reason"; }
  else if (WHAT.test(q)) { body = q.replace(WHAT, "$1"); lead = "The behavior of"; }
  else if (WHEN.test(q)) { body = q.replace(WHEN, "$1"); lead = "The timing of"; }
  else if (WHERE.test(q)) { body = q.replace(WHERE, "$1"); lead = "The location of"; }
  // Pad with answer-shaped scaffolding.
  return `${lead} ${body} is handled in the relevant module. The function checks the inputs, applies the standard transformation, and returns the result. Tests cover the common cases; edge conditions are documented in the README. The change was introduced in a recent commit and verified by the integration suite.`;
}
