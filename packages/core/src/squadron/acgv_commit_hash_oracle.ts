/**
 * v2.34.0 — ACGV Layer 0c: COMMIT-HASH ORACLE.
 *
 * Closes regression-card bug NEW3:
 *
 *   "Hallucination POC: commit a1b2c3d4 fixed the auth bug"
 *
 *   Pre-v2.34 verdict: NONE (verifier had no path to check commit hashes)
 *   Post-v2.34 verdict: REFUTED — caveat
 *                       "FAKE_COMMIT_HASH:a1b2c3d4 not in git log"
 *
 * Why this matters: vendor hallucinations CONSTANTLY cite fake commit
 * SHAs. Mneme sits inside the user's repo with `git cat-file` available
 * — there's no excuse for trusting any AI's commit citations without
 * a lookup. This is the #1 paper-grade demo of the entire library.
 *
 * The oracle is git-only; no network call. It works offline. It runs
 * BEFORE the expensive Chandrasekhar/Godel pipeline so a fake-hash
 * claim short-circuits in <50ms even on a 200K-commit repo.
 */

import { spawnSync } from "node:child_process";

export interface CommitHashMatch {
  /** The literal hash-shaped substring from the claim (7-40 hex chars). */
  hash: string;
  /** Whether `git cat-file -e <hash>` resolved (true) or not (false). */
  exists: boolean;
  /** First line of git show summary when exists=true. */
  summary?: string;
  /** Position in the original claim. */
  index: number;
}

export interface HashOracleVerdict {
  /** Did the oracle find ANY hash-shaped substring? */
  scanned: boolean;
  /** All hashes detected (existing + missing). */
  matches: CommitHashMatch[];
  /** Any hashes that DIDN'T resolve? If yes the claim is suspect. */
  hasFakeHash: boolean;
  /** Plain-English explanation. */
  reason: string;
  /** Vaccine signature for emit. */
  vaccineSignature: string;
}

/**
 * Hash-shape regex: 7-40 lowercase hex chars NOT preceded/followed by
 * another hex char (so we don't false-positive on giant hex blobs).
 *
 * Word-boundary trick: `(?<![a-f0-9])` requires the preceding char (if
 * any) to be a non-hex. Same on the right side. Avoids matching the
 * middle of a SHA-256 token like `dead...beef`.
 */
const HASH_RX = /(?<![a-f0-9])([a-f0-9]{7,40})(?![a-f0-9])/gi;

function git(cwd: string, args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 5_000, maxBuffer: 4 * 1024 * 1024 });
  if (r.status !== 0) return "";
  return r.stdout ?? "";
}

function isGitRepo(cwd: string): boolean {
  const r = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { cwd, encoding: "utf8", timeout: 2_000 });
  return r.status === 0 && (r.stdout ?? "").trim() === "true";
}

/**
 * Detect commit-hash-shaped substrings in `claim` + check each via git.
 *
 * Returns `{ scanned: false }` when:
 *   - cwd isn't a git repo (oracle is a no-op; not a failure)
 *   - no hash-shaped substring detected
 *
 * Returns `{ scanned: true, hasFakeHash: true|false, matches: [...] }`
 * otherwise. Callers should escalate hasFakeHash to REFUTED.
 */
export function scanCommitHashes(claim: string, cwd: string): HashOracleVerdict {
  const candidates = Array.from(claim.matchAll(HASH_RX));
  if (candidates.length === 0) {
    return {
      scanned: false, matches: [], hasFakeHash: false,
      reason: "no commit-hash-shaped substring in claim",
      vaccineSignature: "",
    };
  }
  if (!isGitRepo(cwd)) {
    return {
      scanned: false, matches: [], hasFakeHash: false,
      reason: "not a git repo — hash oracle skipped",
      vaccineSignature: "",
    };
  }
  // Filter further: strip pure-decimal sequences (those are NOT hex SHAs;
  // they'd be timestamps, port numbers, etc). We require at LEAST one
  // letter a-f in the candidate.
  const matches: CommitHashMatch[] = [];
  for (const m of candidates) {
    const hash = m[1]!;
    if (!/[a-f]/i.test(hash)) continue; // pure decimal — not a SHA
    const exists = git(cwd, ["cat-file", "-e", hash]) !== "" || (() => {
      // cat-file -e returns empty stdout on success; check exit via second probe.
      const r2 = spawnSync("git", ["cat-file", "-e", hash], { cwd, encoding: "utf8", timeout: 2_000 });
      return r2.status === 0;
    })();
    let summary: string | undefined;
    if (exists) {
      const s = git(cwd, ["show", "--no-color", "--no-patch", "--format=%h %s", hash]).trim().split("\n")[0];
      if (s) summary = s;
    }
    matches.push({
      hash, exists,
      ...(summary ? { summary } : {}),
      index: m.index ?? 0,
    });
  }
  if (matches.length === 0) {
    return {
      scanned: false, matches: [], hasFakeHash: false,
      reason: "all hash-shaped candidates were pure decimal — not commit hashes",
      vaccineSignature: "",
    };
  }
  const fakes = matches.filter((m) => !m.exists);
  return {
    scanned: true,
    matches,
    hasFakeHash: fakes.length > 0,
    reason: fakes.length > 0
      ? `${fakes.length} of ${matches.length} hash(es) NOT in git log: ${fakes.map((f) => f.hash).join(", ")}`
      : `${matches.length} hash(es) all resolve in git log`,
    vaccineSignature: fakes.length > 0
      ? `fake_commit_hash :: hashes=${fakes.map((f) => f.hash).join(",")}`
      : "",
  };
}
