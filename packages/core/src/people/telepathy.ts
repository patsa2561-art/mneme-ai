/**
 * `mneme telepathy` — latent collaboration network.
 *
 * The thesis: GitHub shows EXPLICIT collaboration (PR review, co-author).
 * Mneme surfaces INVISIBLE collaboration — pairs of authors who never
 * co-authored a commit but whose changes are behaviorally coupled.
 *
 *   Alice edits packages/core/src/auth.ts
 *      ↓ within N hours
 *   Bob   edits packages/cli/src/auth.ts on the same topic
 *      ↑ pattern repeats across many commits
 *
 * They never spoke. The repo proves they're a team.
 *
 * Algorithm (deterministic — no LLM):
 *   1. Walk every commit C by author A touching files F_A at time t_A.
 *   2. Find commits C' by author B (B ≠ A, B not co-author of C) within
 *      the time window [t_A, t_A + window_hours], touching files F_B.
 *   3. Compute topic overlap: shared directories at depth ≥ 2 between
 *      F_A and F_B. Score >= 1 shared topic counts as a "telepathic event".
 *   4. For each unordered pair {A, B}, score =
 *        (events / opportunities) × log(1 + events).
 *   5. Filter pairs with < min_events events.
 *   6. Output ranked list with the top shared topic + last-seen date.
 *
 * Pure data over a `MnemeStore` — no I/O beyond the SQLite query.
 */

import type { MnemeStore } from "../store/sqlite.js";

// ─── public types ─────────────────────────────────────────────────────

export interface TelepathyOptions {
  /** Time window in hours within which two authors' commits "rhyme". */
  windowHours?: number;
  /** Minimum events for a pair to be reported. */
  minEvents?: number;
  /** Cap on results returned. */
  topN?: number;
  /** Filter — only return pairs containing this email. */
  authorEmail?: string;
}

export interface TelepathyEvent {
  /** Hash of the earlier commit in the pair. */
  earlierHash: string;
  /** Hash of the later commit in the pair. */
  laterHash: string;
  /** ISO date of the earlier commit. */
  earlierAt: string;
  /** ISO date of the later commit. */
  laterAt: string;
  /** Hours elapsed between the two commits (>=0). */
  gapHours: number;
  /** Shared topic key (directory at depth ≥ 2). */
  topic: string;
}

export interface TelepathyPair {
  /** Author A — alphabetically lower email. */
  authorA: { name: string; email: string };
  /** Author B — alphabetically higher email. */
  authorB: { name: string; email: string };
  /** Number of telepathic events recorded for this pair. */
  events: number;
  /** Opportunities — every (A-commit, B-commit) within the window. */
  opportunities: number;
  /**
   * Telepathy score: (events / opportunities) × log(1 + events).
   * Range roughly 0..3 — higher = stronger latent collaboration.
   */
  score: number;
  /** Top shared topic + how many events touched it. */
  topTopic: { topic: string; count: number };
  /** Up to 3 most-recent events (newest first). */
  recentEvents: TelepathyEvent[];
  /** ISO date of the most recent event. */
  lastSeenAt: string;
}

export interface TelepathyResult {
  pairs: TelepathyPair[];
  /** Repo-wide stats — used by the renderer for an honest disclaimer. */
  stats: {
    /** Distinct authors observed (regardless of pair filter). */
    authorCount: number;
    /** Total commits scanned. */
    commitCount: number;
    /** Total candidate pairs evaluated (before min-events filter). */
    pairsEvaluated: number;
    /** Window in hours actually used. */
    windowHours: number;
  };
}

// ─── implementation ───────────────────────────────────────────────────

const DEFAULT_WINDOW_HOURS = 48;
const DEFAULT_MIN_EVENTS = 3;
const DEFAULT_TOP_N = 10;

/**
 * Extract topic keys from a list of file paths.
 *
 * A "topic" is the directory at depth ≥ 2 (e.g. "packages/core/src" for
 * "packages/core/src/audit/baseline.ts"). Depth 2 strikes the right balance
 * between specificity (so "src" alone doesn't match across the whole repo)
 * and recall (so files in adjacent subdirs still rhyme). Top-level files
 * (no slash, or single segment) get a single top-level token.
 */
export function topicsForPaths(paths: string[]): Set<string> {
  const out = new Set<string>();
  for (const p of paths) {
    if (!p) continue;
    const norm = p.replace(/\\/g, "/").replace(/^\.?\/+/, "");
    const parts = norm.split("/").filter(Boolean);
    if (parts.length === 0) continue;
    if (parts.length === 1) {
      out.add(parts[0]!);
      continue;
    }
    // Use the parent directory of the file as the topic.
    // For deep paths, use depth-3 — avoids overly-broad topics like "packages".
    const depth = Math.min(parts.length - 1, 3);
    out.add(parts.slice(0, depth).join("/"));
  }
  return out;
}

/** Co-author email extraction from a commit body — git trailer convention. */
export function extractCoAuthorEmails(body: string): string[] {
  if (!body) return [];
  const out = new Set<string>();
  const re = /Co-authored-by:\s*[^<\n\r]+<([^>\n\r]+)>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(body)) !== null) {
    out.add(m[1]!.trim().toLowerCase());
  }
  return Array.from(out);
}

interface CommitRow {
  hash: string;
  author_name: string;
  author_email: string;
  author_date: string;
  body: string;
}

interface CommitWithTopics {
  hash: string;
  authorName: string;
  authorEmail: string;
  ts: number;
  topics: Set<string>;
  coAuthors: Set<string>;
}

