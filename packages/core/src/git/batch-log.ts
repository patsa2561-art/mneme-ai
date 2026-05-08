/**
 * Single-spawn `git log -p` parser — the core HPC primitive.
 *
 * ── Why this exists ───────────────────────────────────────────────────
 * The forensics-vulns scanner used to call `git show <hash>` once per
 * commit. On Windows where each spawn costs 50-200ms of fork/exec, a
 * 500-commit scan burned 25-100s in spawn overhead alone — before git
 * did any actual work. One `git log -p -n 500` does the same job in
 * one process with sub-linear per-commit cost (git reuses an open
 * packfile cursor instead of re-mmap'ing per commit).
 *
 * ── Why a sentinel + null-byte separator ──────────────────────────────
 * `git log -p` interleaves commit metadata (in --pretty format) with the
 * unified diff output. The diff text can contain LITERALLY ANYTHING — file
 * paths, code with backticks, hash-like strings. So we need a separator
 * that diff content provably can't contain.
 *
 * Real diffs have these guarantees:
 *   - Lines are LF-separated (no embedded NUL)
 *   - The "Binary files X and Y differ" placeholder has no NUL either
 *   - File paths in `diff --git a/X b/Y` headers are quoted if they
 *     contain control bytes
 *
 * → A NUL byte in the OUTPUT is bulletproof as a field separator. We
 *   ask git to emit it via the `%x00` pretty-format placeholder (NOT a
 *   literal `\x00` in argv — see the Windows note below). We pair it
 *   with a multi-byte sentinel (`<<<MNEME-COMMIT>>>`) at format-start
 *   so we can re-sync if we ever miss a NUL boundary.
 *
 * ── Why `%x00` instead of a literal NUL in argv ───────────────────────
 * Node's child_process.spawn on Windows rejects argv strings that contain
 * a literal NUL byte:
 *
 *   ✗ The argument 'args[3]' must be a string without null bytes.
 *
 * Cause: Windows' CreateProcess takes a single command-line STRING (not
 * an argv array) and a NUL terminates that string. Node enforces the
 * constraint up-front to avoid silent argv truncation. POSIX systems
 * (Linux/macOS) pass argv as a real array and don't have this problem,
 * but the bug surfaced for Windows users running `mneme forensics vulns`.
 *
 * The fix: pass `%x00` (literal four ASCII characters) in argv, and let
 * git substitute it to a real NUL byte in its OUTPUT. Same wire format,
 * no NUL in argv. Documented in `man git-log` under PRETTY FORMATS.
 *
 * ── Output format we emit ─────────────────────────────────────────────
 *   <<<MNEME-COMMIT>>>\x00<hash>\x00<authorISO>\x00<authorName>\x00<authorEmail>\x00<subject>\x00<body>\x00\n
 *   diff --git a/foo b/foo
 *   ...full unified diff...
 *
 * `--pretty=tformat:...` (the `t` prefix) ensures the format applies to
 * EVERY commit including the last, with a trailing newline. Without `t`
 * the last commit lacks a newline and downstream parsers split wrong.
 */
import { execGitOk } from "./exec.js";

export interface CommitWithDiff {
  hash: string;
  authorDate: string; // ISO-8601
  authorName: string;
  authorEmail: string;
  subject: string;
  body: string;
  /** Unified diff body for this commit (multi-file). Empty for first / merge / etc. */
  diff: string;
}

export interface LoadOptions {
  cwd: string;
  /** Cap to the most-recent N commits. 0 = unlimited. */
  maxCommits?: number;
  /** Restrict to commits since this date (any git-parseable form). */
  since?: string;
  /** Restrict to commits matching this path filter. */
  pathPrefix?: string;
  /** Skip merge commits (default true — merge diffs explode in noise). */
  noMerges?: boolean;
  /** Buffer cap forwarded to git subprocess. 1 GB default — security
   *  scans on monorepos can produce massive log+diff streams. */
  maxBuffer?: number;
}

