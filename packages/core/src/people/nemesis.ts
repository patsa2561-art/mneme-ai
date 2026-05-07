/**
 * `mneme nemesis` — engineering friction detector.
 *
 * The thesis: GitHub shows merges (success). Mneme surfaces friction
 * archaeology — pairs of authors who consistently revert / rewrite each
 * other's work.  Useful for team formation: "don't put nemeses on the
 * same sub-team".
 *
 * IMPORTANT framing:  these results describe ENGINEERING friction
 * (style/architecture disagreement), NOT personal conflict.  The CLI
 * output and any downstream renderer must say so explicitly.  This is a
 * deliberate quality + defamation-risk constraint.
 *
 * Algorithm (deterministic; no LLM):
 *   1. Walk commits oldest → newest.  For each commit C by author B
 *      touching file F, find the most recent prior commit C_prev by a
 *      DIFFERENT author A that also touched F.
 *   2. C is a "rewrite" of C_prev when ANY of:
 *        - C is a `git revert` of C_prev (subject contains "Revert" + the
 *          short hash, or the explicit `Revert "<subject>"` form).
 *        - The intersection of C's files with C_prev's files is at least
 *          half of the files C touched (rewrite-by-overlap).
 *        - C's subject/body contains fix/revert/rollback/undo/redo/
 *          rewrite + at least one file is shared with C_prev.
 *   3. Increment friction_count[(A, B)] for each such event (ordered:
 *      A wrote, B rewrote).
 *   4. For each unordered pair {A, B}, total = friction_count[(A,B)] +
 *      friction_count[(B,A)].  Diagonal (A === B) ignored.
 *   5. Filter pairs with total < `minTotal` (default 3).  Sort desc.
 *
 * Pure functions.  All I/O lives in the CLI command file.  Caller
 * provides commits already filtered by the `windowDays` cutoff.
 *
 * ─── --json shape (stable contract) ─────────────────────────────────────
 *   {
 *     "totalEvents": number,
 *     "uniquePairs": number,
 *     "windowDays": number,
 *     "pairs": [
 *       {
 *         "a": "alice@x",
 *         "b": "bob@x",
 *         "total": 12,
 *         "aWroteBRewrote": 8,        // A wrote, B rewrote
 *         "bWroteARewrote": 4,        // B wrote, A rewrote
 *         "topFile": "src/cache.ts",  // most-contested file (or null)
 *         "lastClashAt": "2025-04-30T...",
 *         "examples": [
 *           { "shipped": "abc1234", "rewrote": "def5678",
 *             "kind": "revert" | "overlap" | "fix-keyword",
 *             "subject": "Revert ...", "filePath": "src/cache.ts",
 *             "rewroteBy": "bob@x", "shippedBy": "alice@x",
 *             "atIso": "2025-04-30T..." }
 *         ]
 *       }, ...
 *     ]
 *   }
 */

import type { Commit } from "../types.js";
import { isNoiseFile } from "../util/noise.js";

/** A single friction event — A's commit was rewritten by B's commit. */
export interface FrictionEvent {
  /** A's commit (the original work). */
  shipped: Commit;
  /** B's commit (the rewrite). */
  rewrote: Commit;
  /** Which heuristic fired. */
  kind: "revert" | "overlap" | "fix-keyword";
  /** A representative file present in both commits. */
  filePath: string;
  /** Files shared between both commits (noise-filtered). */
  sharedFiles: string[];
  /** ISO timestamp the rewrite landed (B's authorDate). */
  atIso: string;
}

/** An aggregated friction pair, ordered for stable rendering. */
export interface NemesisPair {
  /** Lower email lexicographically — gives stable ordering. */
  a: string;
  /** Higher email lexicographically. */
  b: string;
  /** total = aWroteBRewrote + bWroteARewrote. */
  total: number;
  aWroteBRewrote: number;
  bWroteARewrote: number;
  /** Most-contested file across both directions, or null. */
  topFile: string | null;
  /** ISO of the most recent friction event in either direction. */
  lastClashAt: string;
  /** A few example events (≤ 4) for the renderer to cite. */
  examples: FrictionEvent[];
}

