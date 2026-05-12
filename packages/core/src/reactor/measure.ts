/**
 * v1.62.0 -- TOKEN NUCLEAR REACTOR · measurement primitives.
 *
 * Every reactor layer reports baseline -> spent -> saved -> ratio with
 * the SAME ReactorMetrics shape so the ledger can roll them up.
 *
 * Token estimator: char/4 heuristic. Matches GPT-style tokenization
 * within ~5% on English + code; off by 10-15% on dense Asian text.
 * Documented as approximate; callers can swap in tiktoken/anthropic
 * tokenizers if they need exact counts.
 */

import { existsSync, mkdirSync, appendFileSync, readFileSync } from "node:fs";
import { join } from "node:path";

const LEDGER_DIR = ".mneme/reactor";

export interface ReactorMetrics {
  /** Tokens the call ACTUALLY spent after the reactor optimization. */
  tokensSpent: number;
  /** Tokens that WOULD have been spent without the reactor. */
  baselineTokens: number;
  /** Difference (always >= 0; clamped). */
  tokensSaved: number;
  /** 0..1, e.g. 0.83 means 83% reduction. */
  savingsRatio: number;
  /** Which reactor layer produced these savings. */
  method: string;
  /** ISO 8601 timestamp. */
  ts: string;
}

/** Cheap char/4 estimator. Documented imperfect; consistent enough for
 *  relative savings claims (we compare spent vs baseline on same content). */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/** Build a metrics record. Floors savings at 0 (never negative). */
export function metricsOf(spent: number, baseline: number, method: string): ReactorMetrics {
  const saved = Math.max(0, baseline - spent);
  const ratio = baseline > 0 ? saved / baseline : 0;
  return {
    tokensSpent: spent,
    baselineTokens: baseline,
    tokensSaved: saved,
    savingsRatio: ratio,
    method,
    ts: new Date().toISOString(),
  };
}

/** Append to the ledger. Best-effort -- never throws. */
export function recordSavings(repoRoot: string, m: ReactorMetrics): void {
  try {
    const dir = join(repoRoot, LEDGER_DIR);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, "ledger.jsonl"), JSON.stringify(m) + "\n", "utf8");
  } catch { /* */ }
}

export interface LedgerSummary {
  totalCalls: number;
  totalSpent: number;
  totalBaseline: number;
  totalSaved: number;
  overallRatio: number;
  byMethod: Record<string, { calls: number; spent: number; saved: number; ratio: number }>;
}

/** Roll up all recorded savings. */
export function totalSavings(repoRoot: string): LedgerSummary {
  const path = join(repoRoot, LEDGER_DIR, "ledger.jsonl");
  const empty: LedgerSummary = {
    totalCalls: 0, totalSpent: 0, totalBaseline: 0, totalSaved: 0,
    overallRatio: 0, byMethod: {},
  };
  if (!existsSync(path)) return empty;
  try {
    const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
    const out = { ...empty, byMethod: {} as LedgerSummary["byMethod"] };
    for (const line of lines) {
      try {
        const m = JSON.parse(line) as ReactorMetrics;
        out.totalCalls += 1;
        out.totalSpent += m.tokensSpent;
        out.totalBaseline += m.baselineTokens;
        out.totalSaved += m.tokensSaved;
        if (!out.byMethod[m.method]) {
          out.byMethod[m.method] = { calls: 0, spent: 0, saved: 0, ratio: 0 };
        }
        const b = out.byMethod[m.method]!;
        b.calls += 1;
        b.spent += m.tokensSpent;
        b.saved += m.tokensSaved;
      } catch { /* */ }
    }
    out.overallRatio = out.totalBaseline > 0 ? out.totalSaved / out.totalBaseline : 0;
    for (const k of Object.keys(out.byMethod)) {
      const b = out.byMethod[k]!;
      b.ratio = b.spent + b.saved > 0 ? b.saved / (b.spent + b.saved) : 0;
    }
    return out;
  } catch {
    return empty;
  }
}
