/**
 * `mneme nervous-system` — repo-level neural map.
 *
 * The single PDF that a CTO prints and pins on their wall.  Composes:
 *
 *   1. Cultural-alpha ladder       (influence: PageRank + adoption evidence)
 *   2. Latent-collaboration grid   (telepathy: top N pairs as a heatmap)
 *   3. Knowledge-atrophy critical  (atrophy: top files at risk + best knowers)
 *   4. Mini-passports for top N    (passport: composed for each top contributor)
 *   5. Repo neuroanatomy           (cluster files by depth-3 directory ⇒ "lobes")
 *   6. Honest limitations panel    (always-last)
 *
 * Pure data composition — render is the CLI/HTML's job.
 */

import type { MnemeStore } from "../store/sqlite.js";
import type { Commit } from "../types.js";
import { loadAllCommits } from "../util/index.js";
import { isNoiseFile } from "../util/noise.js";

import { atrophy, type AtrophyReport, type FileKnowledge } from "./atrophy.js";
import { telepathy, type TelepathyResult, type TelepathyPair } from "./telepathy.js";
import {
  buildInfluenceReport,
  type InfluenceReport,
  type AuthorRanking,
} from "./influence.js";
import { buildPromiseReport, type PromiseReport } from "./promise.js";
import { buildPassport, topAuthorEmails, type PassportData } from "./passport.js";

// ─── public types ─────────────────────────────────────────────────────

export interface NervousSystemOptions {
  cwd: string;
  /** Number of mini-passports to embed. Default 5. */
  topPeople?: number;
  /** Critical-files size for atrophy block. Default 30. */
  topFiles?: number;
  /** ISO "as-of" override for deterministic tests. */
  asOf?: string;
  /** Repo display name. */
  repoName?: string;
  /** Forwarded to passport — usually false at repo level. */
  includeFriction?: boolean;
}

export interface AlphaSlot {
  rank: number;
  name: string;
  email: string;
  pageRank: number;
  originatedShapesAdopted: number;
  adoptionsByOthers: number;
  uniqueAdopters: number;
  /** Top single pattern by adoptions (if any). */
  topShape: { kind: string; name: string; arity: number; adoptions: number } | null;
}

export interface CriticalFileSlot {
  filePath: string;
  totalTouches: number;
  tier: "safe" | "warn" | "at-risk";
  freshestKnowledge: number;
  topKnower: { name: string; email: string; knowledge: number } | null;
  /** Number of authors with knowledge > 0.3. */
  liveExpertCount: number;
}

export interface BrainLobe {
  /** Directory key, depth ≤ 3 — e.g. "packages/core/src". */
  lobe: string;
  /** Distinct files in this lobe. */
  fileCount: number;
  /** Total touches across the lobe. */
  totalTouches: number;
  /** Top owner — author with the most touches in this lobe. */
  topOwner: { name: string; email: string; touches: number } | null;
  /** Best-remembered file in this lobe (highest knowledge_score). */
  freshestFile: { filePath: string; knowledge: number } | null;
  /** Worst-decayed file with ≥2 touches — the lobe's "ghost zone". */
  ghostFile: { filePath: string; daysIdle: number; touches: number } | null;
  /** % of authors who account for 80% of touches (concentration). */
  concentrationPct: number;
}

export interface NervousSystemData {
  meta: {
    repoName: string;
    generatedAt: string;
    totalCommits: number;
    totalAuthors: number;
    halfLifeDays: number;
    /** PR-rank denominator. */
    rankedAuthorCount: number;
  };
  hero: {
    /** "5 cultural alphas · 12 invisible teams · 8 critical files" */
    headline: string;
    /** 4 hero metrics with sparkline-friendly histograms. */
    metrics: Array<{
      label: string;
      value: string;
      subtitle: string;
      /** 12-week histogram for the sparkline. */
      sparkline: number[];
    }>;
  };
  alphas: AlphaSlot[];
  telepathy: {
    pairs: TelepathyPair[];
    pairsEvaluated: number;
    distinctAuthorsInGrid: number;
  };
  atrophy: {
    halfLifeDays: number;
    criticalFiles: CriticalFileSlot[];
    ghostedDeepFiles: number;
    filesWithLiveExpert: number;
    fileCount: number;
  };
  passports: PassportData[];
  lobes: BrainLobe[];
  promises: {
    open: number;
    kept: number;
    stale: number;
    keepRate: number;
  };
  surprising: string[];
  limits: string[];
}

