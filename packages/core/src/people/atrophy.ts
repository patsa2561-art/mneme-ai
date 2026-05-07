/**
 * `mneme atrophy` — knowledge half-life clock.
 *
 * The thesis: GitHub's "last touched" timestamp is shallow. Real human
 * knowledge decays. This module models the Ebbinghaus forgetting curve
 * over (author × file) pairs:
 *
 *   "Alice last touched auth.ts 18 months ago; her knowledge there is
 *    73% decayed — needs ~3 hours of re-reading."
 *
 * Algorithm (deterministic — no LLM):
 *   knowledge_score(author, file) =
 *     exp(-last_touch_days / half_life_days)
 *       × (1 - exp(-touch_count / 5))
 *
 *   The first factor is exponential decay (half_life_days controls rate).
 *   The second factor weighs depth of familiarity — one-touch authors get
 *   a fractional credit, while ≥10 touches saturate near 1.0.
 *
 *   Aggregations:
 *     per-author:  total knowledge mass = Σ knowledge_score over all files.
 *     per-file:    "who still remembers?" — authors with score > 0.3.
 *     at-risk:     files where every remaining expert has score < 0.3.
 *
 * Pure data over a `MnemeStore` — no I/O beyond SQLite queries.
 */

import type { MnemeStore } from "../store/sqlite.js";

// ─── public types ─────────────────────────────────────────────────────

export interface AtrophyOptions {
  /** Half-life in days for the forgetting curve (default 180 = 6 months). */
  halfLifeDays?: number;
  /** Cap on results per section (top authors, top at-risk files, etc.). */
  topN?: number;
  /** ISO date string used as "today" — exposed for deterministic tests. */
  asOf?: string;
  /** Cap on per-file knower lists. */
  maxKnowersPerFile?: number;
  /** Glob-fragments to skip (lockfiles, generated dirs, etc.). */
  excludePatterns?: string[];
}

export interface AuthorKnowledge {
  name: string;
  email: string;
  /** Sum of knowledge_score across every file the author ever touched. */
  knowledgeMass: number;
  /** Number of distinct files in their knowledge set. */
  filesKnown: number;
  /** Files where the author is still > 0.3 fresh. */
  filesStillFresh: number;
  /** ISO date of the author's most recent commit (any file). */
  lastActiveAt: string;
}

export interface FileExpert {
  name: string;
  email: string;
  /** 0..1 — knowledge_score for this (author, file). */
  knowledge: number;
  /** Days since last touch by this author. */
  lastTouchDaysAgo: number;
  /** Number of distinct commits touching this file. */
  touchCount: number;
}

export interface FileKnowledge {
  filePath: string;
  /** Total commits touching the file (any author). */
  totalTouches: number;
  /** Authors with knowledge > 0.3, sorted by knowledge desc. */
  liveExperts: FileExpert[];
  /** All authors who ever touched the file, freshness-sorted. */
  allKnowers: FileExpert[];
  /**
   * "ghost code risk" tier — derived from the freshest remaining knowledge:
   *   safe:     someone is ≥ 0.7 fresh
   *   warn:     freshest knowledge is 0.3 .. 0.7 — knowledge is fading
   *   at-risk:  freshest knowledge < 0.3 — code may be ghosted
   */
  tier: "safe" | "warn" | "at-risk";
  /** Number that drove the tier — the freshest knowledge score in `allKnowers`. */
  freshestKnowledge: number;
}

export interface AtrophyReport {
  /** Per-author roll-up across the whole repo. */
  authors: AuthorKnowledge[];
  /** Files at risk — sorted by importance × freshness gap. */
  atRiskFiles: FileKnowledge[];
  /** Stats — populated for the renderer. */
  stats: {
    halfLifeDays: number;
    asOf: string;
    authorCount: number;
    fileCount: number;
    totalCommits: number;
    /** How many files have at least one live expert (knowledge > 0.3). */
    filesWithLiveExpert: number;
    /** How many files have NO live expert. */
    ghostedFiles: number;
    /**
     * Of the ghosted files, how many had ≥2 total touches — i.e. real
     * historical expertise that has now decayed. Single-touch files are
     * "shallow" rather than "ghosted" and tracked separately.
     */
    ghostedDeepFiles: number;
    /** Single-touch files with no live expert — never deep to begin with. */
    shallowFiles: number;
  };
}

// ─── implementation ───────────────────────────────────────────────────

const DEFAULT_HALF_LIFE_DAYS = 180;
const DEFAULT_TOP_N = 10;
const DEFAULT_MAX_KNOWERS_PER_FILE = 8;
const FRESHNESS_THRESHOLD = 0.3;
const SAFE_THRESHOLD = 0.7;
const FAMILIARITY_DENOM = 5;

