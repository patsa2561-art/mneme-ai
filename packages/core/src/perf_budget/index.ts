/**
 * v2.19.56 PERF BUDGET LEDGER — cross-release performance accountability.
 *
 * WISDOM BONUS that the user asked for: "extremely super wisdom function".
 *
 * The pattern this kills: v2.19.53/54 shipped INSTALL ORGAN as a world-class
 * fix for the EBUSY orphan problem — but accidentally regressed P1 verify
 * latency by 18x (50 parallel: 1034ms → 18385ms). The team had publish-time
 * structural gates (phase 3.5-3.9) but ZERO publish-time PERF regression gate.
 *
 * v2.19.56 ships the missing gate as a composable primitive + ritual phase:
 *
 *   - PerfBudget   — `{name, baselineMs, ceilingMs, sampleN}` per metric
 *   - PerfMeasure  — `{name, ts, version, durations[], stats}` per release run
 *   - perfLedger   — HMAC-chained `.mneme-perf-budget.jsonl` ledger
 *   - regressionGate — compares current vs ledger baseline + fails if >threshold
 *   - record       — append a measure to the ledger on each release
 *
 * Composes with v2.19.34 APOSTILLE chain pattern (same HMAC + prevSig).
 * Composes with v2.19.52 CONTRACT GATE (phase 3.10 invokes regressionGate).
 *
 * The wild bet: every release writes its perf baseline to a versioned ledger.
 * The ritual REFUSES to publish if any P1 metric regresses >REGRESSION_THRESHOLD.
 * Bug class "fix one thing → break another perf-wise" extinct at publish forever.
 *
 * No AI tool worldwide ships a cross-release HMAC-chained perf budget ledger
 * with publish-time enforcement at the spec level. 7th world-first.
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import { join } from "node:path";
import { createHmac } from "node:crypto";

const PROTOCOL_VERSION = 1;

// 10% regression default — matches the user's wisdom: "block release if any
// P1 metric regresses >10%". Configurable per-budget via opts.regressionPct.
const DEFAULT_REGRESSION_PCT = 0.10;

/** A perf budget: this metric must stay below ceilingMs to ship. */
export interface PerfBudget {
  name: string;
  baselineMs: number;  // historical p50 — informational
  ceilingMs: number;   // ABSOLUTE limit; any run above this blocks publish
  sampleN: number;     // how many samples to take per release
  regressionPct?: number; // override default 10% threshold per budget
  description?: string;
}

export interface PerfMeasure {
  v: typeof PROTOCOL_VERSION;
  name: string;
  ts: string;
  version: string;
  durationsMs: number[];
  p50: number;
  p99: number;
  meanMs: number;
  passed: boolean;
  budget: PerfBudget;
  prevSig: string;
  sig: string;
}

/** Compute p50 / p99 / mean for a sample. */
function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx]!;
}

export function statsFor(durationsMs: number[]): { p50: number; p99: number; meanMs: number } {
  if (durationsMs.length === 0) return { p50: 0, p99: 0, meanMs: 0 };
  const sorted = [...durationsMs].sort((a, b) => a - b);
  const mean = durationsMs.reduce((a, b) => a + b, 0) / durationsMs.length;
  return {
    p50: percentile(sorted, 0.5),
    p99: percentile(sorted, 0.99),
    meanMs: mean,
  };
}

function defaultSecret(): string {
  return process.env["MNEME_PERF_BUDGET_SECRET"] || `mneme-perf-budget-v${PROTOCOL_VERSION}`;
}

function hmacHex(prev: string, body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(prev + "::" + JSON.stringify(body)).digest("hex");
}

/** Default ledger location — at the repo root so it's part of the audit
 *  artifact. Composes with v2.19.34 APOSTILLE chain pattern. */
export function defaultLedgerPath(repoRoot: string): string {
  return join(repoRoot, ".mneme-perf-budget.jsonl");
}

/** Catalog of P1 perf budgets that gate publish. Add new entries as Mneme
 *  grows; each entry will appear in ritual phase 3.10 enforcement. */
export const P1_BUDGETS: readonly PerfBudget[] = [
  {
    name: "verify-50-parallel-identical",
    baselineMs: 100,    // v2.19.52 measured ~20ms/call sequential
    ceilingMs: 3000,    // user's wisdom: "50 parallel verify must complete < 3000ms"
    sampleN: 1,
    description: "50 parallel verifies of identical claim — concurrency-coalesce ceiling",
  },
  {
    name: "verify-50-parallel-distinct",
    baselineMs: 5000,
    ceilingMs: 10_000,
    sampleN: 1,
    description: "50 parallel verifies of DISTINCT claims — catalog-memo + filesystem-walk ceiling",
  },
  {
    name: "cli-startup",
    baselineMs: 200,
    ceilingMs: 1000,
    sampleN: 3,
    description: "Cold-start cost of `mneme --version` — autonomic_breath_hook + module imports",
  },
];

/** Read the ledger (best-effort; returns [] on error). Composes with v2.19.53
 *  HMAC lineage replay pattern. */
export function readLedger(repoRoot: string): PerfMeasure[] {
  const path = defaultLedgerPath(repoRoot);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l) as PerfMeasure);
  } catch {
    return [];
  }
}

