/**
 * `mneme moneyball` — find undervalued contributors.
 *
 * The Billy Beane angle on engineering: in baseball, big-volume hitters
 * get the contracts but on-base-percentage wins games. In codebases:
 * loud LOC-per-day contributors get promoted, but the people whose
 * commits *unblock everyone else* are the real value.
 *
 * Metric: each commit is "valuable" by how many SUBSEQUENT commits touch
 * the same files. People whose commits frequently appear upstream of
 * many others' work are unblocking. People with high LOC volume but few
 * downstream touches are noise generators.
 *
 *   value_score = log(downstream_commits + 1) × distinct_collaborators
 *   over_undervalued = value_score / commit_count   (per-commit ROI)
 *
 * Pure analysis. No LLM.
 */

import type { Commit } from "../types.js";

export interface ContributorScore {
  authorName: string;
  authorEmail: string;
  /** Total commits authored. */
  commitCount: number;
  /** Total downstream commits — sum of how many later commits touched the same files. */
  downstreamReach: number;
  /** Number of DISTINCT other authors whose work followed theirs on the same files. */
  collaborators: number;
  /** Aggregate value score (see formula in module doc). */
  valueScore: number;
  /** Per-commit ROI = valueScore / commitCount — the moneyball metric. */
  perCommitROI: number;
  /** Tier label. */
  tier: "moneyball" | "balanced" | "loud" | "passive";
  /** A 1-line interpretation. */
  interpretation: string;
}

export interface MoneyballOptions {
  /** Maximum days to count "downstream" relationships. Default 90. */
  downstreamWindowDays?: number;
  /** Minimum commits for a contributor to be ranked. Default 2. */
  minCommits?: number;
  /** Top-N to return. */
  topN?: number;
}

export function moneyball(commits: Commit[], opts: MoneyballOptions = {}): ContributorScore[] {
  const windowMs = (opts.downstreamWindowDays ?? 90) * 86_400_000;
  const minCommits = opts.minCommits ?? 2;
  const topN = opts.topN ?? 20;

  const sorted = [...commits].sort((a, b) => a.authorDate.localeCompare(b.authorDate));

  // Step 1: per-author bookkeeping.
  type Bucket = {
    authorName: string;
    authorEmail: string;
    commits: Commit[];
    downstream: number;
    collaboratorSet: Set<string>;
  };
  const byAuthor = new Map<string, Bucket>();
  for (const c of sorted) {
    const key = `${c.authorName}|${c.authorEmail}`;
    if (!byAuthor.has(key))
      byAuthor.set(key, {
        authorName: c.authorName,
        authorEmail: c.authorEmail,
        commits: [],
        downstream: 0,
        collaboratorSet: new Set(),
      });
    byAuthor.get(key)!.commits.push(c);
  }

  // Step 2: for each commit, count downstream commits within window.
  for (let i = 0; i < sorted.length; i++) {
    const upstream = sorted[i]!;
    if (!upstream.files?.length) continue;
    const upstreamFiles = new Set(upstream.files);
    const upstreamTime = new Date(upstream.authorDate).getTime();
    const upstreamAuthor = `${upstream.authorName}|${upstream.authorEmail}`;
    const bucket = byAuthor.get(upstreamAuthor)!;

    for (let j = i + 1; j < sorted.length; j++) {
      const later = sorted[j]!;
      const dt = new Date(later.authorDate).getTime() - upstreamTime;
      if (dt > windowMs) break;
      if (!later.files?.some((f) => upstreamFiles.has(f))) continue;
      // Count this as a downstream touch on the upstream commit.
      bucket.downstream += 1;
      const laterAuthor = `${later.authorName}|${later.authorEmail}`;
      if (laterAuthor !== upstreamAuthor) {
        bucket.collaboratorSet.add(later.authorName);
      }
    }
  }

  // Step 3: compute scores + tiers.
  const scores: ContributorScore[] = [];
  for (const b of byAuthor.values()) {
    if (b.commits.length < minCommits) continue;
    const valueScore = Math.log2(b.downstream + 1) * b.collaboratorSet.size;
    const perCommitROI = b.commits.length === 0 ? 0 : valueScore / b.commits.length;
    const tier = classifyMoneyballTier(b.commits.length, valueScore, perCommitROI);
    scores.push({
      authorName: b.authorName,
      authorEmail: b.authorEmail,
      commitCount: b.commits.length,
      downstreamReach: b.downstream,
      collaborators: b.collaboratorSet.size,
      valueScore,
      perCommitROI,
      tier,
      interpretation: buildInterpretation(tier, b.commits.length, b.downstream, b.collaboratorSet.size),
    });
  }

  // Sort by perCommitROI desc — undervalued contributors rise.
  scores.sort((a, b) => b.perCommitROI - a.perCommitROI);
  return scores.slice(0, topN);
}

export function classifyMoneyballTier(
  commitCount: number,
  valueScore: number,
  perCommitROI: number,
): ContributorScore["tier"] {
  // Moneyball: high ROI per commit AND modest commit count (low volume, high impact).
  if (perCommitROI >= 1.5 && commitCount < 30) return "moneyball";
  // Balanced: high overall value but proportional commit count.
  if (valueScore >= 5 && perCommitROI >= 0.5) return "balanced";
  // Loud: lots of commits, low ROI per commit (noise).
  if (commitCount >= 30 && perCommitROI < 0.3) return "loud";
  // Passive: few commits, low downstream activity.
  return "passive";
}

function buildInterpretation(
  tier: ContributorScore["tier"],
  commitCount: number,
  downstream: number,
  collaborators: number,
): string {
  switch (tier) {
    case "moneyball":
      return `Undervalued — ${commitCount} commits unblocked ${collaborators} other contributors (${downstream} downstream touches). High ROI per commit.`;
    case "balanced":
      return `Solid contributor — ${commitCount} commits with ${downstream} downstream effects across ${collaborators} collaborators.`;
    case "loud":
      return `High volume, low impact — ${commitCount} commits but only ${downstream} downstream touches. Noise > signal.`;
    case "passive":
      return `Limited footprint — ${commitCount} commits, ${downstream} downstream effects. Either too new or working in isolation.`;
  }
}
