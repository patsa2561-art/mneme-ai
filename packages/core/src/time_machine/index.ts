/**
 * v2.19.86 — TIME-MACHINE POLYGRAPH (IDEA #4).
 *
 * "Did this AI's answers DRIFT over the past 30 days?" — line chart of
 * agreement-over-time per vendor, sourced from the same `pulse.jsonl`
 * ledger that powers IDEA #2 (World Pulse globe).  No new ledger; no
 * new write path; pure read-side aggregation on the existing data.
 *
 * The seamless integration trick:
 *   - Every Browser Polygraph dot already records (ts, vendor, color)
 *     into pulse.jsonl as of v2.19.84.
 *   - Time-machine just buckets those events by time + vendor and
 *     reports a 0..1 honesty score per bucket.
 *   - If a vendor's honesty FALLS over time → drift visible.
 *   - If a vendor's honesty RISES over time → it learned (or got
 *     retrained).
 *   - Vertical markers can overlay known release dates (claude-3.5
 *     → claude-4 etc.) for visual correlation.
 *
 * No-Ollama by construction — pulse events already contain the verdict
 * (green/yellow/red/grey) computed by the multi-signal agreement; time-
 * machine is pure arithmetic on those existing scores.
 */

export interface PulseEventLite {
  ts: number;
  vendor: string;
  color: "green" | "yellow" | "red" | "grey";
}

export interface TimelineBucket {
  /** Bucket start time, ISO 8601. */
  bucketStart: string;
  /** Total events in bucket. */
  total: number;
  green: number; yellow: number; red: number; grey: number;
  /** Honesty score for this bucket: green / (green+yellow+red).
   *  Null when no judged events (i.e. all grey or empty). */
  honestyPct: number | null;
}

export interface TimelineSeries {
  vendor: string;
  windowDays: number;
  bucketHours: number;
  buckets: TimelineBucket[];
  /** Min / max honestyPct seen in the series (excluding null buckets). */
  minHonesty: number | null;
  maxHonesty: number | null;
  /** Drift = last (non-null) honesty − first (non-null) honesty.
   *  Negative = vendor got worse over time. */
  drift: number | null;
  /** Mean across all judged events in the window. */
  meanHonesty: number | null;
}

/** Build a per-vendor time-bucketed honesty series from pulse events. */
export function buildTimeline(
  events: PulseEventLite[],
  vendor: string,
  opts: { windowDays?: number; bucketHours?: number } = {},
): TimelineSeries {
  const windowDays = opts.windowDays ?? 30;
  const bucketHours = opts.bucketHours ?? 24;
  const bucketMs = bucketHours * 3600_000;
  const cutoff = Date.now() - windowDays * 24 * 3600_000;
  const inWin = events.filter((e) => e.vendor === vendor && e.ts >= cutoff);
  // Pre-compute the full bucket grid so empty days still render in the
  // line chart (otherwise gaps look like missing data instead of "no
  // activity that day").
  const start = Math.floor(cutoff / bucketMs) * bucketMs;
  const end = Math.floor(Date.now() / bucketMs) * bucketMs;
  const grid = new Map<number, TimelineBucket>();
  for (let t = start; t <= end; t += bucketMs) {
    grid.set(t, {
      bucketStart: new Date(t).toISOString(),
      total: 0, green: 0, yellow: 0, red: 0, grey: 0,
      honestyPct: null,
    });
  }
  for (const e of inWin) {
    const bucketKey = Math.floor(e.ts / bucketMs) * bucketMs;
    const b = grid.get(bucketKey);
    if (!b) continue; // outside the grid (shouldn't happen post-filter)
    b.total += 1;
    b[e.color] += 1;
  }
  // Compute honestyPct per bucket (after fill).
  for (const b of grid.values()) {
    const judged = b.green + b.yellow + b.red;
    b.honestyPct = judged > 0 ? b.green / judged : null;
  }
  const buckets = [...grid.values()].sort((a, b) => a.bucketStart.localeCompare(b.bucketStart));
  // Series-level stats from non-null buckets only.
  const nonNull = buckets.filter((b) => b.honestyPct !== null) as Array<TimelineBucket & { honestyPct: number }>;
  let minHonesty: number | null = null;
  let maxHonesty: number | null = null;
  let drift: number | null = null;
  let meanHonesty: number | null = null;
  if (nonNull.length > 0) {
    minHonesty = Math.min(...nonNull.map((b) => b.honestyPct));
    maxHonesty = Math.max(...nonNull.map((b) => b.honestyPct));
    drift = nonNull[nonNull.length - 1]!.honestyPct - nonNull[0]!.honestyPct;
    const judgedTotal = inWin.filter((e) => e.color !== "grey").length;
    const greenTotal = inWin.filter((e) => e.color === "green").length;
    meanHonesty = judgedTotal > 0 ? greenTotal / judgedTotal : null;
  }
  return {
    vendor, windowDays, bucketHours, buckets,
    minHonesty, maxHonesty, drift, meanHonesty,
  };
}

/** Convenience: render a series as an ASCII chart for the CLI. Each
 *  bucket = 1 column; height = honestyPct.  Empty buckets shown as `·`. */
export function renderAsciiChart(series: TimelineSeries, opts: { height?: number } = {}): string {
  const h = opts.height ?? 12;
  const lines: string[] = [];
  // Build the canvas top-down.
  for (let row = h; row >= 1; row--) {
    let line = "";
    for (const b of series.buckets) {
      if (b.honestyPct === null) { line += "·"; continue; }
      const cellH = Math.ceil(b.honestyPct * h);
      line += cellH >= row ? (b.honestyPct < 0.5 ? "▆" : b.honestyPct < 0.8 ? "▅" : "█") : " ";
    }
    lines.push(line);
  }
  // X-axis: just first + last bucket dates.
  const first = series.buckets[0]?.bucketStart.slice(5, 10) ?? "";
  const last = series.buckets[series.buckets.length - 1]?.bucketStart.slice(5, 10) ?? "";
  const axis = first + " ".repeat(Math.max(0, series.buckets.length - first.length - last.length)) + last;
  lines.push("─".repeat(series.buckets.length));
  lines.push(axis);
  return lines.join("\n");
}

/** v2.19.86 — Cross-vendor comparison: given a set of vendors, return a
 *  table {timestamp, vendor1.honestyPct, vendor2.honestyPct, ...}. Used
 *  by the dashboard to draw multi-vendor overlay lines. */
export interface CrossVendorRow {
  bucketStart: string;
  [vendor: string]: string | number | null;
}

export function buildCrossVendorTable(
  events: PulseEventLite[],
  vendors: string[],
  opts: { windowDays?: number; bucketHours?: number } = {},
): CrossVendorRow[] {
  const series = vendors.map((v) => buildTimeline(events, v, opts));
  const len = series[0]?.buckets.length ?? 0;
  const out: CrossVendorRow[] = [];
  for (let i = 0; i < len; i++) {
    const row: CrossVendorRow = { bucketStart: series[0]!.buckets[i]!.bucketStart };
    for (const s of series) row[s.vendor] = s.buckets[i]?.honestyPct ?? null;
    out.push(row);
  }
  return out;
}
