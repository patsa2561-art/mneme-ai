/**
 * v2.30.0 — Git-commit artifact source for HONEST MIRROR.
 *
 * The primary source. Why git commits work so well:
 *   - commit message = the user's NATURAL prompt ("fix typo in
 *     bridge_hardening.test.ts", "refactor BFT to per-route caps")
 *   - the diff = the ACCEPTED ANSWER (whatever shipped is what worked)
 *   - 100% real workplace artifacts — no consent issue, no training-set
 *     contamination, no synthetic shape
 *   - timestamps + author + file context all preserved
 *   - universally available — every repo has commits
 *
 * Implementation: lightweight git log + show invocations. No external
 * library; no dependency on Mneme's existing git helper (so this works
 * even in degraded runtime mode).
 */

import { spawnSync } from "node:child_process";
import type { RealArtifact, AcceptedAnswer } from "../types.js";

interface GitCommit {
  sha: string;
  at: string;
  author: string;
  subject: string;
  body: string;
}

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 15_000, maxBuffer: 4 * 1024 * 1024 });
  if (r.status !== 0) return "";
  return r.stdout ?? "";
}

function listCommits(cwd: string, max: number): GitCommit[] {
  // Use unit separator (US, \x1f) between fields + record separator (RS, \x1e) between rows.
  const FS = "\x1f";
  const RS = "\x1e";
  const fmt = `%H${FS}%aI${FS}%an${FS}%s${FS}%b${RS}`;
  const raw = git(cwd, ["log", `-${Math.max(1, Math.min(1000, max))}`, `--pretty=format:${fmt}`]);
  if (!raw) return [];
  const out: GitCommit[] = [];
  for (const row of raw.split(RS)) {
    const r = row.trim();
    if (!r) continue;
    const parts = r.split(FS);
    if (parts.length < 4) continue;
    out.push({
      sha: parts[0]!,
      at: parts[1]!,
      author: parts[2]!,
      subject: parts[3]!,
      body: parts[4] ?? "",
    });
  }
  return out;
}

function getDiff(cwd: string, sha: string, maxBytes = 8000): string {
  const raw = git(cwd, ["show", "--no-color", "--stat", "--patch", sha]);
  return raw.slice(0, maxBytes);
}

/**
 * Sample N commits deterministically by seed. Returns artifacts +
 * matched accepted answers.
 *
 * Skips commits whose subject starts with "chore(release)" /
 * "Merge " / "Revert " — those aren't real engineering prompts.
 */
export function sampleArtifacts(cwd: string, count: number, seed: number): Array<{ artifact: RealArtifact; accepted: AcceptedAnswer }> {
  const pool = listCommits(cwd, count * 4 + 20)
    .filter((c) => !/^(chore\(release\)|Merge |Revert )/i.test(c.subject))
    .filter((c) => c.subject.length >= 20);
  if (pool.length === 0) return [];

  // Deterministic sample by seed: rotate + step.
  const step = Math.max(1, Math.floor(pool.length / count));
  const start = seed % pool.length;
  const picked: GitCommit[] = [];
  const seen = new Set<number>();
  let i = start;
  while (picked.length < Math.min(count, pool.length)) {
    if (!seen.has(i)) { picked.push(pool[i]!); seen.add(i); }
    i = (i + step) % pool.length;
    if (seen.size === pool.length) break;
  }

  return picked.map((c) => {
    const prompt = (c.body && c.body.length > 30)
      ? `${c.subject}\n\n${c.body}`.slice(0, 2000)
      : c.subject;
    const diff = getDiff(cwd, c.sha);
    return {
      artifact: {
        id: c.sha.slice(0, 12),
        source: "git_commit" as const,
        at: c.at,
        prompt,
        context: undefined,
        originalVendor: undefined,
      },
      accepted: {
        text: diff,
        kind: "commit_diff" as const,
      },
    };
  });
}

export function gitSourceAvailable(cwd: string): boolean {
  return git(cwd, ["rev-parse", "--is-inside-work-tree"]).trim() === "true";
}
