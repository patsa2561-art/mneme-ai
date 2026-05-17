/**
 * v2.19.38 — MNEME MAYOR AUTO-VOTE (Socket #4 — git commit trailer → auto-vote)
 *
 *   v2.19.37 MAYOR ELECTION shipped the ledger + tally. v2.19.38 ships
 *   the AUTO-VOTE: parse `git log` output for AI vendor trailers
 *   ("Co-Authored-By: Claude <noreply@anthropic.com>" / "AI-Generated-By:
 *   gpt" / etc) and auto-record a vote per commit. Plus IDE status-bar
 *   text generator so user sees "Mayor: claude" without leaving editor.
 *
 *   Wired into post-commit git hook (caller installs hook; this module
 *   does the parse + vote).
 *
 *   Composes onto:
 *     - v2.19.37 MAYOR ELECTION (recordVote primitive)
 *     - v2.19.34 OUTCOME MARKET (reputation signal source)
 *     - v2.19.34 ZK FAIRNESS (fairness signal source)
 *
 * Honest scope:
 *   - PURE FUNCTION parser + vote builder + status-line. Caller does git I/O.
 *   - Detects 9+ canonical trailer formats.
 *   - Defensive: empty / garbage commit message → no vote (returns null).
 *   - 25+ tests + 1000-iter fuzz.
 */

import { recordVote, type ElectionState, type Vote } from "../mayor_election/index.js";

const PROTOCOL_VERSION = 1 as const;

/**
 * Canonical vendor trailers we recognise. Add more by PR.
 * Format: regex matches a commit-message line; capture group 1 = raw label;
 * we then normalise to a lowercase vendor id.
 */
const TRAILER_PATTERNS: ReadonlyArray<{ vendor: string; re: RegExp }> = Object.freeze([
  // Claude Code default trailer
  { vendor: "claude",  re: /^Co-Authored-By:\s*Claude(?:\s+\(.+?\))?\s*<noreply@anthropic\.com>/im },
  // Generic Claude
  { vendor: "claude",  re: /^(?:AI-)?Co-Authored-By:\s*Claude\b/im },
  { vendor: "claude",  re: /^AI-Generated-By:\s*claude\b/im },
  // GPT / OpenAI
  { vendor: "gpt",     re: /^Co-Authored-By:\s*(?:ChatGPT|GPT-?\d?(?:\.\d+)?)\b/im },
  { vendor: "gpt",     re: /^AI-Generated-By:\s*(?:gpt|openai)\b/im },
  // Gemini / Google
  { vendor: "gemini",  re: /^Co-Authored-By:\s*Gemini\b/im },
  { vendor: "gemini",  re: /^AI-Generated-By:\s*gemini\b/im },
  { vendor: "gemini",  re: /^Co-Authored-By:\s*Bard\b/im },
  // Grok / xAI
  { vendor: "grok",    re: /^Co-Authored-By:\s*Grok\b/im },
  { vendor: "grok",    re: /^AI-Generated-By:\s*grok\b/im },
  // Copilot
  { vendor: "copilot", re: /^Co-Authored-By:\s*Copilot\b/im },
  { vendor: "copilot", re: /^AI-Generated-By:\s*copilot\b/im },
  // Cursor
  { vendor: "cursor",  re: /^Co-Authored-By:\s*Cursor\b/im },
  // Aider
  { vendor: "aider",   re: /^Co-Authored-By:\s*Aider\b/im },
  // Codeium / Windsurf
  { vendor: "codeium", re: /^Co-Authored-By:\s*(?:Codeium|Windsurf)\b/im },
  // Generic catch-all fallback
  { vendor: "unknown", re: /^AI-Generated-By:\s*([a-z0-9_.-]+)\b/im },
]);

/**
 * Detect AI vendor from a commit message. Returns null if no recognised
 * AI trailer is present (human-only commits don't vote).
 */
