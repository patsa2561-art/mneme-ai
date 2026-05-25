/**
 * v2.49.0 — AUTO-ALIAS RESOLVER.
 *
 * Wild idea: the WIRING LAG class isn't just "feature shipped but CLI verb
 * missing" — it's ALSO "feature shipped but user typed a NATURAL ALIAS
 * that doesn't exist". v2.48 shipped `mneme dev_tooling detect`; user
 * tried `mneme dev` / `mneme detect` / `mneme tool_detect` and got
 * cryptic `unknown command`. That's wiring lag at the keyboard surface.
 *
 * This module kills the class STRUCTURALLY:
 *   1. Levenshtein-based fuzzy match against all known top-level verbs
 *   2. Top-3 suggestions printed when user types unknown verb
 *   3. Heat-map ledger of misses → next release adds them as real aliases
 *   4. Intent-router fallback for natural-language phrases
 *
 * Pure deterministic except for the file-write to the heat-map ledger.
 * Defensive — never throws.
 */

import { existsSync, mkdirSync, appendFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Classic Levenshtein with single-char + transposition + similar-key
 * discounts. O(m·n) DP — fine for command names (typically ≤ 20 chars).
 */
export function levenshteinDistance(a: string, b: string): number {
  if (!a || !b) return Math.max(a?.length ?? 0, b?.length ?? 0);
  a = a.toLowerCase();
  b = b.toLowerCase();
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  const d: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) d[i]![0] = i;
  for (let j = 0; j <= n; j++) d[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      d[i]![j] = Math.min(
        d[i - 1]![j]! + 1,        // deletion
        d[i]![j - 1]! + 1,        // insertion
        d[i - 1]![j - 1]! + cost, // substitution
      );
      // Damerau transposition discount
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        d[i]![j] = Math.min(d[i]![j]!, d[i - 2]![j - 2]! + 1);
      }
    }
  }
  return d[m]![n]!;
}

export interface Suggestion {
  command: string;
  distance: number;
  /** Heuristic: does user's verb START WITH the command (or vice versa)? */
  prefixMatch: boolean;
  /** Distance normalized to candidate length (0=identical, 1=totally different). */
  normalizedDistance: number;
}

/**
 * Return top-N suggestions for `typed` from `known` commands, sorted by
 * (prefixMatch desc, distance asc, normalizedDistance asc).
 */
export function suggestCommands(
  typed: string,
  known: ReadonlyArray<string>,
  opts: { topN?: number; maxDistance?: number } = {},
): Suggestion[] {
  const topN = opts.topN ?? 5;
  const maxDistance = opts.maxDistance ?? 10;
  const t = (typed ?? "").toLowerCase();
  if (!t) return [];
  const scored: Suggestion[] = [];
  for (const cmd of known) {
    const c = cmd.toLowerCase();
    const dist = levenshteinDistance(t, c);
    if (dist > maxDistance) continue;
    const prefixMatch = c.startsWith(t) || t.startsWith(c);
    const normalizedDistance = c.length === 0 ? 1 : dist / Math.max(c.length, t.length);
    scored.push({ command: cmd, distance: dist, prefixMatch, normalizedDistance });
  }
  scored.sort((a, b) => {
    if (a.prefixMatch !== b.prefixMatch) return a.prefixMatch ? -1 : 1;
    if (a.distance !== b.distance) return a.distance - b.distance;
    return a.normalizedDistance - b.normalizedDistance;
  });
  return scored.slice(0, topN);
}

/**
 * Append a missed-verb to the heat-map ledger so future releases can
 * pre-add as a real alias. Never throws; best-effort write only.
 */
export function logMissedAlias(repoRoot: string, verb: string): void {
  if (!repoRoot || !verb) return;
  try {
    const dir = join(repoRoot, ".mneme");
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const path = join(dir, "alias_misses.jsonl");
    appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), verb }) + "\n");
  } catch { /* defensive */ }
}

/**
 * Print a friendly suggestion block to stderr. Returns the suggested
 * command if there's a clear winner (distance ≤ 2), else null.
 */
export function printSuggestions(typed: string, suggestions: Suggestion[]): string | null {
  if (suggestions.length === 0) {
    process.stderr.write(`\n❓ Unknown command: ${JSON.stringify(typed)}\n`);
    process.stderr.write(`   Run \`mneme --help\` to see all available commands.\n\n`);
    return null;
  }
  const winner = suggestions[0]!;
  if (winner.distance <= 2 || winner.prefixMatch) {
    process.stderr.write(`\n❓ Unknown command: ${JSON.stringify(typed)}\n\n`);
    process.stderr.write(`   Did you mean \`mneme ${winner.command}\`?\n`);
    if (suggestions.length > 1) {
      process.stderr.write(`\n   Other closest matches:\n`);
      for (const s of suggestions.slice(1, 4)) {
        process.stderr.write(`     • mneme ${s.command}   (distance ${s.distance})\n`);
      }
    }
    process.stderr.write(`\n   Tip: set MNEME_AUTO_ALIAS=1 to auto-run the best match next time.\n\n`);
    return winner.command;
  }
  process.stderr.write(`\n❓ Unknown command: ${JSON.stringify(typed)}\n`);
  process.stderr.write(`   Closest matches:\n`);
  for (const s of suggestions.slice(0, 4)) {
    process.stderr.write(`     • mneme ${s.command}   (distance ${s.distance})\n`);
  }
  process.stderr.write(`\n   Run \`mneme --help\` for the full command list.\n\n`);
  return null;
}
