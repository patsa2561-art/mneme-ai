/**
 * v2.120.0 — EXEC value layer (the CXO/CFO surface).
 *
 * Mneme already computes the hard signals an executive cares about — from REAL
 * sources, not vibes: key-person/bus-factor risk (atrophy, git history),
 * collaboration/talent map (stigmergy, git traces), governance/promise-debt
 * (promise, commit text), and realized token savings (treasury, a signed
 * ledger). The CLI `mneme exec` group frames each for a buyer. The ONE piece of
 * genuinely-new math that belongs here is the **ROI projection**: extrapolate
 * the MEASURED per-reduction saving rate to a team's usage, at the user's OWN
 * vendor price. Everything is a transparent product of (measured rate) ×
 * (user-supplied volume) × (user-supplied price) — falsifiable, never a
 * fabricated metric. Pure + total (108-error rule).
 *
 * DIAKRISIS: this is NOT a forecast of the business, NOT a fabricated dollar
 * figure. It is "your inputs × Mneme's measured rate", and it says so.
 */

export interface RoiInput {
  /** realized token-savings from the treasury ledger (≥0). */
  measuredTokensSaved: number;
  /** number of realized reduction events behind that saving (≥0). */
  measuredReductions: number;
  /** team size (user input, ≥0). */
  teamSize: number;
  /** reduction-eligible events per developer per month (user input, ≥0). */
  reductionsPerDevPerMonth: number;
  /** the user's OWN vendor price per 1k input tokens, USD (≥0). */
  pricePer1kUSD: number;
  /** projection horizon in months (default 12). */
  months?: number;
}

export interface RoiProjection {
  /** measured rate = measuredTokensSaved / measuredReductions (0 if none yet). */
  avgTokensPerReduction: number;
  /** teamSize × reductionsPerDevPerMonth × months. */
  projectedReductions: number;
  /** projectedReductions × avgTokensPerReduction. */
  projectedTokensSaved: number;
  /** projectedTokensSaved / 1000 × pricePer1kUSD. */
  projectedUsdSaved: number;
  /** already-realized USD = measuredTokensSaved / 1000 × pricePer1kUSD. */
  realizedUsdSaved: number;
  months: number;
  /** honest basis label. */
  basis: string;
}

const n0 = (x: unknown): number => {
  const v = typeof x === "number" && isFinite(x) ? x : 0;
  return v < 0 ? 0 : v;
};
const round2 = (x: number): number => Math.round(x * 100) / 100;

/**
 * Project savings from the MEASURED per-reduction rate × the user's team/usage/
 * price. Deterministic + total. Returns zeros (never throws) on degenerate input.
 */
export function projectRoi(input: RoiInput): RoiProjection {
  try {
    const measuredTokensSaved = n0(input?.measuredTokensSaved);
    const measuredReductions = n0(input?.measuredReductions);
    const teamSize = n0(input?.teamSize);
    const perDev = n0(input?.reductionsPerDevPerMonth);
    const price = n0(input?.pricePer1kUSD);
    const months = Math.max(0, Math.floor(n0(input?.months ?? 12)));

    const avgTokensPerReduction = measuredReductions > 0 ? measuredTokensSaved / measuredReductions : 0;
    const projectedReductions = teamSize * perDev * months;
    const projectedTokensSaved = projectedReductions * avgTokensPerReduction;
    const projectedUsdSaved = round2((projectedTokensSaved / 1000) * price);
    const realizedUsdSaved = round2((measuredTokensSaved / 1000) * price);

    return {
      avgTokensPerReduction: round2(avgTokensPerReduction),
      projectedReductions,
      projectedTokensSaved: Math.round(projectedTokensSaved),
      projectedUsdSaved,
      realizedUsdSaved,
      months,
      basis: "projection = (Mneme's MEASURED tokens-saved per reduction) × (your team × usage × months) × (your vendor price); token figures are a labelled ≈chars/4 estimate of INPUT context, USD uses the price YOU supplied — not a business forecast",
    };
  } catch {
    return { avgTokensPerReduction: 0, projectedReductions: 0, projectedTokensSaved: 0, projectedUsdSaved: 0, realizedUsdSaved: 0, months: 0, basis: "exec roi engine error (safe)" };
  }
}

