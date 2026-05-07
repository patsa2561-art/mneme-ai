/**
 * `mneme passport` — per-engineer dossier.
 *
 * A 2–3-page "passport" combining everything Mneme knows about one
 * contributor.  Pure data composition over Wave-1 modules + the existing
 * insights/dna fingerprint.  No I/O of its own beyond what the underlying
 * modules need (sqlite for atrophy/telepathy/promise, git log for influence
 * + first-add, HEAD parse for entity shapes).
 *
 * Output shape is stable JSON — the CLI/HTML renderer consumes it directly.
 *
 * Composition map:
 *   - identity      — name, email, dna fingerprint hash, voice histogram
 *   - dna           — re-uses {@link insights.extractDna}
 *   - expertise     — top files + knowledge mass from `atrophyForAuthor`
 *   - telepathy     — latent collaborators from `telepathy({ author })`
 *   - influence     — PageRank slot + originated patterns from `buildInfluenceReport`
 *   - promises      — open / kept / stale from `buildPromiseReport({ authorFilter })`
 *   - atrophyClock  — top fading domains (top files where knowledge ≤ 0.3 but author owned ≥3 touches)
 *   - voice         — top words/phrases vs team baseline (TF-IDF style)
 *   - friction      — opt-in nemesis pairs (omitted unless includeFriction = true)
 *   - limits        — honest caveats about what this report can/cannot tell you
 */

import type { MnemeStore } from "../store/sqlite.js";
import type { Commit } from "../types.js";
import { loadAllCommits } from "../util/index.js";
import { extractDna, type CodebaseDna } from "../insights/dna.js";

import { atrophyForAuthor, type AuthorDetail } from "./atrophy.js";
import { telepathy, type TelepathyPair, type TelepathyResult } from "./telepathy.js";
import {
  buildInfluenceReport,
  type AuthorRanking,
  type InfluenceReport,
  type ShapeKey,
} from "./influence.js";
import {
  buildPromiseReport,
  type PromiseReport,
  type PromiseRecord,
  type AuthorPromiseStats,
} from "./promise.js";
import { buildNemesisReport, type NemesisPair } from "./nemesis.js";

// ─── public types ─────────────────────────────────────────────────────

export interface PassportOptions {
  /** Repo working directory — used by influence module (git log walk). */
  cwd: string;
  /** Author email (lower-cased internally). If omitted, top contributor is auto-picked. */
  author?: string;
  /** How many top files / patterns to include. Default 12. */
  topFiles?: number;
  /** Knowledge half-life passed through to atrophy. */
  halfLifeDays?: number;
  /** Pre-computed influence report — pass when composing nervous-system to avoid re-walking git. */
  influence?: InfluenceReport;
  /** Pre-computed promise report — pass to avoid double-walking commits. */
  promise?: PromiseReport;
  /** Pre-computed telepathy result — pass to avoid double-walking the store. */
  telepathy?: TelepathyResult;
  /** Pre-loaded commits (sorted asc). Pass to avoid re-loading. */
  commits?: Commit[];
  /** ISO "as-of" override for deterministic tests. */
  asOf?: string;
  /** Include nemesis section (defamation-safe; opt-in). Default false. */
  includeFriction?: boolean;
  /** Repo display name — propagated into `meta`. */
  repoName?: string;
}

export interface VoicePhrase {
  phrase: string;
  /** Raw frequency in this author's commits. */
  count: number;
  /** Author share (count / authorTokens). */
  authorRate: number;
  /** Team share excluding this author (count / otherTokens). */
  teamRate: number;
  /** TF-IDF-ish weight: authorRate × log(1 + authorRate / max(teamRate, ε)). */
  weight: number;
}

export interface PassportExpertiseFile {
  filePath: string;
  knowledge: number;
  lastTouchDaysAgo: number;
  touchCount: number;
  band: "fresh" | "warm" | "fading" | "ghosted";
  /** Plain-English re-ramp time, e.g. "still strong". */
  refreshHint: string;
}

export interface PassportFadingDomain {
  filePath: string;
  /** Earliest knowledge score recorded (history) — proxy for "they once knew this". */
  peakTouches: number;
  /** Current knowledge score (low). */
  currentKnowledge: number;
  /** Days since last touch. */
  daysIdle: number;
}

