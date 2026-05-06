/**
 * Novel scoring algorithms for Mneme retrieval.
 *
 * These formulas are designed to outperform pure semantic similarity by
 * exploiting signals that other tools (which only embed file contents)
 * cannot see: time decay, regret patterns, author diversity, and the
 * causal graph implicit in commit/PR/issue references.
 *
 * All formulas are pure functions. They take the set of search results
 * + (optional) commit history and produce a re-ranked list. Use them as
 * post-processors over base BM25/cosine search.
 *
 * Algorithms:
 *   1. TDWE — Time-Decay Weighted Embedding score
 *      Formula: w(c) = exp(-λ · age_days / half_life)
 *               adjusted = base × w(c)
 *
 *   2. RACB — Regret-Aware Chunk Boosting
 *      Formula: boost(c) = 1 + ln(1 + days_to_followup × severity_factor)
 *      Severity: revert=3, hotfix=2, fix=1, sameFiles=0.5, none=0
 *
 *   3. ADS — Author Diversity Score re-ranking
 *      Formula: penalty = α · (same_author_above_in_ranking / K)
 *               final = base × (1 - penalty)
 *
 *   4. CGAR — Causal Graph Augmented Retrieval (light)
 *      Walks PR/issue links 2 hops; chunks reachable get boost = 0.85^hops
 */

import type { Commit, SearchResult } from "../types.js";

// ─── 1. TDWE — Time-Decay Weighted Embedding ──────────────────────────

export interface TdweOptions {
  /** Reference time (UTC ms). Defaults to Date.now(). */
  nowMs?: number;
  /**
   * Half-life in days. After this many days, weight decays to 0.5.
   * Default 365 — a year-old commit is half as relevant as today's.
   * Set higher for stable codebases, lower for fast-moving repos.
   */
  halfLifeDays?: number;
  /**
   * λ — decay coefficient. Higher = more aggressive decay.
   * Default 0.693 (ln 2) so that age = halfLifeDays gives weight 0.5.
   */
  lambda?: number;
}

/**
 * Apply time-decay weighting to a base score.
 *   - A commit from today gets weight ≈ 1.0
 *   - A commit at half-life age gets weight ≈ 0.5
 *   - A commit at 2× half-life age gets weight ≈ 0.25
 */
export function timeDecayWeight(
  commitDateIso: string,
  opts: TdweOptions = {},
): number {
  const nowMs = opts.nowMs ?? Date.now();
  const halfLife = opts.halfLifeDays ?? 365;
  const lambda = opts.lambda ?? Math.LN2;
  const t = new Date(commitDateIso).getTime();
  if (Number.isNaN(t)) return 1;
  const ageDays = Math.max(0, (nowMs - t) / 86_400_000);
  return Math.exp(-lambda * (ageDays / halfLife));
}

export function applyTdwe(
  results: SearchResult[],
  opts: TdweOptions = {},
): SearchResult[] {
  return results
    .map((r) => ({
      ...r,
      score: r.score * timeDecayWeight(r.commit.authorDate, opts),
    }))
    .sort((a, b) => b.score - a.score);
}

// ─── 2. RACB — Regret-Aware Chunk Boosting ───────────────────────────

export type RegretKind = "revert" | "hotfix" | "fix" | "sameFiles" | "none";

export interface RegretSignal {
  /** Commit hash that exhibits a regret follow-up. */
  commitHash: string;
  /** What kind of follow-up was detected. */
  kind: RegretKind;
  /** Days from commit to its follow-up. */
  daysToFollowup: number;
}

export interface RacbOptions {
  /**
   * Maximum boost cap (multiplicative). Default 2.5 — chunks from highly
   * regretted commits get up to 2.5× boost.
   */
  maxBoost?: number;
  /** Map regret kind → severity factor used in formula. */
  severityMap?: Record<RegretKind, number>;
}

const DEFAULT_SEVERITY: Record<RegretKind, number> = {
  revert: 3,
  hotfix: 2,
  fix: 1,
  sameFiles: 0.5,
  none: 0,
};

/**
 * Compute regret boost for a single signal.
 *   boost = 1 + ln(1 + days × severity)
 *
 * Why ln? Because the "wisdom" in a regret saturates. A 1-day-to-fix is
 * very informative; a 30-day-to-fix is *more* informative but not 30×
 * more. Logarithmic growth captures diminishing returns.
 */
