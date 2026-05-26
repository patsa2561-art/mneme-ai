/**
 * v2.63.0 — TIME-CRYSTAL approach ranking.
 *
 * Given N raw wisdom records for the same problem fingerprint, group by
 * approach + score each group. Output is the ranked solution list.
 *
 * Three scoring factors fused:
 *  1. Wilson lower-bound on success rate (small samples don't dominate)
 *  2. Recency boost (exponential decay; half-life 30 days)
 *  3. Environment match (if caller's env supplied, prefer approaches
 *     tested on matching env)
 *
 * Pure deterministic.
 */

export type Outcome = "success" | "failure" | "partial";

export interface WisdomRecord {
  approach: string;
  outcome: Outcome;
  /** When this record was contributed (ISO 8601). */
  at: string;
  /** Optional environment fingerprint (node version etc). */
  env?: Record<string, string>;
  /** Optional free-text note (gotcha hint). */
  note?: string;
}

export interface ApproachGroup {
  approach: string;
  sampleSize: number;
  successCount: number;
  partialCount: number;
  failureCount: number;
  /** Mean success rate (success + 0.5*partial) / total. */
  successRate: number;
  /** Wilson lower bound at 95% — credible lower bound. */
  wilsonLB: number;
  /** Most recent contribution timestamp. */
  lastSeenAt: string;
  /** Records' env-match count (when grounding env provided). */
  envMatches?: number;
  /** Aggregated notes (gotcha hints). */
  notes: string[];
  /** Composite rank score 0..1. */
  rankScore: number;
}

/** Wilson score lower bound for a binomial proportion. */
function wilsonLB(success: number, total: number, z = 1.96): number {
  if (total === 0) return 0;
  const phat = success / total;
  const denom = 1 + z * z / total;
  const center = phat + z * z / (2 * total);
  const margin = z * Math.sqrt(phat * (1 - phat) / total + z * z / (4 * total * total));
  return Math.max(0, (center - margin) / denom);
}

/**
 * Normalize approach text so similar phrasing groups. We don't deeply
 * understand the approach — just trim + lowercase + collapse whitespace.
 * Future: cluster via embedding distance (deep mode).
 */
export function approachKey(text: string): string {
  return text.replace(/\s+/g, " ").trim().toLowerCase();
}

export interface RankOpts {
  /** Current environment to match (e.g. { node: "22.13.0", pnpm: "10" }). */
  env?: Record<string, string>;
  /** Half-life in milliseconds for recency boost. Default 30 days. */
  halfLifeMs?: number;
  /** Reference "now" for recency calculation (default Date.now). */
  now?: number;
}

export function rankApproaches(records: WisdomRecord[], opts: RankOpts = {}): ApproachGroup[] {
  const now = opts.now ?? Date.now();
  const halfLifeMs = opts.halfLifeMs ?? 30 * 24 * 60 * 60 * 1000;
  const groups = new Map<string, ApproachGroup>();
  for (const r of records) {
    const key = approachKey(r.approach);
    if (!key) continue;
    const g = groups.get(key) ?? {
      approach: r.approach,
      sampleSize: 0,
      successCount: 0,
      partialCount: 0,
      failureCount: 0,
      successRate: 0,
      wilsonLB: 0,
      lastSeenAt: r.at,
      envMatches: opts.env ? 0 : undefined,
      notes: [] as string[],
      rankScore: 0,
    };
    g.sampleSize++;
    if (r.outcome === "success") g.successCount++;
    else if (r.outcome === "partial") g.partialCount++;
    else g.failureCount++;
    if (new Date(r.at).getTime() > new Date(g.lastSeenAt).getTime()) g.lastSeenAt = r.at;
    if (opts.env && r.env && envMatch(opts.env, r.env)) g.envMatches = (g.envMatches ?? 0) + 1;
    if (r.note && r.note.length > 0 && !g.notes.includes(r.note)) g.notes.push(r.note);
    groups.set(key, g);
  }

  for (const g of groups.values()) {
    const effectiveSuccess = g.successCount + 0.5 * g.partialCount;
    g.successRate = g.sampleSize === 0 ? 0 : effectiveSuccess / g.sampleSize;
    g.wilsonLB = wilsonLB(effectiveSuccess, g.sampleSize);
    const ageMs = Math.max(0, now - new Date(g.lastSeenAt).getTime());
    const recency = Math.pow(0.5, ageMs / halfLifeMs);
    const envBoost = opts.env && g.envMatches !== undefined && g.sampleSize > 0
      ? 0.5 + 0.5 * (g.envMatches / g.sampleSize)
      : 1.0;
    g.rankScore = +(g.wilsonLB * recency * envBoost).toFixed(4);
  }

  return Array.from(groups.values()).sort((a, b) => b.rankScore - a.rankScore);
}

/** True iff target env contains all key/value pairs from required. */
function envMatch(required: Record<string, string>, candidate: Record<string, string>): boolean {
  for (const [k, v] of Object.entries(required)) {
    if (candidate[k] !== v) return false;
  }
  return true;
}
