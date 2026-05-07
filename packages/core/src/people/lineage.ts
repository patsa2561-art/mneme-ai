/**
 * `mneme lineage <target>` — philosophical inheritance of code.
 *
 * Thesis: `git blame` says who wrote line N. `mneme lineage` says
 * *whose interpretation of whose intent currently lives in this code*.
 *
 * Algorithm (v1):
 *
 *   1. Resolve <target> to a sequence of commits that touched it, in time
 *      order.
 *   2. For each commit C_i in the chain, compute:
 *        intent_continuity (0..1) — how much of the prior commit's stated
 *        intent (subject + body, fused with HTC abstract if available) is
 *        preserved by C_i's stated intent.
 *        diff_size — insertions + deletions for the target file.
 *   3. Walk forward.  Author of C_0 starts with full ownership for that
 *      first commit.  At C_i, ownership is:
 *        weights_i  =  intent_continuity * weights_{i-1}
 *                   +  (1 - intent_continuity) * unit(authorOf(C_i))
 *   4. After the last commit, normalise to percentages.
 *
 * Output is a ranked list of authors with a plain-English narrative:
 *   "70 % Alice's design as interpreted by Bob's refactor, then preserved
 *    through Carol's extension."
 *
 * Honest framing — semantic ownership, not legal authorship:
 *   - This is NOT `git blame`.  A 5-line refactor that changes the entire
 *     intent of a function semantically owns more than a 500-line stylistic
 *     pass.
 *   - We use commit-message similarity (Jaccard on bigrams) by default;
 *     HTC abstracts (when present) layer on top to deepen the signal.
 *   - Results are interpretation-dependent — we expose the per-commit
 *     continuity score so reviewers can verify Mneme's read of "intent
 *     preserved".
 *
 * Edge cases:
 *   - Single-commit file → "Single author, no lineage to compute".
 *   - Target resolves to a file:func form → we still walk the file's
 *     full history (function-level slicing is v2).
 *
 * --json shape (stable):
 *
 *   {
 *     "target": "packages/core/src/store/index.ts",
 *     "ownership": [
 *       { "author": "alice@x.io", "name": "Alice", "percent": 70.2,
 *         "role": "design" },
 *       ...
 *     ],
 *     "narrative": "70.2 % Alice's design …",
 *     "timeline": [
 *       { "shortHash": "abc1234", "author": "alice@x.io", "date": "...",
 *         "subject": "...", "intentContinuity": 1.0, "diffSize": 120,
 *         "ownershipShift": "+70 % Alice" }, ...
 *     ],
 *     "totalCommits": 12,
 *     "headsUp": "..."  // when applicable
 *   }
 */
import type { MnemeStore } from "../store/sqlite.js";
import type { Commit, FileChange } from "../types.js";
import { rowToCommit } from "../util/index.js";
import { getAbstract } from "../htc/storage.js";

export interface LineageOptions {
  cwd: string;
  /** File path or `file.ts:funcName` (function-level v2; v1 walks the whole file). */
  target: string;
  /** Max commits to walk (default 20 — keeps results scannable). */
  depth?: number;
}

export interface OwnershipShare {
  author: string; // email
  name: string;
  percent: number;
  /** Coarse role inferred from contribution shape. */
  role: "design" | "refactor" | "extension" | "polish";
}

export interface TimelineEntry {
  shortHash: string;
  hash: string;
  author: string;
  authorName: string;
  date: string;
  subject: string;
  intentContinuity: number; // 0..1
  diffSize: number;
  /** Snapshot of ownership AFTER this commit (top 3, summarized). */
  ownershipAfter: Array<{ email: string; percent: number }>;
}

export interface LineageReport {
  target: string;
  resolvedFilePath: string;
  /** When user asked for file:func — we record that, even if v1 walks file. */
  functionFilter?: string;
  totalCommits: number;
  /** Ranked ownership AFTER the last commit. */
  ownership: OwnershipShare[];
  /** One-line plain-English summary. */
  narrative: string;
  timeline: TimelineEntry[];
  /** Optional friendly notice. */
  headsUp?: string;
}

/* ───────────────────────  Pure helpers  ─────────────────────── */

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "of",
  "to",
  "for",
  "in",
  "on",
  "at",
  "is",
  "are",
  "was",
  "were",
  "be",
  "by",
  "with",
  "from",
  "as",
  "into",
  "this",
  "that",
  "it",
  "its",
  "if",
  "then",
  "so",
  "we",
  "i",
  "you",
  "they",
  "do",
  "does",
  "not",
  "no",
]);