export function regretBoost(signal: RegretSignal, opts: RacbOptions = {}): number {
  const maxBoost = opts.maxBoost ?? 2.5;
  const severity = (opts.severityMap ?? DEFAULT_SEVERITY)[signal.kind] ?? 0;
  if (severity === 0) return 1;
  const raw = 1 + Math.log(1 + signal.daysToFollowup * severity);
  return Math.min(maxBoost, raw);
}

export function applyRacb(
  results: SearchResult[],
  signals: RegretSignal[],
  opts: RacbOptions = {},
): SearchResult[] {
  const sigByHash = new Map<string, RegretSignal>();
  for (const s of signals) sigByHash.set(s.commitHash, s);
  return results
    .map((r) => {
      const sig = sigByHash.get(r.commit.hash);
      const boost = sig ? regretBoost(sig, opts) : 1;
      return { ...r, score: r.score * boost };
    })
    .sort((a, b) => b.score - a.score);
}

// ─── 3. ADS — Author Diversity Score re-ranking ──────────────────────

export interface AdsOptions {
  /** Penalty coefficient 0..1. Higher = more aggressive diversification. Default 0.4. */
  alpha?: number;
  /** Cap on how many results to consider. Default Infinity. */
  topK?: number;
}

/**
 * Re-rank results to penalize over-representation of any single author.
 *
 * For each result at position i:
 *   sameAuthorAbove = count of (j < i) where author(j) == author(i)
 *   penalty = α × (sameAuthorAbove / total)
 *   final = base × (1 - penalty)
 *
 * Then re-sort by final.
 *
 * Why this matters: when one author dominates a topic, retrieval becomes
 * monocultural. Diversity surfaces the second-most-knowledgeable
 * contributor, which the user often actually needs.
 */
export function applyAds(
  results: SearchResult[],
  opts: AdsOptions = {},
): SearchResult[] {
  const alpha = opts.alpha ?? 0.4;
  const topK = opts.topK ?? results.length;
  const slice = results.slice(0, topK);
  const total = Math.max(1, slice.length);

  const adjusted = slice.map((r, i) => {
    let sameAuthorAbove = 0;
    for (let j = 0; j < i; j++) {
      if (slice[j]!.commit.authorEmail === r.commit.authorEmail) {
        sameAuthorAbove += 1;
      }
    }
    const penalty = alpha * (sameAuthorAbove / total);
    const finalScore = r.score * (1 - penalty);
    return { ...r, score: finalScore };
  });
  adjusted.sort((a, b) => b.score - a.score);
  return adjusted;
}

// ─── 4. CGAR — Causal Graph Augmented Retrieval ──────────────────────

export interface CgarOptions {
  /** Max hops to walk in the causal graph. Default 2. */
  maxHops?: number;
  /** Decay per hop. Default 0.85 — each hop reduces boost by 15%. */
  hopDecay?: number;
  /** Initial boost for direct causal neighbors. Default 1.3. */
  initialBoost?: number;
}

/**
 * Build adjacency of "causal references" between commits using:
 *   - PR numbers in body / subject
 *   - Issue refs (closes #N, fixes #N, etc.)
 *   - Reverts that name a commit hash
 *
 * Returns a map: commitHash → Set<referenced commit hash>
 */