export interface PassportInfluenceSlot {
  rank: number;
  pageRank: number;
  /** Total ranked authors — used by renderer to say "rank #1 of 7". */
  rankedOf: number;
  originatedShapesAdopted: number;
  originatedShapesTotal: number;
  adoptionsByOthers: number;
  uniqueAdopters: number;
  adoptionsByThisAuthor: number;
  /** Top patterns this author originated that others adopted. */
  topShapes: Array<{
    shape: ShapeKey;
    adoptions: number;
    adopters: Array<{ email: string; name: string; file: string }>;
  }>;
}

export interface PassportTelepathySlot {
  pairs: TelepathyPair[];
  /** How many candidate pairs were evaluated repo-wide (denominator hint). */
  pairsEvaluated: number;
}

export interface PassportPromiseSlot {
  open: number;
  kept: number;
  stale: number;
  total: number;
  /** Promise-keep rate: kept / max(1, kept + stale). 1.0 = saint, 0 = chronic deferral. */
  keepRate: number;
  /** Worst (oldest) currently-stale promise. */
  oldestStale: PromiseRecord | null;
  /** Most recent kept promise — proof of follow-through. */
  mostRecentKept: PromiseRecord | null;
  /** Simple counts only (no records) for the team baseline. */
  teamBaseline: { open: number; kept: number; stale: number; keepRate: number; authors: number };
}

export interface PassportFrictionSlot {
  pairs: NemesisPair[];
  totalEvents: number;
}

export interface PassportData {
  meta: {
    repoName: string;
    generatedAt: string;
    totalCommits: number;
    /** Number of distinct authors in the repo (denominator for "out of"). */
    repoAuthorCount: number;
    /** Mneme didn't see this section because it's missing from the store. */
    notes: string[];
  };
  identity: {
    name: string;
    email: string;
    /** Stable DNA hash — short ID. */
    dnaHash: string;
    commitCount: number;
    fromDate: string;
    toDate: string;
    activeDays: number;
    /** % of commits authored, vs team. */
    repoCommitShare: number;
  };
  dna: CodebaseDna;
  expertise: {
    knowledgeMass: number;
    filesKnown: number;
    filesStillFresh: number;
    lastActiveAt: string;
    topFiles: PassportExpertiseFile[];
  };
  telepathySlot: PassportTelepathySlot;
  influenceSlot: PassportInfluenceSlot | null;
  promiseSlot: PassportPromiseSlot;
  fadingDomains: PassportFadingDomain[];
  voice: VoicePhrase[];
  friction: PassportFrictionSlot | null;
  limits: string[];
}

// ─── implementation ───────────────────────────────────────────────────

const DEFAULT_TOP_FILES = 12;

/**
 * Build a passport for one author.  If `author` is unspecified we auto-pick
 * the top contributor by commit count — useful for the (no-args) UX.
 */