/** Tokenise text → lowercase words, ≥2 chars, stopwords removed. */
export function tokenizeForLineage(s: string): string[] {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9_\s]+/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

/** Bigrams (consecutive token pairs) — captures "fix bug" vs "bug fix". */
export function bigrams(tokens: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < tokens.length - 1; i++) {
    out.add(`${tokens[i]} ${tokens[i + 1]}`);
  }
  return out;
}

/** Combined Jaccard on bigrams (60 %) + unigrams (40 %).
 *  Bigrams alone are too brittle on short commit messages — a single
 *  word overlap (e.g. shared topic "payment") should still register some
 *  continuity.  We blend both signals.
 */
export function intentSimilarity(a: string, b: string): number {
  if (!a.trim() || !b.trim()) return 0;
  const ta = tokenizeForLineage(a);
  const tb = tokenizeForLineage(b);
  const uniSim = jaccardUnigram(new Set(ta), new Set(tb));
  const bgA = bigrams(ta);
  const bgB = bigrams(tb);
  if (bgA.size === 0 || bgB.size === 0) return uniSim;
  let intersect = 0;
  for (const x of bgA) if (bgB.has(x)) intersect++;
  const union = bgA.size + bgB.size - intersect;
  const bgSim = union === 0 ? 0 : intersect / union;
  // Blend: bigrams capture phrasing, unigrams capture topic.  60/40 favours
  // phrasing without making single-word topic overlap invisible.
  return 0.6 * bgSim + 0.4 * uniSim;
}

function jaccardUnigram(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersect = 0;
  for (const x of a) if (b.has(x)) intersect++;
  const union = a.size + b.size - intersect;
  return union === 0 ? 0 : intersect / union;
}

/** Resolve `<file>` or `<file>:<funcName>` → { filePath, functionFilter }. */
export function parseTarget(target: string): {
  filePath: string;
  functionFilter?: string;
} {
  // Windows paths can contain `:` after drive letter, but our targets are
  // always repo-relative — split on the LAST colon only when the suffix
  // looks like a function name (alphanumeric / underscore / $).
  const last = target.lastIndexOf(":");
  if (last < 0) return { filePath: target };
  const tail = target.slice(last + 1);
  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(tail)) {
    return { filePath: target.slice(0, last), functionFilter: tail };
  }
  return { filePath: target };
}

/* ───────────────────────  Ownership walk  ─────────────────────── */

export interface CommitForLineage {
  commit: Commit;
  /** insertions+deletions for the target file (not the whole commit). */
  diffSize: number;
}

export interface WalkInput {
  /** Chronological list of commits touching the target, oldest first. */
  commits: CommitForLineage[];
  /** Optional HTC abstract per commit hash (deepens intent signal). */
  abstractsByHash?: Map<string, string>;
}

/** Pure ownership walker — testable without a real store. */
export function walkOwnership(input: WalkInput): {
  ownership: Map<string, number>;
  timeline: Array<{
    hash: string;
    intentContinuity: number;
    diffSize: number;
    snapshot: Array<{ email: string; percent: number }>;
  }>;
} {
  const timeline: Array<{
    hash: string;
    intentContinuity: number;
    diffSize: number;
    snapshot: Array<{ email: string; percent: number }>;
  }> = [];
  let weights = new Map<string, number>();
  let priorIntent = "";

  for (let i = 0; i < input.commits.length; i++) {
    const { commit, diffSize } = input.commits[i]!;
    const author = commit.authorEmail || "(unknown)";
    const intent = composeIntent(commit, input.abstractsByHash?.get(commit.hash));

    let cont: number;
    if (i === 0) {
      // First commit: ownership is 100 % its author.
      weights = new Map([[author, 1]]);
      cont = 1;
    } else {
      cont = intentSimilarity(priorIntent, intent);
      // Tiny-diff guard: a 1-5 line tweak almost never re-authors the
      // intent of a file, regardless of how the commit message reads.
      // Floor continuity at a high value when the diff is small.
      //   ≤5  lines → cont ≥ 0.90
      //   ≤20 lines → cont ≥ 0.70
      //   ≤50 lines → cont ≥ 0.40
      //   else      → no floor
      let floor = 0;
      if (diffSize <= 5) floor = 0.9;
      else if (diffSize <= 20) floor = 0.7;
      else if (diffSize <= 50) floor = 0.4;
      cont = Math.min(1, Math.max(cont, floor));
      // Mix forward.
      const next = new Map<string, number>();
      for (const [k, v] of weights) next.set(k, v * cont);
      next.set(author, (next.get(author) ?? 0) + (1 - cont));
      // Renormalise (paranoia — should already sum to ~1).
      const total = Array.from(next.values()).reduce((s, v) => s + v, 0);
      if (total > 0) for (const k of next.keys()) next.set(k, next.get(k)! / total);
      weights = next;
    }

    priorIntent = intent;

    const snapshot = Array.from(weights.entries())
      .map(([email, w]) => ({ email, percent: w * 100 }))
      .sort((a, b) => b.percent - a.percent)
      .slice(0, 3);

    timeline.push({ hash: commit.hash, intentContinuity: cont, diffSize, snapshot });
  }

  return { ownership: weights, timeline };
}

