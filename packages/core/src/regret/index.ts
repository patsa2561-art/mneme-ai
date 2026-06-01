/**
 * v2.140.0 — REGRET ORACLE (💎3 of 3, the last diamond). A signed, cross-vendor
 * CALIBRATION of how often an edit/claim carrying a given signal was *actually
 * regretted later* — reverted, or its test failed.
 * ============================================================================
 * The seductive-but-dishonest version of this is "predict whether THIS edit will
 * be regretted" — that is fortune-telling, and a model can't do it. So the Regret
 * Oracle does the honest, falsifiable thing instead: it is **backward-looking**.
 * You feed it real recorded OUTCOMES (an edit's signals + did it get reverted /
 * did a test fail), and it builds a per-signal **base-rate table** with a Wilson
 * 95% interval. To score a new edit, it reports the **Wilson LOWER bound** of the
 * riskiest matching signal — i.e. "signals like these were regretted *at least*
 * this often, here, with this much support" — and it **abstains (UNKNOWN)** when
 * there isn't enough data. It never says "will", never claims causation, and a
 * small/under-measured signal scores LOW by construction (the lower bound stays
 * near zero) — so it cannot be gamed into a scary number.
 *
 * Cross-vendor: outcomes carry a `vendor:<x>` signal, so the same table answers
 * "which vendor's edits get reverted more, here" — measured, not asserted.
 *
 * DIAKRISIS — the honest ceiling:
 *   - This is a calibrated HISTORICAL BASE RATE with a confidence interval, NOT a
 *     prediction of a specific future and NOT a causal claim. Correlation in your
 *     own revert/test history is the whole signal.
 *   - The Wilson LOWER bound is deliberate: it reports what is *proven* risky, not
 *     a hopeful point estimate; HIGH requires both a high rate AND real support.
 * Pure + deterministic + total (the CLI/MCP add the Ed25519 signature).
 */

// ─────────────────────────── Wilson interval ───────────────────────────

/** Wilson 95% score interval for k successes in n trials. Total. */
export function wilson(k: number, n: number): { low: number; high: number; rate: number } {
  try {
    if (!Number.isFinite(k) || !Number.isFinite(n) || n <= 0 || k < 0) return { low: 0, high: 0, rate: 0 };
    const kk = Math.min(k, n);
    const z = 1.959963984540054; // 95%
    const phat = kk / n;
    const z2 = z * z;
    const denom = 1 + z2 / n;
    const center = phat + z2 / (2 * n);
    const margin = z * Math.sqrt((phat * (1 - phat) + z2 / (4 * n)) / n);
    const low = Math.max(0, (center - margin) / denom);
    const high = Math.min(1, (center + margin) / denom);
    const r = (x: number) => Math.round(x * 1e4) / 1e4;
    return { low: r(low), high: r(high), rate: r(phat) };
  } catch { return { low: 0, high: 0, rate: 0 }; }
}

// ─────────────────────────── the model ───────────────────────────

export interface RegretEvent { features: string[]; regretted: boolean }
export interface FeatureStat { feature: string; n: number; regret: number; wilsonLow: number; wilsonHigh: number; rate: number }
export interface RegretModel { byFeature: Record<string, FeatureStat>; total: { n: number; regret: number } }

function normFeatures(f: unknown): string[] {
  if (!Array.isArray(f)) return [];
  const out: string[] = [];
  for (const x of f) { if (typeof x === "string" && x.trim()) out.push(x.trim().toLowerCase().slice(0, 60)); }
  return Array.from(new Set(out));
}

/** Build the per-signal calibration table from recorded outcomes. Pure + total. */
export function buildRegretModel(events: ReadonlyArray<RegretEvent>): RegretModel {
  const counts: Record<string, { n: number; regret: number }> = {};
  let tn = 0, tr = 0;
  try {
    const list = Array.isArray(events) ? events : [];
    for (const e of list) {
      const regretted = e?.regretted === true;
      tn++; if (regretted) tr++;
      for (const f of normFeatures(e?.features)) {
        const c = counts[f] ?? (counts[f] = { n: 0, regret: 0 });
        c.n++; if (regretted) c.regret++;
      }
    }
  } catch { /* total */ }
  const byFeature: Record<string, FeatureStat> = {};
  for (const [feature, c] of Object.entries(counts)) {
    const w = wilson(c.regret, c.n);
    byFeature[feature] = { feature, n: c.n, regret: c.regret, wilsonLow: w.low, wilsonHigh: w.high, rate: w.rate };
  }
  return { byFeature, total: { n: tn, regret: tr } };
}

// ─────────────────────────── scoring ───────────────────────────

export type RegretBand = "LOW" | "ELEVATED" | "HIGH" | "UNKNOWN";
export interface RegretScore {
  band: RegretBand;
  /** Wilson LOWER bound of the riskiest matching signal — "at least this often, proven". */
  regretRateLowerBound: number;
  /** the historical point rate of that riskiest signal (context for the LB). */
  observedRate: number;
  /** support (n) behind the riskiest signal. */
  support: number;
  /** the signals that drove the score, riskiest first (by Wilson LB). */
  drivers: FeatureStat[];
  note: string;
}

/**
 * Score a set of signals against the calibration table. Reports the Wilson LOWER
 * bound of the riskiest signal that has >= minSupport samples; abstains UNKNOWN
 * when none does. Pure + total. NOTE: a historical base rate, not a prediction.
 */
