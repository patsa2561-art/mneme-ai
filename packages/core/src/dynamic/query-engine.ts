/**
 * Query engine — pure functions that execute pack queries against a repo.
 *
 * Design:
 *   • Each query KIND has its own pure executor.
 *   • Executors take a (query, repoRoot) pair and return Result<T, Error>.
 *   • NEVER throws — all I/O wrapped in try/catch.
 *   • DETERMINISTIC over a frozen repo state (essential for tests + cache).
 *   • Defensive caps on result count, file count, recursion depth.
 *
 * The engine does NOT compose with Mneme's heavy retrieval (HMRA, embeddings)
 * here because we want this layer to work **even before** `mneme index` has
 * been run. The augmentation layer (separate file) is where index-dependent
 * enrichment lives.
 */

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { spawnSync } from "node:child_process";
import type {
  CodeSearchQuery,
  GitHistoryQuery,
  EntityGraphQuery,
  Query,
} from "./pack-schema.js";

// ─── Result types ────────────────────────────────────────────────────

export interface CodeSearchHit {
  /** Repo-relative path with forward slashes (cross-platform). */
  path: string;
  /** 1-indexed line number. */
  line: number;
  /** Trimmed snippet of the matched line (max 200 chars). */
  snippet: string;
  /** Which pattern matched (the regex source). */
  matchedPattern: string;
}

export interface GitHistoryEntry {
  /** Repo-relative path. */
  path: string;
  /** Commit hash (full 40-char). */
  hash: string;
  /** ISO timestamp. */
  timestamp: string;
  /** Commit author name. */
  author: string;
  /** Commit subject (first line). */
  subject: string;
}

export interface EntityGraphNode {
  /** Entity unique id. */
  id: string;
  /** Entity kind (function / class / variable / etc.) */
  kind: string;
  /** File where it's defined. */
  path: string;
  /** Display name (function name etc.). */
  name: string;
}

export type QueryResult =
  | { kind: "code-search"; hits: CodeSearchHit[] }
  | { kind: "git-history"; entries: GitHistoryEntry[] }
  | { kind: "entity-graph"; nodes: EntityGraphNode[] };

export interface QueryExecutionError {
  kind: "execution-error";
  /** Stage at which the error occurred. */
  stage: "compile-pattern" | "filesystem" | "git" | "entity-graph";
  message: string;
  /** Optional structured context for debugging. */
  context?: Record<string, unknown>;
}

export type QueryExecutionResult =
  | { ok: true; result: QueryResult }
  | { ok: false; error: QueryExecutionError };

// ─── Limits — defensive, capping resource usage ──────────────────────

const DEFAULT_FILE_SCAN_LIMIT = 5000;
const MAX_LINE_LENGTH_FOR_SNIPPET = 200;
const SKIPPED_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next",
  "__pycache__", ".venv", "venv", ".cache", "coverage",
  "out", "target", "bin", "obj",
]);

// ─── Code-search executor ────────────────────────────────────────────

export function executeCodeSearch(
  query: CodeSearchQuery,
  repoRoot: string,
  fileScanLimit: number = DEFAULT_FILE_SCAN_LIMIT,
): QueryExecutionResult {
  // 1. Compile patterns; fail fast on bad regex.
  const compiled: Array<{ source: string; re: RegExp }> = [];
  for (const pattern of query.patterns) {
    try {
      compiled.push({ source: pattern, re: new RegExp(pattern, "g") });
    } catch (err) {
      return {
        ok: false,
        error: {
          kind: "execution-error",
          stage: "compile-pattern",
          message: `Invalid regex pattern: ${(err as Error).message}`,
          context: { pattern },
        },
      };
    }
  }

  const extSet = new Set(query.fileExtensions.map((e) => e.startsWith(".") ? e.toLowerCase() : "." + e.toLowerCase()));
  const hits: CodeSearchHit[] = [];

  // 2. Walk repo (iterative DFS, bounded).
  const stack: string[] = [repoRoot];
  let scanned = 0;

  while (stack.length > 0 && scanned < fileScanLimit && hits.length < query.maxResults) {
    const dir = stack.pop()!;
    let entries: string[];
    try { entries = readdirSync(dir); } catch { continue; }

    for (const name of entries) {
      if (hits.length >= query.maxResults) break;
      if (SKIPPED_DIRS.has(name)) continue;

      const full = join(dir, name);
      let st;
      try { st = statSync(full); } catch { continue; }

      if (st.isDirectory()) {
        stack.push(full);
        continue;
      }
      if (!st.isFile()) continue;

      const ext = extname(name).toLowerCase();
      if (!extSet.has(ext)) continue;
      scanned += 1;

      // 3. Read the file, scan each line. Bounded by max line count read
      //    (cap each file at ~10k lines to prevent pathological cases).
      let content: string;
      try { content = readFileSync(full, "utf8"); } catch { continue; }

      const lines = content.split(/\r?\n/);
      const max = Math.min(lines.length, 10000);
      const relPath = relative(repoRoot, full).replace(/\\/g, "/");

      for (let i = 0; i < max; i++) {
        if (hits.length >= query.maxResults) break;
        const line = lines[i]!;
        for (const { source, re } of compiled) {
          // Reset state for global regex
          re.lastIndex = 0;
          if (re.test(line)) {
            hits.push({
              path: relPath,
              line: i + 1,
              snippet: line.length > MAX_LINE_LENGTH_FOR_SNIPPET
                ? line.slice(0, MAX_LINE_LENGTH_FOR_SNIPPET) + "…"
                : line.trim(),
              matchedPattern: source,
            });
            break; // one hit per line is enough
          }
        }
      }
    }
  }

  // 4. Apply ranking. We only do alphabetical for now — centrality/recency
  //    require Mneme's index which is the augmentation layer's job.
  if (query.ranking === "alphabetical") {
    hits.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line);
  }

  return { ok: true, result: { kind: "code-search", hits } };
}

