/**
 * `mneme alpha` — Kelly criterion for technical debt allocation.
 *
 * Each refactor/TD item is a "bet" with (expected payoff, variance).
 * Kelly optimal fraction maximizes long-run growth: f* = edge / variance.
 * In practice, we use FRACTIONAL Kelly (×0.25) to limit blow-up risk —
 * the same lever Edward Thorp used to win Wall Street.
 *
 * Pure math + small heuristics for estimating edge/variance from history.
 * No LLM. The CLI takes a JSON list of items OR auto-extracts from
 * `mneme regret` + `mneme bus-factor` + `mneme paradox` data.
 */

export interface DebtItem {
  /** Stable id — drives sorting + reporting. */
  id: string;
  /** Human-readable name shown in output. */
  name: string;
  /**
   * Edge — expected return as a fraction. Positive = improves codebase
   * (smaller diff sizes, fewer regrets, better velocity). Negative =
   * outright wasteful (the item costs more than it returns).
   */
  edge: number;
  /**
   * Variance — squared volatility of the outcome. Higher = riskier bet,
   * more dispersion in possible outcomes. Tiny number (0..1) — interpret
   * as fraction-squared.
   */
  variance: number;
  /** Estimated dev-days to complete. */
  effortDays: number;
}

export interface KellyAllocation extends DebtItem {
  /** Raw Kelly fraction f* = edge / variance. May be > 1 or negative. */
  rawKelly: number;
  /** Fractional Kelly (clamped to [0, 0.5] after multiplier). */
  kellyFraction: number;
  /** Allocated dev-days for this item out of the budget. */
  allocatedDays: number;
  /** Sort tier for display. */
  tier: "skip" | "small" | "core" | "outsized";
}

export interface KellyResult {
  items: KellyAllocation[];
  totalAllocated: number;
  budgetDays: number;
  reserveDays: number;
  /** Kelly multiplier used. 0.25 by default — conservative. */
  kellyMultiplier: number;
}

/**
 * Compute Kelly-optimal allocation for a list of debt items.
 *
 * Algorithm:
 *   1. raw_kelly_i = edge_i / variance_i  (the canonical Kelly formula)
 *   2. fractional_kelly_i = raw_kelly_i × multiplier (default 0.25)
 *   3. clamp to [0, 0.5] — never bet > 50% of budget on one item
 *   4. zero out negative-edge items (don't hold a losing bet)
 *   5. normalize so allocations sum to ≤ budgetDays (leave reserve)
 *   6. allocate dev-days proportionally
 */
export function kellyAllocate(
  items: DebtItem[],
  opts: { budgetDays: number; multiplier?: number; reserveFraction?: number } = { budgetDays: 25 },
): KellyResult {
  const multiplier = opts.multiplier ?? 0.25;
  const reserveFrac = opts.reserveFraction ?? 0.2;
  const budget = Math.max(0, opts.budgetDays);

  // 1. Raw + fractional Kelly per item.
  const computed = items.map((item) => {
    // Avoid division-by-zero — variance of 0 is unrealistic; treat as floor.
    const v = Math.max(item.variance, 1e-6);
    const rawKelly = item.edge / v;
    let frac = rawKelly * multiplier;
    if (frac < 0) frac = 0; // never bet on a losing item
    if (frac > 0.5) frac = 0.5; // never bet > 50% on one item
    return { ...item, rawKelly, kellyFraction: frac };
  });

  // 2. Normalize fractions to sum ≤ (1 - reserveFrac).
  const totalFrac = computed.reduce((s, c) => s + c.kellyFraction, 0);
  const targetTotal = 1 - reserveFrac;
  const scale = totalFrac > targetTotal ? targetTotal / totalFrac : 1;

  // 3. Allocate dev-days.
  let allocatedSum = 0;
  const allocations: KellyAllocation[] = computed.map((c) => {
    const adjusted = c.kellyFraction * scale;
    const allocatedDays = Math.round(budget * adjusted * 10) / 10;
    allocatedSum += allocatedDays;
    return {
      ...c,
      kellyFraction: adjusted,
      allocatedDays,
      tier: classifyTier(adjusted, c.edge),
    };
  });

  // 4. Sort by allocated days desc — biggest bets first.
  allocations.sort((a, b) => b.allocatedDays - a.allocatedDays);

  return {
    items: allocations,
    totalAllocated: Math.round(allocatedSum * 10) / 10,
    budgetDays: budget,
    reserveDays: Math.round((budget - allocatedSum) * 10) / 10,
    kellyMultiplier: multiplier,
  };
}

export function classifyTier(kellyFraction: number, edge: number): KellyAllocation["tier"] {
  if (edge < 0) return "skip";
  if (kellyFraction >= 0.2) return "outsized";
  if (kellyFraction >= 0.1) return "core";
  if (kellyFraction > 0) return "small";
  return "skip";
}

/**
 * Estimate edge from historical data: a refactor's edge is the difference
 * in (regret rate, bug rate, churn velocity) between BEFORE and AFTER
 * similar past refactors in the same module.
 *
 * The CLI calls this with regret data + commit-coach signals; here we
 * just expose the algorithm so it's testable in isolation.
 */
export function estimateEdge(opts: {
  pastRegretRate: number; // 0..1
  pastChurnPerDay: number;
  postRefactorRegretRate: number;
  postRefactorChurnPerDay: number;
}): number {
  const regretImprovement = opts.pastRegretRate - opts.postRefactorRegretRate;
  const churnImprovement = (opts.pastChurnPerDay - opts.postRefactorChurnPerDay) / Math.max(opts.pastChurnPerDay, 0.001);
  // Weighted: regret matters more (bugs hurt more than churn).
  return 0.7 * regretImprovement + 0.3 * churnImprovement;
}

/**
 * Estimate variance — historical variance of payoff across similar past
 * refactors. Higher when past outcomes were inconsistent.
 */
export function estimateVariance(historicalPayoffs: number[]): number {
  if (historicalPayoffs.length < 2) return 0.1; // unknown — assume mid-range
  const mean = historicalPayoffs.reduce((s, x) => s + x, 0) / historicalPayoffs.length;
  const variance =
    historicalPayoffs.reduce((s, x) => s + (x - mean) * (x - mean), 0) / historicalPayoffs.length;
  return Math.max(variance, 1e-6);
}
