/**
 * `mneme promise` — promise-debt tracker.
 *
 * The thesis: engineers casually write "I'll fix this later", "TODO:
 * refactor", "follow-up PR coming" in commit messages and PR
 * descriptions.  These promises live in free-form text and are invisible
 * to query.  Mneme parses them into a structured ledger and verifies
 * which were kept.
 *
 * IMPORTANT framing: this is a HEURISTIC.  "I'll fix" might be ironic.
 * We mark high-confidence promises and report fulfilment as "appears
 * unfulfilled in our window" — never as a verdict.  The CLI renderer
 * must echo this caveat.
 *
 * Algorithm (regex + matching; no LLM):
 *   1. For each commit C: scan commit subject+body+pr_title+pr_body for
 *      promise patterns.  Each match becomes a Promise record.
 *   2. Walk subsequent commits.  A promise is "kept" if a later commit
 *      (within `keptWindowDays`) by anyone touches a file that overlaps
 *      with the promising commit's files AND the later commit's message
 *      contains the promise's scope_hint OR a fix/refactor/cleanup keyword.
 *   3. Otherwise: "open" if age < `staleAfterDays`, else "stale".
 *   4. Aggregate per author: open / kept / stale counts.
 *
 * Pure functions.  CLI handles I/O.
 *
 * ─── --json shape (stable contract) ─────────────────────────────────────
 *   {
 *     "totals": { "open": n, "kept": n, "stale": n, "total": n },
 *     "oldestStaleAgeDays": number | null,
 *     "promises": [
 *       {
 *         "id": "abc1234:0",         // commit shortHash + match index
 *         "author": "alice@x",
 *         "commit": "abc1234",
 *         "date": "2024-12-01T...",
 *         "excerpt": "TODO: refactor cache",
 *         "scopeHint": "cache",
 *         "files": ["src/cache.ts", ...],
 *         "status": "open" | "kept" | "stale",
 *         "ageDays": 47,
 *         "patternKind": "todo" | "will-verb" | "followup" | "plan-to",
 *         "fulfilledBy": "ef56789" | null,   // commit short-hash if kept
 *         "fulfilledAt": "..." | null
 *       }
 *     ],
 *     "byAuthor": [
 *       { "author": "alice@x", "open": n, "kept": n, "stale": n, "total": n }
 *     ]
 *   }
 */

import type { Commit } from "../types.js";
import { isNoiseFile } from "../util/noise.js";

export type PromiseStatus = "open" | "kept" | "stale";
export type PromisePatternKind = "todo" | "will-verb" | "followup" | "plan-to";

export interface PromiseRecord {
  /** Stable per-promise id: `${shortHash}:${matchIndex}` */
  id: string;
  /** Author email (lowercased). */
  author: string;
  /** Commit hash that recorded the promise. */
  commit: string;
  /** Commit short hash (7 char). */
  commitShort: string;
  /** ISO author date of the promising commit. */
  date: string;
  /** Short excerpt of the matched promise text. */
  excerpt: string;
  /** Best-effort noun phrase indicating what was promised (lowercased). */
  scopeHint: string | null;
  /** Files touched by the promising commit (noise-filtered). */
  files: string[];
  /** Current status — "open" / "kept" / "stale". */
  status: PromiseStatus;
  /** Days since the promise was made (relative to nowMs). */
  ageDays: number;
  /** Which regex family fired. */
  patternKind: PromisePatternKind;
  /** Short hash of the commit that fulfilled the promise, if any. */
  fulfilledBy: string | null;
  /** ISO date the promise was fulfilled, if any. */
  fulfilledAt: string | null;
}

export interface PromiseTotals {
  open: number;
  kept: number;
  stale: number;
  total: number;
}

export interface AuthorPromiseStats {
  author: string;
  open: number;
  kept: number;
  stale: number;
  total: number;
}

export interface PromiseReport {
  totals: PromiseTotals;
  /** Days since the oldest currently-stale promise was made. */
  oldestStaleAgeDays: number | null;
  promises: PromiseRecord[];
  byAuthor: AuthorPromiseStats[];
}