// ─── implementation ───────────────────────────────────────────────────

const DEFAULT_TOP_PEOPLE = 5;
const DEFAULT_TOP_FILES = 30;
const SPARKLINE_BUCKETS = 12;

export async function buildNervousSystem(
  store: MnemeStore,
  opts: NervousSystemOptions,
): Promise<NervousSystemData | null> {
  const commits = loadAllCommits(store);
  if (commits.length === 0) return null;
  const topPeople = Math.max(1, opts.topPeople ?? DEFAULT_TOP_PEOPLE);
  const topFiles = Math.max(5, opts.topFiles ?? DEFAULT_TOP_FILES);

  // 1 — atrophy report (whole repo).
  const atrophyReport = atrophy(store, { topN: topFiles });

  // 2 — telepathy report (whole repo).
  const tele = telepathy(store, { topN: 20, minEvents: 2 });

  // 3 — influence report (single git walk).
  let influenceReport: InfluenceReport;
  try {
    influenceReport = await buildInfluenceReport({ cwd: opts.cwd });
  } catch {
    influenceReport = {
      rankings: [],
      totalShapesAnalyzed: 0,
      shapesWithAdoption: 0,
      languageMix: {},
      perAuthor: {},
    };
  }

  // 4 — promise report (single sweep).
  const promiseReport = buildPromiseReport(commits);

  // 5 — pick top-N authors and build mini-passports re-using shared reports.
  const topEmails = topAuthorEmails(commits, topPeople);
  const passports: PassportData[] = [];
  for (const email of topEmails) {
    const p = await buildPassport(store, {
      cwd: opts.cwd,
      author: email,
      commits,
      influence: influenceReport,
      promise: promiseReport,
      telepathy: tele,
      asOf: opts.asOf,
      repoName: opts.repoName,
      includeFriction: opts.includeFriction,
      topFiles: 8,
    });
    if (p) passports.push(p);
  }

  // 6 — lobes (group files by depth-3 directory, score knowledge).
  const lobes = computeLobes(store, atrophyReport);

  // 7 — alphas (slim view of top influence rankings).
  const alphas = composeAlphas(influenceReport);

  // 8 — critical files block (already provided by atrophy).
  const criticalFiles = composeCriticalFiles(atrophyReport, topFiles);

  // 9 — surprising findings.
  const surprising = computeSurprising(atrophyReport, tele, influenceReport, promiseReport);

  // 10 — hero metrics.
  const hero = computeHero(commits, alphas, tele, atrophyReport);

  // 11 — honest limits.
  const limits = computeLimits({
    commits: commits.length,
    authors: atrophyReport.stats.authorCount,
    rankings: influenceReport.rankings.length,
    headsUp: influenceReport.headsUp,
    tele,
    atrophyReport,
  });

  return {
    meta: {
      repoName: opts.repoName ?? "this repository",
      generatedAt: new Date(opts.asOf ?? Date.now()).toISOString(),
      totalCommits: atrophyReport.stats.totalCommits,
      totalAuthors: atrophyReport.stats.authorCount,
      halfLifeDays: atrophyReport.stats.halfLifeDays,
      rankedAuthorCount: influenceReport.rankings.length,
    },
    hero,
    alphas,
    telepathy: {
      pairs: tele.pairs,
      pairsEvaluated: tele.stats.pairsEvaluated,
      distinctAuthorsInGrid: distinctAuthorsInPairs(tele.pairs),
    },
    atrophy: {
      halfLifeDays: atrophyReport.stats.halfLifeDays,
      criticalFiles,
      ghostedDeepFiles: atrophyReport.stats.ghostedDeepFiles,
      filesWithLiveExpert: atrophyReport.stats.filesWithLiveExpert,
      fileCount: atrophyReport.stats.fileCount,
    },
    passports,
    lobes,
    promises: {
      open: promiseReport.totals.open,
      kept: promiseReport.totals.kept,
      stale: promiseReport.totals.stale,
      keepRate:
        promiseReport.totals.kept + promiseReport.totals.stale === 0
          ? 1
          : promiseReport.totals.kept /
            (promiseReport.totals.kept + promiseReport.totals.stale),
    },
    surprising,
    limits,
  };
}

// ─── sub-composers ─────────────────────────────────────────────────────