/** Run telepathy analysis. Pure with respect to the store snapshot. */
export function telepathy(store: MnemeStore, opts: TelepathyOptions = {}): TelepathyResult {
  const windowHours = Math.max(1, opts.windowHours ?? DEFAULT_WINDOW_HOURS);
  const minEvents = Math.max(1, opts.minEvents ?? DEFAULT_MIN_EVENTS);
  const topN = Math.max(1, opts.topN ?? DEFAULT_TOP_N);
  const authorFilter = opts.authorEmail?.trim().toLowerCase();
  const windowMs = windowHours * 60 * 60 * 1000;

  // Pull commits + their files in one go, sorted ascending by time.
  // file_changes is large — but we materialize per-commit topic sets so each
  // file is only string-handled once.
  const commitRows = store.db
    .prepare(
      `SELECT hash, author_name, author_email, author_date, body
         FROM commits
        ORDER BY author_date ASC`,
    )
    .all() as unknown as CommitRow[];

  const fileRows = store.db
    .prepare("SELECT commit_hash, path FROM file_changes")
    .all() as Array<{ commit_hash: string; path: string }>;

  const filesByCommit = new Map<string, string[]>();
  for (const r of fileRows) {
    let list = filesByCommit.get(r.commit_hash);
    if (!list) {
      list = [];
      filesByCommit.set(r.commit_hash, list);
    }
    list.push(r.path);
  }

  const authorEmails = new Set<string>();
  const commits: CommitWithTopics[] = [];
  for (const r of commitRows) {
    const ts = Date.parse(r.author_date);
    if (!Number.isFinite(ts)) continue;
    const email = (r.author_email ?? "").toLowerCase();
    authorEmails.add(email);
    commits.push({
      hash: r.hash,
      authorName: r.author_name,
      authorEmail: email,
      ts,
      topics: topicsForPaths(filesByCommit.get(r.hash) ?? []),
      coAuthors: new Set(extractCoAuthorEmails(r.body)),
    });
  }

  // Pair accumulator: key = "emailA|emailB" with emailA < emailB lexically.
  interface PairAcc {
    authorA: { name: string; email: string };
    authorB: { name: string; email: string };
    events: number;
    opportunities: number;
    topicCounts: Map<string, number>;
    eventList: TelepathyEvent[];
  }
  const pairs = new Map<string, PairAcc>();

  // Sliding window — for each commit, look forward until ts gap exceeds window.
  for (let i = 0; i < commits.length; i++) {
    const a = commits[i]!;
    if (a.topics.size === 0) continue;
    for (let j = i + 1; j < commits.length; j++) {
      const b = commits[j]!;
      const gapMs = b.ts - a.ts;
      if (gapMs > windowMs) break; // commits are sorted ascending — safe to stop.
      if (gapMs < 0) continue;
      if (a.authorEmail === b.authorEmail) continue;
      // Skip when one author appears as a co-author on the other commit —
      // that would be EXPLICIT collaboration, not telepathy.
      if (a.coAuthors.has(b.authorEmail)) continue;
      if (b.coAuthors.has(a.authorEmail)) continue;
      if (b.topics.size === 0) continue;

      // Optional author filter — only count if either side matches.
      if (authorFilter && a.authorEmail !== authorFilter && b.authorEmail !== authorFilter) {
        continue;
      }

      // Order pair canonically by email.
      const [first, second] =
        a.authorEmail < b.authorEmail ? [a, b] : [b, a];
      const key = `${first.authorEmail}|${second.authorEmail}`;
      let acc = pairs.get(key);
      if (!acc) {
        acc = {
          authorA: { name: first.authorName, email: first.authorEmail },
          authorB: { name: second.authorName, email: second.authorEmail },
          events: 0,
          opportunities: 0,
          topicCounts: new Map(),
          eventList: [],
        };
        pairs.set(key, acc);
      }
      acc.opportunities++;

      // Topic overlap: any shared directory.
      let shared: string[] = [];
      for (const t of a.topics) {
        if (b.topics.has(t)) shared.push(t);
      }
      if (shared.length === 0) continue;

      // The "best" shared topic is the longest path (most specific).
      shared.sort((x, y) => y.length - x.length);
      const topic = shared[0]!;

      acc.events++;
      acc.topicCounts.set(topic, (acc.topicCounts.get(topic) ?? 0) + 1);
      acc.eventList.push({
        earlierHash: a.hash,
        laterHash: b.hash,
        earlierAt: new Date(a.ts).toISOString(),
        laterAt: new Date(b.ts).toISOString(),
        gapHours: round(gapMs / 3_600_000, 2),
        topic,
      });
    }
  }

  const allPairs: TelepathyPair[] = [];
  for (const acc of pairs.values()) {
    if (acc.events < minEvents) continue;
    if (acc.opportunities === 0) continue;
    const ratio = acc.events / acc.opportunities;
    const score = ratio * Math.log(1 + acc.events);

    let topTopic = { topic: "(none)", count: 0 };
    for (const [topic, count] of acc.topicCounts) {
      if (count > topTopic.count) topTopic = { topic, count };
    }

    acc.eventList.sort((x, y) => Date.parse(y.laterAt) - Date.parse(x.laterAt));
    const lastSeen = acc.eventList[0]?.laterAt ?? "";

    allPairs.push({
      authorA: acc.authorA,
      authorB: acc.authorB,
      events: acc.events,
      opportunities: acc.opportunities,
      score: round(score, 3),
      topTopic,
      recentEvents: acc.eventList.slice(0, 3),
      lastSeenAt: lastSeen,
    });
  }

  allPairs.sort((a, b) => b.score - a.score || b.events - a.events);
  const top = allPairs.slice(0, topN);

  return {
    pairs: top,
    stats: {
      authorCount: authorEmails.size,
      commitCount: commits.length,
      pairsEvaluated: pairs.size,
      windowHours,
    },
  };
}

function round(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}
