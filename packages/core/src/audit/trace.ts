/**
 * AI Session Audit — TRACE module.
 *
 * Given a baseline HEAD hash, find every commit that landed since (the
 * "AI session"), aggregate the diff, and detect which commits were
 * AI-authored and by which vendor.
 *
 * Vendor detection is heuristic and intentionally conservative — we
 * never block on a guess, only annotate.  The signals we use:
 *   - commit-message regex  ("Co-Authored-By: Claude", "[Cursor]", ...)
 *   - author/email patterns  (noreply@anthropic.com, cursor.sh, ...)
 *
 * All process I/O flows through a `GitRunner` interface so tests can
 * replay canned commit logs.
 */

import { execFileSync } from "node:child_process";

/** A single AI-vendor detection rule. */
export interface VendorRule {
  vendor: string;
  /** If a regex matches the commit message, attribute to `vendor`. */
  messageRe?: RegExp;
  /** If a regex matches the author email, attribute to `vendor`. */
  emailRe?: RegExp;
  /** Confidence in [0, 1]; combined as max across matching rules. */
  confidence: number;
}

/**
 * Default rule set.  Order doesn't matter — we score every rule against
 * every commit and take the maximum confidence per vendor.
 */
export const DEFAULT_VENDOR_RULES: VendorRule[] = [
  { vendor: "claude", messageRe: /Co-Authored-By:\s*Claude/i, confidence: 0.95 },
  { vendor: "claude", emailRe: /noreply@anthropic\.com$/i, confidence: 0.95 },
  { vendor: "cursor", messageRe: /\[Cursor\]/, confidence: 0.9 },
  { vendor: "cursor", emailRe: /noreply@cursor\.(sh|com)$/i, confidence: 0.9 },
  { vendor: "codex", messageRe: /Generated\s+by\s+Codex/i, confidence: 0.9 },
  { vendor: "codex", messageRe: /Co-Authored-By:\s*ChatGPT/i, confidence: 0.85 },
  { vendor: "devin", messageRe: /devin\.ai/i, confidence: 0.9 },
  { vendor: "devin", emailRe: /@devin\.ai$/i, confidence: 0.9 },
  { vendor: "sweep", messageRe: /sweep\.dev/i, confidence: 0.85 },
  { vendor: "sweep", emailRe: /@sweep\.dev$/i, confidence: 0.85 },
  { vendor: "aider", messageRe: /\baider\b/i, confidence: 0.7 },
  { vendor: "copilot", messageRe: /Co-Authored-By:\s*GitHub Copilot/i, confidence: 0.9 },
];

export interface AuditCommit {
  hash: string;
  shortHash: string;
  author: string;
  authorEmail: string;
  message: string;
  /** Vendor + confidence; `undefined` means "human (or undetected AI)". */
  likelyAI?: { vendor: string; confidence: number };
}

export interface SessionTrace {
  fromHash: string;
  toHash: string;
  commits: AuditCommit[];
  filesChanged: string[];
  insertions: number;
  deletions: number;
}

/** Test seam — every git invocation goes through this. */
export interface GitRunner {
  /** Run `git <args>` in `cwd`; return stdout (empty string on failure). */
  run(cwd: string, args: string[]): string;
}

export const realGitRunner: GitRunner = {
  run(cwd, args) {
    try {
      return execFileSync("git", args, {
        cwd,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 64 * 1024 * 1024,
      });
    } catch {
      return "";
    }
  },
};

/** Sentinel separator we ask git to emit between commit blocks. */
export const COMMIT_SEP = "<<<MNEME-AUDIT-COMMIT-SEP>>>";

/**
 * Detect AI vendor for a single commit.
 *
 * Returns the vendor with the highest confidence, or `undefined` if no
 * rule matched.  Ties are broken by alphabetical vendor name (stable).
 */