export interface ExtractPromisesOptions {
  /** "now" override for tests. */
  nowMs?: number;
  /** A promise is "kept" only if fulfilled within this window. Default 365. */
  keptWindowDays?: number;
  /** A promise becomes "stale" after this many days unfulfilled. Default 90. */
  staleAfterDays?: number;
  /** Optional author filter (email, lowercased internally). */
  authorFilter?: string;
  /** Optional status filter. */
  statusFilter?: PromiseStatus;
  /**
   * Cap on per-commit matches to avoid pathological commit messages with
   * dozens of TODO bullets producing duplicate records. Default 4.
   */
  maxMatchesPerCommit?: number;
}

// ─── regex patterns ──────────────────────────────────────────────────
//
// All patterns are case-insensitive, multi-line, and non-overlapping.
// Each named group `verb` / `body` is the meaningful payload.

/** "I'll fix", "we will refactor", "will revisit", … */
const RE_WILL_VERB =
  /\b(?:I'?ll|I\s+will|we'?ll|we\s+will|will)\s+(fix|address|cleanup|clean\s+up|refactor|revisit|finish|complete|tackle|handle|resolve|investigate|polish|improve|simplify|migrate)\b([^\n.;]*)/gi;

/** "TODO:", "FIXME:", "HACK:", "XXX:", "FOLLOWUP:", "FOLLOW-UP:", … */
const RE_TODO_LABEL =
  /\b(TODO|FIXME|HACK|XXX|FOLLOWUP|FOLLOW-UP|FOLLOW\s+UP)\s*[:.\-]\s*([^\n]+)/gi;

/** "in a follow-up", "next sprint", "later this week", "soon", "eventually". */
const RE_FOLLOWUP_PHRASE =
  /\b(in\s+(?:a\s+)?follow[\s-]?up|next\s+sprint|later\s+this\s+week|later\s+this\s+sprint|soon|eventually|in\s+a\s+later\s+pr|will\s+follow\s+up)\b([^\n.;]*)/gi;

/** "plan to migrate", "plans to refactor", "planning to simplify". */
const RE_PLAN_TO =
  /\bplan(?:ned|s|ning)?\s+to\s+(\w+(?:\s+\w+){0,3})/gi;

/** Keywords that count as "fulfilment" in a later commit. */
const FULFILMENT_RE = /\b(fix|fixes|fixed|refactor|refactored|cleanup|cleaned\s+up|resolve|resolved|address|addressed|complete|completed|finish|finished|implement|implemented|migrate|migrated|polish|polished|simplify|simplified|done)\b/i;

/**
 * Extract promises from one commit.  Returns one record per match,
 * de-duplicated by excerpt to avoid noise.
 */
export function extractPromisesFromCommit(
  c: Commit,
  matchIndexBase = 0,
  maxMatches = 4,
): Array<Omit<PromiseRecord, "status" | "ageDays" | "fulfilledBy" | "fulfilledAt">> {
  const text = composeText(c);
  if (!text) return [];

  const out: Array<Omit<PromiseRecord, "status" | "ageDays" | "fulfilledBy" | "fulfilledAt">> = [];
  const seen = new Set<string>();
  const files = (c.files ?? []).filter((f) => !isNoiseFile(f));
  let matchIndex = matchIndexBase;

  const scanners: Array<{ re: RegExp; kind: PromisePatternKind; toExcerpt: (m: RegExpExecArray) => { excerpt: string; scopeHint: string | null } }> = [
    {
      re: RE_TODO_LABEL,
      kind: "todo",
      toExcerpt: (m) => {
        const tag = (m[1] ?? "TODO").toUpperCase();
        const body = (m[2] ?? "").trim().replace(/\s+/g, " ");
        const excerpt = `${tag}: ${truncate(body, 100)}`;
        return { excerpt, scopeHint: extractScope(body) };
      },
    },
    {
      re: RE_WILL_VERB,
      kind: "will-verb",
      toExcerpt: (m) => {
        const verb = (m[1] ?? "").toLowerCase();
        const tail = (m[2] ?? "").trim().replace(/\s+/g, " ");
        const excerpt = truncate(`will ${verb}${tail ? " " + tail : ""}`, 100);
        return { excerpt, scopeHint: extractScope(tail) };
      },
    },
    {
      re: RE_FOLLOWUP_PHRASE,
      kind: "followup",
      toExcerpt: (m) => {
        const phrase = (m[1] ?? "").toLowerCase().replace(/\s+/g, " ");
        const tail = (m[2] ?? "").trim().replace(/\s+/g, " ");
        const excerpt = truncate(`${phrase}${tail ? " " + tail : ""}`, 100);
        return { excerpt, scopeHint: extractScope(tail) };
      },
    },
    {
      re: RE_PLAN_TO,
      kind: "plan-to",
      toExcerpt: (m) => {
        const tail = (m[1] ?? "").trim().replace(/\s+/g, " ");
        const excerpt = truncate(`plan to ${tail}`, 100);
        return { excerpt, scopeHint: extractScope(tail) };
      },
    },
  ];

  for (const sc of scanners) {
    sc.re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = sc.re.exec(text)) !== null) {
      if (out.length >= maxMatches) break;
      const { excerpt, scopeHint } = sc.toExcerpt(m);
      const dedupeKey = excerpt.toLowerCase();
      if (seen.has(dedupeKey)) continue;
      // Reject promises shorter than 8 chars of payload — likely noise.
      if (excerpt.replace(/[^A-Za-z0-9]/g, "").length < 4) continue;
      seen.add(dedupeKey);
      out.push({
        id: `${c.shortHash}:${matchIndex}`,
        author: (c.authorEmail ?? "").toLowerCase(),
        commit: c.hash,
        commitShort: c.shortHash,
        date: c.authorDate,
        excerpt,
        scopeHint,
        files,
        patternKind: sc.kind,
      });
      matchIndex += 1;
    }
    if (out.length >= maxMatches) break;
  }

  return out;
}

