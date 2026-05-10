/**
 * Lamarckian inheritance for retrieval configs.
 *
 * Pattern mirrors antivirus/lineage_vaccines.ts: when a chromosome is
 * crystallized, snapshot the current leaderboard's top-3 configs +
 * scores. When `fertilize()` runs at session boot, merge inherited
 * configs into the local leaderboard (highest mean composite per
 * configId wins).
 *
 * Net effect: a session that ran on machine A and discovered
 * "bge-m3-rrf60-cross" beats the baseline by 30% lets the SAME finding
 * flow into the next session on machine B (or with a different AI
 * vendor) -- without machine B having to re-run the trials.
 */

import type { LeaderboardEntry, RetrievalConfig } from "./types.js";
import { readLeaderboard, writeLeaderboard } from "./leaderboard.js";

export interface RetrievalConfigSignature {
  configId: string;
  config: RetrievalConfig;
  trialCount: number;
  meanComposite: number;
  meanPrecisionAtK: number;
  meanRecallAtK: number;
  meanNdcgAtK: number;
  meanLatencyMs: number;
  capturedAt: string;
}

/** Snapshot top-3 leaderboard entries for inclusion in a chromosome. */
export function snapshotForChromosome(repoRoot: string): RetrievalConfigSignature[] {
  const lb = readLeaderboard(repoRoot);
  const tried = lb.entries.filter((e) => e.trialCount > 0)
    .sort((a, b) => b.meanComposite - a.meanComposite)
    .slice(0, 3);
  const now = new Date().toISOString();
  return tried.map((e) => ({
    configId: e.configId,
    config: e.config,
    trialCount: e.trialCount,
    meanComposite: e.meanComposite,
    meanPrecisionAtK: e.meanPrecisionAtK,
    meanRecallAtK: e.meanRecallAtK,
    meanNdcgAtK: e.meanNdcgAtK,
    meanLatencyMs: e.meanLatencyMs,
    capturedAt: now,
  }));
}

/** Merge inherited configs into the local leaderboard. Highest mean
 *  composite per (configId) wins. Returns the number of entries
 *  updated/added. */
export function mergeInheritedConfigs(
  repoRoot: string,
  inherited: { chromosomeId: string; signatures: RetrievalConfigSignature[] }[],
): number {
  const lb = readLeaderboard(repoRoot);
  let touched = 0;
  for (const { signatures } of inherited) {
    for (const sig of signatures) {
      const local = lb.entries.find((e) => e.configId === sig.configId);
      if (!local) continue; // unknown config -- skip
      // Adopt inherited scores ONLY if they're higher (Lamarckian: the
      // child inherits the better performance the parent already paid for).
      if (sig.meanComposite > local.meanComposite) {
        // Use a weighted average so we don't fully overwrite local trials.
        const localWeight = Math.max(1, local.trialCount);
        const inheritedWeight = Math.max(1, sig.trialCount);
        const totalW = localWeight + inheritedWeight;
        local.meanComposite = (local.meanComposite * localWeight + sig.meanComposite * inheritedWeight) / totalW;
        local.meanPrecisionAtK = (local.meanPrecisionAtK * localWeight + sig.meanPrecisionAtK * inheritedWeight) / totalW;
        local.meanRecallAtK = (local.meanRecallAtK * localWeight + sig.meanRecallAtK * inheritedWeight) / totalW;
        local.meanNdcgAtK = (local.meanNdcgAtK * localWeight + sig.meanNdcgAtK * inheritedWeight) / totalW;
        local.meanLatencyMs = (local.meanLatencyMs * localWeight + sig.meanLatencyMs * inheritedWeight) / totalW;
        local.trialCount = local.trialCount + sig.trialCount;
        touched++;
      }
    }
  }
  if (touched > 0) {
    // Recompute UCB1 + active.
    const totalN = lb.entries.reduce((s, e) => s + e.trialCount, 0);
    for (const e of lb.entries) {
      if (e.trialCount === 0) { e.ucb1 = Number.POSITIVE_INFINITY; continue; }
      e.ucb1 = e.meanComposite + 1.4 * Math.sqrt(Math.log(Math.max(1, totalN)) / e.trialCount);
    }
    const stable = lb.entries.filter((e: LeaderboardEntry) => e.trialCount >= 2);
    const candidate = stable.length > 0 ? stable : lb.entries.filter((e: LeaderboardEntry) => e.trialCount > 0);
    if (candidate.length > 0) {
      candidate.sort((a, b) => b.meanComposite - a.meanComposite);
      lb.active = candidate[0]!.configId;
    }
    lb.lastUpdate = new Date().toISOString();
    writeLeaderboard(repoRoot, lb);
  }
  return touched;
}