export function detectVendorFromCommit(commitMessage: string): string | null {
  if (typeof commitMessage !== "string" || commitMessage.length === 0) return null;
  for (const p of TRAILER_PATTERNS) {
    const m = commitMessage.match(p.re);
    if (m) {
      // Fallback pattern captures the label
      if (p.vendor === "unknown" && m[1]) {
        const label = m[1].toLowerCase();
        if (/^[a-z0-9_.-]+$/.test(label)) return label;
      }
      return p.vendor;
    }
  }
  return null;
}

// ─── AUTO-VOTE ──────────────────────────────────────────────────────

export interface AutoVoteInput {
  state: ElectionState;
  commitMessage: string;
  commitSha?: string;
  castAtMs?: number;
  secret?: string;
}

export interface AutoVoteResult {
  state: ElectionState;
  vote: Vote | null;
  detectedVendor: string | null;
  reason: string;
}

/**
 * Parse commit → detect vendor → cast vote. Idempotent if caller passes
 * the same commitSha twice (the vote ledger contains commitSha).
 */
export function autoVoteFromCommit(input: AutoVoteInput): AutoVoteResult {
  const vendor = detectVendorFromCommit(input.commitMessage);
  if (vendor === null) {
    return { state: input.state, vote: null, detectedVendor: null, reason: "no AI trailer detected in commit message" };
  }
  // Dedupe via commitSha if supplied — don't double-vote the same commit
  if (input.commitSha) {
    const dup = input.state.votes.find((v) => v.commitSha === input.commitSha);
    if (dup) {
      return { state: input.state, vote: null, detectedVendor: vendor, reason: `commit ${input.commitSha.slice(0, 8)} already voted (dedupe)` };
    }
  }
  const r = recordVote({
    state: input.state, vendor,
    commitSha: input.commitSha,
    castAtMs: input.castAtMs,
    secret: input.secret,
  });
  return {
    state: r.state,
    vote: r.vote,
    detectedVendor: vendor,
    reason: r.vote ? `auto-voted ${vendor} for commit ${input.commitSha?.slice(0, 8) ?? "?"}` : (r.reason ?? "vote rejected"),
  };
}

// ─── BATCH: ingest N commits at once (from `git log`) ──────────────

export interface CommitInput {
  sha: string;
  message: string;
  /** ISO date or ms epoch. */
  authorDate?: string | number;
}

export function autoVoteBatch(input: {
  state: ElectionState;
  commits: CommitInput[];
  secret?: string;
}): { state: ElectionState; votesCast: number; commitsSkipped: number; breakdown: Record<string, number> } {
  let state = input.state;
  let votesCast = 0, skipped = 0;
  const breakdown: Record<string, number> = {};
  for (const c of input.commits ?? []) {
    if (!c || typeof c.message !== "string") { skipped++; continue; }
    const ms = typeof c.authorDate === "number" ? c.authorDate
      : (typeof c.authorDate === "string" ? Date.parse(c.authorDate) : Date.now());
    const result = autoVoteFromCommit({
      state, commitMessage: c.message, commitSha: c.sha,
      castAtMs: Number.isFinite(ms) ? ms : Date.now(),
      secret: input.secret,
    });
    state = result.state;
    if (result.vote) {
      votesCast++;
      breakdown[result.detectedVendor!] = (breakdown[result.detectedVendor!] ?? 0) + 1;
    } else {
      skipped++;
    }
  }
  return { state, votesCast, commitsSkipped: skipped, breakdown };
}

// ─── GIT-HOOK SCRIPT GENERATOR (caller installs this) ──────────────

/**
 * Emit a portable post-commit hook script that calls `mneme mayor vote`
 * with the trailer-detected vendor. Caller writes to `.git/hooks/post-commit`
 * + chmod +x. No external deps.
 */