export async function buildPassport(
  store: MnemeStore,
  opts: PassportOptions,
): Promise<PassportData | null> {
  const commits = opts.commits ?? loadAllCommits(store);
  if (commits.length === 0) return null;

  const author = (opts.author ?? topAuthorEmail(commits) ?? "").toLowerCase();
  if (!author) return null;

  // Filter to this author's commits ─ used for DNA + voice + promises.
  const mine = commits.filter((c) => (c.authorEmail ?? "").toLowerCase() === author);
  if (mine.length === 0) return null;
  const others = commits.filter((c) => (c.authorEmail ?? "").toLowerCase() !== author);

  const repoAuthorCount = countDistinctAuthors(commits);
  const dna = extractDna(commits, author);

  const detail = atrophyForAuthor(store, author, {
    topN: opts.topFiles ?? DEFAULT_TOP_FILES,
    halfLifeDays: opts.halfLifeDays,
    asOf: opts.asOf,
  });

  const expertiseFiles: PassportExpertiseFile[] = [];
  let knowledgeMass = 0;
  let filesKnown = 0;
  let filesStillFresh = 0;
  let lastActiveAt = mine[mine.length - 1]!.authorDate;
  if (detail) {
    knowledgeMass = detail.author.knowledgeMass;
    filesKnown = detail.author.filesKnown;
    filesStillFresh = detail.author.filesStillFresh;
    lastActiveAt = detail.author.lastActiveAt;
    for (const f of detail.topFiles) {
      expertiseFiles.push({
        filePath: f.filePath,
        knowledge: f.knowledge,
        lastTouchDaysAgo: f.lastTouchDaysAgo,
        touchCount: f.touchCount,
        band: f.band,
        refreshHint: explainKnowledgeShort(f.knowledge),
      });
    }
  }

  const tele = opts.telepathy ?? telepathy(store, { authorEmail: author, topN: 8 });
  const myPairs = tele.pairs.filter((p) => p.authorA.email.toLowerCase() === author || p.authorB.email.toLowerCase() === author);
  const telepathySlot: PassportTelepathySlot = {
    pairs: myPairs,
    pairsEvaluated: tele.stats.pairsEvaluated,
  };

  // Influence — re-uses the caller-supplied report when given (nervous-system
  // pre-computes it once for the whole repo).  Otherwise we walk git ourselves.
  let influenceSlot: PassportInfluenceSlot | null = null;
  let influenceReport: InfluenceReport | null = null;
  try {
    influenceReport = opts.influence ?? (await buildInfluenceReport({ cwd: opts.cwd }));
    const ranked = influenceReport.rankings;
    const slot = ranked.find((r) => r.author.email.toLowerCase() === author) ?? null;
    if (slot) {
      const detailEntry = influenceReport.perAuthor[slot.author.email];
      influenceSlot = {
        rank: slot.rank,
        rankedOf: ranked.length,
        pageRank: slot.pageRank,
        originatedShapesAdopted: slot.originatedShapesAdopted,
        originatedShapesTotal: slot.originatedShapesTotal,
        adoptionsByOthers: slot.adoptionsByOthers,
        uniqueAdopters: slot.uniqueAdopters,
        adoptionsByThisAuthor: slot.adoptionsByThisAuthor,
        topShapes: detailEntry?.topShapes ?? [],
      };
    }
  } catch {
    /* influence walks git — leave slot null, renderer will note it. */
  }

  const promiseReport = opts.promise ?? buildPromiseReport(commits);
  const promiseSlot = composePromiseSlot(promiseReport, author);

  const fadingDomains = computeFadingDomains(store, author, opts.halfLifeDays);
  const voice = computeVoice(mine, others);

  let friction: PassportFrictionSlot | null = null;
  if (opts.includeFriction) {
    const nem = buildNemesisReport(commits, { authorFilter: author, minTotal: 2 });
    friction = { pairs: nem.pairs, totalEvents: nem.totalEvents };
  }

  // Honest limits.
  const limits = buildPassportLimits({
    commitCount: mine.length,
    repoAuthorCount,
    influenceMissing: influenceSlot === null,
    telepathyEmpty: telepathySlot.pairs.length === 0,
    expertiseEmpty: expertiseFiles.length === 0,
    voiceLow: voice.length < 5,
  });

  const repoCommitShare = commits.length > 0 ? mine.length / commits.length : 0;

  return {
    meta: {
      repoName: opts.repoName ?? "this repository",
      generatedAt: new Date(opts.asOf ?? Date.now()).toISOString(),
      totalCommits: commits.length,
      repoAuthorCount,
      notes: [],
    },
    identity: {
      name: dna.commitCount > 0 ? bestDisplayName(mine) : author,
      email: author,
      dnaHash: dna.hash,
      commitCount: mine.length,
      fromDate: dna.fromDate,
      toDate: dna.toDate,
      activeDays: countActiveDays(mine),
      repoCommitShare,
    },
    dna,
    expertise: {
      knowledgeMass,
      filesKnown,
      filesStillFresh,
      lastActiveAt,
      topFiles: expertiseFiles,
    },
    telepathySlot,
    influenceSlot,
    promiseSlot,
    fadingDomains,
    voice,
    friction,
    limits,
  };
}

// ─── helpers ──────────────────────────────────────────────────────────

