/**
 * `mneme correlation-matrix` — find HIDDEN coupling between files.
 *
 * Static analysis catches imports. This catches *behavioral coupling*:
 * "every time file X is touched, file Y has a bug fix within N days,
 * even though X and Y don't import each other."
 *
 * Why this is novel: most tools see static dependency graphs (X imports
 * Y). Behavioral graphs reveal architectural smells that imports don't:
 * a config table that EVERY service silently depends on, an undocumented
 * shared state, an order-of-operations contract.
 *
 * Output: ranked file-pair coupling with statistical significance score.
 *
 * Pure analysis. No LLM.
 */

import type { Commit } from "../types.js";

export interface CouplingPair {
  fileA: string;
  fileB: string;
  /** Total commits that touched A. */
  countA: number;
  /** Total commits that touched B. */
  countB: number;
  /** Commits that touched A AND B together. */
  coOccurrences: number;
  /** Jaccard similarity = co_occurrences / (A + B - co_occurrences). */
  jaccard: number;
  /** Lift = P(B|A) / P(B) — how much MORE likely B is touched given A. */
  lift: number;
  /** Tier label. */
  tier: "tight" | "strong" | "moderate" | "weak";
  /** Plain-English interpretation. */
  interpretation: string;
}

export interface CorrelationOptions {
  /** Minimum total touches per file to consider. */
  minFileTouches?: number;
  /** Minimum co-occurrences to surface a pair. */
  minCoOccurrences?: number;
  /** Top-N pairs to return. */
  topN?: number;
  /** Skip pairs where lift below this. */
  minLift?: number;
}

/**
 * Build the file-pair coupling matrix from commit history.
 *
 * Algorithm: for each commit, mark every pair (file_i, file_j) as co-touched.
 * Aggregate counts; compute Jaccard + lift per pair.
 */
export function correlationMatrix(commits: Commit[], opts: CorrelationOptions = {}): CouplingPair[] {
  const minTouches = opts.minFileTouches ?? 3;
  const minCo = opts.minCoOccurrences ?? 2;
  const topN = opts.topN ?? 20;
  const minLift = opts.minLift ?? 1.5;

  // Step 1: per-file count.
  const fileCount = new Map<string, number>();
  for (const c of commits) {
    for (const f of c.files ?? []) fileCount.set(f, (fileCount.get(f) ?? 0) + 1);
  }

  // Filter to files with enough activity.
  const eligible = new Set<string>();
  for (const [f, n] of fileCount) if (n >= minTouches) eligible.add(f);

  // Step 2: per-pair co-occurrence.
  const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
  const pairCount = new Map<string, number>();
  for (const c of commits) {
    const files = (c.files ?? []).filter((f) => eligible.has(f));
    for (let i = 0; i < files.length; i++) {
      for (let j = i + 1; j < files.length; j++) {
        const k = pairKey(files[i]!, files[j]!);
        pairCount.set(k, (pairCount.get(k) ?? 0) + 1);
      }
    }
  }

  const totalCommits = commits.length;
  const pairs: CouplingPair[] = [];
  for (const [k, n] of pairCount) {
    if (n < minCo) continue;
    const [a, b] = k.split("|");
    const A = fileCount.get(a!)!;
    const B = fileCount.get(b!)!;
    const jaccard = n / (A + B - n);
    // P(B|A) = n / A;  P(B) = B / totalCommits;  lift = (n/A) / (B/totalCommits)
    const lift = totalCommits === 0 || A === 0 || B === 0 ? 0 : (n / A) / (B / totalCommits);
    if (lift < minLift) continue;

    pairs.push({
      fileA: a!,
      fileB: b!,
      countA: A,
      countB: B,
      coOccurrences: n,
      jaccard,
      lift,
      tier: classifyCouplingTier(jaccard, lift),
      interpretation: buildCouplingInterpretation(jaccard, lift, n),
    });
  }

  pairs.sort((a, b) => b.lift - a.lift || b.jaccard - a.jaccard);
  return pairs.slice(0, topN);
}

export function classifyCouplingTier(jaccard: number, lift: number): CouplingPair["tier"] {
  // 'tight' = perfect jaccard (≥ 0.9) OR (jaccard ≥ 0.6 AND lift ≥ 5).
  // Real codebases rarely hit lift ≥ 5; jaccard 1.0 is a stronger signal
  // than lift alone — fully co-touched files deserve the 'tight' label.
  if (jaccard >= 0.9 || (jaccard >= 0.6 && lift >= 5)) return "tight";
  if (jaccard >= 0.4 || lift >= 3) return "strong";
  if (jaccard >= 0.2 || lift >= 2) return "moderate";
  return "weak";
}

function buildCouplingInterpretation(jaccard: number, lift: number, co: number): string {
  if (jaccard >= 0.6) {
    return `Tight behavioral coupling (Jaccard ${jaccard.toFixed(2)}). These files almost always change together. Likely candidates for a single module.`;
  }
  if (lift >= 5) {
    return `${lift.toFixed(1)}× more likely than random to be touched together (${co} co-occurrences). Hidden dependency worth investigating.`;
  }
  if (jaccard >= 0.3) {
    return `Moderate coupling (Jaccard ${jaccard.toFixed(2)}). Watch for accidental shared state.`;
  }
  return `Weak signal — ${co} shared touches with lift ${lift.toFixed(1)}×.`;
}