export interface NemesisReport {
  /** Total qualifying friction events across the window. */
  totalEvents: number;
  /** Unique (A, B) pairs after the minTotal filter. */
  uniquePairs: number;
  /** The window the caller used (echoed for output). */
  windowDays: number;
  pairs: NemesisPair[];
}

export interface DetectFrictionOptions {
  /** Window in days — caller filters commits before passing in; this is for reporting. */
  windowDays?: number;
  /** Minimum total events for a pair to appear in the report (default 3). */
  minTotal?: number;
  /** Restrict pairs to those involving this email. */
  authorFilter?: string;
  /** Per-pair example cap (default 4). */
  examplesPerPair?: number;
  /**
   * Maximum overlap-search look-back per file: how many prior commits to
   * inspect when finding the "most recent prior commit by a different
   * author touching F".  Default 1 (most-recent only) — matches the spec.
   */
  priorLookback?: number;
}

const REVERT_RE = /\brevert(?:s|ed|ing)?\b/i;
const FIX_KEYWORDS_RE = /\b(fix|fixes|fixed|revert|reverts|rollback|rolling back|undo|undone|redo|rewrite|rewriting|rewrote)\b/i;
const SHORT_HASH_RE = /\b([0-9a-f]{7,40})\b/gi;

/**
 * Detect friction events across a commit list.  Commits should be
 * already trimmed to the desired window by the caller (the function
 * still accepts every commit and walks them in date order).
 */
export function detectFriction(
  commits: Commit[],
  opts: DetectFrictionOptions = {},
): FrictionEvent[] {
  const events: FrictionEvent[] = [];
  if (commits.length === 0) return events;
  const sorted = [...commits].sort((a, b) =>
    a.authorDate.localeCompare(b.authorDate),
  );
  const lookback = Math.max(1, opts.priorLookback ?? 1);

  // Index by file: ordered list of (commit, position) most-recent first.
  // We rebuild incrementally as we walk so "most recent prior commit by a
  // different author" is just a scan over fileHistory[file] until we find
  // an author !== current.
  const fileHistory = new Map<string, Commit[]>();

  for (const c of sorted) {
    const cFiles = (c.files ?? []).filter((f) => !isNoiseFile(f));
    if (cFiles.length === 0) continue;

    // 1. Collect candidate "prior" commits across c's files.
    //    For each file, consider the most-recent prior commit (or up to
    //    `lookback`) where the author differs.  De-duplicate by hash.
    const candidates = new Map<string, { prev: Commit; sharedFiles: Set<string> }>();
    for (const f of cFiles) {
      const hist = fileHistory.get(f);
      if (!hist || hist.length === 0) continue;
      let inspected = 0;
      for (let i = hist.length - 1; i >= 0 && inspected < lookback; i--) {
        const prev = hist[i]!;
        inspected += 1;
        if (sameAuthor(prev, c)) continue;
        const slot = candidates.get(prev.hash);
        if (slot) {
          slot.sharedFiles.add(f);
        } else {
          candidates.set(prev.hash, { prev, sharedFiles: new Set([f]) });
        }
        // Don't keep walking — we only want the most-recent-prior-by-different-author per file.
        break;
      }
    }

    // 2. For each candidate, decide if c is a "rewrite" of prev.
    //    Spec lets a single c trigger multiple events if it rewrites
    //    multiple distinct prior commits — that's correct behavior since
    //    each pairing is an independent friction signal.
    for (const { prev, sharedFiles } of candidates.values()) {
      const kind = classifyRewrite(c, prev, sharedFiles, cFiles);
      if (!kind) continue;
      const filePath = pickRepresentativeFile(sharedFiles);
      events.push({
        shipped: prev,
        rewrote: c,
        kind,
        filePath,
        sharedFiles: [...sharedFiles].sort(),
        atIso: c.authorDate,
      });
    }

    // 3. Index c into fileHistory for future commits to find.
    for (const f of cFiles) {
      const hist = fileHistory.get(f);
      if (hist) hist.push(c);
      else fileHistory.set(f, [c]);
    }
  }

  return events;
}