export interface ExecGauntlet {
  /** zero team ⇒ zero projection. */
  zeroTeamZero: boolean;
  /** zero measured rate ⇒ zero projection. */
  zeroRateZero: boolean;
  /** projection is non-decreasing in team size. */
  monotonicInTeam: boolean;
  /** projection is non-decreasing in price. */
  monotonicInPrice: boolean;
  /** projectedUsd is EXACTLY projectedTokens/1000×price (the dollar identity). */
  usdIdentityHolds: boolean;
  /** realized USD reflects the measured saving exactly. */
  realizedExact: boolean;
  /** deterministic. */
  deterministic: boolean;
  /** total on garbage. */
  stable: boolean;
  /** number of random cases swept for the monotonicity proof. */
  cases: number;
  score: number;
}

/** Prove the ROI math: monotone, zero-bounded, dollar-identity-exact,
 *  deterministic, total. Deterministic sweep (no Math.random). */
export function execGauntlet(): ExecGauntlet {
  try {
    const base: RoiInput = { measuredTokensSaved: 50_000, measuredReductions: 100, teamSize: 10, reductionsPerDevPerMonth: 40, pricePer1kUSD: 0.003, months: 12 };

    const zeroTeamZero = projectRoi({ ...base, teamSize: 0 }).projectedUsdSaved === 0;
    const zeroRateZero = projectRoi({ ...base, measuredTokensSaved: 0, measuredReductions: 0 }).projectedTokensSaved === 0;

    // monotonicity sweep over a deterministic LCG.
    let mt = true, mp = true, usd = true; let seed = 1234567;
    const next = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const CASES = 5000;
    for (let i = 0; i < CASES; i++) {
      const inp: RoiInput = {
        measuredTokensSaved: Math.floor(next() * 1e6),
        measuredReductions: 1 + Math.floor(next() * 1000),
        teamSize: Math.floor(next() * 200),
        reductionsPerDevPerMonth: Math.floor(next() * 100),
        pricePer1kUSD: round2(next() * 0.05),
        months: 1 + Math.floor(next() * 24),
      };
      const r = projectRoi(inp);
      const more = projectRoi({ ...inp, teamSize: inp.teamSize + 5 });
      if (more.projectedUsdSaved < r.projectedUsdSaved) mt = false;
      const pricier = projectRoi({ ...inp, pricePer1kUSD: inp.pricePer1kUSD + 0.01 });
      if (pricier.projectedUsdSaved < r.projectedUsdSaved) mp = false;
      const expectedUsd = Math.round((r.projectedTokensSaved / 1000) * inp.pricePer1kUSD * 100) / 100;
      if (Math.abs(r.projectedUsdSaved - expectedUsd) > 0.011) usd = false;
    }

    const rb = projectRoi(base);
    const realizedExact = rb.realizedUsdSaved === Math.round((base.measuredTokensSaved / 1000) * base.pricePer1kUSD * 100) / 100;
    const deterministic = JSON.stringify(projectRoi(base)) === JSON.stringify(projectRoi(base));

    let stable = true;
    try { projectRoi(null as never); projectRoi({} as never); projectRoi({ teamSize: NaN, pricePer1kUSD: -5 } as never); } catch { stable = false; }

    const perfect = zeroTeamZero && zeroRateZero && mt && mp && usd && realizedExact && deterministic && stable;
    return { zeroTeamZero, zeroRateZero, monotonicInTeam: mt, monotonicInPrice: mp, usdIdentityHolds: usd, realizedExact, deterministic, stable, cases: CASES, score: perfect ? 100 : 0 };
  } catch {
    return { zeroTeamZero: false, zeroRateZero: false, monotonicInTeam: false, monotonicInPrice: false, usdIdentityHolds: false, realizedExact: false, deterministic: false, stable: false, cases: 0, score: 0 };
  }
}
