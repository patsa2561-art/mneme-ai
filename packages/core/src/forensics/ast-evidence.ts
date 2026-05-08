/**
 * AST-based evidence scoring — score the *context* of a regex match.
 *
 * Why this is needed (customer feedback, v0.36): the previous SQL-injection
 * regex matched the substring "update" inside a NestJS log line, producing
 * 16 false positives. The regex had no way to know it was looking at the
 * argument of `console.log()` and not `db.query()`.
 *
 * This module classifies each match's surrounding context using lightweight
 * lexical heuristics that work without parsing the file. We don't need a
 * full TS compiler walk for 80% of the value — knowing whether the match is
 * inside a comment, a string literal, a logger call, or a database sink is
 * enough to crush most false positives.
 *
 * Returns `evidenceScore ∈ [0,1]`. Multiplied by the stack prior to produce
 * the posterior. A match with `evidenceScore < 0.1` is almost certainly noise.
 */

export type EvidenceContext =
  | "comment"
  | "string-literal"
  | "logger-arg"
  | "test-file"
  | "type-only"
  | "config-only"
  | "db-sink"
  | "shell-sink"
  | "html-sink"
  | "unknown";

export interface EvidenceResult {
  /** Numeric weight ∈ [0, 1]. */
  score: number;
  /** What kind of context the match landed in. */
  context: EvidenceContext;
  /** Human-readable explanation rendered in --explain mode. */
  reason: string;
}

