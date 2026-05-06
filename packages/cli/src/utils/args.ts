/**
 * Argument parsing + validation helpers for CLI commands.
 *
 * The goal: turn every malformed user input into a CLEAR, actionable error
 * message — never let raw `git log` errors or `NaN` leak to the user.
 *
 * v0.19.2: built after a real audit found that `--top abc` crashed with
 * `fatal: 'NaN': not an integer` (leaking internal git command), and
 * `forensics match deadbeef` produced "EXTREMELY STRONG SUPPORT AGAINST"
 * the actual author because the commit didn't exist.
 */
import { execSync } from "node:child_process";

/** Strict positive-integer parser for commander option callbacks.
 *  Throws a friendly error string if the value is not a positive integer. */
export function parseIntStrict(name: string, min = 1): (v: string) => number {
  return (v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) {
      // commander wraps this in: error: option '--top <n>': <message>
      throw new Error(`'${v}' is not a positive integer (min ${min})`);
    }
    return n;
  };
}

/** Strict non-negative-float parser for `--threshold` etc. */
export function parseFloatStrict(name: string, min = 0): (v: string) => number {
  return (v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min) {
      throw new Error(`'${v}' is not a number ≥ ${min}`);
    }
    return n;
  };
}

/** Validate `--since` accepts: ISO date (2024-01-01), relative ('7d', '1mo', '3y'),
 *  or named ('yesterday', 'last week'). Pass-through is fine — git resolves these.
 *  Reject only obvious garbage that git won't understand. */
export function parseSinceDate(v: string): string {
  const trimmed = v.trim();
  if (!trimmed) throw new Error(`--since cannot be empty`);
  // Git accepts ISO dates, relative (7d / 2.weeks / yesterday), and human dates.
  // Cheap check: must contain at least one digit OR a known time keyword.
  const hasDigit = /\d/.test(trimmed);
  const namedKeyword = /^(yesterday|today|now|last\s+(week|month|year)|recent)/i.test(
    trimmed,
  );
  if (!hasDigit && !namedKeyword) {
    throw new Error(
      `'${v}' is not a date. Examples: 2024-01-01, 7d, 2.weeks.ago, yesterday, "last month"`,
    );
  }
  return trimmed;
}

/** Resolve any git ref (HEAD, HEAD~3, branch, short hash) to a full 40-char hash.
 *  Returns null if unresolvable. Synchronous (uses execSync) — fine for CLI. */
export function resolveCommitRef(cwd: string, ref: string): string | null {
  try {
    const out = execSync(`git rev-parse --verify "${ref}^{commit}"`, {
      cwd,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    });
    const hash = out.trim();
    return /^[a-f0-9]{40}$/.test(hash) ? hash : null;
  } catch {
    return null;
  }
}

/** Format a "could not find commit X" error with concrete remedies. */
export function commitNotFoundMessage(ref: string): string {
  return [
    `Commit '${ref}' not found in the repo.`,
    ``,
    `Try:`,
    `  • git log --oneline | head           ← see recent commit hashes`,
    `  • mneme index                         ← if commit is new and not indexed`,
    `  • mneme forensics attribute HEAD      ← analyze the latest commit instead`,
  ].join("\n");
}