/**
 * Build the full promise report from a chronological commit list.
 * Caller passes commits in any order — we sort.
 */
export function buildPromiseReport(
  commits: Commit[],
  opts: ExtractPromisesOptions = {},
): PromiseReport {
  const nowMs = opts.nowMs ?? Date.now();
  const keptWindowMs = (opts.keptWindowDays ?? 365) * 86_400_000;
  const staleAfterMs = (opts.staleAfterDays ?? 90) * 86_400_000;
  const maxMatches = Math.max(1, opts.maxMatchesPerCommit ?? 4);
  const authorFilter = opts.authorFilter?.toLowerCase();

  const sorted = [...commits].sort((a, b) =>
    a.authorDate.localeCompare(b.authorDate),
  );

  // Step 1: extract every promise.
  const promises: PromiseRecord[] = [];
  for (const c of sorted) {
    const recs = extractPromisesFromCommit(c, 0, maxMatches);
    for (const r of recs) {
      const t = new Date(r.date).getTime();
      const ageDays = Math.max(0, (nowMs - t) / 86_400_000);
      promises.push({
        ...r,
        status: "open",
        ageDays: Math.round(ageDays * 10) / 10,
        fulfilledBy: null,
        fulfilledAt: null,
      });
    }
  }

  // Step 2: walk subsequent commits to mark fulfilment.
  // For each promise we look forward (up to keptWindowMs) for a commit by
  // anyone that touches an overlapping file AND mentions either the
  // scope_hint or a fulfilment keyword.
  const commitsByDate = sorted; // already sorted asc
  for (const promise of promises) {
    const t0 = new Date(promise.date).getTime();
    if (promise.files.length === 0) continue;
    const promiseFiles = new Set(promise.files);
    const scope = promise.scopeHint;
    // Binary search would be nicer; simple scan is fine for typical sizes.
    for (const candidate of commitsByDate) {
      const t = new Date(candidate.authorDate).getTime();
      if (t <= t0) continue;
      if (t - t0 > keptWindowMs) break;
      if (candidate.hash === promise.commit) continue;
      // Must touch at least one file from the promising commit.
      const candFiles = candidate.files ?? [];
      let touches = false;
      for (const f of candFiles) {
        if (promiseFiles.has(f)) {
          touches = true;
          break;
        }
      }
      if (!touches) continue;
      const candText = `${candidate.subject}\n${candidate.body ?? ""}`;
      const mentionsScope = scope ? candText.toLowerCase().includes(scope) : false;
      const fulfilment = FULFILMENT_RE.test(candText);
      if (mentionsScope || fulfilment) {
        promise.status = "kept";
        promise.fulfilledBy = candidate.shortHash;
        promise.fulfilledAt = candidate.authorDate;
        break;
      }
    }
  }

  // Step 3: open vs stale.
  for (const p of promises) {
    if (p.status === "kept") continue;
    const ageMs = nowMs - new Date(p.date).getTime();
    p.status = ageMs >= staleAfterMs ? "stale" : "open";
  }

  // Step 4: filters (after computing status so totals reflect raw history).
  let filtered = promises;
  if (authorFilter) filtered = filtered.filter((p) => p.author === authorFilter);
  if (opts.statusFilter) filtered = filtered.filter((p) => p.status === opts.statusFilter);

  // Step 5: aggregate.
  const totals: PromiseTotals = { open: 0, kept: 0, stale: 0, total: filtered.length };
  for (const p of filtered) totals[p.status] += 1;

  let oldestStaleAgeDays: number | null = null;
  for (const p of filtered) {
    if (p.status !== "stale") continue;
    if (oldestStaleAgeDays === null || p.ageDays > oldestStaleAgeDays) {
      oldestStaleAgeDays = p.ageDays;
    }
  }

  const byAuthorMap = new Map<string, AuthorPromiseStats>();
  for (const p of filtered) {
    let row = byAuthorMap.get(p.author);
    if (!row) {
      row = { author: p.author, open: 0, kept: 0, stale: 0, total: 0 };
      byAuthorMap.set(p.author, row);
    }
    row[p.status] += 1;
    row.total += 1;
  }
  const byAuthor = [...byAuthorMap.values()].sort((a, b) => {
    // Worst promise debt first: stale desc, then open desc, then total desc.
    if (b.stale !== a.stale) return b.stale - a.stale;
    if (b.open !== a.open) return b.open - a.open;
    if (b.total !== a.total) return b.total - a.total;
    return a.author.localeCompare(b.author);
  });

  // Sort the final promise list: stale first (oldest), then open
  // (newest), then kept (newest), so the renderer naturally surfaces the
  // most-actionable items at the top.
  filtered.sort((a, b) => {
    const order: Record<PromiseStatus, number> = { stale: 0, open: 1, kept: 2 };
    if (order[a.status] !== order[b.status]) return order[a.status] - order[b.status];
    if (a.status === "stale") return b.ageDays - a.ageDays;
    return b.date.localeCompare(a.date);
  });

  return {
    totals,
    oldestStaleAgeDays:
      oldestStaleAgeDays === null
        ? null
        : Math.round(oldestStaleAgeDays * 10) / 10,
    promises: filtered,
    byAuthor,
  };
}

