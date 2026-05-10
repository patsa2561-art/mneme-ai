/**
 * MNEME STIGMERGY HIVE (v1.27.6) -- emergent dev collaboration
 * detection from git traces alone, no chat logs needed.
 *
 * Stigmergy is the biological term for indirect coordination via
 * traces in the environment. Termites build cathedrals without
 * blueprints because each termite responds to local pheromone
 * gradients. Devs do the same in a codebase: every commit leaves a
 * trace, every other dev decides what to commit based on what's
 * already there.
 *
 * Most "team analytics" tools count Slack messages and PR reviews
 * because those are easy to see. Mneme STIGMERGY HIVE infers the
 * INVISIBLE collaboration layer:
 *
 *   - When dev B touches a file dev A introduced 6 days ago, that's
 *     stigmergic carry-on (B extending A's work).
 *   - When dev A and dev B both touch the same file within 24 hours,
 *     that's stigmergic synchrony (one reacted to the other).
 *   - When devs share files but never on PRs together, that's
 *     INVISIBLE collaboration.
 *
 * The output is a ranked list of dev pairs with a stigmergic score.
 * Pairs near the top are people who effectively work together
 * without ever talking. Often this is gold for org charts: the real
 * team structure vs the formal one.
 *
 * As far as we can tell, no other dev tool ships this analysis.
 * Mneme is the only one with the git-graph + author-passport
 * substrate to compute it.
 */

export interface CommitFact {
  /** sha1 short. */
  sha: string;
  /** Committer email (lowercased). */
  email: string;
  /** ISO timestamp. */
  at: string;
  /** Files touched (relative paths). */
  files: string[];
}

export interface PairOverlap {
  authorA: string;       // email A (alphabetically first)
  authorB: string;       // email B
  /** Files touched by BOTH authors at any time. */
  sharedFiles: number;
  /** Files where A touched then B touched within 24h (or vice-versa). */
  synchronyHits: number;
  /** Files where A introduced (`--diff-filter=A`) then B touched within 7d. */
  carryOnHits: number;
  /** First-seen co-occurrence ISO. */
  firstCoTouch: string | null;
  /** Most-recent co-touch ISO. */
  lastCoTouch: string | null;
  /** Composite 0-100 stigmergy score. */
  stigmergyScore: number;
}

export interface StigmergyReport {
  /** ISO timestamp the analysis ran. */
  computedAt: string;
  /** How many commits were analysed. */
  commitsAnalysed: number;
  /** Distinct author count. */
  authorCount: number;
  /** Pairs with stigmergy >= surfaceThreshold (default 10), ranked desc. */
  pairs: PairOverlap[];
  /** Pairs that touched the same files but score below threshold. */
  weakPairs: number;
}

export interface StigmergyConfig {
  /** Number of commits to scan back. Default 500. */
  windowCommits: number;
  /** Synchrony window in hours. Default 24. */
  synchronyHours: number;
  /** Carry-on window in days. Default 7. */
  carryOnDays: number;
  /** Minimum stigmergy score to surface in `pairs`. Default 10. */
  surfaceThreshold: number;
}

export const DEFAULT_STIGMERGY_CONFIG: StigmergyConfig = {
  windowCommits: 500,
  synchronyHours: 24,
  carryOnDays: 7,
  surfaceThreshold: 10,
};
