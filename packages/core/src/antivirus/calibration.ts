/**
 * MNEME ANTIVIRUS — calibration metrics (v1.28.0).
 *
 * F1 / precision / recall tell you whether vaccine fires correctly.
 * Calibration tells you whether the vaccine's CONFIDENCE is well
 * matched to its ACCURACY. A vaccine that's wrong at 99% confidence
 * is a worse failure than one that's wrong at 51% -- but binary
 * classification doesn't surface the difference.
 *
 * Two metrics:
 *
 *   1. Brier score  -- mean((p - actual)^2) where p in [0,1] is the
 *                      vaccine's confidence and actual is 0/1 truth.
 *                      0 = perfectly calibrated, 1 = perfectly wrong.
 *                      < 0.10 is excellent, 0.10-0.25 acceptable,
 *                      > 0.25 needs attention.
 *
 *   2. Margin of decision -- |p - 0.5| averaged. Higher = vaccine is
 *                            more decisive. Combined with accuracy:
 *                              high margin + high accuracy = expert
 *                              high margin + low accuracy = overconfident
 *                              low margin + low accuracy = honest doubt
 *                              low margin + high accuracy = lucky guess
 */

export interface CalibrationCase {
  /** Vaccine's confidence in [0, 1] that the claim is infected. */
  confidence: number;
  /** Ground truth: was it really infected? */
  actual: boolean;
}

export interface CalibrationReport {
  brierScore: number;          // 0 = perfect, 1 = worst
  meanMargin: number;          // 0 = pure coin-flip, 0.5 = always-decisive
  brierBand: "excellent" | "acceptable" | "poor";
  decisivenessBand: "uncertain" | "balanced" | "decisive";
  /** Combined verdict for the eyeball test. */
  verdict: string;
}

export function brierScore(cases: CalibrationCase[]): number {
  if (cases.length === 0) return 0;
  const sum = cases.reduce((acc, c) => {
    const actual = c.actual ? 1 : 0;
    return acc + (c.confidence - actual) ** 2;
  }, 0);
  return sum / cases.length;
}

export function meanMargin(cases: CalibrationCase[]): number {
  if (cases.length === 0) return 0;
  const sum = cases.reduce((acc, c) => acc + Math.abs(c.confidence - 0.5), 0);
  return sum / cases.length;
}

export function buildCalibrationReport(cases: CalibrationCase[]): CalibrationReport {
  const b = brierScore(cases);
  const m = meanMargin(cases);
  const brierBand: CalibrationReport["brierBand"] =
    b < 0.10 ? "excellent" : b < 0.25 ? "acceptable" : "poor";
  const decisivenessBand: CalibrationReport["decisivenessBand"] =
    m < 0.15 ? "uncertain" : m < 0.35 ? "balanced" : "decisive";
  // Combined verdict.
  let verdict: string;
  if (brierBand === "excellent" && decisivenessBand === "decisive") verdict = "expert (decisive + accurate)";
  else if (brierBand === "poor" && decisivenessBand === "decisive") verdict = "overconfident (decisive but wrong)";
  else if (brierBand === "excellent") verdict = "well-calibrated";
  else if (decisivenessBand === "uncertain") verdict = "honest doubt (low confidence + low accuracy)";
  else verdict = "needs tuning";
  return { brierScore: b, meanMargin: m, brierBand, decisivenessBand, verdict };
}
