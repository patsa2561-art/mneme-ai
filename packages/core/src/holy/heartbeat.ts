/**
 * `mneme heartbeat` — codebase as living being.
 *
 * Holy Grail #1 of v0.43. Treat the repo as a patient under continuous
 * observation. Each tick of the heartbeat:
 *
 *   1. Take the current pulse (a snapshot of repo-mri axes).
 *   2. Compare against the rolling baseline (mean ± stdev over last 7 days).
 *   3. Emit any axis whose z-score exceeds 2σ as a "pulse anomaly" event.
 *   4. Persist the snapshot for tomorrow's baseline.
 *
 * Output is a structured event list — Slack/email/PR-comment-ready. Cron
 * the daemon to run every N minutes (the CLI exposes `--watch` for that).
 *
 * Why this is novel: every existing health tool computes metrics
 * REACTIVELY ("here's the state when you ran me"). Heartbeat computes
 * them PROACTIVELY ("here's what changed since yesterday, and which
 * change is statistically significant"). The second-brain library is
 * already collecting plan invocations; heartbeat does the same for
 * codebase axes.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { computeMri, type AxisResult, type ComputedAxes } from "../mri/index.js";

const FILE_NAME = "heartbeat.json";
const FILE_VERSION = 1;

export interface PulseSnapshot {
  takenAt: string; // ISO
  /** Axis id → raw value. */
  axes: Record<string, number>;
}

export interface HeartbeatHistory {
  version: 1;
  /** Newest-first. Capped at MAX_HISTORY entries. */
  pulses: PulseSnapshot[];
}

export interface PulseAnomaly {
  axisId: string;
  axisLabel: string;
  /** Current value. */
  value: number;
  /** Baseline mean over the lookback window. */
  baselineMean: number;
  /** Baseline standard deviation. */
  baselineStdev: number;
  /** z = (value − mean) / stdev. */
  zScore: number;
  /** True when crossing into "worse" direction for this axis. */
  worse: boolean;
  /** "outlier" (|z| ≥ 2) | "notable" (|z| ≥ 1). */
  severity: "outlier" | "notable";
}

export interface HeartbeatResult {
  pulse: PulseSnapshot;
  baselineSize: number;
  /** Anomalies detected vs rolling baseline. */
  anomalies: PulseAnomaly[];
  /** True if any axis crossed the outlier threshold. */
  alarming: boolean;
  /** Verbal verdict for Slack/email subject line. */
  verdict: "all-quiet" | "watching" | "alarming";
}

const MAX_HISTORY = 90; // ~3 months

/* ─────────────  Persistence  ──────────────────────────────────────── */

export async function readHistory(rootPath: string): Promise<HeartbeatHistory> {
  const file = join(rootPath, ".mneme", FILE_NAME);
  try {
    const raw = await readFile(file, "utf8");
    const parsed = JSON.parse(raw) as HeartbeatHistory;
    if (parsed.version !== FILE_VERSION) return { version: FILE_VERSION, pulses: [] };
    return parsed;
  } catch {
    return { version: FILE_VERSION, pulses: [] };
  }
}

async function writeHistory(rootPath: string, history: HeartbeatHistory): Promise<void> {
  const dir = join(rootPath, ".mneme");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, FILE_NAME), JSON.stringify(history, null, 2), "utf8");
}

/* ─────────────  Stats  ────────────────────────────────────────────── */

export interface BaselineStat {
  mean: number;
  stdev: number;
  n: number;
}

/** Compute the per-axis baseline (mean + stdev) over a sequence of pulses. */
export function computeBaseline(history: PulseSnapshot[]): Record<string, BaselineStat> {
  const out: Record<string, BaselineStat> = {};
  if (history.length === 0) return out;
  const axisIds = new Set<string>();
  for (const p of history) for (const k of Object.keys(p.axes)) axisIds.add(k);

  for (const id of axisIds) {
    const xs = history.map((p) => p.axes[id]).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (xs.length === 0) continue;
    const mean = xs.reduce((s, v) => s + v, 0) / xs.length;
    const variance = xs.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, xs.length - 1);
    out[id] = { mean, stdev: Math.sqrt(variance), n: xs.length };
  }
  return out;
}