export function scoreRegret(model: RegretModel, features: string[], opts?: { minSupport?: number }): RegretScore {
  const note = "Historical base rate from your own revert/test outcomes — NOT a prediction of this edit and NOT a causal claim. The figure is the Wilson 95% LOWER bound (what is proven risky); a thin signal stays LOW by construction.";
  try {
    const minSupport = Number.isFinite(opts?.minSupport) && (opts!.minSupport as number) > 0 ? Math.floor(opts!.minSupport as number) : 5;
    const fs = normFeatures(features);
    const present = fs.map((f) => model?.byFeature?.[f]).filter((s): s is FeatureStat => !!s);
    const supported = present.filter((s) => s.n >= minSupport).sort((a, b) => b.wilsonLow - a.wilsonLow || b.n - a.n);
    if (supported.length === 0) {
      return { band: "UNKNOWN", regretRateLowerBound: 0, observedRate: 0, support: present.reduce((m, s) => Math.max(m, s.n), 0), drivers: present.sort((a, b) => b.n - a.n).slice(0, 5), note };
    }
    const top = supported[0]!;
    const lb = top.wilsonLow;
    const band: RegretBand = lb >= 0.3 ? "HIGH" : lb >= 0.1 ? "ELEVATED" : "LOW";
    return { band, regretRateLowerBound: lb, observedRate: top.rate, support: top.n, drivers: supported.slice(0, 5), note };
  } catch { return { band: "UNKNOWN", regretRateLowerBound: 0, observedRate: 0, support: 0, drivers: [], note }; }
}

/** Cross-vendor comparison: regret stats for every `vendor:*` signal in the table. */
export function vendorRegret(model: RegretModel): FeatureStat[] {
  try {
    return Object.values(model?.byFeature ?? {}).filter((s) => s.feature.startsWith("vendor:")).sort((a, b) => b.wilsonLow - a.wilsonLow);
  } catch { return []; }
}

// ─────────────────────────── falsifiable proof ───────────────────────────

export interface RegretGauntlet {
  riskySignalScoresHigh: boolean;
  safeSignalScoresLow: boolean;
  abstainsOnLowSupport: boolean;
  lowerBoundConservative: boolean;
  wilsonTightensWithData: boolean;
  driversSortedByProvenRisk: boolean;
  crossVendorComparison: boolean;
  historicalNotPrediction: boolean;
  deterministic: boolean;
  total: boolean;
  score: 0 | 100;
}

export function regretGauntlet(): RegretGauntlet {
  const ev: RegretEvent[] = [];
  // a proven-risky signal: 18/20 regretted
  for (let i = 0; i < 20; i++) ev.push({ features: ["primitive:network", "vendor:grok"], regretted: i < 18 });
  // a proven-safe signal: 0/30 regretted
  for (let i = 0; i < 30; i++) ev.push({ features: ["area:docs", "vendor:claude"], regretted: false });
  // a thin signal: 2 samples only
  ev.push({ features: ["area:experimental"], regretted: true });
  ev.push({ features: ["area:experimental"], regretted: true });

  const model = buildRegretModel(ev);

  const risky = scoreRegret(model, ["primitive:network"]);
  const riskySignalScoresHigh = risky.band === "HIGH" && risky.regretRateLowerBound >= 0.3 && risky.support === 20;

  const safe = scoreRegret(model, ["area:docs"]);
  const safeSignalScoresLow = safe.band === "LOW" && safe.regretRateLowerBound < 0.1;

  // 2 samples (< minSupport 5) → UNKNOWN even though both regretted (100% rate)
  const thin = scoreRegret(model, ["area:experimental"]);
  const abstainsOnLowSupport = thin.band === "UNKNOWN";

  // lower bound is below the point rate (conservative)
  const lowerBoundConservative = risky.regretRateLowerBound < model.byFeature["primitive:network"]!.rate;

  // more data at the same rate tightens (raises) the lower bound
  const small = wilson(9, 10), big = wilson(90, 100);
  const wilsonTightensWithData = big.low > small.low;

  // drivers sorted by proven risk (wilsonLow desc) when multiple present
  const both = scoreRegret(model, ["primitive:network", "area:docs"]);
  const driversSortedByProvenRisk = both.drivers.length >= 2 && both.drivers[0]!.feature === "primitive:network" && both.drivers[0]!.wilsonLow >= both.drivers[1]!.wilsonLow;

  const vr = vendorRegret(model);
  const crossVendorComparison = vr.length === 2 && vr[0]!.feature === "vendor:grok" && vr[0]!.wilsonLow > vr[1]!.wilsonLow;

  const historicalNotPrediction = /historical base rate/i.test(risky.note) && !/\bwill\b/i.test(risky.note);

  const deterministic = JSON.stringify(scoreRegret(model, ["primitive:network"])) === JSON.stringify(scoreRegret(model, ["primitive:network"]));

  let total = true;
  try {
    buildRegretModel(null as unknown as RegretEvent[]);
    scoreRegret(null as unknown as RegretModel, null as unknown as string[]);
    wilson(NaN, -1);
    vendorRegret(undefined as unknown as RegretModel);
    buildRegretModel([{ features: 123 as unknown as string[], regretted: "x" as unknown as boolean }]);
  } catch { total = false; }

  const all = riskySignalScoresHigh && safeSignalScoresLow && abstainsOnLowSupport && lowerBoundConservative
    && wilsonTightensWithData && driversSortedByProvenRisk && crossVendorComparison && historicalNotPrediction
    && deterministic && total;
  return { riskySignalScoresHigh, safeSignalScoresLow, abstainsOnLowSupport, lowerBoundConservative, wilsonTightensWithData, driversSortedByProvenRisk, crossVendorComparison, historicalNotPrediction, deterministic, total, score: all ? 100 : 0 };
}