export function detectAiVendor(
  commit: { message: string; authorEmail: string },
  rules: VendorRule[] = DEFAULT_VENDOR_RULES,
): { vendor: string; confidence: number } | undefined {
  let bestVendor: string | undefined;
  let bestConfidence = -1;
  for (const r of rules) {
    let matched = false;
    if (r.messageRe && r.messageRe.test(commit.message)) matched = true;
    if (r.emailRe && r.emailRe.test(commit.authorEmail)) matched = true;
    if (!matched) continue;
    if (
      r.confidence > bestConfidence ||
      (r.confidence === bestConfidence && (bestVendor ?? "z") > r.vendor)
    ) {
      bestVendor = r.vendor;
      bestConfidence = r.confidence;
    }
  }
  return bestVendor ? { vendor: bestVendor, confidence: bestConfidence } : undefined;
}

/**
 * Trace the session — every commit between `baselineHeadHash` and HEAD.
 */
export async function traceSession(
  repoRoot: string,
  baselineHeadHash: string,
  runner: GitRunner = realGitRunner,
): Promise<SessionTrace> {
  const headOut = runner.run(repoRoot, ["rev-parse", "HEAD"]);
  const toHash = headOut.trim() || baselineHeadHash;

  if (toHash === baselineHeadHash) {
    return {
      fromHash: baselineHeadHash,
      toHash,
      commits: [],
      filesChanged: [],
      insertions: 0,
      deletions: 0,
    };
  }

  const range = `${baselineHeadHash}..HEAD`;
  // Header (TAB-separated) on line 1, commit body follows, separator marks end.
  const fmt = `--pretty=format:%H%x09%an%x09%ae%x09%s%n%b%n${COMMIT_SEP}`;
  const logRaw = runner.run(repoRoot, ["log", range, fmt]);
  const commits = parseCommitLog(logRaw);

  const shortstat = runner.run(repoRoot, ["diff", "--shortstat", range]);
  const { insertions, deletions } = parseShortstat(shortstat);

  const namesOut = runner.run(repoRoot, ["diff", "--name-only", range]);
  const filesChanged = [
    ...new Set(
      namesOut
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0),
    ),
  ];

  return {
    fromHash: baselineHeadHash,
    toHash,
    commits,
    filesChanged,
    insertions,
    deletions,
  };
}

// ─── Parsers (exported for tests) ───────────────────────────────────

export function parseCommitLog(raw: string): AuditCommit[] {
  if (!raw) return [];
  const out: AuditCommit[] = [];
  for (const block of raw.split(COMMIT_SEP)) {
    const trimmed = block.replace(/^\s+/, "").replace(/\s+$/, "");
    if (!trimmed) continue;
    const firstNl = trimmed.indexOf("\n");
    const headerLine = firstNl >= 0 ? trimmed.slice(0, firstNl) : trimmed;
    const body = firstNl >= 0 ? trimmed.slice(firstNl + 1) : "";
    const parts = headerLine.split("\t");
    if (parts.length < 4) continue;
    const [hash, author, email, subject] = parts;
    if (!hash || !author || !email) continue;
    const fullMessage = body ? `${subject}\n${body}` : (subject ?? "");
    const ai = detectAiVendor({ message: fullMessage, authorEmail: email });
    out.push({
      hash,
      shortHash: hash.slice(0, 7),
      author,
      authorEmail: email,
      message: fullMessage,
      likelyAI: ai,
    });
  }
  return out;
}

export function parseShortstat(s: string): { insertions: number; deletions: number } {
  if (!s) return { insertions: 0, deletions: 0 };
  const ins = s.match(/(\d+)\s+insertion/);
  const del = s.match(/(\d+)\s+deletion/);
  return {
    insertions: ins ? Number(ins[1]) : 0,
    deletions: del ? Number(del[1]) : 0,
  };
}

/** Convenience: how many commits in the trace look AI-authored. */
export function aiCommitCount(trace: SessionTrace): number {
  return trace.commits.filter((c) => !!c.likelyAI).length;
}

/** Distinct vendors observed (sorted by descending count, then name). */
export function aiVendorBreakdown(trace: SessionTrace): Array<{ vendor: string; count: number }> {
  const map = new Map<string, number>();
  for (const c of trace.commits) {
    if (!c.likelyAI) continue;
    map.set(c.likelyAI.vendor, (map.get(c.likelyAI.vendor) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([vendor, count]) => ({ vendor, count }))
    .sort((a, b) => b.count - a.count || a.vendor.localeCompare(b.vendor));
}