/* ─────────────  Pulse + tick  ─────────────────────────────────────── */

export function snapshotFromMri(mri: ComputedAxes): PulseSnapshot {
  return { takenAt: new Date(mri.asOf * 1000).toISOString(), axes: { ...mri.raw } };
}

/**
 * Compute the heartbeat tick: take pulse, compare to baseline, emit
 * anomalies, persist the new snapshot.
 *
 * The minimum-baseline guard is critical — z-scores on a baseline of
 * size < 3 are noise. We surface this to the caller so the renderer
 * shows "warming up" rather than fake findings.
 */
export interface TickOptions {
  cwd: string;
  /** Minimum baseline size before anomalies are emitted. Default 3. */
  minBaselineSize?: number;
  /** z-threshold for "notable". Default 1. */
  notableZ?: number;
  /** z-threshold for "outlier" (alarming). Default 2. */
  outlierZ?: number;
  /** Pre-computed pulse (for tests / dependency injection). */
  pulseOverride?: PulseSnapshot;
  /** Skip persistence (for dry-run / tests). */
  noPersist?: boolean;
}

export async function tick(opts: TickOptions): Promise<HeartbeatResult> {
  const minBaseline = opts.minBaselineSize ?? 3;
  const notableZ = opts.notableZ ?? 1;
  const outlierZ = opts.outlierZ ?? 2;

  // 1. Pulse
  let pulse: PulseSnapshot;
  if (opts.pulseOverride) {
    pulse = opts.pulseOverride;
  } else {
    const mri = await computeMri({ cwd: opts.cwd, maxCommits: 500 });
    pulse = snapshotFromMri(mri);
  }

  // 2. Baseline (use everything except the just-taken pulse, capped at MAX_HISTORY)
  const history = await readHistory(opts.cwd);
  const baseline = computeBaseline(history.pulses);

  // 3. Anomalies
  const anomalies: PulseAnomaly[] = [];
  if (Object.keys(baseline).length > 0 && history.pulses.length >= minBaseline) {
    // We need the axis catalogue to know directions + labels. Re-using
    // the mri module's _AXES_FOR_TESTS would couple too tightly; instead
    // we recompute the labels by best-effort from the axis id.
    const { _AXES_FOR_TESTS } = await import("../mri/axes.js");
    const axisDefById = new Map(_AXES_FOR_TESTS.map((a) => [a.id, a]));
    for (const [axisId, value] of Object.entries(pulse.axes)) {
      const stat = baseline[axisId];
      if (!stat || stat.stdev <= 0 || !Number.isFinite(value)) continue;
      const def = axisDefById.get(axisId);
      const rawZ = (value - stat.mean) / stat.stdev;
      // Flip sign so positive z = worse for the axis's declared direction
      const z = def?.direction === "lower-is-worse" ? -rawZ : rawZ;
      const absZ = Math.abs(z);
      if (absZ < notableZ) continue;
      anomalies.push({
        axisId,
        axisLabel: def?.label ?? axisId,
        value,
        baselineMean: stat.mean,
        baselineStdev: stat.stdev,
        zScore: round2(z),
        worse: z > 0,
        severity: absZ >= outlierZ ? "outlier" : "notable",
      });
    }
    // Sort: outliers first, then by absolute z
    anomalies.sort((a, b) => {
      if (a.severity !== b.severity) return a.severity === "outlier" ? -1 : 1;
      return Math.abs(b.zScore) - Math.abs(a.zScore);
    });
  }

  // 4. Persist (push newest to front, cap at MAX_HISTORY)
  if (!opts.noPersist) {
    history.pulses.unshift(pulse);
    if (history.pulses.length > MAX_HISTORY) history.pulses.length = MAX_HISTORY;
    await writeHistory(opts.cwd, history);
  }

  const alarming = anomalies.some((a) => a.severity === "outlier");
  const verdict: HeartbeatResult["verdict"] =
    alarming ? "alarming" : anomalies.length > 0 ? "watching" : "all-quiet";

  return {
    pulse,
    baselineSize: history.pulses.length,
    anomalies,
    alarming,
    verdict,
  };
}

function round2(x: number): number {
  return Math.round(x * 100) / 100;
}