/** Pick the email with the most commits — the natural "default" author. */
export function topAuthorEmail(commits: Commit[]): string | null {
  const counts = new Map<string, number>();
  for (const c of commits) {
    const e = (c.authorEmail ?? "").toLowerCase();
    if (!e) continue;
    counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  let best: string | null = null;
  let bestN = 0;
  for (const [e, n] of counts) {
    if (n > bestN) {
      best = e;
      bestN = n;
    }
  }
  return best;
}

/** Top N authors by commit count — used by nervous-system to pick passport subjects. */
export function topAuthorEmails(commits: Commit[], n: number): string[] {
  const counts = new Map<string, number>();
  for (const c of commits) {
    const e = (c.authorEmail ?? "").toLowerCase();
    if (!e) continue;
    counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, Math.max(1, n))
    .map(([e]) => e);
}

function countDistinctAuthors(commits: Commit[]): number {
  const set = new Set<string>();
  for (const c of commits) {
    const e = (c.authorEmail ?? "").toLowerCase();
    if (e) set.add(e);
  }
  return set.size;
}

function countActiveDays(commits: Commit[]): number {
  const days = new Set<string>();
  for (const c of commits) {
    days.add(c.authorDate.slice(0, 10));
  }
  return days.size;
}

function bestDisplayName(commits: Commit[]): string {
  const seen = new Map<string, number>();
  for (const c of commits) {
    const n = (c.authorName ?? "").trim();
    if (!n) continue;
    seen.set(n, (seen.get(n) ?? 0) + 1);
  }
  let best = "";
  let bestN = 0;
  for (const [n, k] of seen) {
    if (k > bestN) {
      best = n;
      bestN = k;
    }
  }
  return best;
}

function explainKnowledgeShort(score: number): string {
  if (score >= 0.7) return "still strong";
  if (score >= 0.5) return "~30 min refresh";
  if (score >= 0.3) return "~2 h refresh";
  if (score >= 0.1) return "half-day rebuild";
  return "ghost — full re-onboarding";
}

function composePromiseSlot(
  report: PromiseReport,
  author: string,
): PassportPromiseSlot {
  const mine = report.byAuthor.find((r) => r.author === author);
  const open = mine?.open ?? 0;
  const kept = mine?.kept ?? 0;
  const stale = mine?.stale ?? 0;
  const total = mine?.total ?? 0;
  const keepRate = kept + stale === 0 ? 1 : kept / (kept + stale);

  const myRecords = report.promises.filter((p) => p.author === author);
  let oldestStale: PromiseRecord | null = null;
  for (const p of myRecords) {
    if (p.status !== "stale") continue;
    if (!oldestStale || p.ageDays > oldestStale.ageDays) oldestStale = p;
  }
  let mostRecentKept: PromiseRecord | null = null;
  for (const p of myRecords) {
    if (p.status !== "kept") continue;
    if (!mostRecentKept || p.date > mostRecentKept.date) mostRecentKept = p;
  }

  const baseline = computeTeamBaseline(report.byAuthor.filter((r) => r.author !== author));
  return { open, kept, stale, total, keepRate, oldestStale, mostRecentKept, teamBaseline: baseline };
}

function computeTeamBaseline(rest: AuthorPromiseStats[]): PassportPromiseSlot["teamBaseline"] {
  if (rest.length === 0) return { open: 0, kept: 0, stale: 0, keepRate: 1, authors: 0 };
  let open = 0,
    kept = 0,
    stale = 0;
  for (const r of rest) {
    open += r.open;
    kept += r.kept;
    stale += r.stale;
  }
  const keepRate = kept + stale === 0 ? 1 : kept / (kept + stale);
  return { open, kept, stale, keepRate, authors: rest.length };
}

/**
 * Files where this author ONCE had real history (≥3 touches) but knowledge
 * has decayed to ≤ 0.3 — i.e. the "atrophy clock" alert for them.
 *
 * We scan file_changes ordered by author + path. Any pair the atrophy module
 * already would have considered.  Pull the top-N decayed.
 */
function computeFadingDomains(
  store: MnemeStore,
  authorEmail: string,
  halfLifeDays?: number,
): PassportFadingDomain[] {
  const halfLife = Math.max(1, halfLifeDays ?? 180);
  const rows = store.db
    .prepare(
      `SELECT fc.path AS path,
              COUNT(*) AS touches,
              MAX(c.author_date) AS last_touch
       FROM file_changes fc
       JOIN commits c ON c.hash = fc.commit_hash
       WHERE LOWER(c.author_email) = ?
       GROUP BY fc.path
       HAVING touches >= 3
       ORDER BY last_touch ASC`,
    )
    .all(authorEmail) as Array<{ path: string; touches: number; last_touch: string }>;

  const now = Date.now();
  const out: PassportFadingDomain[] = [];
  for (const r of rows) {
    const lastMs = Date.parse(r.last_touch);
    if (!Number.isFinite(lastMs)) continue;
    const days = Math.max(0, (now - lastMs) / 86_400_000);
    const decay = Math.exp((-days * Math.LN2) / halfLife);
    const familiarity = 1 - Math.exp(-r.touches / 5);
    const score = decay * familiarity;
    if (score > 0.3) continue;
    out.push({
      filePath: r.path,
      peakTouches: r.touches,
      currentKnowledge: round3(score),
      daysIdle: Math.round(days),
    });
  }
  out.sort((a, b) => {
    // Worst-first: oldest with most touches.
    if (b.peakTouches !== a.peakTouches) return b.peakTouches - a.peakTouches;
    return b.daysIdle - a.daysIdle;
  });
  return out.slice(0, 5);
}

const VOICE_TOKENIZE_RE = /[^A-Za-z][A-Za-z]{3,}[^A-Za-z]?/g;

const VOICE_STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "into", "when",
  "should", "would", "could", "have", "been", "being", "their", "there",
  "where", "after", "before", "while", "about", "your", "yours", "than",
  "then", "them", "they", "will", "shall", "must", "make", "made",
  "feat", "fix", "chore", "docs", "test", "perf", "refactor", "build", "ci", "style",
  "merge", "revert", "branch", "main", "master",
  "commit", "commits", "code", "file", "files", "line", "lines",
]);

