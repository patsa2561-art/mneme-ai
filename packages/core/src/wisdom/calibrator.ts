/**
 * Auto-calibrator — picks the search config that maximizes hit rate on the
 * accumulated feedback set.
 *
 * Approach: small-grid search over (semanticWeight × minSemCosine × rrfK).
 * Re-runs every query in the feedback set with each config and counts how
 * many of the originally-helpful results stay in top-K. The config with the
 * highest count wins.
 *
 * Pragmatically:
 *   - Grid is intentionally small (3 × 3 × 2 = 18 configs) to fit in seconds.
 *   - We only consider feedback where was_helpful = 1 (positive examples).
 *   - We require ≥ 10 positive examples before calibrating; below that, the
 *     defaults are statistically stronger than any tuned value.
 *
 * The output is written to wisdom_calibration so search() can read the
 * latest calibrated values without re-running the calibrator.
 */

import type { MnemeStore } from "../store/sqlite.js";
import { search } from "../retrieve/search.js";
import type { EmbeddingProvider } from "../types.js";
import { listFeedback } from "./feedback.js";
import {
  type CalibrationConfig,
  type CalibrationRow,
  DEFAULT_CALIBRATION,
} from "./types.js";

const SEARCH_GRID: CalibrationConfig[] = [];
for (const semanticWeight of [0.4, 0.65, 0.85]) {
  for (const minSemCosine of [0.3, 0.4, 0.5]) {
    for (const rrfK of [60, 30]) {
      SEARCH_GRID.push({ semanticWeight, minSemCosine, rrfK });
    }
  }
}

export interface CalibrationResult {
  /** The winning config. If no calibration ran, equals DEFAULT_CALIBRATION. */
  config: CalibrationConfig;
  /** Score on the feedback set: fraction of helpful results re-found in top-3. */
  hitRate: number;
  /** Number of positive examples evaluated (gating threshold: 10). */
  positiveExamples: number;
  /** Whether the calibrator actually ran or returned defaults. */
  calibrated: boolean;
  /** The full grid result, sorted desc by hitRate. */
  grid: Array<CalibrationConfig & { hitRate: number }>;
}

const MIN_POSITIVE_EXAMPLES = 10;

export async function calibrate(
  store: MnemeStore,
  embedder?: EmbeddingProvider,
): Promise<CalibrationResult> {
  const positives = listFeedback(store, { limit: 500 }).filter(
    (f) => f.wasHelpful === 1 && f.resultHashes.length > 0,
  );

  if (positives.length < MIN_POSITIVE_EXAMPLES) {
    return {
      config: DEFAULT_CALIBRATION,
      hitRate: 0,
      positiveExamples: positives.length,
      calibrated: false,
      grid: [],
    };
  }

  const results: Array<CalibrationConfig & { hitRate: number }> = [];

  for (const config of SEARCH_GRID) {
    let hits = 0;
    for (const ex of positives) {
      // The "ground truth" is the top-3 hashes from the original query —
      // we re-run with the candidate config and check overlap.
      const groundTruth = new Set(ex.resultHashes.slice(0, 3));
      const re = await search(ex.query, {
        store,
        embedder,
        topK: 3,
        semanticWeight: config.semanticWeight,
        confidenceFloor: { minFtsHits: 1, minSemCosine: config.minSemCosine },
      });
      const reHashes = new Set(re.map((r) => r.commit.hash));
      // Count this query as a "hit" if at least one of the original useful
      // results is still surfaced.
      const overlap = [...groundTruth].some((h) => reHashes.has(h));
      if (overlap) hits += 1;
    }
    results.push({ ...config, hitRate: hits / positives.length });
  }

  results.sort((a, b) => b.hitRate - a.hitRate);
  const best = results[0]!;

  persistCalibration(store, "search", best, "hit_rate");

  return {
    config: { semanticWeight: best.semanticWeight, minSemCosine: best.minSemCosine, rrfK: best.rrfK },
    hitRate: best.hitRate,
    positiveExamples: positives.length,
    calibrated: true,
    grid: results,
  };
}

export function persistCalibration(
  store: MnemeStore,
  key: string,
  config: CalibrationConfig & { hitRate: number },
  metricName: string,
  notes?: string,
): void {
  store.db
    .prepare(
      `INSERT OR REPLACE INTO wisdom_calibration
       (key, value, metric_value, metric_name, calibrated_at, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .run(
      key,
      JSON.stringify({
        semanticWeight: config.semanticWeight,
        minSemCosine: config.minSemCosine,
        rrfK: config.rrfK,
      }),
      config.hitRate,
      metricName,
      new Date().toISOString(),
      notes ?? null,
    );
}

/** Read back the current calibration. Returns DEFAULT_CALIBRATION if no row. */
export function readCalibration(store: MnemeStore, key = "search"): CalibrationConfig {
  const row = store.db
    .prepare(
      `SELECT value FROM wisdom_calibration WHERE key = ? ORDER BY calibrated_at DESC LIMIT 1`,
    )
    .get(key) as { value: string } | undefined;
  if (!row) return DEFAULT_CALIBRATION;
  try {
    const parsed = JSON.parse(row.value) as Partial<CalibrationConfig>;
    return {
      semanticWeight: parsed.semanticWeight ?? DEFAULT_CALIBRATION.semanticWeight,
      minSemCosine: parsed.minSemCosine ?? DEFAULT_CALIBRATION.minSemCosine,
      rrfK: parsed.rrfK ?? DEFAULT_CALIBRATION.rrfK,
    };
  } catch {
    return DEFAULT_CALIBRATION;
  }
}

export function listCalibrations(store: MnemeStore): CalibrationRow[] {
  const rows = store.db
    .prepare(
      `SELECT key, value, metric_value, metric_name, calibrated_at, notes
       FROM wisdom_calibration ORDER BY calibrated_at DESC`,
    )
    .all() as Array<{
    key: string;
    value: string;
    metric_value: number | null;
    metric_name: string | null;
    calibrated_at: string;
    notes: string | null;
  }>;
  return rows.map((r) => ({
    key: r.key,
    value: JSON.parse(r.value) as unknown,
    metricValue: r.metric_value ?? undefined,
    metricName: r.metric_name ?? undefined,
    calibratedAt: r.calibrated_at,
    notes: r.notes ?? undefined,
  }));
}
