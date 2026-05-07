/**
 * Mutant-adapt — auto-adapt Mneme's behavior based on what's worked.
 *
 * Where the calibrator tunes a fixed set of search knobs against feedback,
 * this module tracks success/failure across *any* labeled axis: provider,
 * model, scoring config, intent classifier — anything caller wants to tag.
 * Over time, `recommend()` returns whichever axis in a given group has the
 * best success rate weighted by recency.
 *
 * Design choices:
 *   - Axis names are free-form strings. Callers convene on prefix conventions
 *     ("provider:groq", "model:qwen2.5:3b", "weights:rrf-k=60"). The grouping
 *     is just substring-startsWith, so naming is the API.
 *   - `decayState` is *pure* — it returns a new state. The caller chooses when
 *     to persist. This keeps the file write batched at most once per command.
 *   - Stats older than 7 days get halved by decay. This isn't a half-life; it's
 *     a one-shot demotion. Callers can run decay before every recommendation
 *     for a softer running average, or once per day for a sharper recency bias.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface AxisStat {
  axis: string; // e.g. "provider:groq", "model:qwen2.5:3b", "scoring:rrf-k=60"
  successCount: number;
  failureCount: number;
  /** Last success ISO timestamp. */
  lastSuccessAt?: string;
  /** Avg latency (ms). */
  avgLatencyMs?: number;
  /** Most recent failure reason — useful for diagnostics. */
  lastFailureReason?: string;
  /** Last update ISO timestamp — used by decayState. */
  lastUpdatedAt?: string;
}

export interface MutantState {
  axes: Record<string, AxisStat>;
  /** Last time mutant adapted recommendations. */
  lastAdaptedAt?: string;
}

export interface AxisRecommendation {
  bestAxis: string;
  successRate: number;
  reason: string;
}

/** ms in 7 days — anything older than this gets halved by decayState. */
const DECAY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;

function statePath(repoRoot: string): string {
  return join(repoRoot, ".mneme", "mutant.json");
}

function emptyState(): MutantState {
  return { axes: {} };
}

/** Read state from .mneme/mutant.json. Returns empty state if missing/corrupt. */
export function readMutantState(repoRoot: string): MutantState {
  const path = statePath(repoRoot);
  if (!existsSync(path)) return emptyState();
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return emptyState();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return emptyState();
  }
  if (!parsed || typeof parsed !== "object") return emptyState();
  const s = parsed as Partial<MutantState>;
  if (!s.axes || typeof s.axes !== "object") return emptyState();
  // Defensive: drop malformed axis records rather than throw.
  const axes: Record<string, AxisStat> = {};
  for (const [key, val] of Object.entries(s.axes)) {
    if (!val || typeof val !== "object") continue;
    const a = val as Partial<AxisStat>;
    if (typeof a.axis !== "string") continue;
    axes[key] = {
      axis: a.axis,
      successCount: typeof a.successCount === "number" ? a.successCount : 0,
      failureCount: typeof a.failureCount === "number" ? a.failureCount : 0,
      lastSuccessAt: typeof a.lastSuccessAt === "string" ? a.lastSuccessAt : undefined,
      avgLatencyMs: typeof a.avgLatencyMs === "number" ? a.avgLatencyMs : undefined,
      lastFailureReason: typeof a.lastFailureReason === "string" ? a.lastFailureReason : undefined,
      lastUpdatedAt: typeof a.lastUpdatedAt === "string" ? a.lastUpdatedAt : undefined,
    };
  }
  return {
    axes,
    lastAdaptedAt: typeof s.lastAdaptedAt === "string" ? s.lastAdaptedAt : undefined,
  };
}

function atomicWrite(path: string, contents: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    try {
      mkdirSync(dir, { recursive: true });
    } catch {
      return;
    }
  }
  const tmp = `${path}.tmp.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}`;
  try {
    writeFileSync(tmp, contents, "utf8");
    renameSync(tmp, path);
  } catch {
    try {
      rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
  }
}

function persist(repoRoot: string, state: MutantState): void {
  atomicWrite(statePath(repoRoot), JSON.stringify(state, null, 2));
}

function getOrInit(state: MutantState, axis: string): AxisStat {
  if (!state.axes[axis]) {
    state.axes[axis] = { axis, successCount: 0, failureCount: 0 };
  }
  return state.axes[axis];
}