/**
 * Voice fingerprint: top words that show up disproportionately in this
 * author's commit subjects/bodies vs the team baseline.
 */
function computeVoice(mine: Commit[], others: Commit[]): VoicePhrase[] {
  const myCounts = countTokens(mine);
  const otherCounts = countTokens(others);
  const myTotal = sumValues(myCounts);
  const otherTotal = Math.max(1, sumValues(otherCounts));

  const out: VoicePhrase[] = [];
  for (const [word, count] of myCounts) {
    if (count < 2) continue;
    const authorRate = count / Math.max(1, myTotal);
    const teamRate = (otherCounts.get(word) ?? 0) / otherTotal;
    // log-ratio with smoothing.  Add 1e-4 to avoid log(0); take log of (1 + ratio).
    const ratio = authorRate / Math.max(teamRate, 1e-4);
    const weight = authorRate * Math.log1p(ratio);
    out.push({
      phrase: word,
      count,
      authorRate: round4(authorRate),
      teamRate: round4(teamRate),
      weight: round4(weight),
    });
  }
  out.sort((a, b) => b.weight - a.weight);
  return out.slice(0, 10);
}

function countTokens(commits: Commit[]): Map<string, number> {
  const counts = new Map<string, number>();
  for (const c of commits) {
    const text = ((c.subject ?? "") + " " + (c.body ?? "")).toLowerCase();
    let m: RegExpExecArray | null;
    VOICE_TOKENIZE_RE.lastIndex = 0;
    while ((m = VOICE_TOKENIZE_RE.exec(text)) !== null) {
      const w = m[0].replace(/[^a-z]/g, "");
      if (w.length < 4) continue;
      if (VOICE_STOPWORDS.has(w)) continue;
      counts.set(w, (counts.get(w) ?? 0) + 1);
    }
  }
  return counts;
}

function sumValues(m: Map<string, number>): number {
  let s = 0;
  for (const v of m.values()) s += v;
  return s;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

export function buildPassportLimits(input: {
  commitCount: number;
  repoAuthorCount: number;
  influenceMissing: boolean;
  telepathyEmpty: boolean;
  expertiseEmpty: boolean;
  voiceLow: boolean;
}): string[] {
  const limits: string[] = [];
  if (input.commitCount < 30) {
    limits.push(
      `Sample size: ${input.commitCount} commits. Below 30 commits, every percentage is fragile — read the direction, not the number.`,
    );
  }
  if (input.repoAuthorCount < 2) {
    limits.push(
      "Solo repo: telepathy and influence are trivial when only one author has shipped commits. Treat those sections as placeholders.",
    );
  }
  if (input.influenceMissing) {
    limits.push(
      "Influence section unavailable for this author — they did not originate or adopt any reused TS/JS function shape (or the parser ran on a non-TS/JS repo).",
    );
  }
  if (input.telepathyEmpty) {
    limits.push(
      "No latent collaborators detected — either this author works alone, or their commit cadence does not overlap others within the rhyme window.",
    );
  }
  if (input.expertiseEmpty) {
    limits.push(
      "Expertise section is empty — Mneme has no file-change history for this author yet. Run `mneme index` to populate.",
    );
  }
  if (input.voiceLow) {
    limits.push(
      "Voice fingerprint is sparse — fewer than 5 distinguishing phrases; a real voice signature emerges around 50+ commit messages.",
    );
  }
  // Always-on disclaimers.
  limits.push(
    "All data computed from this local repository's git log. Nothing was sent to any server.",
  );
  limits.push(
    "This passport is a behavioural fingerprint, not a performance review. Patterns describe past commits, not the value of a person's work.",
  );
  return limits;
}

// Re-export Author detail for callers that want the raw atrophy slot.
export type { AuthorDetail };