// ─── helpers ─────────────────────────────────────────────────────────

function composeText(c: Commit): string {
  const parts = [c.subject ?? "", c.body ?? "", c.prTitle ?? "", c.prBody ?? ""];
  return parts.filter(Boolean).join("\n");
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + "…";
}

/**
 * Pull the first noun-ish chunk from a fragment of promise text.  Used as a
 * cheap "scope hint" — e.g. "TODO: refactor cache layer" → "cache".
 *
 * Heuristic:
 *   1. Drop common stop-fragments and punctuation.
 *   2. Take the first 1-2 alphanumeric tokens after any verb.
 *   3. Lowercase, length ≤ 32.
 */
export function extractScope(fragment: string): string | null {
  if (!fragment) return null;
  // Strip leading verbs and connectives.
  const cleaned = fragment
    .toLowerCase()
    .replace(/^[\s:.\-]+/, "")
    .replace(
      /^(?:to\s+|for\s+|the\s+|a\s+|an\s+|fix|fixes|fixed|address|cleanup|clean\s+up|refactor|revisit|finish|complete|tackle|handle|resolve|investigate|polish|improve|simplify|migrate|do)\s+/,
      "",
    )
    .trim();
  if (!cleaned) return null;
  const tokens = cleaned.split(/[^a-z0-9_./-]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  // Drop tiny stopwords from the head.
  const STOP = new Set([
    "this",
    "that",
    "these",
    "those",
    "in",
    "on",
    "at",
    "of",
    "to",
    "for",
    "and",
    "or",
    "but",
    "if",
    "is",
    "it",
    "we",
    "you",
    "i",
    "the",
    "a",
    "an",
    "later",
    "soon",
    "eventually",
  ]);
  while (tokens.length > 0 && STOP.has(tokens[0]!)) tokens.shift();
  if (tokens.length === 0) return null;
  const head = tokens.slice(0, 2).join(" ");
  if (head.length > 32) return head.slice(0, 32);
  if (head.length < 3) return null;
  return head;
}
