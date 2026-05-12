/**
 * v1.68.0 -- ASCENSION ASC-1: CIRCADIAN HEARTBEAT.
 *
 * Replaces single-baseline anomaly detection with a 168-bucket
 * per-hour-of-week baseline. Tuesday-3am gets compared to other
 * Tuesday-3am samples, not to lifetime mean.
 *
 * Result: legitimate weekly rhythm (heavy weekday daytime, light
 * weekend) stops looking like "anomaly" -- only true deviation
 * from the EXPECTED-FOR-THIS-HOUR pattern fires.
 *
 * The bucket id is (dayOfWeek * 24 + hourOfDay) -- 168 total.
 * Bayesian shrinkage toward global mean kicks in for sparse buckets
 * so a single weird Sunday-4am sample doesn't dominate.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const ASC_DIR = ".mneme/ascension";
const BASELINE_FILE = ".mneme/ascension/circadian-baseline.json";

export interface CircadianSample {
  axisId: string;
  /** UTC timestamp (ms). */
  ts: number;
  value: number;
}

export interface BucketStat {
  bucket: number;       // 0..167
  mean: number;
  stdev: number;
  n: number;
}

export interface CircadianBaseline {
  /** Axis -> bucket -> stat. */
  byAxis: Record<string, Record<number, BucketStat>>;
  /** Axis-level global stat (used for Bayesian shrinkage). */
  global: Record<string, { mean: number; stdev: number; n: number }>;
  /** Total samples used. */
  totalSamples: number;
  builtAt: string;
}

export interface CircadianAnomaly {
  axisId: string;
  bucket: number;
  observed: number;
  expectedMean: number;
  expectedStdev: number;
  zScore: number;
  severity: "notable" | "outlier";
}

export function bucketFor(ts: number | string): number {
  const d = typeof ts === "string" ? new Date(ts) : new Date(ts);
  return (d.getUTCDay() * 24) + d.getUTCHours();
}

/** Build a circadian baseline from past samples. */
export function buildCircadianBaseline(samples: CircadianSample[]): CircadianBaseline {
  const byAxis: Record<string, Record<number, { sum: number; sumSq: number; n: number }>> = {};
  const globalAcc: Record<string, { sum: number; sumSq: number; n: number }> = {};

  for (const s of samples) {
    if (!Number.isFinite(s.value)) continue;
    const b = bucketFor(s.ts);
    if (!byAxis[s.axisId]) byAxis[s.axisId] = {};
    const buckets = byAxis[s.axisId]!;
    if (!buckets[b]) buckets[b] = { sum: 0, sumSq: 0, n: 0 };
    const stat = buckets[b]!;
    stat.sum += s.value; stat.sumSq += s.value * s.value; stat.n += 1;
    if (!globalAcc[s.axisId]) globalAcc[s.axisId] = { sum: 0, sumSq: 0, n: 0 };
    const g = globalAcc[s.axisId]!;
    g.sum += s.value; g.sumSq += s.value * s.value; g.n += 1;
  }

  const byAxisOut: CircadianBaseline["byAxis"] = {};
  const globalOut: CircadianBaseline["global"] = {};
  for (const [axisId, buckets] of Object.entries(byAxis)) {
    byAxisOut[axisId] = {};
    for (const [bucketStr, acc] of Object.entries(buckets)) {
      const b = Number(bucketStr);
      const mean = acc.n === 0 ? 0 : acc.sum / acc.n;
      const variance = acc.n <= 1 ? 0 : (acc.sumSq - (acc.sum * acc.sum) / acc.n) / (acc.n - 1);
      byAxisOut[axisId]![b] = { bucket: b, mean, stdev: Math.sqrt(Math.max(0, variance)), n: acc.n };
    }
  }
  for (const [axisId, acc] of Object.entries(globalAcc)) {
    const mean = acc.n === 0 ? 0 : acc.sum / acc.n;
    const variance = acc.n <= 1 ? 0 : (acc.sumSq - (acc.sum * acc.sum) / acc.n) / (acc.n - 1);
    globalOut[axisId] = { mean, stdev: Math.sqrt(Math.max(0, variance)), n: acc.n };
  }

  return {
    byAxis: byAxisOut,
    global: globalOut,
    totalSamples: samples.length,
    builtAt: new Date().toISOString(),
  };
}

/** Bayesian shrinkage: if bucket has < shrinkK samples, blend toward
 *  global mean. shrinkK=8 means a bucket with 4 samples is 50/50
 *  bucket-vs-global. */
