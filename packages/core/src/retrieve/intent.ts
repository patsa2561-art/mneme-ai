/**
 * Query intent classifier.
 *
 * Mneme is designed for SPECIFIC questions ("why does X exist?", "when did Y
 * change?"). It's not a code-review oracle and not a general-purpose chatbot.
 * When users ask vague questions ("how to improve my code", "what's wrong"),
 * the right move is to redirect them BEFORE retrieval — pretending to answer
 * with low-confidence results is dishonest.
 *
 * Classification is regex-based on purpose:
 *   - Deterministic, runs in microseconds, no LLM needed
 *   - User-overridable: flags exist for "trust me, just retrieve"
 *   - Falsifiable: every signal is a documented heuristic, not a black box
 */

export type Intent =
  | "specific"   // "why does X exist?", "what does Y do?" — full retrieval
  | "lookup"     // "who wrote X?", "what's the latest commit on Y?" — focus on metadata
  | "temporal"   // "when did X change?", "what was the auth flow in March?" — timeline view
  | "vague";     // "how to improve my code", "best practice for X" — Mneme can't answer

export interface IntentResult {
  intent: Intent;
  /** Why this classification was chosen — for transparency / debugging. */
  reason: string;
  /**
   * If intent === "vague", a redirect message to show the user instead of
   * running retrieval. Empty for other intents.
   */
  redirect?: string;
}

/** Trigger phrases for vague queries. Listed by frequency in real misuse. */
const VAGUE_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\bhow\s+to\b/i, reason: '"how to" — Mneme indexes history, not best-practices' },
  { re: /\b(best|good)\s+(practice|practices|way)s?\b/i, reason: 'asks for best practice — not a history question' },
  { re: /\b(improve|optimize|refactor|review)\s+(my|the|this)\s+code\b/i, reason: 'general code-improvement request' },
  { re: /\bshould\s+i\b/i, reason: '"should I" — opinion, not memory' },
  { re: /\bcan\s+you\s+(write|generate|create)\b/i, reason: 'asks Mneme to generate code — out of scope' },
  { re: /^(help|hello|hi|test)\s*$/i, reason: 'greeting / smoke-test, not a real question' },
  { re: /\bwhat\s+is\s+(the\s+)?(meaning|point)\s+of\s+(life|this)\b/i, reason: 'philosophical' },
];

/** Lookup: question is about a specific person, hash, or PR number. */
const LOOKUP_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\bwho\s+(wrote|made|created|authored|added)\b/i, reason: 'who-question — author lookup' },
  { re: /\bwhat\s+did\s+\S+\s+(do|change|commit|write)\b/i, reason: 'asks what a person did — author lookup' },
  { re: /\bPR\s*#?\d+\b/i, reason: 'specific PR reference' },
  { re: /\b[a-f0-9]{7,40}\b/, reason: 'commit hash reference' },
];

/** Temporal: question asks about time, dates, or change-over-time. */
const TEMPORAL_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\bwhen\s+(did|was|will)\b/i, reason: 'when-question — timeline query' },
  { re: /\b(last|recent|latest|previous|first|earliest)\s+(commit|change|update|time)\b/i, reason: 'temporal modifier' },
  { re: /\b(yesterday|today|last\s+(week|month|year|quarter))\b/i, reason: 'relative time reference' },
  { re: /\b(20\d{2})-(0[1-9]|1[0-2])\b/, reason: 'absolute date reference (YYYY-MM)' },
];

/** Specific: WHY/WHAT/HOW/WHERE questions about a concrete thing. */
const SPECIFIC_PATTERNS: Array<{ re: RegExp; reason: string }> = [
  { re: /\bwhy\s+(does|did|do|is|are|was|were)\b/i, reason: 'why-question with concrete subject' },
  { re: /\bwhat\s+(does|did|do|is|are)\b/i, reason: 'what-question (concrete)' },
  { re: /\bhow\s+(does|did|do|is|are)\b/i, reason: 'how-question (about behavior, not advice)' },
  // "what X appear / exist / live / hide / show up" — discovery questions, especially for security audits.
  { re: /\bwhat\s+\w+(?:\s+\w+)?\s+(appear|exist|live|hide|show\s+up|are\s+there|come\s+from)\b/i, reason: 'discovery question (what X exists in the repo)' },
  // "where ..." — location questions across history.
  { re: /\bwhere\s+(is|are|does|did|do|was|were|in|do\s+we|did\s+we)\b/i, reason: 'where-question — location across history' },
  // "find X" / "show X" / "list X" — direct retrieval verbs over history.
  { re: /\b(find|show|list)\s+(all\s+)?\w+(\s+\w+)?\s+(in|across|from|that|with)\b/i, reason: 'imperative retrieval verb (find/show/list X in Y)' },
];