function composeIntent(c: Commit, abstract?: string): string {
  const parts = [c.subject, c.body];
  if (abstract) parts.push(abstract);
  return parts.filter(Boolean).join("\n");
}

/* ───────────────────────  Role inference  ─────────────────────── */

/**
 * Coarse role for each owner — based on ownership %, diff-size profile,
 * and recency in the chain.
 *
 *   design     — first commit, ≥40 % ownership
 *   refactor   — non-first commit with ≥30 % ownership AND a large diff
 *   extension  — non-first commit with ≥15 % ownership
 *   polish     — anything else
 */
export function inferRoles(
  ownership: Map<string, number>,
  commits: CommitForLineage[],
): Map<string, OwnershipShare["role"]> {
  const roles = new Map<string, OwnershipShare["role"]>();
  if (commits.length === 0) return roles;
  const firstAuthor = commits[0]!.commit.authorEmail;
  // For each owner, find their largest contribution diff.
  const maxDiff = new Map<string, number>();
  const firstCommitAuthors = new Set<string>([firstAuthor]);
  for (const cl of commits) {
    const a = cl.commit.authorEmail;
    if (cl.diffSize > (maxDiff.get(a) ?? 0)) maxDiff.set(a, cl.diffSize);
  }
  for (const [email, w] of ownership) {
    if (firstCommitAuthors.has(email) && w >= 0.4) {
      roles.set(email, "design");
      continue;
    }
    const md = maxDiff.get(email) ?? 0;
    if (w >= 0.3 && md >= 50) {
      roles.set(email, "refactor");
    } else if (w >= 0.15) {
      roles.set(email, "extension");
    } else {
      roles.set(email, "polish");
    }
  }
  return roles;
}

/* ───────────────────────  Narrative generator  ─────────────────────── */

const ROLE_PHRASES: Record<OwnershipShare["role"], string> = {
  design: "design",
  refactor: "refactor",
  extension: "extension",
  polish: "polish",
};

export function buildNarrative(ownership: OwnershipShare[]): string {
  if (ownership.length === 0) return "No ownership data — nobody has been credited.";
  const top = ownership.slice(0, 3);
  const pieces = top.map(
    (o) => `${o.percent.toFixed(0)}% ${o.name || o.author}'s ${ROLE_PHRASES[o.role]}`,
  );
  if (top.length === 1) return `${pieces[0]}.`;
  if (top.length === 2) return `${pieces[0]} + ${pieces[1]}.`;
  return `${pieces[0]} + ${pieces[1]} + ${pieces[2]}.`;
}

/* ───────────────────────  Top-level builder  ─────────────────────── */

/**
 * Compute lineage from data already in the Mneme store.
 *
 * Caller is responsible for opening the store and resolving target.  This
 * function is the pure data path; the CLI wraps it with renderers.
 */