const DEFAULT_EXCLUDES = [
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "node_modules/",
  "dist/",
  ".min.js",
  ".min.css",
  "/generated/",
];

interface PerPair {
  filePath: string;
  authorName: string;
  authorEmail: string;
  touchCount: number;
  lastTouchIso: string;
}

/**
 * Knowledge score for a single (author, file) pair.
 *
 *   exp(-days/halfLife) × (1 - exp(-touches/5))
 *
 * `days` and `touches` must be non-negative; halfLifeDays must be > 0.
 * Result is clamped to [0, 1].
 */
export function knowledgeScore(
  daysSinceTouch: number,
  touchCount: number,
  halfLifeDays: number,
): number {
  if (halfLifeDays <= 0) return 0;
  const d = Math.max(0, daysSinceTouch);
  const t = Math.max(0, touchCount);
  // Half-life decay: convert from "half-life" to natural-log rate.
  const decay = Math.exp((-d * Math.LN2) / halfLifeDays);
  const familiarity = 1 - Math.exp(-t / FAMILIARITY_DENOM);
  const score = decay * familiarity;
  if (!Number.isFinite(score)) return 0;
  if (score < 0) return 0;
  if (score > 1) return 1;
  return score;
}

/** Translate a knowledge score to plain-English re-ramp time. */
export function explainKnowledge(score: number): string {
  // Heuristic mapping — calibrated against typical onboarding times.
  // 0.95+ → "fresh, ready to go"
  // 0.7+  → "still strong"
  // 0.5+  → "needs ~30 min refresh"
  // 0.3+  → "needs ~2 hours of re-reading"
  // <0.3  → "needs ~half a day to rebuild context"
  if (score >= 0.95) return "ready to go";
  if (score >= 0.7) return "still strong";
  if (score >= 0.5) return "needs ~30 min refresh";
  if (score >= 0.3) return "needs ~2 hours of re-reading";
  if (score >= 0.1) return "needs ~half a day to rebuild context";
  return "fully ghosted — full re-onboarding";
}

