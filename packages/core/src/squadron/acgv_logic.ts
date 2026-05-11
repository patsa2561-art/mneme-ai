/**
 * v1.55.0 -- LOGICAL CONNECTIVE + NUMERIC INTENT PARSER.
 *
 * Pulls numeric range / comparison intents and boolean connectives out
 * of a natural-language claim so the arithmetic layer can encode them.
 *
 * Extracted shapes:
 *
 *   NUMERIC INTENT
 *     - "between 200 and 500 tools"            -> { subject: tool_count, op: "between", value: 200, value2: 500 }
 *     - "more than 200 tools"                  -> { subject: tool_count, op: "gt", value: 200 }
 *     - "less than 50 tools"                   -> { subject: tool_count, op: "lt", value: 50 }
 *     - "at least 100 tools"                   -> { subject: tool_count, op: "ge", value: 100 }
 *     - "at most 200 tools"                    -> { subject: tool_count, op: "le", value: 200 }
 *     - "exactly 129 tools"                    -> { subject: tool_count, op: "eq", value: 129 }
 *     - "200 tools" (bare)                     -> { subject: tool_count, op: "eq", value: 200 }
 *
 *   LOGICAL SHAPE
 *     - "X and Y"           -> "and"   (conjunction; all must hold)
 *     - "X or Y"            -> "or"    (disjunction; at least one must hold)
 *     - "if X then Y"       -> "implies"
 *     - otherwise           -> "none"  (single proposition or no connective)
 *
 * The parser is INTENTIONALLY simple. It catches the 90% of compound
 * claims dev-flow conversations actually produce; over-engineering it
 * makes regressions hard to reason about. The Z3 layer handles formal
 * semantics; the parser just turns text into structured shapes.
 */

export type NumericOp = "eq" | "ne" | "lt" | "le" | "gt" | "ge" | "between";

export interface NumericIntent {
  subject: "tool_count" | "version_major" | "version_minor" | "version_patch" | "file_count" | "commit_count";
  op: NumericOp;
  value: number;
  /** Second value for "between" (inclusive). */
  value2?: number;
  /** Original phrase. */
  raw: string;
}

export interface LogicalShape {
  kind: "and" | "or" | "implies" | "none";
  raw: string;
}

// ─── NUMERIC INTENT EXTRACTION ───────────────────────────────────────

const BETWEEN_RE = /\bbetween\s+(\d+)\s+(?:and|to|-)\s+(\d+)\s+(?:tools?|commands?|mcp\s+tools?|features?)\b/i;
const MORE_THAN_RE = /\b(?:more\s+than|over|above|exceeds?|exceeding|greater\s+than|>)\s+(\d+)\s+(?:tools?|commands?|mcp\s+tools?|features?)\b/i;
const LESS_THAN_RE = /\b(?:less\s+than|under|below|fewer\s+than|<)\s+(\d+)\s+(?:tools?|commands?|mcp\s+tools?|features?)\b/i;
const AT_LEAST_RE = /\b(?:at\s+least|minimum\s+of|>=|≥)\s+(\d+)\s+(?:tools?|commands?|mcp\s+tools?|features?)\b/i;
const AT_MOST_RE = /\b(?:at\s+most|maximum\s+of|no\s+more\s+than|<=|≤)\s+(\d+)\s+(?:tools?|commands?|mcp\s+tools?|features?)\b/i;
const EXACTLY_RE = /\b(?:exactly|precisely|equals?)\s+(\d+)\s+(?:tools?|commands?|mcp\s+tools?|features?)\b/i;
const BARE_COUNT_RE = /\b(?:has|exposes|ships|exports?|provides?|with)\s+(\d+)\s+(?:tools?|commands?|mcp\s+tools?|features?)\b/i;

export function extractNumericIntent(text: string): NumericIntent[] {
  if (!text) return [];
  const out: NumericIntent[] = [];
  const lower = text.toLowerCase();

  let m: RegExpMatchArray | null;
  if ((m = lower.match(BETWEEN_RE))) {
    out.push({ subject: "tool_count", op: "between", value: parseInt(m[1]!, 10), value2: parseInt(m[2]!, 10), raw: m[0] });
    return out;
  }
  if ((m = lower.match(MORE_THAN_RE))) {
    out.push({ subject: "tool_count", op: "gt", value: parseInt(m[1]!, 10), raw: m[0] });
    return out;
  }
  if ((m = lower.match(LESS_THAN_RE))) {
    out.push({ subject: "tool_count", op: "lt", value: parseInt(m[1]!, 10), raw: m[0] });
    return out;
  }
  if ((m = lower.match(AT_LEAST_RE))) {
    out.push({ subject: "tool_count", op: "ge", value: parseInt(m[1]!, 10), raw: m[0] });
    return out;
  }
  if ((m = lower.match(AT_MOST_RE))) {
    out.push({ subject: "tool_count", op: "le", value: parseInt(m[1]!, 10), raw: m[0] });
    return out;
  }
  if ((m = lower.match(EXACTLY_RE))) {
    out.push({ subject: "tool_count", op: "eq", value: parseInt(m[1]!, 10), raw: m[0] });
    return out;
  }
  if ((m = lower.match(BARE_COUNT_RE))) {
    out.push({ subject: "tool_count", op: "eq", value: parseInt(m[1]!, 10), raw: m[0] });
    return out;
  }
  return out;
}

// ─── LOGICAL CONNECTIVE EXTRACTION ───────────────────────────────────

const IF_THEN_RE = /\b(?:if|when)\s+.+?\s+then\s+/i;
const AND_RE = /\b(?:\s+and\s+|&&)/i;
const OR_RE = /\b(?:\s+or\s+|\|\|)/i;

export function extractLogicalConnectives(text: string): LogicalShape {
  if (!text) return { kind: "none", raw: "" };
  if (IF_THEN_RE.test(text)) return { kind: "implies", raw: text };
  // Order matters: implication first, then AND, then OR. We treat AND as
  // dominant so "A and B or C" parses as conjunction (most common dev
  // claim shape -- "X and Y are true [or something]").
  if (AND_RE.test(text)) return { kind: "and", raw: text };
  if (OR_RE.test(text)) return { kind: "or", raw: text };
  return { kind: "none", raw: text };
}