function effectiveStat(bucket: BucketStat | undefined, global: { mean: number; stdev: number; n: number } | undefined, shrinkK = 8): { mean: number; stdev: number; n: number } {
  if (!bucket && !global) return { mean: 0, stdev: 0, n: 0 };
  if (!bucket) return global!;
  if (!global) return bucket;
  const w = bucket.n / (bucket.n + shrinkK);
  const mean = w * bucket.mean + (1 - w) * global.mean;
  // Use global stdev when bucket is sparse (avoids zero-stdev divide-by-zero).
  const stdev = bucket.n >= 3 ? bucket.stdev : global.stdev;
  return { mean, stdev, n: bucket.n };
}

/** Detect anomalies in a fresh sample relative to the circadian baseline. */
export function detectCircadianAnomalies(
  baseline: CircadianBaseline,
  fresh: CircadianSample[],
  opts?: { notableZ?: number; outlierZ?: number },
): CircadianAnomaly[] {
  const notableZ = opts?.notableZ ?? 1.5;
  const outlierZ = opts?.outlierZ ?? 2.5;
  const anomalies: CircadianAnomaly[] = [];
  for (const s of fresh) {
    const b = bucketFor(s.ts);
    const bucketStat = baseline.byAxis[s.axisId]?.[b];
    const globalStat = baseline.global[s.axisId];
    const eff = effectiveStat(bucketStat, globalStat);
    if (eff.stdev <= 0 || eff.n < 2) continue; // Not enough data to call anomaly.
    const z = (s.value - eff.mean) / eff.stdev;
    const absZ = Math.abs(z);
    if (absZ < notableZ) continue;
    anomalies.push({
      axisId: s.axisId,
      bucket: b,
      observed: s.value,
      expectedMean: eff.mean,
      expectedStdev: eff.stdev,
      zScore: Number(z.toFixed(2)),
      severity: absZ >= outlierZ ? "outlier" : "notable",
    });
  }
  return anomalies;
}

export function persistBaseline(repoRoot: string, baseline: CircadianBaseline): void {
  const dir = join(repoRoot, ASC_DIR);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(join(repoRoot, BASELINE_FILE), JSON.stringify(baseline, null, 2) + "\n", "utf8");
}

export function readBaseline(repoRoot: string): CircadianBaseline | null {
  const p = join(repoRoot, BASELINE_FILE);
  if (!existsSync(p)) return null;
  try { return JSON.parse(readFileSync(p, "utf8")) as CircadianBaseline; } catch { return null; }
}

export interface CircadianReport {
  baselineSamples: number;
  bucketsFilled: number;
  anomalies: CircadianAnomaly[];
  /** Compared to a single-baseline approach, how many false alarms did we suppress? */
  suppressedVsSingleBaseline: number;
  headline: string;
}

/** Convenience: build baseline from history + run on fresh sample. */
export function analyzeCircadian(
  history: CircadianSample[],
  freshSamples: CircadianSample[],
): CircadianReport {
  const baseline = buildCircadianBaseline(history);
  const anomalies = detectCircadianAnomalies(baseline, freshSamples);
  // Simple "single-baseline" comparison: pool all history + fire on z>=1.5
  // against the pooled mean. Subtract from circadian alarms to surface
  // the false-alarm suppression.
  const pooled: Record<string, { sum: number; sumSq: number; n: number }> = {};
  for (const s of history) {
    if (!Number.isFinite(s.value)) continue;
    if (!pooled[s.axisId]) pooled[s.axisId] = { sum: 0, sumSq: 0, n: 0 };
    const p = pooled[s.axisId]!;
    p.sum += s.value; p.sumSq += s.value * s.value; p.n += 1;
  }
  let singleAlarms = 0;
  for (const f of freshSamples) {
    const p = pooled[f.axisId];
    if (!p || p.n < 3) continue;
    const mean = p.sum / p.n;
    const variance = (p.sumSq - (p.sum * p.sum) / p.n) / (p.n - 1);
    const stdev = Math.sqrt(Math.max(0, variance));
    if (stdev <= 0) continue;
    if (Math.abs((f.value - mean) / stdev) >= 1.5) singleAlarms += 1;
  }
  const suppressedVsSingleBaseline = Math.max(0, singleAlarms - anomalies.length);

  const bucketsFilled = Object.values(baseline.byAxis).reduce((s, m) => s + Object.keys(m).length, 0);
  const headline = anomalies.length === 0
    ? `Circadian quiet: 0 anomalies across ${freshSamples.length} fresh sample(s). Suppressed ${suppressedVsSingleBaseline} false alarm(s) vs single-baseline.`
    : `${anomalies.length} circadian anomaly/ies (${anomalies.filter((a) => a.severity === "outlier").length} outlier). Suppressed ${suppressedVsSingleBaseline} vs single-baseline.`;

  return {
    baselineSamples: history.length,
    bucketsFilled,
    anomalies,
    suppressedVsSingleBaseline,
    headline,
  };
}
