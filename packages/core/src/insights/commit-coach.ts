/**
 * `mneme commit-coach` — pre-commit assistant.
 *
 * Reads a unified diff (from `git diff --staged` or stdin) and produces
 * a structured advice payload covering:
 *   1. Suggested commit message (style-matched to repo's history).
 *   2. Recommended reviewers (top experts on touched files).
 *   3. Scope warning (touching too many modules → suggest splitting).
 *   4. Past-regret check (this pattern caused INC-X before).
 *
 * Pure data analysis. The CLI optionally calls an LLM to polish the
 * commit message; everything else is heuristic + store queries.
 */

import type { MnemeStore } from "../store/sqlite.js";
import type { Commit } from "../types.js";
import { detectRegrets } from "./regret.js";

export interface ParsedDiff {
  files: string[];
  /** Unique top-2-segment modules (e.g. "src/payment", "src/auth"). */
  modules: string[];
  /** Total lines added across all hunks. */
  added: number;
  /** Total lines removed across all hunks. */
  removed: number;
  /** Type guess based on file paths + line counts. */
  shape: "feat" | "fix" | "refactor" | "test" | "docs" | "chore" | "perf";
}

export interface Reviewer {
  name: string;
  email: string;
  /** % of commits on the touched files attributable to this person. */
  ownership: number;
  /** Files this reviewer is the primary owner of (within touched set). */
  ownedFiles: string[];
}

export interface RegretWarning {
  pattern: string;
  pastCommitHash: string;
  pastDate: string;
  outcome: string;
}

export interface CoachAdvice {
  /** What the diff looks like. */
  diff: ParsedDiff;
  /** Suggested commit message subject (style-matched). */
  suggestedSubject: string;
  /** Top 3 recommended reviewers. */
  reviewers: Reviewer[];
  /** Scope diagnosis — module count + verdict. */
  scopeOK: boolean;
  scopeMessage: string;
  /** Past-regret warnings if similar past changes regretted. */
  warnings: RegretWarning[];
}

/**
 * Parse a unified diff string. Best-effort — handles standard `git diff`
 * output. Skips binary diffs and file-mode changes.
 */
export function parseDiff(diffText: string): ParsedDiff {
  const files: string[] = [];
  let added = 0;
  let removed = 0;

  const lines = diffText.split("\n");
  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      // Format: diff --git a/path b/path
      const m = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      if (m) files.push(m[2]!);
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      added += 1;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      removed += 1;
    }
  }

  // Modules: first 2 path segments.
  const modules = [
    ...new Set(
      files.map((f) => {
        const parts = f.split("/");
        return parts.length >= 2 ? `${parts[0]}/${parts[1]}` : parts[0]!;
      }),
    ),
  ];

  return {
    files,
    modules,
    added,
    removed,
    shape: classifyShape(files, added, removed),
  };
}

function classifyShape(files: string[], added: number, removed: number): ParsedDiff["shape"] {
  if (files.length === 0) return "chore";
  const allTests = files.every((f) => /(\.test\.|\.spec\.|\/tests?\/|\/specs?\/)/.test(f));
  if (allTests) return "test";
  const allDocs = files.every((f) => /(\.md$|\/docs?\/)/i.test(f));
  if (allDocs) return "docs";
  // Refactor: balanced add/remove (within 30%) AND no obvious test changes
  if (removed > 0 && added > 0 && Math.abs(added - removed) / Math.max(added, removed) < 0.3 && removed > 5) {
    return "refactor";
  }
  // Heavy removals → likely a fix or refactor
  if (removed > added * 2) return "fix";
  // Default: feat for new code
  return "feat";
}

/**
 * Look up the top reviewer per touched file (the file's largest contributor).
 * Aggregates across files to find the people most worth requesting review from.
 */
export function recommendReviewers(store: MnemeStore, files: string[], topN = 3): Reviewer[] {
  if (files.length === 0) return [];

  // For each touched file, find the dominant author.
  const placeholders = files.map(() => "?").join(",");
  const rows = store.db
    .prepare(
      `SELECT
         fc.path                  AS path,
         c.author_name            AS author_name,
         c.author_email           AS author_email,
         COUNT(*)                 AS touches
       FROM file_changes fc
       JOIN commits c ON c.hash = fc.commit_hash
       WHERE fc.path IN (${placeholders})
       GROUP BY fc.path, c.author_name, c.author_email
       ORDER BY fc.path, touches DESC`,
    )
    .all(...files) as Array<{
    path: string;
    author_name: string;
    author_email: string;
    touches: number;
  }>;

  // Group by file → top author.
  const fileTotals = new Map<string, number>();
  const fileTopAuthor = new Map<string, { name: string; email: string; touches: number }>();
  for (const r of rows) {
    fileTotals.set(r.path, (fileTotals.get(r.path) ?? 0) + r.touches);
    if (!fileTopAuthor.has(r.path)) {
      fileTopAuthor.set(r.path, { name: r.author_name, email: r.author_email, touches: r.touches });
    }
  }

  // Aggregate authors across files: who owns the most across the touched set?
  type Bucket = { name: string; email: string; ownedFiles: string[]; ownershipScore: number };
  const byAuthor = new Map<string, Bucket>();
  for (const [file, top] of fileTopAuthor) {
    const total = fileTotals.get(file) ?? 1;
    const share = top.touches / total;
    const key = `${top.name}|${top.email}`;
    if (!byAuthor.has(key)) byAuthor.set(key, { name: top.name, email: top.email, ownedFiles: [], ownershipScore: 0 });
    const b = byAuthor.get(key)!;
    b.ownedFiles.push(file);
    b.ownershipScore += share;
  }

  return [...byAuthor.values()]
    .map((b) => ({
      name: b.name,
      email: b.email,
      ownership: Math.round((b.ownershipScore / files.length) * 100),
      ownedFiles: b.ownedFiles,
    }))
    .sort((a, b) => b.ownership - a.ownership)
    .slice(0, topN);
}

