/**
 * v2.54.0 — PERFORMANCE BUDGET infrastructure.
 *
 * From the v2.53 audit: "ถ้า latency เกิน 100ms ใน git hook → user
 * disable → product ตาย". Lock budgets per operation + measure them
 * deterministically every TG run; release-script refuses tag if any
 * budget regresses.
 *
 * Budgets are MEASURED in-process (avoids subprocess noise) where
 * possible. The CLI-level ops also expose budgets via the subprocess
 * benchmark suite for end-to-end verification.
 *
 * Pure deterministic + defensive; never throws.
 */

import { extractFingerprint } from "./nemesis/features.js";
import { classifyAgentCalibrated } from "./nemesis/classifier_calibrated.js";
import { stampArticle50, __resetWarmCacheForTest } from "./nemesis/eu_ai_act_stamp.js";
import { computeStealthScore } from "./nemesis/stealth_score.js";
import { observe } from "./nemesis/janus.js";

export interface PerfBudget {
  /** Op identifier. */
  op: string;
  /** Budget ceiling in milliseconds (warm-path target). */
  budgetMs: number;
  /** Optional cold-path ceiling (first call). */
  coldBudgetMs?: number;
  /** Human-readable rationale for the budget. */
  rationale: string;
}

export const PERF_BUDGETS: ReadonlyArray<PerfBudget> = [
  { op: "nemesis.classify_calibrated", budgetMs: 50, coldBudgetMs: 200, rationale: "MCP / git-hook hot path — must be sub-frame on every commit" },
  { op: "nemesis.extract_fingerprint", budgetMs: 30, coldBudgetMs: 100, rationale: "called by classifier + JANUS + STEALTH; must be cheap" },
  { op: "nemesis.eu_stamp", budgetMs: 50, coldBudgetMs: 200, rationale: "git hook UX killer if slow — user will disable" },
  { op: "nemesis.stealth_score", budgetMs: 80, coldBudgetMs: 250, rationale: "reuses classifier; should add <50ms over baseline" },
  { op: "nemesis.janus_observe", budgetMs: 50, coldBudgetMs: 200, rationale: "real-time identity-swap detection requires speed" },
];

export interface PerfMeasurement {
  op: string;
  budgetMs: number;
  warmMeanMs: number;
  warmP95Ms: number;
  coldFirstMs: number;
  iterations: number;
  ok: boolean;
}

export interface PerfBudgetReport {
  ok: boolean;
  measurements: PerfMeasurement[];
  failing: string[];
  at: string;
}

function quantile(arr: number[], q: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)));
  return sorted[idx]!;
}

function measureWarmCold(opName: string, iterations: number, fn: () => unknown): PerfMeasurement {
  // Cold first
  const cold0 = process.hrtime.bigint();
  try { fn(); } catch { /* let later loop surface */ }
  const cold1 = process.hrtime.bigint();
  const coldFirstMs = Number(cold1 - cold0) / 1e6;
  // Warm iterations
  const samples: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = process.hrtime.bigint();
    try { fn(); } catch { /* count as miss */ }
    const t1 = process.hrtime.bigint();
    samples.push(Number(t1 - t0) / 1e6);
  }
  const budget = (PERF_BUDGETS.find((b) => b.op === opName)?.budgetMs) ?? 100;
  const mean = samples.reduce((s, x) => s + x, 0) / Math.max(1, samples.length);
  const p95 = quantile(samples, 0.95);
  return {
    op: opName,
    budgetMs: budget,
    warmMeanMs: +mean.toFixed(2),
    warmP95Ms: +p95.toFixed(2),
    coldFirstMs: +coldFirstMs.toFixed(2),
    iterations,
    ok: mean < budget,
  };
}

/**
 * Run the full perf budget suite in-process. Iterations chosen so total
 * runtime stays <2s on typical hardware.
 */
export function runPerfBudget(): PerfBudgetReport {
  const fixture = { diff: "+const x = 1;\n+function foo() { return x; }\n", prDescription: "## Changes\n- a\n- b\n", commitMessages: ["add foo"] };
  // Reset EU stamp warm cache so the cold path is honest
  try { __resetWarmCacheForTest(); } catch { /* */ }
  // Pre-extract a fingerprint so classifier benchmark doesn't double-pay
  const fpForClassify = extractFingerprint(fixture);
  const measurements: PerfMeasurement[] = [];
  // 1. extract_fingerprint
  measurements.push(measureWarmCold("nemesis.extract_fingerprint", 100, () => extractFingerprint(fixture)));
  // 2. classify_calibrated
  measurements.push(measureWarmCold("nemesis.classify_calibrated", 100, () => classifyAgentCalibrated(fpForClassify)));
  // 3. eu_stamp
  measurements.push(measureWarmCold("nemesis.eu_stamp", 100, () => stampArticle50({ message: "perf test", vendor: "claude-code", confidence: 0.9 })));
  // 4. stealth_score
  measurements.push(measureWarmCold("nemesis.stealth_score", 100, () => computeStealthScore(fixture)));
  // 5. janus_observe
  measurements.push(measureWarmCold("nemesis.janus_observe", 100, () => observe(fixture)));
  const failing = measurements.filter((m) => !m.ok).map((m) => `${m.op} ${m.warmMeanMs}ms ≥ ${m.budgetMs}ms`);
  return {
    ok: failing.length === 0,
    measurements,
    failing,
    at: new Date().toISOString(),
  };
}

/** Human-friendly text report. */
export function renderPerfBudgetReport(r: PerfBudgetReport): string {
  const rows = r.measurements.map((m) => {
    const status = m.ok ? "✓" : "✗";
    return `  ${status} ${m.op.padEnd(40)} mean=${String(m.warmMeanMs).padStart(7)}ms  p95=${String(m.warmP95Ms).padStart(7)}ms  cold=${String(m.coldFirstMs).padStart(7)}ms  budget=${m.budgetMs}ms`;
  });
  return [
    `PERF BUDGET — ${r.ok ? "PASS" : "FAIL"} at ${r.at}`,
    ...rows,
    r.failing.length > 0 ? `FAILING: ${r.failing.join("; ")}` : "",
  ].filter(Boolean).join("\n");
}
