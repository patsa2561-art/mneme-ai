/**
 * HEAD verification — cross-check "intended state from commit message"
 * against "actual state in HEAD".
 *
 * Customer feedback (v0.36): an audit doc said "ลบ omise.restoreStock
 * แล้ว" (= removed omise.restoreStock), but `omise.restoreStock` was
 * still present in HEAD. The forensics scanner only looked at commit
 * additions/deletions in history; it never read HEAD to check whether
 * what the commit *claimed* to do was actually true.
 *
 * Algorithm:
 *   1. Parse each commit's subject + body for "remove X" / "delete X"
 *      / "drop X" / "rename X to Y" patterns. Extract X.
 *   2. For each X, scan HEAD for an exact symbol match. If X is still
 *      present, raise a "claim drift" finding.
 *
 * The check is conservative — we only fire on identifiers that are
 * specific enough (≥4 chars, contains a dot or camelCase split) to be
 * meaningful. False positives are still possible (e.g. comment
 * mentioning the old name in a CHANGELOG); the renderer says so.
 */
import { execGitOk } from "../git/exec.js";

export interface DriftFinding {
  /** Commit whose claim is contradicted. */
  commitHash: string;
  shortHash: string;
  authorDate: string;
  subject: string;
  /** What the commit claimed (e.g. "removed", "deleted"). */
  verb: string;
  /** The identifier the commit claimed to remove. */
  symbol: string;
  /** Where the symbol still appears in HEAD. */
  occurrences: Array<{ filePath: string; line: number; preview: string }>;
}

export interface DriftReport {
  scanned: number;
  candidates: number;
  findings: DriftFinding[];
}

/** Patterns that say "this commit removes/deletes/drops X". */
const CLAIM_PATTERNS: Array<{ verb: string; re: RegExp }> = [
  { verb: "remove", re: /\b(?:remove|removed|removes)\s+([A-Za-z][A-Za-z0-9_$.]{3,40})/g },
  { verb: "delete", re: /\b(?:delete|deleted|deletes)\s+([A-Za-z][A-Za-z0-9_$.]{3,40})/g },
  { verb: "drop", re: /\bdrops?\s+([A-Za-z][A-Za-z0-9_$.]{3,40})/g },
  { verb: "kill", re: /\bkills?\s+([A-Za-z][A-Za-z0-9_$.]{3,40})/g },
  { verb: "rip-out", re: /\brip(?:s|ped)?\s+out\s+([A-Za-z][A-Za-z0-9_$.]{3,40})/g },
];

/**
 * Words that look like claim targets but are too generic to be meaningful.
 * These are filtered out so we don't flag "remove debug" as a drift bug
 * when the commit just removed a debug log somewhere.
 */
const STOP_TARGETS = new Set([
  "the", "a", "an", "all", "old", "new", "this", "that", "any", "some",
  "debug", "logs", "log", "comment", "comments", "test", "tests", "code",
  "file", "files", "dep", "deps", "dependency", "dependencies", "thing",
  "stuff", "junk", "noise", "warning", "warnings", "error", "errors",
  "todo", "todos", "fixme", "feature", "features", "support",
  "import", "imports", "export", "exports", "type", "types", "interface",
  "version", "versions", "doc", "docs", "documentation", "readme",
  "config", "configs", "configuration", "setting", "settings",
]);

export interface VerifyOptions {
  cwd: string;
  /** Cap commits scanned. Default 200. */
  maxCommits?: number;
  /** Restrict to commits since this date. */
  since?: string;
}