const LOGGER_PREFIX_RE = /(?:console\.(?:log|info|warn|error|debug|trace)|logger?\.[a-z]+|this\.logger?\.[a-z]+|log\.[a-z]+)\s*\(\s*$/i;
// Recognises the canonical DB-sink shapes: `<obj>.<method>(` and a few named
// raw-query helpers. Backtick variants are accepted because tagged-template
// queries (e.g. `prisma.$queryRaw\`...\``) are common.
const DB_SINK_RE = /(?:(?:\bdb|cursor|pool|client|connection|conn)\.[a-zA-Z_$]\w*|prisma\.\$queryRaw(?:Unsafe)?|knex\.raw|sequelize\.query|\.execute|\.exec)\s*[`(]\s*$/i;
const SHELL_SINK_RE = /(?:\bexec|\bspawn|spawnSync|execSync|execFile|child_process\.\w+)\s*\(\s*$/;
const HTML_SINK_RE = /(?:innerHTML\s*=\s*|dangerouslySetInnerHTML\s*=\s*\{\s*\{?\s*__html\s*:\s*)$/;
const TEST_PATH_RE = /(?:^|\/)(?:tests?|__tests__|specs?)(?:\/|$)|\.(?:test|spec)\.[mc]?[jt]sx?$/i;
const CONFIG_PATH_RE = /(?:^|\/)(?:config|configs)(?:\/|$)|\.(?:config|env)\.[mc]?[jt]sx?$/i;
const TYPE_DECL_RE = /^\s*(?:type|interface|declare)\s/;

/**
 * Classify a single regex match given the file's source text + index of
 * the match's start. Cheap (no AST walk required) but gives us 80% of the
 * accuracy at 1% of the cost.
 */
export function scoreEvidence(
  source: string,
  matchStart: number,
  filePath: string,
): EvidenceResult {
  // 1. File-path heuristics first — fastest to short-circuit.
  if (TEST_PATH_RE.test(filePath)) {
    return { score: 0.2, context: "test-file", reason: "match is in a test file" };
  }
  if (CONFIG_PATH_RE.test(filePath)) {
    return { score: 0.4, context: "config-only", reason: "match is in a config file" };
  }

  // 2. Locate the line containing the match — used for several sub-checks.
  const lineStart = source.lastIndexOf("\n", matchStart) + 1;
  const lineEnd = source.indexOf("\n", matchStart);
  const line = source.slice(lineStart, lineEnd < 0 ? source.length : lineEnd);
  const beforeMatch = source.slice(lineStart, matchStart);
  const trimmedLine = line.trim();

  // 3. Comment detection — single-line comments and block comments.
  if (/^\s*(?:\/\/|\*|\#)/.test(trimmedLine)) {
    return { score: 0.05, context: "comment", reason: "match is inside a comment" };
  }
  if (insideBlockComment(source, matchStart)) {
    return { score: 0.05, context: "comment", reason: "match is inside a /* … */ block comment" };
  }

  // 4. Type-only declarations — `type Foo = …` or `interface … { … }`
  if (TYPE_DECL_RE.test(trimmedLine)) {
    return { score: 0.2, context: "type-only", reason: "match is in a type/interface declaration" };
  }

  // 5. Sink detection — what call wraps this line?
  const wrappingCall = findWrappingCall(source, matchStart);
  if (wrappingCall) {
    if (LOGGER_PREFIX_RE.test(wrappingCall.prefix)) {
      return { score: 0.05, context: "logger-arg", reason: `match is inside ${wrappingCall.callName}() — almost certainly a log string, not a sink` };
    }
    if (DB_SINK_RE.test(wrappingCall.prefix)) {
      return { score: 0.95, context: "db-sink", reason: `match is inside a DB sink (${wrappingCall.callName}) — likely a real query` };
    }
    if (SHELL_SINK_RE.test(wrappingCall.prefix)) {
      return { score: 0.9, context: "shell-sink", reason: `match is inside a shell sink (${wrappingCall.callName})` };
    }
    if (HTML_SINK_RE.test(wrappingCall.prefix)) {
      return { score: 0.9, context: "html-sink", reason: `match is inside an HTML sink (${wrappingCall.callName})` };
    }
  }

  // 6. String literal detection — match wrapped in quotes that are never
  //    flowed to a sink (best-effort; we can't do full taint without TS).
  if (insideStringLiteral(beforeMatch)) {
    // Slightly higher than logger-arg because we can't always trace the flow.
    return { score: 0.25, context: "string-literal", reason: "match is inside a string literal with no detected sink" };
  }

  // 7. Default: code position with no special signal. Trust the regex.
  return { score: 0.7, context: "unknown", reason: "match is in code position; no comment/string/logger context detected" };
}

function insideBlockComment(source: string, idx: number): boolean {
  // Find the most recent `/*` and `*/` before idx; if `/*` is later than `*/`
  // we're inside a block comment.
  const prevOpen = source.lastIndexOf("/*", idx);
  const prevClose = source.lastIndexOf("*/", idx);
  return prevOpen > prevClose;
}

interface WrappingCall {
  callName: string;
  prefix: string;
}

/**
 * Walk backwards from the match looking for the `(` that opens the
 * enclosing call. Naive but tolerant: cap walk at 400 chars to avoid
 * pathological inputs.
 */
function findWrappingCall(source: string, idx: number): WrappingCall | undefined {
  let depth = 0;
  const minIdx = Math.max(0, idx - 400);
  for (let i = idx - 1; i >= minIdx; i--) {
    const ch = source[i];
    if (ch === ")") depth += 1;
    else if (ch === "(") {
      if (depth === 0) {
        // Found the opening paren of our wrapping call; back up over the
        // identifier preceding it.
        const before = source.slice(Math.max(0, i - 80), i);
        const callName = (before.match(/([A-Za-z0-9_$.]+)\s*$/)?.[1] ?? "(anon)");
        return { callName, prefix: before + "(" };
      }
      depth -= 1;
    }
  }
  return undefined;
}

function insideStringLiteral(beforeMatch: string): boolean {
  // Count quotes on the same line. If any kind of quote has odd count
  // before the match, we're inside a string literal.
  const counts: Record<string, number> = { '"': 0, "'": 0, "`": 0 };
  let escape = false;
  for (const ch of beforeMatch) {
    if (escape) {
      escape = false;
      continue;
    }
    if (ch === "\\") {
      escape = true;
      continue;
    }
    if (ch in counts) counts[ch] += 1;
  }
  return counts['"'] % 2 === 1 || counts["'"] % 2 === 1 || counts["`"] % 2 === 1;
}