/** Run the repo-wide atrophy report. */
export function atrophy(store: MnemeStore, opts: AtrophyOptions = {}): AtrophyReport {
  const halfLifeDays = Math.max(1, opts.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS);
  const topN = Math.max(1, opts.topN ?? DEFAULT_TOP_N);
  const maxKnowersPerFile = Math.max(1, opts.maxKnowersPerFile ?? DEFAULT_MAX_KNOWERS_PER_FILE);
  const excludes = opts.excludePatterns ?? DEFAULT_EXCLUDES;
  const asOfMs = parseAsOf(opts.asOf);

  const pairs = collectPairs(store, excludes);
  const totalCommitsRow = store.db
    .prepare("SELECT COUNT(*) AS n FROM commits")
    .get() as { n: number };

  // Per-author last-active.
  const lastActive = store.db
    .prepare(
      `SELECT author_email AS email, MAX(author_date) AS last_active
         FROM commits
        GROUP BY author_email`,
    )
    .all() as Array<{ email: string; last_active: string }>;
  const lastActiveByEmail = new Map<string, string>();
  for (const r of lastActive) {
    lastActiveByEmail.set((r.email ?? "").toLowerCase(), r.last_active);
  }

  // Per-author roll-up.
  const authorAcc = new Map<
    string,
    { name: string; email: string; mass: number; files: Set<string>; freshFiles: Set<string> }
  >();

  // Per-file roll-up.
  const fileAcc = new Map<string, { totalTouches: number; experts: FileExpert[] }>();

  for (const p of pairs) {
    const ts = Date.parse(p.lastTouchIso);
    if (!Number.isFinite(ts)) continue;
    const days = Math.max(0, (asOfMs - ts) / 86_400_000);
    const score = knowledgeScore(days, p.touchCount, halfLifeDays);

    const expert: FileExpert = {
      name: p.authorName,
      email: p.authorEmail,
      knowledge: round(score, 3),
      lastTouchDaysAgo: round(days, 1),
      touchCount: p.touchCount,
    };

    let bucket = fileAcc.get(p.filePath);
    if (!bucket) {
      bucket = { totalTouches: 0, experts: [] };
      fileAcc.set(p.filePath, bucket);
    }
    bucket.totalTouches += p.touchCount;
    bucket.experts.push(expert);

    let aBucket = authorAcc.get(p.authorEmail);
    if (!aBucket) {
      aBucket = {
        name: p.authorName,
        email: p.authorEmail,
        mass: 0,
        files: new Set(),
        freshFiles: new Set(),
      };
      authorAcc.set(p.authorEmail, aBucket);
    }
    aBucket.mass += score;
    aBucket.files.add(p.filePath);
    if (score >= FRESHNESS_THRESHOLD) aBucket.freshFiles.add(p.filePath);
  }

  // Build per-file output, classify tier.
  const allFiles: FileKnowledge[] = [];
  let filesWithLiveExpert = 0;
  let ghostedFiles = 0;
  let ghostedDeepFiles = 0;
  let shallowFiles = 0;
  for (const [filePath, bucket] of fileAcc) {
    bucket.experts.sort((a, b) => b.knowledge - a.knowledge);
    const allKnowers = bucket.experts.slice(0, maxKnowersPerFile);
    const liveExperts = bucket.experts.filter((e) => e.knowledge >= FRESHNESS_THRESHOLD);
    const freshest = bucket.experts[0]?.knowledge ?? 0;
    let tier: FileKnowledge["tier"] = "at-risk";
    if (freshest >= SAFE_THRESHOLD) tier = "safe";
    else if (freshest >= FRESHNESS_THRESHOLD) tier = "warn";
    if (liveExperts.length > 0) {
      filesWithLiveExpert++;
    } else {
      ghostedFiles++;
      if (bucket.totalTouches >= 2) ghostedDeepFiles++;
      else shallowFiles++;
    }
    allFiles.push({
      filePath,
      totalTouches: bucket.totalTouches,
      liveExperts,
      allKnowers,
      tier,
      freshestKnowledge: round(freshest, 3),
    });
  }

  // Surface at-risk files. Primary list = "deep" files (≥2 touches) where
  // real knowledge was lost. We fall back to single-touch files only if
  // there aren't enough deep ones — they're still surfaced, but never
  // crowd out genuine ghost code.
  const candidates = allFiles.filter((f) => f.tier !== "safe");
  const tierWeight = (t: string) => (t === "at-risk" ? 2 : t === "warn" ? 1 : 0);
  const sortByImportance = (a: FileKnowledge, b: FileKnowledge): number => {
    const dt = tierWeight(b.tier) - tierWeight(a.tier);
    if (dt !== 0) return dt;
    const dh = b.totalTouches - a.totalTouches;
    if (dh !== 0) return dh;
    return a.freshestKnowledge - b.freshestKnowledge;
  };
  const deep = candidates.filter((f) => f.totalTouches >= 2).sort(sortByImportance);
  const shallow = candidates.filter((f) => f.totalTouches < 2).sort(sortByImportance);
  const atRiskFiles = [...deep, ...shallow].slice(0, topN);

  const authors: AuthorKnowledge[] = [];
  for (const a of authorAcc.values()) {
    authors.push({
      name: a.name,
      email: a.email,
      knowledgeMass: round(a.mass, 2),
      filesKnown: a.files.size,
      filesStillFresh: a.freshFiles.size,
      lastActiveAt: lastActiveByEmail.get(a.email) ?? "",
    });
  }
  authors.sort((a, b) => b.knowledgeMass - a.knowledgeMass);

  return {
    authors: authors.slice(0, topN),
    atRiskFiles,
    stats: {
      halfLifeDays,
      asOf: new Date(asOfMs).toISOString(),
      authorCount: authorAcc.size,
      fileCount: fileAcc.size,
      totalCommits: totalCommitsRow.n,
      filesWithLiveExpert,
      ghostedFiles,
      ghostedDeepFiles,
      shallowFiles,
    },
  };
}

// ─── per-author drill-down ────────────────────────────────────────────

export interface AuthorDetail {
  author: AuthorKnowledge;
  /** Top-N files this author knew (highest knowledge first). */
  topFiles: Array<{
    filePath: string;
    knowledge: number;
    lastTouchDaysAgo: number;
    touchCount: number;
    /** Decay banding for renderer. */
    band: "fresh" | "warm" | "fading" | "ghosted";
  }>;
}