function composeAlphas(report: InfluenceReport): AlphaSlot[] {
  return report.rankings.slice(0, 10).map((r) => {
    const detail = report.perAuthor[r.author.email];
    const top = detail?.topShapes[0] ?? null;
    return {
      rank: r.rank,
      name: r.author.name,
      email: r.author.email,
      pageRank: r.pageRank,
      originatedShapesAdopted: r.originatedShapesAdopted,
      adoptionsByOthers: r.adoptionsByOthers,
      uniqueAdopters: r.uniqueAdopters,
      topShape: top
        ? {
            kind: top.shape.kind,
            name: top.shape.name,
            arity: top.shape.arity,
            adoptions: top.adoptions,
          }
        : null,
    };
  });
}

function composeCriticalFiles(
  report: AtrophyReport,
  topN: number,
): CriticalFileSlot[] {
  return report.atRiskFiles.slice(0, topN).map((f: FileKnowledge) => {
    const top = f.allKnowers[0];
    return {
      filePath: f.filePath,
      totalTouches: f.totalTouches,
      tier: f.tier,
      freshestKnowledge: f.freshestKnowledge,
      topKnower: top
        ? { name: top.name, email: top.email, knowledge: top.knowledge }
        : null,
      liveExpertCount: f.liveExperts.length,
    };
  });
}

function distinctAuthorsInPairs(pairs: TelepathyPair[]): number {
  const set = new Set<string>();
  for (const p of pairs) {
    set.add(p.authorA.email);
    set.add(p.authorB.email);
  }
  return set.size;
}

/**
 * Group files into "brain lobes" (depth-3 directory) with summary stats.
 *
 * For each lobe we compute:
 *   - total touches (file_changes joined)
 *   - top owner (author with most touches in that lobe)
 *   - freshest file (highest knowledge_score across any author)
 *   - ghost file (most-decayed deep file, ≥2 touches, knowledge < 0.3)
 *   - concentration (% of authors that account for 80% of touches)
 */
function computeLobes(store: MnemeStore, report: AtrophyReport): BrainLobe[] {
  // Collect per (file, author) counts + last touches in one query.
  const rows = store.db
    .prepare(
      `SELECT fc.path AS path,
              c.author_email AS email,
              c.author_name AS name,
              COUNT(*) AS touches,
              MAX(c.author_date) AS last_touch
       FROM file_changes fc
       JOIN commits c ON c.hash = fc.commit_hash
       GROUP BY fc.path, c.author_email`,
    )
    .all() as Array<{
      path: string;
      email: string;
      name: string;
      touches: number;
      last_touch: string;
    }>;

  const halfLifeDays = report.stats.halfLifeDays;
  const now = Date.now();

  type LobeAcc = {
    fileSet: Set<string>;
    totalTouches: number;
    perAuthor: Map<string, { name: string; touches: number }>;
    bestFile: { filePath: string; knowledge: number } | null;
    ghostFile: { filePath: string; daysIdle: number; touches: number } | null;
    perFileTouches: Map<string, number>;
  };
  const acc = new Map<string, LobeAcc>();

  for (const r of rows) {
    if (!r.path || isNoiseFile(r.path)) continue;
    const key = lobeKey(r.path);
    let lobe = acc.get(key);
    if (!lobe) {
      lobe = {
        fileSet: new Set(),
        totalTouches: 0,
        perAuthor: new Map(),
        bestFile: null,
        ghostFile: null,
        perFileTouches: new Map(),
      };
      acc.set(key, lobe);
    }
    lobe.fileSet.add(r.path);
    lobe.totalTouches += r.touches;
    lobe.perFileTouches.set(
      r.path,
      (lobe.perFileTouches.get(r.path) ?? 0) + r.touches,
    );
    const ae = (r.email ?? "").toLowerCase();
    if (ae) {
      const slot = lobe.perAuthor.get(ae);
      if (slot) slot.touches += r.touches;
      else lobe.perAuthor.set(ae, { name: r.name || ae, touches: r.touches });
    }
    const lastMs = Date.parse(r.last_touch);
    if (Number.isFinite(lastMs)) {
      const days = Math.max(0, (now - lastMs) / 86_400_000);
      const decay = Math.exp((-days * Math.LN2) / halfLifeDays);
      const fam = 1 - Math.exp(-r.touches / 5);
      const score = decay * fam;
      if (!lobe.bestFile || score > lobe.bestFile.knowledge) {
        lobe.bestFile = { filePath: r.path, knowledge: round3(score) };
      }
      if (
        r.touches >= 2 &&
        score < 0.3 &&
        (!lobe.ghostFile || days > lobe.ghostFile.daysIdle)
      ) {
        lobe.ghostFile = {
          filePath: r.path,
          daysIdle: Math.round(days),
          touches: r.touches,
        };
      }
    }
  }

  const lobes: BrainLobe[] = [];
  for (const [key, lobe] of acc) {
    const authors = [...lobe.perAuthor.entries()]
      .sort((a, b) => b[1].touches - a[1].touches)
      .map(([email, v]) => ({ email, ...v }));
    const top = authors[0]
      ? {
          name: authors[0].name,
          email: authors[0].email,
          touches: authors[0].touches,
        }
      : null;
    const conc = concentration80Pct(authors.map((a) => a.touches));
    lobes.push({
      lobe: key,
      fileCount: lobe.fileSet.size,
      totalTouches: lobe.totalTouches,
      topOwner: top,
      freshestFile: lobe.bestFile,
      ghostFile: lobe.ghostFile,
      concentrationPct: conc,
    });
  }
  // Order by total touches desc; cap to top 10 lobes.
  lobes.sort((a, b) => b.totalTouches - a.totalTouches);
  return lobes.slice(0, 10);
}

