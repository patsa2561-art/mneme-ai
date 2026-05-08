/**
 * Quant — Wall-Street-inspired analysis applied to engineering data.
 * Drawdown, alpha, Greeks, black-swan, moneyball, insider-trading detector.
 */

import { passthroughHandler } from "./_runtime.js";
import type { MnemeTool } from "./_types.js";

const quant = (
  name: string,
  description: string,
  triggers: string[],
  cli: string,
  argMap: (a: Record<string, unknown>) => string[] = () => [],
  inputSchema: MnemeTool["inputSchema"] = { type: "object", properties: {} },
  followUp: string[] = [],
  wisdom: (d: unknown) => string = () => "Result returned — summarize key fields for the user.",
): MnemeTool => ({
  name,
  category: "quant",
  description,
  triggers,
  inputSchema,
  handler: passthroughHandler(cli, argMap, { wisdom, followUp, confidence: "medium" }),
});

export const quantTools: MnemeTool[] = [
  quant(
    "mneme.quant.drawdown",
    "Worst losing streaks — periods of pure firefighting. Use WHEN user asks: 'when were our worst weeks?', 'firefighting periods', 'drawdown'.",
    ["worst weeks of firefighting", "drawdown"],
    "drawdown",
  ),
  quant(
    "mneme.quant.alpha",
    "Per-author 'alpha' — Kelly-criterion allocation across tech-debt items. Use WHEN user asks: 'who delivers alpha?', 'allocation of effort'.",
    ["who delivers alpha", "Kelly allocation"],
    "alpha",
    (a) => (a["items"] ? ["--items", String(a["items"])] : []),
    { type: "object", properties: { items: { type: "string", description: "JSON file path with items" } } },
  ),
  quant(
    "mneme.quant.backtest",
    "Validate any binary predictor against historical outcomes. Use WHEN user asks: 'backtest this metric', 'validate predictor'.",
    ["backtest this metric", "validate predictor"],
    "backtest",
    (a) => (a["samples"] ? ["--samples", String(a["samples"])] : []),
    { type: "object", properties: { samples: { type: "string" } } },
  ),
  quant(
    "mneme.quant.black_swan",
    "Tail-risk scan — rare but catastrophic file patterns. Use WHEN user asks: 'tail risks', 'black swan candidates'.",
    ["tail risks", "black swan candidates"],
    "black-swan",
  ),
  quant(
    "mneme.quant.insider_trading",
    "Authors who repeatedly fix bugs they introduced themselves. Use WHEN user asks: 'who fixes their own bugs?', 'insider trading patterns'.",
    ["who fixes their own bugs", "insider patterns"],
    "insider-trading",
  ),
  quant(
    "mneme.quant.moneyball",
    "Undervalued contributors — high impact, low LOC volume. Use WHEN user asks: 'who is undervalued?', 'moneyball contributors'.",
    ["undervalued contributors", "moneyball"],
    "moneyball",
    (a) => (a["topN"] ? ["--top", String(a["topN"])] : []),
    { type: "object", properties: { topN: { type: "number" } } },
    ["mneme.people.influence"],
  ),
  quant(
    "mneme.quant.greek",
    "Codebase Greeks (Δ Γ Θ) — sensitivity analysis across files. Use WHEN user asks: 'sensitivity analysis', 'codebase Greeks'.",
    ["sensitivity Greeks", "Δ Γ Θ"],
    "greek",
  ),
  quant(
    "mneme.quant.correlation_matrix",
    "Hidden behavioral coupling between files (no static deps needed). Use WHEN user asks: 'which files move together?', 'behavioral coupling'.",
    ["files that change together", "behavioral coupling"],
    "correlation-matrix",
  ),
  quant(
    "mneme.quant.implied_volatility",
    "Project chaos predicted from commit-message tone. Use WHEN user asks: 'how chaotic is this project?', 'implied volatility from tone'.",
    ["chaos from commit tone", "implied volatility"],
    "implied-volatility",
  ),
  quant(
    "mneme.quant.tax_loss_harvest",
    "Dead-code candidates — delete to offset technical debt. Use WHEN user asks: 'what can we delete?', 'dead code', 'tax loss harvest'.",
    ["what can we delete", "dead code candidates"],
    "tax-loss-harvest",
    () => [],
    { type: "object", properties: {} },
    ["mneme.insights.fossil", "mneme.insights.runaway"],
  ),
];
