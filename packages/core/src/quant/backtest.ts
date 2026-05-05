/**
 * `mneme backtest` — validate insight commands retroactively.
 *
 * The killer property: every prediction Mneme makes ("this is risky") can
 * be replayed against actual history to compute precision, recall, F1, and
 * lift over a random baseline. This turns "we have an AI tool" into
 * "we have an AI tool with measured edge against the past".
 *
 * Backtest works for any binary predictor: given a set of (commit,
 * prediction) pairs and a window in which to count "trouble" outcomes,
 * compute the standard classification metrics.
 *
 * Pure data analysis — no LLM. The actual replay (re-running a command at
 * a frozen point in history) lives in the CLI command, but the metric
 * math is here and unit-testable.
 */

export interface BacktestSample {
  /** The thing being predicted on — a commit, file, etc. */
  id: string;
  /** Did the predictor say "trouble incoming"? */
  predicted: boolean;
  /** Did trouble actually happen within the validation window? */
  actual: boolean;
}

export interface BacktestResult {
  /** Total samples evaluated. */
  n: number;
  /** Confusion matrix counts. */
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  /** Standard metrics. */
  precision: number;
  recall: number;
  f1: number;
  /** Base rate of positive outcomes (how often trouble happens randomly). */
  baseRate: number;
  /** Lift over base rate — precision / baseRate. */
  lift: number;
  /** Verdict label for the report. */
  verdict: "no-edge" | "weak" | "real-edge" | "strong-edge";
  /** Plain-English conclusion. */
  conclusion: string;
}

/**
 * Compute classification metrics + verdict from a list of (predicted,
 * actual) samples. Pure math — no I/O, deterministic.
 */
export function backtest(samples: BacktestSample[]): BacktestResult {
  const n = samples.length;
  let tp = 0;
  let fp = 0;
  let tn = 0;
  let fn = 0;
  for (const s of samples) {
    if (s.predicted && s.actual) tp += 1;
    else if (s.predicted && !s.actual) fp += 1;
    else if (!s.predicted && !s.actual) tn += 1;
    else fn += 1;
  }

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  const baseRate = n === 0 ? 0 : (tp + fn) / n;
  const lift = baseRate === 0 ? 0 : precision / baseRate;

  const verdict = classifyVerdict(lift, precision, recall, n);
  return {
    n,
    truePositives: tp,
    falsePositives: fp,
    trueNegatives: tn,
    falseNegatives: fn,
    precision,
    recall,
    f1,
    baseRate,
    lift,
    verdict,
    conclusion: buildConclusion(verdict, n, precision, recall, lift),
  };
}

export function classifyVerdict(
  lift: number,
  precision: number,
  recall: number,
  n: number,
): BacktestResult["verdict"] {
  if (n < 5) return "no-edge"; // sample too small
  if (lift >= 2.5 && precision >= 0.6 && recall >= 0.5) return "strong-edge";
  if (lift >= 1.5 && precision >= 0.4) return "real-edge";
  if (lift >= 1.1) return "weak";
  return "no-edge";
}

function buildConclusion(
  verdict: BacktestResult["verdict"],
  n: number,
  precision: number,
  recall: number,
  lift: number,
): string {
  switch (verdict) {
    case "no-edge":
      if (n < 5) return `Sample size too small (n=${n}) to draw conclusions.`;
      return `No detectable edge over random — precision ${(precision * 100).toFixed(0)}%, lift ${lift.toFixed(2)}×.`;
    case "weak":
      return `Weak edge — beats random by ${((lift - 1) * 100).toFixed(0)}% but precision is still ${(precision * 100).toFixed(0)}%. Use as a soft prior.`;
    case "real-edge":
      return `Real predictive edge — precision ${(precision * 100).toFixed(0)}%, ${lift.toFixed(1)}× over random.`;
    case "strong-edge":
      return `Strong edge — precision ${(precision * 100).toFixed(0)}%, recall ${(recall * 100).toFixed(0)}%, ${lift.toFixed(1)}× over random. Trust this predictor.`;
  }
}

/**
 * Aggregate a backtest result into a one-line markdown badge for the
 * README / docs. Format: "F1 = 0.67 · 2.4× lift · n=14".
 */
export function badge(result: BacktestResult): string {
  return `F1 = ${result.f1.toFixed(2)} · ${result.lift.toFixed(1)}× lift · n=${result.n}`;
}