export function buildLineageReport(
  store: MnemeStore,
  opts: LineageOptions,
): LineageReport {
  const { filePath, functionFilter } = parseTarget(opts.target);
  const depth = Math.max(1, opts.depth ?? 20);

  // 1 — every commit that touched this file.  Use file_changes table.
  const rows = store.db
    .prepare(
      `SELECT c.* , fc.insertions, fc.deletions
       FROM file_changes fc
       JOIN commits c ON c.hash = fc.commit_hash
       WHERE fc.path = ?
       ORDER BY c.author_date ASC`,
    )
    .all(filePath) as Array<Record<string, unknown>>;

  if (rows.length === 0) {
    return {
      target: opts.target,
      resolvedFilePath: filePath,
      functionFilter,
      totalCommits: 0,
      ownership: [],
      narrative:
        "No commits in the Mneme index touched this path. Run `mneme index`, or check the path.",
      timeline: [],
      headsUp: `No commits found for "${filePath}" — the path may be wrong, or the file may not be indexed yet.`,
    };
  }

  const totalCommits = rows.length;
  // Take the LAST `depth` commits — most recent edits dominate semantic
  // ownership for the current snapshot of code.
  const sliceFrom = Math.max(0, rows.length - depth);
  const sliced = rows.slice(sliceFrom);

  const commits: CommitForLineage[] = sliced.map((r) => ({
    commit: rowToCommit(r, store),
    diffSize: Number(r.insertions ?? 0) + Number(r.deletions ?? 0),
  }));

  // Single-commit graceful path.
  if (commits.length === 1) {
    const c = commits[0]!;
    return {
      target: opts.target,
      resolvedFilePath: filePath,
      functionFilter,
      totalCommits,
      ownership: [
        {
          author: c.commit.authorEmail,
          name: c.commit.authorName || c.commit.authorEmail,
          percent: 100,
          role: "design",
        },
      ],
      narrative: `Single author, no lineage to compute — ${c.commit.authorName || c.commit.authorEmail} owns 100% of this file's intent.`,
      timeline: [
        {
          shortHash: c.commit.shortHash,
          hash: c.commit.hash,
          author: c.commit.authorEmail,
          authorName: c.commit.authorName,
          date: c.commit.authorDate,
          subject: c.commit.subject,
          intentContinuity: 1,
          diffSize: c.diffSize,
          ownershipAfter: [{ email: c.commit.authorEmail, percent: 100 }],
        },
      ],
      headsUp: "Single-commit file — no lineage chain.",
    };
  }

  // 2 — fetch HTC abstracts where available (best-effort).
  const abstractsByHash = new Map<string, string>();
  for (const cl of commits) {
    const ab = getAbstract(store, cl.commit.hash);
    if (ab?.abstract) abstractsByHash.set(cl.commit.hash, ab.abstract);
  }

  // 3 — walk.
  const { ownership: ownershipMap, timeline: walked } = walkOwnership({
    commits,
    abstractsByHash: abstractsByHash.size > 0 ? abstractsByHash : undefined,
  });

  // 4 — names.
  const nameByEmail = new Map<string, string>();
  for (const cl of commits) {
    if (cl.commit.authorName) nameByEmail.set(cl.commit.authorEmail, cl.commit.authorName);
  }

  // 5 — role inference.
  const roles = inferRoles(ownershipMap, commits);

  // 6 — assemble ranked ownership shares (≥1 % only — below that is noise).
  const ownership: OwnershipShare[] = Array.from(ownershipMap.entries())
    .map(([email, w]) => ({
      author: email,
      name: nameByEmail.get(email) ?? email,
      percent: round(w * 100, 1),
      role: roles.get(email) ?? "polish",
    }))
    .filter((o) => o.percent >= 1)
    .sort((a, b) => b.percent - a.percent);

  // 7 — narrative + timeline shape.
  const narrative = buildNarrative(ownership);
  const timeline: TimelineEntry[] = walked.map((w, i) => {
    const c = commits[i]!.commit;
    return {
      shortHash: c.shortHash,
      hash: c.hash,
      author: c.authorEmail,
      authorName: c.authorName,
      date: c.authorDate,
      subject: c.subject,
      intentContinuity: round(w.intentContinuity, 3),
      diffSize: w.diffSize,
      ownershipAfter: w.snapshot.map((s) => ({
        email: s.email,
        percent: round(s.percent, 1),
      })),
    };
  });

  // 8 — heads-up.
  const headsUpParts: string[] = [];
  if (totalCommits > depth) {
    headsUpParts.push(
      `Only the most recent ${depth} of ${totalCommits} commits were walked; older context omitted (raise --depth to widen).`,
    );
  }
  if (functionFilter) {
    headsUpParts.push(
      `Function-level filtering ("${functionFilter}") is not yet implemented — file-level lineage shown.`,
    );
  }
  if (abstractsByHash.size === 0) {
    headsUpParts.push(
      "HTC abstracts unavailable — falling back to commit-message similarity. Run `mneme htc-build` to deepen the signal.",
    );
  }

  return {
    target: opts.target,
    resolvedFilePath: filePath,
    functionFilter,
    totalCommits,
    ownership,
    narrative,
    timeline,
    headsUp: headsUpParts.length > 0 ? headsUpParts.join(" ") : undefined,
  };
}

/** Helper exposed for tests — accept a list of file changes and assert
 *  whether `path` was touched. */
export function fileChangesIncludePath(changes: FileChange[], path: string): boolean {
  return changes.some((c) => c.path === path);
}

function round(n: number, places: number): number {
  const f = Math.pow(10, places);
  return Math.round(n * f) / f;
}