// ─── Git-history executor ────────────────────────────────────────────

export function executeGitHistory(
  query: GitHistoryQuery,
  repoRoot: string,
): QueryExecutionResult {
  const entries: GitHistoryEntry[] = [];
  for (const path of query.paths) {
    // Defensive: refuse paths with shell metacharacters (we use spawnSync
    // argv-only, so injection is impossible; this is a clarity/safety check).
    if (/[;&|`$<>()\\\n\r"']/.test(path)) {
      return {
        ok: false,
        error: {
          kind: "execution-error",
          stage: "git",
          message: "Path contains shell metacharacters; refused",
          context: { path },
        },
      };
    }

    const r = spawnSync(
      "git",
      [
        "log",
        `--max-count=${query.maxCommits}`,
        "--format=%H%x09%aI%x09%an%x09%s",
        "--",
        path,
      ],
      { cwd: repoRoot, stdio: "pipe", encoding: "utf8" },
    );

    if (r.error) {
      return {
        ok: false,
        error: {
          kind: "execution-error",
          stage: "git",
          message: `git log failed: ${r.error.message}`,
          context: { path },
        },
      };
    }
    if (r.status !== 0) {
      // Don't fail the whole query — this path may not be tracked yet.
      continue;
    }

    const out = String(r.stdout ?? "").trim();
    if (out === "") continue;

    for (const line of out.split(/\r?\n/)) {
      const parts = line.split("\t");
      if (parts.length < 4) continue;
      entries.push({
        path,
        hash: parts[0]!,
        timestamp: parts[1]!,
        author: parts[2]!,
        subject: parts.slice(3).join("\t"),
      });
    }
  }
  return { ok: true, result: { kind: "git-history", entries } };
}

// ─── Entity-graph executor (placeholder — depends on Mneme index) ────

/**
 * Entity-graph queries require the indexed entity graph that Mneme builds
 * during `mneme index`. For v1.13.0 P1, we return a structured "needs index"
 * error so the tool can degrade gracefully rather than silently returning
 * empty results.
 *
 * Full integration with `core/correlate` happens in v1.13.x once we audit
 * the read-only API surface.
 */
export function executeEntityGraph(
  query: EntityGraphQuery,
  _repoRoot: string,
): QueryExecutionResult {
  return {
    ok: false,
    error: {
      kind: "execution-error",
      stage: "entity-graph",
      message: "entity-graph queries require `mneme index` to have run; integration in progress",
      context: { entityKinds: query.entityKinds, maxDepth: query.maxDepth },
    },
  };
}

// ─── Top-level dispatcher ────────────────────────────────────────────

export function executeQuery(query: Query, repoRoot: string): QueryExecutionResult {
  switch (query.kind) {
    case "code-search":
      return executeCodeSearch(query, repoRoot);
    case "git-history":
      return executeGitHistory(query, repoRoot);
    case "entity-graph":
      return executeEntityGraph(query, repoRoot);
  }
}

// ─── Test helpers ────────────────────────────────────────────────────

/** Test-only: list which directories the engine skips by default. */
export const _SKIPPED_DIRS_FOR_TESTS = SKIPPED_DIRS;