export function generatePostCommitHook(): string {
  return `#!/usr/bin/env bash
# v2.19.38 — Mneme MAYOR auto-vote post-commit hook.
# Installed by 'mneme mayor install-hook'. Idempotent — safe to re-install.
# Reads the latest commit's message; if it has a recognised AI trailer
# (Co-Authored-By: Claude / AI-Generated-By: gpt / etc), records a vote.
set -e
SHA=$(git rev-parse HEAD 2>/dev/null) || exit 0
MSG=$(git log -1 --format=%B HEAD 2>/dev/null) || exit 0
# Best-effort, non-blocking: if mneme isn't installed or daemon is off, no harm.
if command -v mneme >/dev/null 2>&1; then
  mneme mayor auto_vote_from_commit --json "{\\"commitSha\\":\\"$SHA\\",\\"commitMessage\\":$(printf '%s' "$MSG" | jq -Rs .)}" >/dev/null 2>&1 || true
fi
`;
}

/**
 * Emit a powershell equivalent for Windows users (post-commit hook).
 */
export function generatePostCommitHookPwsh(): string {
  return `# v2.19.38 — Mneme MAYOR auto-vote post-commit hook (PowerShell).
# Installed by 'mneme mayor install-hook'. Idempotent.
$ErrorActionPreference = "SilentlyContinue"
$sha = git rev-parse HEAD
$msg = git log -1 --format=%B HEAD
if (Get-Command mneme -ErrorAction SilentlyContinue) {
  $payload = @{ commitSha = "$sha"; commitMessage = "$msg" } | ConvertTo-Json -Compress
  mneme mayor auto_vote_from_commit --json $payload 2>&1 | Out-Null
}
`;
}

// ─── STATUS LINE for IDE plugin ────────────────────────────────────

export interface StatusLineInput {
  /** Latest election result (mid-term or final). */
  winnerVendor: string | null;
  winnerVoteCount: number;
  runnerUpVendor?: string | null;
  runnerUpVoteCount?: number;
  marginPct?: number;
  termRemainingMs?: number;
}

export function generateStatusLine(input: StatusLineInput): string {
  if (!input.winnerVendor) return "👑 Mayor: (no votes — cast one to elect)";
  const winner = `${input.winnerVendor} ${input.winnerVoteCount}`;
  const ru = input.runnerUpVendor ? ` vs ${input.runnerUpVendor} ${input.runnerUpVoteCount}` : "";
  let term = "";
  if (typeof input.termRemainingMs === "number" && input.termRemainingMs > 0) {
    const days = Math.floor(input.termRemainingMs / (24 * 3600_000));
    term = ` · ${days}d left`;
  }
  return `👑 Mayor: ${winner}${ru}${term}`;
}

export interface AutoVoteStats {
  totalCommitsProcessed: number;
  votesCast: number;
  skipped: number;
  vendorBreakdown: Record<string, number>;
}

export function computeAutoVoteStats(results: AutoVoteResult[]): AutoVoteStats {
  let cast = 0, skipped = 0;
  const breakdown: Record<string, number> = {};
  for (const r of results) {
    if (r.vote) {
      cast++;
      if (r.detectedVendor) breakdown[r.detectedVendor] = (breakdown[r.detectedVendor] ?? 0) + 1;
    } else skipped++;
  }
  return { totalCommitsProcessed: results.length, votesCast: cast, skipped, vendorBreakdown: breakdown };
}

export function formatAutoVoteLine(s: AutoVoteStats): string {
  return `👑 AUTO-VOTE · ${s.votesCast} cast / ${s.skipped} skipped · ${Object.keys(s.vendorBreakdown).length} vendors`;
}

export const MAYOR_AUTO_VOTE_TUNABLES = Object.freeze({
  PROTOCOL_VERSION,
  RECOGNISED_VENDORS: ["claude", "gpt", "gemini", "grok", "copilot", "cursor", "aider", "codeium"] as ReadonlyArray<string>,
  TRAILER_PATTERN_COUNT: TRAILER_PATTERNS.length,
});