export function atrophyForAuthor(
  store: MnemeStore,
  authorEmail: string,
  opts: AtrophyOptions = {},
): AuthorDetail | null {
  const halfLifeDays = Math.max(1, opts.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS);
  const topN = Math.max(1, opts.topN ?? 20);
  const excludes = opts.excludePatterns ?? DEFAULT_EXCLUDES;
  const asOfMs = parseAsOf(opts.asOf);
  const target = authorEmail.toLowerCase();

  const pairs = collectPairs(store, excludes).filter(
    (p) => p.authorEmail === target,
  );
  if (pairs.length === 0) return null;

  const author: AuthorKnowledge = {
    name: pairs[0]!.authorName,
    email: target,
    knowledgeMass: 0,
    filesKnown: 0,
    filesStillFresh: 0,
    lastActiveAt: "",
  };
  const lastActive = store.db
    .prepare("SELECT MAX(author_date) AS d FROM commits WHERE LOWER(author_email) = ?")
    .get(target) as { d: string | null };
  author.lastActiveAt = lastActive?.d ?? "";

  const files: AuthorDetail["topFiles"] = [];
  let mass = 0;
  let fresh = 0;
  for (const p of pairs) {
    const ts = Date.parse(p.lastTouchIso);
    if (!Number.isFinite(ts)) continue;
    const days = Math.max(0, (asOfMs - ts) / 86_400_000);
    const score = knowledgeScore(days, p.touchCount, halfLifeDays);
    mass += score;
    if (score >= FRESHNESS_THRESHOLD) fresh++;
    files.push({
      filePath: p.filePath,
      knowledge: round(score, 3),
      lastTouchDaysAgo: round(days, 1),
      touchCount: p.touchCount,
      band:
        score >= SAFE_THRESHOLD
          ? "fresh"
          : score >= FRESHNESS_THRESHOLD
            ? "warm"
            : score >= 0.1
              ? "fading"
              : "ghosted",
    });
  }
  files.sort((a, b) => b.knowledge - a.knowledge);
  author.knowledgeMass = round(mass, 2);
  author.filesKnown = pairs.length;
  author.filesStillFresh = fresh;

  return { author, topFiles: files.slice(0, topN) };
}

// ─── per-file drill-down ──────────────────────────────────────────────

export function atrophyForFile(
  store: MnemeStore,
  filePath: string,
  opts: AtrophyOptions = {},
): FileKnowledge | null {
  const halfLifeDays = Math.max(1, opts.halfLifeDays ?? DEFAULT_HALF_LIFE_DAYS);
  const maxKnowersPerFile = Math.max(1, opts.maxKnowersPerFile ?? 32);
  const asOfMs = parseAsOf(opts.asOf);

  const rows = store.db
    .prepare(
      `SELECT c.author_name AS name, LOWER(c.author_email) AS email,
              COUNT(*) AS touch_count, MAX(c.author_date) AS last_touch
         FROM file_changes fc
         JOIN commits c ON c.hash = fc.commit_hash
        WHERE fc.path = ?
        GROUP BY c.author_name, LOWER(c.author_email)
        ORDER BY last_touch DESC`,
    )
    .all(filePath) as Array<{
    name: string;
    email: string;
    touch_count: number;
    last_touch: string;
  }>;

  if (rows.length === 0) return null;

  const experts: FileExpert[] = [];
  let totalTouches = 0;
  for (const r of rows) {
    totalTouches += r.touch_count;
    const ts = Date.parse(r.last_touch);
    if (!Number.isFinite(ts)) continue;
    const days = Math.max(0, (asOfMs - ts) / 86_400_000);
    const score = knowledgeScore(days, r.touch_count, halfLifeDays);
    experts.push({
      name: r.name,
      email: r.email,
      knowledge: round(score, 3),
      lastTouchDaysAgo: round(days, 1),
      touchCount: r.touch_count,
    });
  }
  experts.sort((a, b) => b.knowledge - a.knowledge);
  const liveExperts = experts.filter((e) => e.knowledge >= FRESHNESS_THRESHOLD);
  const freshest = experts[0]?.knowledge ?? 0;
  const tier: FileKnowledge["tier"] =
    freshest >= SAFE_THRESHOLD
      ? "safe"
      : freshest >= FRESHNESS_THRESHOLD
        ? "warn"
        : "at-risk";

  return {
    filePath,
    totalTouches,
    liveExperts,
    allKnowers: experts.slice(0, maxKnowersPerFile),
    tier,
    freshestKnowledge: round(freshest, 3),
  };
}

// ─── helpers ──────────────────────────────────────────────────────────

function parseAsOf(asOf: string | undefined): number {
  if (!asOf) return Date.now();
  const ts = Date.parse(asOf);
  return Number.isFinite(ts) ? ts : Date.now();
}

function collectPairs(store: MnemeStore, excludes: string[]): PerPair[] {
  const rows = store.db
    .prepare(
      `SELECT fc.path                 AS path,
              c.author_name           AS author_name,
              LOWER(c.author_email)   AS author_email,
              COUNT(*)                AS touches,
              MAX(c.author_date)      AS last_touch
         FROM file_changes fc
         JOIN commits c ON c.hash = fc.commit_hash
        GROUP BY fc.path, c.author_name, LOWER(c.author_email)`,
    )
    .all() as Array<{
    path: string;
    author_name: string;
    author_email: string;
    touches: number;
    last_touch: string;
  }>;
  const out: PerPair[] = [];
  for (const r of rows) {
    if (!r.path) continue;
    if (excludes.some((p) => r.path.includes(p))) continue;
    out.push({
      filePath: r.path,
      authorName: r.author_name,
      authorEmail: r.author_email,
      touchCount: r.touches,
      lastTouchIso: r.last_touch,
    });
  }
  return out;
}

function round(n: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(n * f) / f;
}