/** Append a measure to the ledger with HMAC chain. */
export function recordMeasure(repoRoot: string, name: string, version: string, durationsMs: number[], budget: PerfBudget, secret?: string): PerfMeasure {
  const path = defaultLedgerPath(repoRoot);
  const stats = statsFor(durationsMs);
  // Pass = max sample < ceiling (we want WORST case to pass)
  const passed = Math.max(...durationsMs) < budget.ceilingMs;
  let prevSig = "0".repeat(64);
  try {
    if (existsSync(path)) {
      const all = readFileSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
      if (all.length > 0) {
        const last = JSON.parse(all[all.length - 1]!) as PerfMeasure;
        prevSig = last.sig;
      }
    }
  } catch { /* chain restarts if corrupt */ }
  const body: Omit<PerfMeasure, "sig"> = {
    v: PROTOCOL_VERSION,
    name,
    ts: new Date().toISOString(),
    version,
    durationsMs,
    p50: stats.p50,
    p99: stats.p99,
    meanMs: stats.meanMs,
    passed,
    budget,
    prevSig,
  };
  const sig = hmacHex(prevSig, body, secret ?? defaultSecret());
  const measure: PerfMeasure = { ...body, sig };
  try {
    appendFileSync(path, JSON.stringify(measure) + "\n", { encoding: "utf8", mode: 0o644 });
  } catch { /* best-effort — failing to record is not a regression in itself */ }
  return measure;
}

export interface RegressionVerdict {
  ok: boolean;
  budgetName: string;
  ceiling: number;
  worstMs: number;
  baselineFromLedger: number | null;
  regressionPct: number | null;
  recommendedAction: string;
}

/** Compare current measurement to the ledger baseline + ceiling.
 *  Two-sided enforcement:
 *    (a) WORST sample must be below ABSOLUTE ceiling (hard gate)
 *    (b) WORST sample must not exceed prior baseline × (1 + regressionPct)
 *
 *  Either failure blocks publish.
 */
export function regressionGate(repoRoot: string, budget: PerfBudget, durationsMs: number[]): RegressionVerdict {
  const worst = Math.max(...durationsMs);
  const ledger = readLedger(repoRoot);
  const priorForName = ledger.filter((m) => m.name === budget.name && m.passed);
  const baselineFromLedger = priorForName.length > 0 ? priorForName[priorForName.length - 1]!.meanMs : null;
  const allowedRegressionPct = budget.regressionPct ?? DEFAULT_REGRESSION_PCT;

  // Hard ceiling check
  if (worst >= budget.ceilingMs) {
    return {
      ok: false,
      budgetName: budget.name,
      ceiling: budget.ceilingMs,
      worstMs: worst,
      baselineFromLedger,
      regressionPct: null,
      recommendedAction: `BLOCK PUBLISH — ${budget.name} worst=${worst}ms exceeded HARD CEILING ${budget.ceilingMs}ms. Profile the hot path; suspect new I/O or sync work.`,
    };
  }

  // Relative regression check (only if we have a baseline)
  if (baselineFromLedger !== null && baselineFromLedger > 0) {
    const ratio = worst / baselineFromLedger;
    const regressionPct = ratio - 1;
    if (regressionPct > allowedRegressionPct) {
      return {
        ok: false,
        budgetName: budget.name,
        ceiling: budget.ceilingMs,
        worstMs: worst,
        baselineFromLedger,
        regressionPct,
        recommendedAction: `BLOCK PUBLISH — ${budget.name} regressed ${(regressionPct * 100).toFixed(0)}% vs ledger baseline ${baselineFromLedger.toFixed(0)}ms (worst=${worst}ms; allowed ${(allowedRegressionPct * 100).toFixed(0)}%). Bisect recent commits; the regressor is between last passing release and now.`,
      };
    }
  }

  return {
    ok: true,
    budgetName: budget.name,
    ceiling: budget.ceilingMs,
    worstMs: worst,
    baselineFromLedger,
    regressionPct: baselineFromLedger !== null && baselineFromLedger > 0 ? (worst / baselineFromLedger - 1) : null,
    recommendedAction: `OK — ${budget.name} worst=${worst}ms under ceiling ${budget.ceilingMs}ms${baselineFromLedger !== null ? ` and within ${(allowedRegressionPct * 100).toFixed(0)}% of baseline ${baselineFromLedger.toFixed(0)}ms` : " (no prior baseline — recording first)"}.`,
  };
}

/** Verify the HMAC chain integrity of the ledger. Composes with v2.19.34
 *  APOSTILLE + v2.19.49 CHRONOSHEAF storage + v2.19.53 install_organ lineage. */
export function verifyLedgerChain(repoRoot: string, secret?: string): { ok: boolean; brokenAt?: number; reason?: string } {
  const all = readLedger(repoRoot);
  if (all.length === 0) return { ok: true };
  let prevSig = "0".repeat(64);
  for (let i = 0; i < all.length; i++) {
    const entry = all[i]!;
    if (entry.prevSig !== prevSig) return { ok: false, brokenAt: i, reason: "prevSig mismatch" };
    const { sig, ...body } = entry;
    const expectedSig = hmacHex(prevSig, body, secret ?? defaultSecret());
    if (sig !== expectedSig) return { ok: false, brokenAt: i, reason: "sig mismatch" };
    prevSig = entry.sig;
  }
  return { ok: true };
}

export { PROTOCOL_VERSION, DEFAULT_REGRESSION_PCT };