function lobeKey(path: string): string {
  const parts = path.replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.length === 0) return "(root)";
  if (parts.length === 1) return parts[0]!;
  const depth = Math.min(parts.length - 1, 3);
  return parts.slice(0, depth).join("/");
}

/** Smallest fraction of authors that cover 80% of total touches.  Returns 0..1. */
function concentration80Pct(touchesDesc: number[]): number {
  if (touchesDesc.length === 0) return 0;
  const total = touchesDesc.reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let cum = 0;
  for (let i = 0; i < touchesDesc.length; i++) {
    cum += touchesDesc[i]!;
    if (cum / total >= 0.8) {
      return Math.round(((i + 1) / touchesDesc.length) * 100) / 100;
    }
  }
  return 1;
}

/** Compute "what's surprising" — at most 4 punchy bullet points. */
function computeSurprising(
  atrophyReport: AtrophyReport,
  tele: TelepathyResult,
  influence: InfluenceReport,
  promise: PromiseReport,
): string[] {
  const out: string[] = [];

  // Surprise 1: a deep ghost-code file that nobody remembers.
  if (atrophyReport.stats.ghostedDeepFiles > 0) {
    const deep = atrophyReport.atRiskFiles.find(
      (f) => f.totalTouches >= 2 && f.freshestKnowledge < 0.1,
    );
    if (deep) {
      out.push(
        `Ghost code: \`${deep.filePath}\` — ${deep.totalTouches} historical touches, no live expert (best knower ${(deep.freshestKnowledge * 100).toFixed(0)}% fresh). One bus-stop away from a re-onboarding bill.`,
      );
    }
  }

  // Surprise 2: a strong telepathy pair (latent collaboration).
  if (tele.pairs.length > 0) {
    const top = tele.pairs[0]!;
    out.push(
      `Invisible team: ${top.authorA.name} ↔ ${top.authorB.name} — ${top.events} rhyming commits across "${top.topTopic.topic}" without ever co-authoring. Schedule a coffee.`,
    );
  }

  // Surprise 3: a non-top-committer dominating PageRank.
  if (influence.rankings.length >= 2) {
    const top = influence.rankings[0]!;
    if (top.adoptionsByOthers > 0) {
      out.push(
        `Cultural alpha: ${top.author.name} — ${top.adoptionsByOthers} adoptions of their pattern${top.adoptionsByOthers === 1 ? "" : "s"} by ${top.uniqueAdopters} other engineer${top.uniqueAdopters === 1 ? "" : "s"}. Volume-independent influence.`,
      );
    }
  }

  // Surprise 4: promise debt.
  if (promise.totals.stale >= 5) {
    out.push(
      `Promise debt: ${promise.totals.stale} stale "I'll fix later" / TODO items past the 90-day mark. Worth a sweep.`,
    );
  }

  return out.slice(0, 4);
}