/** Record a success for an axis. Bumps successCount, updates timestamps + latency. */
export function recordSuccess(repoRoot: string, axis: string, latencyMs?: number): void {
  const state = readMutantState(repoRoot);
  const stat = getOrInit(state, axis);
  stat.successCount += 1;
  const nowIso = new Date().toISOString();
  stat.lastSuccessAt = nowIso;
  stat.lastUpdatedAt = nowIso;
  if (typeof latencyMs === "number" && latencyMs >= 0) {
    // Running average — weighted by total success count so a single outlier
    // doesn't wreck the signal once we have a sample.
    const prev = stat.avgLatencyMs;
    if (prev === undefined) {
      stat.avgLatencyMs = latencyMs;
    } else {
      stat.avgLatencyMs = prev + (latencyMs - prev) / stat.successCount;
    }
  }
  persist(repoRoot, state);
}

/** Record a failure for an axis. Bumps failureCount + records reason. */
export function recordFailure(repoRoot: string, axis: string, reason: string): void {
  const state = readMutantState(repoRoot);
  const stat = getOrInit(state, axis);
  stat.failureCount += 1;
  stat.lastFailureReason = reason;
  stat.lastUpdatedAt = new Date().toISOString();
  persist(repoRoot, state);
}

/**
 * Compute a recommendation: which axis (within a group) has the best
 * success rate × recency? Returns null if no data.
 *
 * Tiebreakers (in order):
 *   1. Highest success rate.
 *   2. Highest absolute success count (more samples = more confidence).
 *   3. Most recent success.
 *
 * Pure function — does not read or write files.
 */
export function recommend(state: MutantState, axisGroupPrefix: string): AxisRecommendation | null {
  const candidates = Object.values(state.axes).filter(
    (a) => a.axis.startsWith(axisGroupPrefix) && a.successCount + a.failureCount > 0,
  );
  if (candidates.length === 0) return null;
  let best: AxisStat | null = null;
  let bestRate = -1;
  for (const c of candidates) {
    const total = c.successCount + c.failureCount;
    const rate = c.successCount / total;
    if (best === null) {
      best = c;
      bestRate = rate;
      continue;
    }
    const bestTotal = best.successCount + best.failureCount;
    if (
      rate > bestRate ||
      (rate === bestRate && c.successCount > best.successCount) ||
      (rate === bestRate &&
        c.successCount === best.successCount &&
        (c.lastSuccessAt ?? "") > (best.lastSuccessAt ?? ""))
    ) {
      best = c;
      bestRate = rate;
      // bestTotal is computed for symmetry but unused — left explicit to
      // document the comparison contract.
      void bestTotal;
    }
  }
  if (!best) return null;
  const total = best.successCount + best.failureCount;
  return {
    bestAxis: best.axis,
    successRate: bestRate,
    reason: `${best.successCount}/${total} successful${
      best.lastSuccessAt ? `, last success ${best.lastSuccessAt}` : ""
    }`,
  };
}

/**
 * Decay old stats so the system can adapt to current realities.
 * Halves counts on axes whose lastUpdatedAt is older than 7 days.
 * Pure function — caller decides when to persist.
 */
export function decayState(state: MutantState, nowMs: number = Date.now()): MutantState {
  const next: MutantState = { axes: {}, lastAdaptedAt: state.lastAdaptedAt };
  for (const [key, stat] of Object.entries(state.axes)) {
    const updatedAt = stat.lastUpdatedAt ? Date.parse(stat.lastUpdatedAt) : NaN;
    const isStale = !Number.isNaN(updatedAt) && nowMs - updatedAt > DECAY_AFTER_MS;
    if (isStale) {
      next.axes[key] = {
        ...stat,
        // Math.floor preserves the "halve and round down" contract — 1 success
        // decays to 0, not 0.5, so a never-revisited axis eventually drops out.
        successCount: Math.floor(stat.successCount / 2),
        failureCount: Math.floor(stat.failureCount / 2),
      };
    } else {
      next.axes[key] = { ...stat };
    }
  }
  return next;
}

/** Persist a state object (e.g. after a caller-driven decayState call). */
export function writeMutantState(repoRoot: string, state: MutantState): void {
  persist(repoRoot, state);
}