export function buildCausalGraph(commits: Commit[]): Map<string, Set<string>> {
  const graph = new Map<string, Set<string>>();
  const byPrNumber = new Map<number, string>();
  for (const c of commits) {
    if (c.prNumber) byPrNumber.set(c.prNumber, c.hash);
  }
  const PR_REF = /(?:pr|pull request|merge\s+pull\s+request)\s*#?\s*(\d+)|#(\d+)/gi;
  const HASH_REF = /\b([0-9a-f]{7,40})\b/gi;
  const REVERT_HASH = /revert(?:s|ed)?\s+(?:commit\s+)?["`]?([0-9a-f]{7,40})/i;

  for (const c of commits) {
    const text = `${c.subject}\n${c.body || ""}`;
    const refs = new Set<string>();

    // PR/issue references
    let m;
    PR_REF.lastIndex = 0;
    while ((m = PR_REF.exec(text)) !== null) {
      const num = Number(m[1] ?? m[2]);
      const target = byPrNumber.get(num);
      if (target && target !== c.hash) refs.add(target);
    }

    // Direct hash references — match against commits in the index
    HASH_REF.lastIndex = 0;
    while ((m = HASH_REF.exec(text)) !== null) {
      const candidate = m[1]!.toLowerCase();
      if (candidate.length < 7) continue;
      // Find any commit whose hash starts with this candidate
      for (const target of commits) {
        if (target.hash === c.hash) continue;
        if (target.hash.toLowerCase().startsWith(candidate)) {
          refs.add(target.hash);
          break;
        }
      }
    }

    // Revert markers
    const rev = REVERT_HASH.exec(c.subject + " " + (c.body || ""));
    if (rev) {
      const candidate = rev[1]!.toLowerCase();
      for (const target of commits) {
        if (target.hash === c.hash) continue;
        if (target.hash.toLowerCase().startsWith(candidate)) {
          refs.add(target.hash);
          break;
        }
      }
    }

    if (refs.size > 0) graph.set(c.hash, refs);
  }
  return graph;
}

/**
 * Boost search results by causal proximity to the top hit.
 *
 * If a chunk's commit is referenced (directly or transitively up to
 * maxHops) by another result's commit, its score gets boosted.
 */
export function applyCgar(
  results: SearchResult[],
  commits: Commit[],
  opts: CgarOptions = {},
): SearchResult[] {
  const maxHops = opts.maxHops ?? 2;
  const decay = opts.hopDecay ?? 0.85;
  const initial = opts.initialBoost ?? 1.3;

  if (results.length === 0) return results;
  const graph = buildCausalGraph(commits);

  // Compute distance (in hops) from any result-commit to every commit it
  // references transitively.
  const seedHashes = new Set(results.map((r) => r.commit.hash));
  const distance = new Map<string, number>();
  // BFS from each seed
  for (const seed of seedHashes) {
    const queue: Array<[string, number]> = [[seed, 0]];
    const seen = new Set<string>([seed]);
    while (queue.length > 0) {
      const [node, hops] = queue.shift()!;
      if (hops >= maxHops) continue;
      const neighbors = graph.get(node);
      if (!neighbors) continue;
      for (const nb of neighbors) {
        if (seen.has(nb)) continue;
        seen.add(nb);
        const cur = distance.get(nb);
        if (cur === undefined || hops + 1 < cur) {
          distance.set(nb, hops + 1);
        }
        queue.push([nb, hops + 1]);
      }
    }
  }

  return results
    .map((r) => {
      const hops = distance.get(r.commit.hash);
      if (hops === undefined || hops === 0) return r;
      const boost = initial * Math.pow(decay, hops - 1);
      return { ...r, score: r.score * boost };
    })
    .sort((a, b) => b.score - a.score);
}

// ─── ENSEMBLE — apply all four ───────────────────────────────────────

export interface EnsembleOptions {
  tdwe?: TdweOptions | false;
  racb?: { signals: RegretSignal[]; opts?: RacbOptions } | false;
  ads?: AdsOptions | false;
  cgar?: { commits: Commit[]; opts?: CgarOptions } | false;
}

/**
 * Apply all four novel scoring layers in sequence:
 *   1. TDWE — temporal relevance
 *   2. RACB — regret-derived wisdom boost
 *   3. CGAR — causal graph propagation
 *   4. ADS — diversity re-ranking (last, after scoring is final)
 */
export function applyNovelScoring(
  results: SearchResult[],
  ensemble: EnsembleOptions,
): SearchResult[] {
  let r = results;
  if (ensemble.tdwe !== false) r = applyTdwe(r, ensemble.tdwe || {});
  if (ensemble.racb !== false && ensemble.racb) {
    r = applyRacb(r, ensemble.racb.signals, ensemble.racb.opts);
  }
  if (ensemble.cgar !== false && ensemble.cgar) {
    r = applyCgar(r, ensemble.cgar.commits, ensemble.cgar.opts);
  }
  if (ensemble.ads !== false) r = applyAds(r, ensemble.ads || {});
  return r;
}