function computeHero(
  commits: Commit[],
  alphas: AlphaSlot[],
  tele: TelepathyResult,
  atrophyReport: AtrophyReport,
): NervousSystemData["hero"] {
  const sparkCommits = sparklineByWeek(commits, SPARKLINE_BUCKETS, (_) => 1);
  const sparkAuthors = sparklineByWeek(commits, SPARKLINE_BUCKETS, (c) => c.authorEmail);
  // Simple proxies for the other two — we just reuse commit counts segmented
  // for "test commits" (paths ~ /test/) and "size churn" if we had it.
  const sparkTests = sparklineByWeek(commits, SPARKLINE_BUCKETS, (c) =>
    c.files.some((f) => /\b(test|spec)\b/i.test(f)) ? 1 : 0,
  );
  const sparkAuthorsActive = sparkAuthors;

  const headline =
    `${alphas.length} cultural alpha${alphas.length === 1 ? "" : "s"}` +
    " · " +
    `${tele.pairs.length} invisible team${tele.pairs.length === 1 ? "" : "s"}` +
    " · " +
    `${atrophyReport.stats.ghostedDeepFiles} critical file${atrophyReport.stats.ghostedDeepFiles === 1 ? "" : "s"} at knowledge risk`;

  return {
    headline,
    metrics: [
      {
        label: "Commits (12 weeks)",
        value: String(sumArr(sparkCommits)),
        subtitle: `${commits.length} total in repo`,
        sparkline: sparkCommits,
      },
      {
        label: "Active authors",
        value: String(atrophyReport.stats.authorCount),
        subtitle: `${alphas.filter((a) => a.adoptionsByOthers > 0).length} originate reused patterns`,
        sparkline: sparkAuthorsActive,
      },
      {
        label: "Files with live expert",
        value: `${atrophyReport.stats.filesWithLiveExpert} / ${atrophyReport.stats.fileCount}`,
        subtitle: `${atrophyReport.stats.ghostedDeepFiles} deep ghost files`,
        sparkline: sparkTests,
      },
      {
        label: "Latent pairs",
        value: String(tele.pairs.length),
        subtitle: `${tele.stats.pairsEvaluated} evaluated`,
        sparkline: sparkCommits,
      },
    ],
  };
}

function sparklineByWeek(
  commits: Commit[],
  buckets: number,
  weight: (c: Commit) => number | string,
): number[] {
  if (commits.length === 0) return Array(buckets).fill(0);
  const now = Date.now();
  const weekMs = 7 * 86_400_000;
  // Last `buckets` weeks ending now.
  const out = new Array(buckets).fill(0) as number[];
  const seenPerBucket = new Array(buckets).fill(null).map(() => new Set<string>());
  for (const c of commits) {
    const t = Date.parse(c.authorDate);
    if (!Number.isFinite(t)) continue;
    const idx = buckets - 1 - Math.floor((now - t) / weekMs);
    if (idx < 0 || idx >= buckets) continue;
    const w = weight(c);
    if (typeof w === "number") {
      out[idx] += w;
    } else if (typeof w === "string" && w.length > 0) {
      // Distinct-string weighting (e.g. distinct authors per week).
      if (!seenPerBucket[idx]!.has(w)) {
        seenPerBucket[idx]!.add(w);
        out[idx] += 1;
      }
    }
  }
  return out;
}

function sumArr(arr: number[]): number {
  let s = 0;
  for (const n of arr) s += n;
  return s;
}

function computeLimits(input: {
  commits: number;
  authors: number;
  rankings: number;
  headsUp: string | undefined;
  tele: TelepathyResult;
  atrophyReport: AtrophyReport;
}): string[] {
  const limits: string[] = [];
  if (input.commits < 50) {
    limits.push(
      `Sample size: ${input.commits} commits — every percentage is fragile under 50 commits. Read directionally, not as a verdict.`,
    );
  }
  if (input.authors < 3) {
    limits.push(
      "Solo / small team: telepathy and influence rankings degenerate when fewer than 3 authors have shipped commits. Treat those sections as scaffolding.",
    );
  }
  if (input.rankings === 0) {
    limits.push(
      "Influence section produced no rankings — the parser found no reused TS/JS function shapes. (Mneme's pattern detector is currently TS/JS-only.)",
    );
  }
  if (input.headsUp) limits.push(input.headsUp);
  if (input.tele.pairs.length === 0) {
    limits.push(
      "Latent-collaboration grid is empty — either the repo is single-author, or commit cadence does not overlap others within the rhyme window.",
    );
  }
  if (input.atrophyReport.stats.fileCount === 0) {
    limits.push(
      "No file-change history indexed yet. Run `mneme index` to populate.",
    );
  }
  limits.push(
    "All data computed locally from this repository's git log. Nothing was sent to any server.",
  );
  limits.push(
    "This map describes patterns, not people. Behaviour over time is data; the value of a person's work is not.",
  );
  return limits;
}

function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}
