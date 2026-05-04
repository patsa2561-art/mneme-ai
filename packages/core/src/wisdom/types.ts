/**
 * Wisdom Mutant Engine — types.
 *
 * The "self-improving memory" subsystem. Three loops:
 *   1. Feedback collector  — every query records what was returned.
 *   2. Auto-calibrator     — periodically tunes search knobs against the
 *                            feedback set, picks the config that maximizes
 *                            hit rate.
 *   3. Self-eval           — runs eval set against current config and writes
 *                            a row to wisdom_eval_run. Detects regressions.
 *
 * The point: `mneme adapt` recommendations and the search thresholds in
 * `mneme ask` are not hardcoded. They are derived from this engine's history.
 */

export interface FeedbackRow {
  id: string;
  query: string;
  /** JSON array of commit hashes returned at query time. */
  resultHashes: string[];
  /** Top RRF score at query time (a confidence proxy). */
  topScore?: number;
  /**
   * 1 = the user found the result useful (or an implicit signal said so).
   * 0 = explicitly marked not useful.
   * undefined = unknown — usually because no feedback has been collected yet.
   */
  wasHelpful?: 1 | 0;
  /** How was_helpful was set. */
  source: "explicit" | "implicit-reuse" | "implicit-revisit" | "pending";
  /** Search config in effect when the query ran. */
  semanticWeight?: number;
  minSemCosine?: number;
  rrfK?: number;
  createdAt: string;
}

export interface CalibrationRow {
  key: string;
  /** Stored as JSON; parse with JSON.parse. */
  value: unknown;
  /** The metric this calibration achieved on the feedback set. */
  metricValue?: number;
  metricName?: string;
  calibratedAt: string;
  notes?: string;
}

export interface EvalRunRow {
  id: number;
  ranAt: string;
  variant: string;
  recallAt3: number;
  mrr: number;
  ndcgAt10?: number;
  hitRate: number;
  semanticWeight?: number;
  minSemCosine?: number;
  rrfK?: number;
  numQueries: number;
  notes?: string;
}

/** Search-time knobs the calibrator can tune. */
export interface CalibrationConfig {
  semanticWeight: number;
  minSemCosine: number;
  rrfK: number;
}

export const DEFAULT_CALIBRATION: CalibrationConfig = {
  semanticWeight: 0.65,
  minSemCosine: 0.4,
  rrfK: 60,
};