/** Aggregate friction events into ranked nemesis pairs. */
export function aggregateNemesisPairs(
  events: FrictionEvent[],
  opts: DetectFrictionOptions = {},
): NemesisReport {
  const minTotal = opts.minTotal ?? 3;
  const examplesPerPair = Math.max(1, opts.examplesPerPair ?? 4);
  const filter = opts.authorFilter?.toLowerCase();

  // Bucket by unordered pair.
  type Bucket = {
    a: string;
    b: string;
    aWroteBRewrote: number; // a is "shipped", b is "rewrote"
    bWroteARewrote: number; // b is "shipped", a is "rewrote"
    fileTallies: Map<string, number>;
    lastClashAt: string;
    events: FrictionEvent[];
  };
  const buckets = new Map<string, Bucket>();

  for (const ev of events) {
    const shippedEmail = normalizeEmail(ev.shipped.authorEmail);
    const rewroteEmail = normalizeEmail(ev.rewrote.authorEmail);
    if (!shippedEmail || !rewroteEmail) continue;
    if (shippedEmail === rewroteEmail) continue;
    if (filter && shippedEmail !== filter && rewroteEmail !== filter) continue;

    const [a, b] =
      shippedEmail < rewroteEmail
        ? [shippedEmail, rewroteEmail]
        : [rewroteEmail, shippedEmail];
    const key = `${a}\x00${b}`;
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        a,
        b,
        aWroteBRewrote: 0,
        bWroteARewrote: 0,
        fileTallies: new Map(),
        lastClashAt: ev.atIso,
        events: [],
      };
      buckets.set(key, bucket);
    }

    if (shippedEmail === a) bucket.aWroteBRewrote += 1;
    else bucket.bWroteARewrote += 1;
    if (ev.atIso > bucket.lastClashAt) bucket.lastClashAt = ev.atIso;
    for (const f of ev.sharedFiles) {
      bucket.fileTallies.set(f, (bucket.fileTallies.get(f) ?? 0) + 1);
    }
    bucket.events.push(ev);
  }

  const pairs: NemesisPair[] = [];
  for (const bucket of buckets.values()) {
    const total = bucket.aWroteBRewrote + bucket.bWroteARewrote;
    if (total < minTotal) continue;
    const topFile =
      [...bucket.fileTallies.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
    // Most-recent events first for the example list.
    const examples = bucket.events
      .slice()
      .sort((x, y) => y.atIso.localeCompare(x.atIso))
      .slice(0, examplesPerPair);
    pairs.push({
      a: bucket.a,
      b: bucket.b,
      total,
      aWroteBRewrote: bucket.aWroteBRewrote,
      bWroteARewrote: bucket.bWroteARewrote,
      topFile,
      lastClashAt: bucket.lastClashAt,
      examples,
    });
  }

  pairs.sort((x, y) => {
    if (y.total !== x.total) return y.total - x.total;
    if (y.lastClashAt !== x.lastClashAt) return y.lastClashAt.localeCompare(x.lastClashAt);
    return x.a.localeCompare(y.a);
  });

  return {
    totalEvents: events.length,
    uniquePairs: pairs.length,
    windowDays: opts.windowDays ?? 365,
    pairs,
  };
}

/** Convenience wrapper — detect + aggregate in one call. */
export function buildNemesisReport(
  commits: Commit[],
  opts: DetectFrictionOptions = {},
): NemesisReport {
  const events = detectFriction(commits, opts);
  return aggregateNemesisPairs(events, opts);
}

// ─── helpers ─────────────────────────────────────────────────────────

