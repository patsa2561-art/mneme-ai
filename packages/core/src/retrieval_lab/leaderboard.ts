/**
 * Leaderboard persistence + UCB1 ranking.
 *
 * UCB1 (Upper Confidence Bound) is the classical multi-armed bandit
 * algorithm: pick the arm with the highest (mean + sqrt(2*ln(N)/n_i))
 * where N = total trials, n_i = trials of this arm. This balances:
 *   - exploit (mean is high)
 *   - explore (n_i is low, so the bound is wide)
 *
 * Result: the tuner converges to the best arm fast WITHOUT permanently
 * starving any arm of trials -- so when a new config is added, it gets
 * a fair shake within a few caretaker passes.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Leaderboard, LeaderboardEntry, RetrievalConfig, Trial } from "./types.js";
import { CANDIDATE_CONFIGS, DEFAULT_CONFIG } from "./configs.js";

const FILE = ".mneme/retrieval/leaderboard.json";

function ensureDir(repoRoot: string): void {
  const dir = join(repoRoot, ".mneme", "retrieval");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function emptyLeaderboard(): Leaderboard {
  const entries: LeaderboardEntry[] = CANDIDATE_CONFIGS.map((c) => ({
    configId: c.id,
    config: c,
    trialCount: 0,
    meanComposite: 0,
    ucb1: Number.POSITIVE_INFINITY, // never tried -> infinite UCB so it gets picked first
    lastTriedAt: "",
    meanPrecisionAtK: 0,
    meanRecallAtK: 0,
    meanNdcgAtK: 0,
    meanLatencyMs: 0,
  }));
  return {
    schemaVersion: 1,
    entries,
    active: DEFAULT_CONFIG.id,
    totalTrials: 0,
    lastUpdate: new Date().toISOString(),
  };
}

export function readLeaderboard(repoRoot: string): Leaderboard {
  const path = join(repoRoot, FILE);
  if (!existsSync(path)) return emptyLeaderboard();
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as Leaderboard;
    // Backfill new candidate configs that were added since last write.
    const knownIds = new Set(parsed.entries.map((e) => e.configId));
    for (const c of CANDIDATE_CONFIGS) {
      if (!knownIds.has(c.id)) {
        parsed.entries.push({
          configId: c.id, config: c, trialCount: 0, meanComposite: 0,
          ucb1: Number.POSITIVE_INFINITY, lastTriedAt: "",
          meanPrecisionAtK: 0, meanRecallAtK: 0, meanNdcgAtK: 0, meanLatencyMs: 0,
        });
      }
    }
    return parsed;
  } catch {
    return emptyLeaderboard();
  }
}

export function writeLeaderboard(repoRoot: string, lb: Leaderboard): void {
  try {
    ensureDir(repoRoot);
    writeFileSync(join(repoRoot, FILE), JSON.stringify(lb, null, 2), "utf8");
  } catch { /* best-effort */ }
}

/** Pick the next arm to trial via UCB1. Returns the config + reason. */
export function pickNextArm(lb: Leaderboard, explorationConst = 1.4): {
  config: RetrievalConfig;
  reason: "untried" | "ucb1-best";
} {
  // Untried first (give every arm at least one trial).
  const untried = lb.entries.find((e) => e.trialCount === 0);
  if (untried) return { config: untried.config, reason: "untried" };

  // UCB1: pick max(mean + c * sqrt(ln(N) / n_i))
  const totalN = lb.entries.reduce((s, e) => s + e.trialCount, 0);
  let best = lb.entries[0]!;
  let bestUcb = -Infinity;
  for (const e of lb.entries) {
    const ucb = e.meanComposite + explorationConst * Math.sqrt(Math.log(totalN) / Math.max(1, e.trialCount));
    if (ucb > bestUcb) { bestUcb = ucb; best = e; }
  }
  return { config: best.config, reason: "ucb1-best" };
}

/** Fold a new trial into the leaderboard (running mean + UCB1 recompute). */
export function recordTrial(repoRoot: string, trial: Trial): Leaderboard {
  const lb = readLeaderboard(repoRoot);
  const entry = lb.entries.find((e) => e.configId === trial.configId);
  if (!entry) return lb; // unknown config -- ignore

  const n = entry.trialCount;
  const k = n + 1;
  // Welford-style running mean update.
  entry.meanComposite = (entry.meanComposite * n + trial.compositeScore) / k;
  entry.meanPrecisionAtK = (entry.meanPrecisionAtK * n + trial.meanPrecisionAtK) / k;
  entry.meanRecallAtK = (entry.meanRecallAtK * n + trial.meanRecallAtK) / k;
  entry.meanNdcgAtK = (entry.meanNdcgAtK * n + trial.meanNdcgAtK) / k;
  entry.meanLatencyMs = (entry.meanLatencyMs * n + trial.meanLatencyMs) / k;
  entry.trialCount = k;
  entry.lastTriedAt = trial.ranAt;
  lb.totalTrials += 1;

  // Recompute UCB1 for every entry now that totalN changed.
  const totalN = lb.totalTrials;
  for (const e of lb.entries) {
    if (e.trialCount === 0) { e.ucb1 = Number.POSITIVE_INFINITY; continue; }
    e.ucb1 = e.meanComposite + 1.4 * Math.sqrt(Math.log(totalN) / e.trialCount);
  }

  // Pick new active = highest mean among arms with >= 2 trials (avoid
  // single-trial flukes promoting a bad arm).
  const stable = lb.entries.filter((e) => e.trialCount >= 2);
  const candidate = stable.length > 0 ? stable : lb.entries.filter((e) => e.trialCount > 0);
  if (candidate.length > 0) {
    candidate.sort((a, b) => b.meanComposite - a.meanComposite);
    lb.active = candidate[0]!.configId;
  }
  lb.lastUpdate = new Date().toISOString();
  writeLeaderboard(repoRoot, lb);
  return lb;
}

/** Read the currently-active config. The function every search() call uses. */
export function activeConfig(repoRoot: string): RetrievalConfig {
  try {
    const lb = readLeaderboard(repoRoot);
    const entry = lb.entries.find((e) => e.configId === lb.active);
    return entry?.config ?? DEFAULT_CONFIG;
  } catch { return DEFAULT_CONFIG; }
}

/** Pareto frontier: configs that are NOT dominated on (composite, latency).
 *  Used by the Lab UI scatter plot. */
export function paretoFrontier(lb: Leaderboard): LeaderboardEntry[] {
  const tried = lb.entries.filter((e) => e.trialCount > 0);
  return tried.filter((a) => {
    return !tried.some((b) =>
      b !== a &&
      b.meanComposite >= a.meanComposite &&
      b.meanLatencyMs <= a.meanLatencyMs &&
      (b.meanComposite > a.meanComposite || b.meanLatencyMs < a.meanLatencyMs),
    );
  });
}
