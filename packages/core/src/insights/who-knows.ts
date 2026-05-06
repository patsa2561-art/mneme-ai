/**
 * `who-knows` — surface the people most likely to answer a question about
 * a topic, ranked by their git activity on commits/files matching that topic.
 *
 * Why this exists: every team has tribal knowledge. "Ask alice about Stripe"
 * is institutional memory. Mneme already indexes commits — making the
 * institutional memory queryable is a small step from the engine the project
 * already has.
 *
 * Scoring is intentionally simple and explainable. We avoid any "rank by
 * cosine similarity of author embedding" trickery: this is a counting
 * problem, and the user should be able to verify by running `git log
 * --author=alice -- <files>`.
 */

import type { MnemeStore } from "../store/sqlite.js";
import { isNoiseFile } from "../util/noise.js";

export interface ExpertCandidate {
  /** Author name as it appears in git. */
  name: string;
  email: string;
  /** Number of commits authored that match the topic. */
  commitCount: number;
  /** Last commit author-date in ISO; lets the caller flag stale experts. */
  lastTouch: string;
  /** Distinct files touched (capped at 1000 for memory hygiene). */
  filesTouched: number;
  /** Top files (top 5, noise-filtered, by touch count) the candidate
   *  worked on for this topic. Lets the asker verify "yes, they own
   *  src/auth/*". */
  topFiles?: string[];
  /** Score: log(commits + 1) × recency bonus. Higher = more authoritative. */
  score: number;
  /** Tier label derived from score + recency. */
  tier: "definitive" | "active" | "stale" | "occasional";
}

export interface WhoKnowsOptions {
  topic: string;
  /** Cap on candidates returned (default 5). */
  topN?: number;
  /** ISO date — ignore commits older than this for the recency bonus. */
  since?: string;
  /** Today, in ISO format. Lets tests inject a deterministic clock. */
  now?: Date;
}

const STALE_DAYS = 180;
const ACTIVE_DAYS = 90;

/**
 * Find people likely to know about `topic`. Searches commit messages,
 * subjects, bodies, and PR titles via FTS, then aggregates by author.
 */
export function whoKnows(store: MnemeStore, opts: WhoKnowsOptions): ExpertCandidate[] {
  const topN = opts.topN ?? 5;
  const now = opts.now ?? new Date();

  // Pull commits whose chunks match the topic via FTS.
  const ftsHits = store.ftsSearch(opts.topic, 200);
  if (ftsHits.length === 0) return [];

  // Aggregate by commit hash (one chunk per commit can appear multiple times).
  const commitHashes = new Set(ftsHits.map((h) => h.commitHash));

  type Bucket = {
    name: string;
    email: string;
    commitCount: number;
    lastTouch: string;
    files: Set<string>;
    /** Per-file touch counts (noise-filtered) for the topFiles ranking. */
    fileCounts: Map<string, number>;
  };
  const buckets = new Map<string, Bucket>();

  for (const hash of commitHashes) {
    const c = store.getCommit(hash);
    if (!c) continue;
    if (opts.since && c.authorDate < opts.since) continue;
    const key = `${c.authorName}|${c.authorEmail}`;
    if (!buckets.has(key)) {
      buckets.set(key, {
        name: c.authorName,
        email: c.authorEmail,
        commitCount: 0,
        lastTouch: c.authorDate,
        files: new Set(),
        fileCounts: new Map(),
      });
    }
    const b = buckets.get(key)!;
    b.commitCount += 1;
    if (c.authorDate > b.lastTouch) b.lastTouch = c.authorDate;
    for (const f of (c.files ?? []).slice(0, 50)) {
      b.files.add(f);
      if (!isNoiseFile(f)) {
        b.fileCounts.set(f, (b.fileCounts.get(f) ?? 0) + 1);
      }
    }
    if (b.files.size > 1000) {
      // Hygiene cap — extremely active authors on huge repos.
      const arr = [...b.files];
      b.files = new Set(arr.slice(0, 1000));
    }
  }

  const candidates: ExpertCandidate[] = [];
  for (const b of buckets.values()) {
    const score = scoreCandidate(b.commitCount, b.lastTouch, now);
    const topFiles = [...b.fileCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([path]) => path);
    candidates.push({
      name: b.name,
      email: b.email,
      commitCount: b.commitCount,
      lastTouch: b.lastTouch,
      filesTouched: b.files.size,
      topFiles,
      score,
      tier: tierOf(b.commitCount, b.lastTouch, now),
    });
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, topN);
}