export async function verifyHeadAgainstHistory(opts: VerifyOptions): Promise<DriftReport> {
  const cwd = opts.cwd;
  const maxN = opts.maxCommits ?? 200;
  const args = [
    "log",
    "-n", String(maxN),
    "--no-merges",
    "--pretty=format:--C--%H%x09%aI%x09%s%n%b%x00",
  ];
  if (opts.since) args.push(`--since=${opts.since}`);
  const out = await execGitOk(args, { cwd });

  const candidateClaims: Array<{ commit: string; date: string; subject: string; verb: string; symbol: string }> = [];
  const blocks = out.split("--C--").filter((b) => b.trim().length > 0);
  for (const block of blocks) {
    const nullIdx = block.indexOf("\x00");
    const segment = nullIdx >= 0 ? block.slice(0, nullIdx) : block;
    const lines = segment.split("\n");
    const head = (lines[0] ?? "").split("\t");
    if (head.length < 3) continue;
    const commitHash = head[0]!;
    const authorDate = head[1] ?? "";
    const subject = head[2] ?? "";
    const body = lines.slice(1).join("\n");
    const text = `${subject}\n${body}`;

    for (const { verb, re } of CLAIM_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(text)) !== null) {
        const symbol = (m[1] ?? "").trim();
        if (!isMeaningfulSymbol(symbol)) continue;
        candidateClaims.push({ commit: commitHash, date: authorDate, subject, verb, symbol });
      }
    }
  }

  if (candidateClaims.length === 0) {
    return { scanned: blocks.length, candidates: 0, findings: [] };
  }

  // Dedupe candidate symbols — we only need to grep HEAD for each unique one.
  const uniqSymbols = Array.from(new Set(candidateClaims.map((c) => c.symbol)));
  const symbolHits = new Map<string, Array<{ filePath: string; line: number; preview: string }>>();
  for (const sym of uniqSymbols) {
    const hits = await grepHead(cwd, sym);
    if (hits.length > 0) symbolHits.set(sym, hits);
  }

  const findings: DriftFinding[] = [];
  const seen = new Set<string>();
  for (const c of candidateClaims) {
    const key = `${c.commit}|${c.symbol}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const occurrences = symbolHits.get(c.symbol);
    if (!occurrences || occurrences.length === 0) continue;
    findings.push({
      commitHash: c.commit,
      shortHash: c.commit.slice(0, 7),
      authorDate: c.date,
      subject: c.subject,
      verb: c.verb,
      symbol: c.symbol,
      occurrences: occurrences.slice(0, 5),
    });
  }
  return { scanned: blocks.length, candidates: candidateClaims.length, findings };
}

function isMeaningfulSymbol(s: string): boolean {
  if (!s) return false;
  if (s.length < 4) return false;
  if (STOP_TARGETS.has(s.toLowerCase())) return false;
  // Require either a dot ("module.method") OR camelCase ("fooBar") OR
  // snake_case ("foo_bar") — i.e. something that looks like an identifier.
  if (s.includes(".")) return true;
  if (/[a-z][A-Z]/.test(s)) return true;
  if (s.includes("_")) return true;
  return false;
}

async function grepHead(
  cwd: string,
  symbol: string,
): Promise<Array<{ filePath: string; line: number; preview: string }>> {
  // Use git grep to scan HEAD only — fast, ignores untracked files.
  const args = ["grep", "-n", "--no-color", "-F", symbol];
  let out = "";
  try {
    out = await execGitOk(args, { cwd });
  } catch {
    return [];
  }
  const result: Array<{ filePath: string; line: number; preview: string }> = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    // Format: path/to/file:42:matched line content
    const idx1 = line.indexOf(":");
    if (idx1 < 0) continue;
    const idx2 = line.indexOf(":", idx1 + 1);
    if (idx2 < 0) continue;
    const filePath = line.slice(0, idx1);
    const lineNum = Number(line.slice(idx1 + 1, idx2));
    const preview = line.slice(idx2 + 1).trim();
    if (!filePath || !Number.isFinite(lineNum)) continue;
    // Skip CHANGELOG / docs / wiki / test files — those are expected to
    // mention removed symbols.
    if (/^(CHANGELOG|README|HISTORY)\.md$/.test(filePath)) continue;
    if (/^docs\/|^wiki\/|\/tests?\/|\.(test|spec)\./.test(filePath)) continue;
    result.push({ filePath, line: lineNum, preview: preview.slice(0, 120) });
  }
  return result;
}