/**
 * Suggest a commit message based on the diff shape + style of recent
 * commits in the repo. Returns a Conventional-Commits-style subject line.
 */
export function suggestSubject(diff: ParsedDiff, recentSubjects: string[]): string {
  const usesConventional = recentSubjects.some((s) => /^[a-z]+(\([^)]+\))?:\s/.test(s));
  const scope = diff.modules[0]?.replace(/^src\//, "") ?? "";
  const scopeStr = scope ? `(${scope})` : "";

  // Hint from filename if obvious
  const hint = diff.files
    .map((f) => f.split("/").pop()!.replace(/\.(ts|js|tsx|jsx|py|go|rb|md)$/, ""))
    .filter((n) => n.length >= 3)
    .slice(0, 2)
    .join(" ");

  if (!usesConventional) {
    // Fall back to imperative subject
    return `${diff.shape}: ${hint || "update " + (diff.modules[0] ?? "code")}`;
  }
  return `${diff.shape}${scopeStr}: ${hint || "update " + diff.modules[0]?.split("/").pop()}`;
}

/** Diagnose scope creep. Touching > 3 modules is usually too much for one commit. */
export function checkScope(diff: ParsedDiff): { scopeOK: boolean; message: string } {
  if (diff.modules.length === 0) return { scopeOK: true, message: "No files staged." };
  if (diff.modules.length === 1) {
    return { scopeOK: true, message: `Focused on ${diff.modules[0]}.` };
  }
  if (diff.modules.length <= 3) {
    return { scopeOK: true, message: `${diff.modules.length} modules touched: ${diff.modules.join(", ")}.` };
  }
  return {
    scopeOK: false,
    message: `Scope creep — ${diff.modules.length} modules touched (${diff.modules.slice(0, 3).join(", ")}, …). Consider splitting into ${diff.modules.length} commits.`,
  };
}

/**
 * Check past regrets: any commit touching the same files where the
 * follow-up was a fix/revert? If so, surface as a warning.
 */
export function checkPastRegrets(store: MnemeStore, files: string[]): RegretWarning[] {
  if (files.length === 0) return [];
  // Pull every commit that touched at least one of the files.
  const placeholders = files.map(() => "?").join(",");
  const commitRows = store.db
    .prepare(
      `SELECT DISTINCT c.* FROM commits c
       JOIN file_changes fc ON fc.commit_hash = c.hash
       WHERE fc.path IN (${placeholders})
       ORDER BY c.author_date DESC
       LIMIT 200`,
    )
    .all(...files) as Array<Record<string, unknown>>;

  const commits: Commit[] = [];
  for (const r of commitRows) {
    const hash = String(r.hash);
    const filesOfCommit = (
      store.db
        .prepare("SELECT path FROM file_changes WHERE commit_hash = ?")
        .all(hash) as Array<{ path: string }>
    ).map((x) => x.path);
    commits.push({
      hash,
      shortHash: String(r.short_hash),
      authorName: String(r.author_name),
      authorEmail: String(r.author_email),
      authorDate: String(r.author_date),
      committerDate: String(r.committer_date),
      subject: String(r.subject),
      body: String(r.body || ""),
      parents: r.parents ? String(r.parents).split(/\s+/).filter(Boolean) : [],
      files: filesOfCommit,
    } as Commit);
  }

  const regrets = detectRegrets(commits, { windowDays: 14 });
  // Convert to warnings — only for regrets where files overlap significantly.
  const touchedSet = new Set(files);
  const out: RegretWarning[] = [];
  for (const r of regrets) {
    const overlap = (r.shipped.files ?? []).filter((f) => touchedSet.has(f));
    if (overlap.length === 0) continue;
    out.push({
      pattern: `Past change in ${overlap[0]} caused a ${r.kind} within ${r.daysToFix.toFixed(0)} days.`,
      pastCommitHash: r.shipped.shortHash || r.shipped.hash.slice(0, 7),
      pastDate: r.shipped.authorDate.slice(0, 10),
      outcome: r.lesson || `${r.kind} within ${r.daysToFix.toFixed(0)} days`,
    });
  }
  return out.slice(0, 3);
}

/** End-to-end coach: parse → recommend → diagnose. Pure-ish (reads the store). */
export function coach(store: MnemeStore, diffText: string): CoachAdvice {
  const diff = parseDiff(diffText);
  const reviewers = recommendReviewers(store, diff.files, 3);
  const scope = checkScope(diff);
  const warnings = checkPastRegrets(store, diff.files);

  const recentRows = store.db
    .prepare(`SELECT subject FROM commits ORDER BY author_date DESC LIMIT 30`)
    .all() as Array<{ subject: string }>;
  const recentSubjects = recentRows.map((r) => r.subject);

  const suggestedSubject = suggestSubject(diff, recentSubjects);

  return {
    diff,
    suggestedSubject,
    reviewers,
    scopeOK: scope.scopeOK,
    scopeMessage: scope.message,
    warnings,
  };
}
