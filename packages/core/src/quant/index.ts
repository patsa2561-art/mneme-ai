/**
 * Sprint 5 — Wall Street meets Git.
 *
 * Quantitative analysis of codebase as if it were a market:
 *   • drawdown          — worst losing streaks (firefighting periods)
 *   • alpha             — Kelly criterion for technical-debt allocation
 *   • backtest          — validate any predictor against actual outcomes
 *   • black-swan        — rare-but-catastrophic file patterns
 *   • insider-trading   — authors who fix bugs they introduced
 *   • moneyball         — undervalued contributors (high impact, low LOC)
 *   • greek             — sensitivity analysis (Δ Γ Θ)
 *   • correlation-matrix— hidden behavioral coupling between files
 *   • implied-volatility— project chaos predicted from commit message tone
 *   • tax-loss-harvest  — dead code candidates that "offset" technical debt
 *
 * All pure analysis. No LLM. Each module is fully unit-tested.
 */

export * from "./drawdown.js";
export * from "./alpha.js";
export * from "./backtest.js";
export * from "./black-swan.js";
export * from "./insider-trading.js";
export * from "./moneyball.js";
export * from "./greek.js";
export * from "./correlation-matrix.js";
export * from "./implied-volatility.js";
export * from "./tax-loss-harvest.js";