const SENTINEL = "<<<MNEME-COMMIT>>>";
const NUL = "\x00";
/** Git's pretty-format placeholder for a NUL byte. We use this in argv —
 *  NOT a literal NUL — so Windows' CreateProcess accepts the command line.
 *  Git substitutes it for a real NUL in its OUTPUT, which the parser then
 *  splits on. */
const NUL_FMT = "%x00";

function buildArgs(opts: LoadOptions): string[] {
  const args: string[] = [
    "log",
    "-p",
    "-z", // null-byte file-path terminators in diff headers (extra paranoia)
    `--pretty=tformat:${SENTINEL}${NUL_FMT}%H${NUL_FMT}%aI${NUL_FMT}%an${NUL_FMT}%ae${NUL_FMT}%s${NUL_FMT}%b${NUL_FMT}`,
    "--no-color",
  ];
  if (opts.noMerges !== false) args.push("--no-merges");
  if (opts.maxCommits && opts.maxCommits > 0) args.push("-n", String(opts.maxCommits));
  if (opts.since) args.push(`--since=${opts.since}`);
  if (opts.pathPrefix) args.push("--", opts.pathPrefix);
  return args;
}

/**
 * One subprocess. All commits + all diffs. Sub-linear in commit count
 * because git reuses its open packfile cursor.
 */
export async function loadCommitsWithDiffs(opts: LoadOptions): Promise<CommitWithDiff[]> {
  const out = await execGitOk(buildArgs(opts), {
    cwd: opts.cwd,
    maxBuffer: opts.maxBuffer ?? 1024 * 1024 * 1024, // 1 GB
  });
  return parseLogStream(out);
}

/**
 * Parse a `git log -p -z --pretty=...` stream into CommitWithDiff records.
 *
 * Exposed for testing — feed it a fixture string, get parsed records back.
 *
 * The parser is defensive against:
 *   - empty input → []
 *   - trailing whitespace
 *   - missing fields (treated as "")
 *   - sentinel appearing inside diff text (we re-sync at the next valid
 *     SENTINEL+NUL boundary)
 */
export function parseLogStream(raw: string): CommitWithDiff[] {
  if (!raw || raw.length === 0) return [];

  const out: CommitWithDiff[] = [];
  let cursor = 0;
  while (cursor < raw.length) {
    // Find the next sentinel — handles the "we're at the start" case AND
    // the "previous diff just ended" case uniformly.
    const sStart = raw.indexOf(SENTINEL, cursor);
    if (sStart < 0) break;
    cursor = sStart + SENTINEL.length;
    if (raw[cursor] !== NUL) continue; // not a real header — keep searching
    cursor += 1;

    // Six NUL-separated fields: hash, date, author, email, subject, body
    const fields: string[] = [];
    for (let i = 0; i < 6; i++) {
      const next = raw.indexOf(NUL, cursor);
      if (next < 0) {
        fields.push(raw.slice(cursor));
        cursor = raw.length;
        break;
      }
      fields.push(raw.slice(cursor, next));
      cursor = next + 1;
    }

    // After the 6 NULs there's a newline + (optional) diff body until the
    // next SENTINEL or EOF. We look for the next SENTINEL to know where
    // this commit's diff ends.
    if (raw[cursor] === "\n") cursor += 1;
    const nextSentinel = raw.indexOf(SENTINEL, cursor);
    const diffEnd = nextSentinel < 0 ? raw.length : nextSentinel;
    let diff = raw.slice(cursor, diffEnd);
    // Trim a single trailing newline that git adds between log entries
    if (diff.endsWith("\n\n")) diff = diff.slice(0, -1);
    cursor = diffEnd;

    out.push({
      hash: fields[0] ?? "",
      authorDate: fields[1] ?? "",
      authorName: fields[2] ?? "",
      authorEmail: fields[3] ?? "",
      subject: fields[4] ?? "",
      body: fields[5] ?? "",
      diff,
    });
  }
  return out;
}

export const _SENTINEL_FOR_TESTS = SENTINEL;
/** Exported for the regression test that asserts argv contains no literal
 *  NUL bytes (Windows CreateProcess rejects them — bug fixed in v1.1.1). */
export const _buildArgsForTests = buildArgs;