/** log-based commit weight × recency multiplier. Pure function, easy to test. */
export function scoreCandidate(commitCount: number, lastTouchIso: string, now: Date): number {
  const lastTouch = new Date(lastTouchIso);
  const daysAgo = Math.max(0, (now.getTime() - lastTouch.getTime()) / (1000 * 60 * 60 * 24));
  // Recency bonus: 1.0 within 30 days, decays linearly to 0.3 at 365 days, then floor 0.3.
  const recency = daysAgo < 30 ? 1.0 : Math.max(0.3, 1.0 - (daysAgo - 30) / 480);
  // Volume: log scale to avoid one mega-contributor dominating.
  const volume = Math.log2(commitCount + 1);
  return volume * recency;
}

export function tierOf(commitCount: number, lastTouchIso: string, now: Date): ExpertCandidate["tier"] {
  const lastTouch = new Date(lastTouchIso);
  const daysAgo = (now.getTime() - lastTouch.getTime()) / (1000 * 60 * 60 * 24);
  if (commitCount >= 10 && daysAgo <= ACTIVE_DAYS) return "definitive";
  if (commitCount >= 3 && daysAgo <= ACTIVE_DAYS) return "active";
  if (daysAgo > STALE_DAYS) return "stale";
  return "occasional";
}

/**
 * Verdict-shaped summary built from the full candidate list. Surfaces the
 * single most likely person to ask + a confidence percentage + a fallback
 * recommendation, instead of letting the user scan a list of names.
 */
export interface ExpertVerdict {
  /** The single most likely expert (or undefined when no candidates). */
  topExpert?: ExpertCandidate;
  /** Confidence percentage 0..100 — share of total commits attributed to the top. */
  confidencePct: number;
  /** Backup expert if the top is stale or has insufficient share. */
  backup?: ExpertCandidate;
  /** A 1-line risk note when the top expert is stale or shares too thinly. */
  risk?: string;
  /** Total commits matched across all candidates (sum of commitCount). */
  totalCommits: number;
}

export function whoKnowsVerdict(candidates: ExpertCandidate[]): ExpertVerdict {
  if (candidates.length === 0) {
    return { confidencePct: 0, totalCommits: 0 };
  }
  const sorted = [...candidates].sort((a, b) => b.score - a.score);
  const top = sorted[0]!;
  const total = candidates.reduce((s, c) => s + c.commitCount, 0);
  const pct = total === 0 ? 0 : Math.round((top.commitCount / total) * 100);
  const backup = sorted[1];

  let risk: string | undefined;
  if (top.tier === "stale") {
    risk = `Top expert is STALE — last touched ${formatDaysAgo(top.lastTouch)} ago. Consider asking ${backup?.name ?? "someone with recent activity"} instead.`;
  } else if (pct < 30 && candidates.length >= 3) {
    risk = `No single dominant expert — ${candidates.length} people share the work. Knowledge is well-distributed but no one will know everything.`;
  } else if (top.commitCount === 1) {
    risk = "Top expert touched the topic only once — treat as weak signal.";
  }

  return { topExpert: top, confidencePct: pct, backup, risk, totalCommits: total };
}

function formatDaysAgo(iso: string): string {
  const d = (Date.now() - new Date(iso).getTime()) / 86_400_000;
  if (d < 30) return `${Math.round(d)}d`;
  if (d < 365) return `${Math.round(d / 30)}mo`;
  return `${(d / 365).toFixed(1)}y`;
}
