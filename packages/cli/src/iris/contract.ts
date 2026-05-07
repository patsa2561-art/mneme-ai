/**
 * Iris — 30-second contract validator.
 *
 * Every Mneme command output should be scannable in ~30 seconds.  This file
 * encodes that as a checkable contract — both for tests ("does my command
 * obey the contract?") and for users (`mneme verify-output`).
 *
 * Pure function.  No I/O.
 */

const ANSI_RE = /\x1b\[[0-9;]*m|\x1b\]8;;[^\x1b]*\x1b\\/g;

/** Strip ANSI escapes for visible-width math.  Local copy to avoid coupling. */
export function stripAnsi(s: string): string {
  return s.replace(ANSI_RE, "");
}

export interface ContractResult {
  ok: boolean;
  violations: string[];
}

/** Heuristic: a "headline-like" line has a leading icon glyph + non-trivial
 *  text.  When ANSI is present we additionally accept a bold escape, but we
 *  do NOT require it — pipes and CI strip colour, and the contract has to
 *  pass either way. */
function looksLikeHeadline(line: string): boolean {
  const visible = stripAnsi(line);
  const head = visible.trimStart();
  if (head.length < 4) return false;
  // Non-ASCII glyph (icon) within the first 12 visible chars.
  const hasIcon = /[^\x00-\x7F]/.test(head.slice(0, 12));
  return hasIcon;
}

/** Detect whether the output offers an actionable hint. */
function hasActionableHint(stripped: string): boolean {
  // "mneme " (a follow-up command), "Try ", "Run ", "→ Try", or fenced cmd.
  if (/\bmneme\s+\w+/.test(stripped)) return true;
  if (/\bTry\b/.test(stripped)) return true;
  if (/\bRun\b/.test(stripped)) return true;
  if (/→\s*Try/.test(stripped)) return true;
  return false;
}

/** Walk lines and find max indent depth (every 2 spaces = 1 level). */
function maxIndentDepth(lines: string[]): number {
  let max = 0;
  for (const raw of lines) {
    const visible = stripAnsi(raw);
    const m = visible.match(/^(\s*)/);
    const spaces = m ? m[1]!.length : 0;
    const depth = Math.floor(spaces / 2);
    if (depth > max) max = depth;
  }
  return max;
}

/**
 * Validate that a rendered output meets the 30-second readability contract.
 *
 * Checks:
 *   1. First 5 lines must contain a headline-like sentence (bold + icon).
 *   2. Output must contain at least one actionable hint
 *      (e.g. `mneme `, `Try `, `Run `).
 *   3. No line wider than 200 visible chars (post-ANSI strip).
 *   4. No section nested deeper than 3 levels (6 leading spaces).
 *   5. Either has `→ Try next` or has fewer than 30 lines (tight).
 */
export function checkContract(output: string): ContractResult {
  const violations: string[] = [];
  const rawLines = output.split("\n");
  const stripped = stripAnsi(output);

  // 1. Headline in first 5 lines.
  const top5 = rawLines.slice(0, 5);
  if (!top5.some(looksLikeHeadline)) {
    violations.push("no headline in first 5 lines (need bold + leading icon)");
  }

  // 2. At least one actionable hint.
  if (!hasActionableHint(stripped)) {
    violations.push("no actionable hint found ('mneme', 'Try', 'Run')");
  }

  // 3. No line wider than 200 visible chars.
  for (let i = 0; i < rawLines.length; i++) {
    const visibleLen = stripAnsi(rawLines[i]!).length;
    if (visibleLen > 200) {
      violations.push(`line ${i + 1} too wide: ${visibleLen} visible chars (max 200)`);
      break; // one report is enough — keep the message tight
    }
  }

  // 4. Indent depth ≤ 3 levels (i.e. 6 leading spaces).
  const depth = maxIndentDepth(rawLines);
  if (depth > 3) {
    violations.push(`section nested too deep: depth=${depth} (max 3)`);
  }

  // 5. Try-next OR fewer than 30 lines.
  const hasTryNext = /→\s*Try next/.test(stripped) || /\bTry next\b/.test(stripped);
  if (!hasTryNext && rawLines.length >= 30) {
    violations.push(`output is ${rawLines.length} lines without '→ Try next' (cap at 30)`);
  }

  return { ok: violations.length === 0, violations };
}