/**
 * Words that, if PRESENT, suggest concreteness even for "how to" patterns.
 * Two regexes — case-sensitive for code (so CamelCase detection works) and
 * case-insensitive for plain-English security/credential nouns.
 *
 * v0.19.2 fix: a real user got blocked asking about an AWS key Mneme had
 * just redacted. Security audits ("where are aws keys?") are legitimate
 * enumeration queries even though the noun phrase looks generic.
 */
const CONCRETE_HINTS_CODE: RegExp =
  /(\.[a-z]+\b|::|\bsrc\/|\b[A-Z][a-zA-Z]{2,}[A-Z][a-z]|\bfunction\s+\w+|\bclass\s+\w+|\bmodule\s+\w+|\bPR\s*#?\d+)/;
const CONCRETE_HINTS_SECURITY: RegExp =
  /\b(secret|password|credential|token|api[\s-]?key|aws|access[\s-]?key|private[\s-]?key|env\s+var|environment\s+variable|hardcoded\s+\w+|leaked\s+\w+)s?\b/i;
function hasConcreteHint(q: string): boolean {
  return CONCRETE_HINTS_CODE.test(q) || CONCRETE_HINTS_SECURITY.test(q);
}

const VAGUE_REDIRECT_TEMPLATE = [
  'I work best with specific questions about your repo\'s history.',
  'Try one of these instead:',
  '',
  '  • "why does <function or pattern> exist?"',
  '  • "when did we change <module>?"',
  '  • "who wrote <file>?"',
  '  • "what does <commit hash> do?"',
  '',
  'For general code improvement advice, use a chat assistant — Mneme is the',
  'memory layer that feeds those tools, not a substitute for them.',
].join('\n');

/**
 * Classify a query's intent. Order matters: lookup and temporal patterns are
 * checked BEFORE vague patterns, so "who wrote how-to-do-x.md" is classified
 * as a lookup, not a vague query.
 */
export function classifyIntent(query: string): IntentResult {
  const q = query.trim();
  if (!q) {
    return { intent: "vague", reason: "empty query", redirect: VAGUE_REDIRECT_TEMPLATE };
  }

  // 1. Lookup patterns win — questions about a specific person/hash/PR are
  //    always specific enough to retrieve.
  for (const p of LOOKUP_PATTERNS) {
    if (p.re.test(q)) return { intent: "lookup", reason: p.reason };
  }

  // 2. Temporal patterns — when-questions and date references.
  for (const p of TEMPORAL_PATTERNS) {
    if (p.re.test(q)) return { intent: "temporal", reason: p.reason };
  }

  // 3. Vague patterns — but only fire if the query has NO concrete hint.
  for (const p of VAGUE_PATTERNS) {
    if (p.re.test(q) && !hasConcreteHint(q)) {
      return { intent: "vague", reason: p.reason, redirect: VAGUE_REDIRECT_TEMPLATE };
    }
  }

  // 4. Specific question patterns.
  for (const p of SPECIFIC_PATTERNS) {
    if (p.re.test(q)) return { intent: "specific", reason: p.reason };
  }

  // 5. Default: short queries (< 4 words) treated as keyword search → specific;
  //    long unstructured queries → vague.
  const wordCount = q.split(/\s+/).length;
  if (wordCount <= 6) return { intent: "specific", reason: "short keyword-style query" };
  if (hasConcreteHint(q)) return { intent: "specific", reason: "contains concrete identifier (file, class, PR, or security noun)" };

  return {
    intent: "vague",
    reason: "long query with no concrete identifier or specific question pattern",
    redirect: VAGUE_REDIRECT_TEMPLATE,
  };
}