function sameAuthor(a: Commit, b: Commit): boolean {
  const ea = normalizeEmail(a.authorEmail);
  const eb = normalizeEmail(b.authorEmail);
  if (ea && eb) return ea === eb;
  // Fall back to authorName when emails are missing/empty.
  return (a.authorName ?? "").toLowerCase() === (b.authorName ?? "").toLowerCase();
}

function normalizeEmail(email: string | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/** Decide whether `current` rewrites `prev`.  Returns kind or null. */
function classifyRewrite(
  current: Commit,
  prev: Commit,
  sharedFiles: Set<string>,
  cFiles: string[],
): FrictionEvent["kind"] | null {
  const text = `${current.subject}\n${current.body ?? ""}`;

  // Heuristic 1: explicit revert.
  if (REVERT_RE.test(text)) {
    if (mentionsHash(text, prev.hash) || mentionsHash(text, prev.shortHash)) {
      return "revert";
    }
    if (mentionsSubject(text, prev.subject) && sharedFiles.size > 0) {
      return "revert";
    }
    if (sharedFiles.size > 0) {
      // Revert keyword + shared file is a strong signal even without the hash.
      return "revert";
    }
  }

  // Heuristic 2: rewrite-by-overlap.
  // ≥50% of the lines/files c touched were last touched by a different
  // author.  We approximate "lines" with files because per-line blame data
  // isn't always indexed; this is a deliberate, documented simplification.
  //
  // Guardrail: require at least 2 shared files OR a multi-file rewrite
  // commit.  A single-file commit by B that happens to touch one of A's
  // files (e.g. a typo fix) is routine maintenance, not friction.
  if (
    cFiles.length >= 2 &&
    sharedFiles.size >= 2 &&
    sharedFiles.size / cFiles.length >= 0.5
  ) {
    return "overlap";
  }

  // Heuristic 3: fix/rewrite keyword + shared file.
  if (FIX_KEYWORDS_RE.test(text) && sharedFiles.size > 0) {
    // Avoid double-flagging the simplest "fix typo" run on a file already
    // shared trivially — require at least one of: a multi-file overlap
    // OR the keyword occurring outside the conventional-commit prefix.
    if (sharedFiles.size > 1 || hasNonPrefixKeyword(text)) {
      return "fix-keyword";
    }
  }

  return null;
}

function mentionsHash(text: string, hash: string | undefined): boolean {
  if (!hash) return false;
  const wanted = hash.slice(0, 7).toLowerCase();
  if (wanted.length < 7) return false;
  let m: RegExpExecArray | null;
  SHORT_HASH_RE.lastIndex = 0;
  while ((m = SHORT_HASH_RE.exec(text)) !== null) {
    if (m[1] && m[1].toLowerCase().startsWith(wanted)) return true;
  }
  return false;
}

function mentionsSubject(text: string, subject: string | undefined): boolean {
  if (!subject) return false;
  const trimmed = subject.trim();
  if (trimmed.length < 8) return false;
  return text.toLowerCase().includes(trimmed.toLowerCase());
}

/**
 * True when the keyword appears outside the conventional-commit prefix.
 * Avoids treating "fix(scope): ..." that happens to share one file as a
 * cross-author rewrite — that's just routine maintenance.
 */
function hasNonPrefixKeyword(text: string): boolean {
  const firstLine = text.split(/\n/, 1)[0] ?? "";
  const stripped = firstLine.replace(
    /^(fix|fixes|fixed|revert|reverts|rollback|undo|redo|rewrite|rewrote|rewriting)(\([^)]*\))?:\s*/i,
    "",
  );
  if (FIX_KEYWORDS_RE.test(stripped)) return true;
  // Body-mention also counts.
  const rest = text.slice(firstLine.length);
  return FIX_KEYWORDS_RE.test(rest);
}

function pickRepresentativeFile(sharedFiles: Set<string>): string {
  // Pick the lexicographically smallest non-noise file for stable output.
  const files = [...sharedFiles].filter((f) => !isNoiseFile(f)).sort();
  return files[0] ?? "(unknown)";
}
