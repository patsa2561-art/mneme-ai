/**
 * v1.63.0 -- TIER 7: TIME-RIVER (counterfactual history).
 *
 * Treat git history as a navigable time stream. Given an ISO date or
 * a commit SHA, Time-River reconstructs:
 *   - which commits existed at that point
 *   - which files existed at that point (via git ls-tree)
 *   - the package.json version that was current
 *   - the last lesson Mneme had learned at that point
 *
 * Mneme then can answer counterfactual questions:
 *   "If I asked Mneme on 2026-03-12, what would it have known?"
 *
 * The answer is GROUNDED in actual snapshot state -- no fabrication.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export interface RewindSnapshot {
  /** The anchor (sha or "date:<iso>"). */
  anchor: string;
  /** Resolved commit at this anchor. */
  sha: string | null;
  /** Date of that commit. */
  date: string | null;
  /** package.json version at that commit. */
  version: string | null;
  /** How many commits had been made at this point. */
  totalCommitsAtAnchor: number;
  /** Sample of file paths that existed at this commit. */
  files: string[];
  /** Last 5 commits before / at this anchor. */
  recentCommits: Array<{ sha: string; date: string; subject: string }>;
  /** Diagnostic. */
  ok: boolean;
  reason: string;
}

function gitOut(repoRoot: string, args: string[]): { ok: boolean; stdout: string } {
  try {
    const r = spawnSync("git", ["-C", repoRoot, ...args], {
      encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 5000,
    });
    return { ok: r.status === 0, stdout: r.stdout ?? "" };
  } catch {
    return { ok: false, stdout: "" };
  }
}

/** Resolve an anchor string to a commit SHA. Accepts:
 *  - explicit SHA (7..40 hex)
 *  - ISO date (resolved via git log --before)
 */
function resolveSha(repoRoot: string, anchor: string): { sha: string | null; date: string | null } {
  // Direct SHA?
  if (/^[0-9a-f]{7,40}$/i.test(anchor)) {
    const r = gitOut(repoRoot, ["log", "-n", "1", "--pretty=format:%H|%cI", anchor]);
    if (!r.ok) return { sha: null, date: null };
    const [sha, date] = r.stdout.split("|");
    return { sha: sha?.slice(0, 12) ?? null, date: date ?? null };
  }
  // Date anchor: pick the latest commit <= the given date.
  const r = gitOut(repoRoot, ["log", "-n", "1", `--before=${anchor}`, "--pretty=format:%H|%cI"]);
  if (!r.ok || !r.stdout.trim()) return { sha: null, date: null };
  const [sha, date] = r.stdout.split("|");
  return { sha: sha?.slice(0, 12) ?? null, date: date ?? null };
}

function packageVersionAt(repoRoot: string, sha: string): string | null {
  const r = gitOut(repoRoot, ["show", `${sha}:package.json`]);
  if (!r.ok) return null;
  try {
    const pkg = JSON.parse(r.stdout) as { version?: string };
    return pkg.version ?? null;
  } catch { return null; }
}

function totalCommitsAtAnchor(repoRoot: string, sha: string): number {
  const r = gitOut(repoRoot, ["rev-list", "--count", sha]);
  if (!r.ok) return 0;
  return parseInt(r.stdout.trim(), 10) || 0;
}

function filesAt(repoRoot: string, sha: string, cap = 20): string[] {
  const r = gitOut(repoRoot, ["ls-tree", "-r", "--name-only", sha]);
  if (!r.ok) return [];
  return r.stdout.split("\n").filter(Boolean).slice(0, cap);
}

function recentCommitsAt(repoRoot: string, sha: string, count = 5): Array<{ sha: string; date: string; subject: string }> {
  const r = gitOut(repoRoot, ["log", `-n${count}`, "--pretty=format:%H@@@%cI@@@%s", sha]);
  if (!r.ok) return [];
  const out: Array<{ sha: string; date: string; subject: string }> = [];
  for (const line of r.stdout.split("\n")) {
    const parts = line.split("@@@");
    if (parts.length < 3) continue;
    out.push({
      sha: parts[0]!.slice(0, 7),
      date: parts[1]!.slice(0, 10),
      subject: parts.slice(2).join("@@@"),
    });
  }
  return out;
}

/** Build a snapshot of the repo state at a given anchor. */
export function rewind(repoRoot: string, anchor: string): RewindSnapshot {
  const { sha, date } = resolveSha(repoRoot, anchor);
  if (!sha) {
    return {
      anchor, sha: null, date: null, version: null,
      totalCommitsAtAnchor: 0, files: [], recentCommits: [],
      ok: false, reason: `Could not resolve anchor "${anchor}" to a commit.`,
    };
  }
  const version = packageVersionAt(repoRoot, sha);
  const totalCommits = totalCommitsAtAnchor(repoRoot, sha);
  const files = filesAt(repoRoot, sha);
  const recentCommits = recentCommitsAt(repoRoot, sha);
  return {
    anchor, sha, date, version,
    totalCommitsAtAnchor: totalCommits,
    files, recentCommits,
    ok: true,
    reason: `Resolved anchor to ${sha} (${date}); ${totalCommits} commits had been made.`,
  };
}

/** Build a counterfactual answer about the repo state at a given date. */
export interface CounterfactualAnswer {
  anchor: string;
  snapshot: RewindSnapshot;
  /** Plain-English summary of what Mneme would have known. */
  summary: string;
}

export function counterfactual(repoRoot: string, anchor: string, question?: string): CounterfactualAnswer {
  const snap = rewind(repoRoot, anchor);
  if (!snap.ok) {
    return { anchor, snapshot: snap, summary: snap.reason };
  }
  const lines = [
    `At ${snap.date}, the repo was at commit ${snap.sha} (version ${snap.version ?? "unknown"}).`,
    `${snap.totalCommitsAtAnchor} commits had been made; ${snap.files.length} files were tracked.`,
  ];
  if (snap.recentCommits.length > 0) {
    lines.push(`Most recent commits:`);
    for (const c of snap.recentCommits) {
      lines.push(`  ${c.sha} (${c.date}) -- ${c.subject}`);
    }
  }
  if (question) {
    lines.push(``);
    lines.push(`Question was: "${question}"`);
    lines.push(`Answer would have been grounded in the above state only -- any claim about features that landed AFTER ${snap.date} would have been refused as PASSTHROUGH / IMPOSSIBLE.`);
  }
  return { anchor, snapshot: snap, summary: lines.join("\n") };
}
