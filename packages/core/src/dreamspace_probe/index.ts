/**
 * v2.19.27 — MNEME DREAMSPACE · PROBE (stage 1 of 6)
 *
 *   "ทุกคืน 02:00 daemon idle detect (BREATH) → run each MCP tool
 *    against 5 synthetic inputs (HIPPOCAMPUS axiom pool) + 3 real
 *    recent inputs → measure latency / output_entropy / error_rate /
 *    utility_score → store in PROPRIOCEPTION → REFLEX query at
 *    predict-next-tool time."
 *                                          — user audit, 2026-05-17
 *
 *   Diagnosis: v2.19.22 REFLEX predicts by frequency; v2.19.26
 *   DREAMSPACE proposes tools from gaps. Neither MEASURES per-tool
 *   capability dimensions. PROBE fills that gap.
 *
 *   PROBE runs a caller-supplied tool handler against:
 *     - synthetic inputs (caller-provided HIPPOCAMPUS axiom samples)
 *     - real recent inputs (caller-provided yesterday's reflex log)
 *
 *   For each run, computes 4 normalised metrics:
 *     1. latencyScore   — 1.0 if < 100ms; decays exponentially
 *     2. outputEntropy  — Shannon entropy of result keys; flag flat outputs
 *     3. errorRate      — proportion of runs that threw
 *     4. utilityScore   — heuristic: result has shape + non-empty + valid
 *
 *   Aggregate fitness = geometric mean of all 4. Used by stage 5
 *   (v2.19.26 EVOLUTION) for promote/sunset decisions and by stage 2
 *   (CARTOGRAPHER) for capability mapping.
 *
 *   Composes onto:
 *     - v2.19.23 BREATH (caller triggers cycle on idle)
 *     - v2.19.23 THALAMUS (dream tier handles the cycle)
 *     - v2.19.23 HIPPOCAMPUS (axiom source for synthetic inputs)
 *     - v2.19.25 SLEEP TRAINING (fitness gradient blends with probe)
 *     - v2.19.26 EVOLUTION (probe results feed lifecycle decisions)
 *
 * Honest scope:
 *   - PURE FUNCTION metric computation. Caller supplies the invoke
 *     function + inputs; we measure + aggregate.
 *   - Latency budget thresholds, entropy bins are CONFIG.
 *   - HMAC-signed ProbeReport so daemon can audit forged probes.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_LATENCY_BUDGET_MS = 100;
const DEFAULT_LATENCY_HALF_LIFE_MS = 200;
const FITNESS_MIN = 0.001;

export interface ProbeInput {
  /** Caller-named input label (e.g., "axiom:fact_check" / "real:yesterday_3"). */
  label: string;
  /** Whether this came from synthetic (axiom) or real recent log. */
  source: "synthetic" | "real";
  /** Args passed to tool. */
  args: Record<string, unknown>;
}

export interface ProbeRun {
  inputLabel: string;
  inputSource: ProbeInput["source"];
  latencyMs: number;
  ok: boolean;
  /** Result returned by tool (or undefined on error). */
  result: unknown;
  errorMessage?: string;
}

export interface ProbeMetrics {
  latencyScore: number;
  outputEntropy: number;
  errorRate: number;
  utilityScore: number;
  /** Geometric mean of all 4; primary fitness signal. */
  fitnessScore: number;
}

export interface ToolProbeReport {
  v: typeof PROTOCOL_VERSION;
  toolName: string;
  runs: ProbeRun[];
  metrics: ProbeMetrics;
  totalInputs: number;
  syntheticInputs: number;
  realInputs: number;
  probedAt: number;
  sig: string;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_DREAMSPACE_PROBE_SECRET"] || `mneme-dreamspace-probe-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/** Latency score: 1.0 if <= budget; decays toward 0 by exponential half-life. */
export function latencyScore(latencyMs: number, budgetMs = DEFAULT_LATENCY_BUDGET_MS, halfLifeMs = DEFAULT_LATENCY_HALF_LIFE_MS): number {
  if (latencyMs <= budgetMs) return 1.0;
  const over = latencyMs - budgetMs;
  return Math.pow(0.5, over / halfLifeMs);
}

/**
 * Shannon entropy over the SHAPE of a result. We bucket by top-level key
 * names + array-vs-object discrimination. High entropy = rich diverse
 * shape; low entropy = flat repetitive structure (suspect bug or stub).
 *
 * Returns 0..1 normalised (entropy / log2(maxBins=8); clamped).
 */
export function outputShapeEntropy(results: unknown[]): number {
  if (results.length === 0) return 0;
  const bucketCounts = new Map<string, number>();
  for (const r of results) {
    const bucket = shapeBucket(r);
    bucketCounts.set(bucket, (bucketCounts.get(bucket) ?? 0) + 1);
  }
  const total = results.length;
  let entropy = 0;
  for (const count of bucketCounts.values()) {
    const p = count / total;
    if (p > 0) entropy -= p * Math.log2(p);
  }
  // Normalise to [0, 1]: log2(8) = 3 as max useful entropy (≥8 distinct shapes).
  return Math.min(1, entropy / 3);
}

function shapeBucket(v: unknown): string {
  if (v === null) return "null";
  if (v === undefined) return "undefined";
  if (Array.isArray(v)) return `array_len_${v.length === 0 ? "0" : v.length < 5 ? "small" : v.length < 50 ? "med" : "large"}`;
  if (typeof v === "object") {
    const keys = Object.keys(v as Record<string, unknown>).sort().slice(0, 4);
    return `obj_${keys.join(",")}`;
  }
  return typeof v;
}

/** Error rate: fraction of runs that threw. */
export function errorRate(runs: ProbeRun[]): number {
  if (runs.length === 0) return 0;
  let errors = 0;
  for (const r of runs) if (!r.ok) errors++;
  return errors / runs.length;
}

/** Utility heuristic: result is non-null + non-undefined + non-empty. */
export function utilityScore(runs: ProbeRun[]): number {
  if (runs.length === 0) return 0;
  let useful = 0;
  for (const r of runs) {
    if (!r.ok) continue;
    if (r.result === null || r.result === undefined) continue;
    if (typeof r.result === "string" && r.result.length === 0) continue;
    if (Array.isArray(r.result) && r.result.length === 0) continue;
    if (typeof r.result === "object" && Object.keys(r.result as object).length === 0) continue;
    useful++;
  }
  return useful / runs.length;
}

/** Geometric mean of 4 normalised scores; preserves zero floor for safety. */
export function aggregateFitness(m: Omit<ProbeMetrics, "fitnessScore">): number {
  const safe = (x: number) => Math.max(FITNESS_MIN, Math.min(1, x));
  const product = safe(m.latencyScore) * safe(1 - m.errorRate) * safe(m.utilityScore) * safe(m.outputEntropy);
  return Math.pow(product, 1 / 4);
}

/**
 * One-shot probe of a single tool against a battery of inputs. Caller
 * supplies the invoke function (so we don't need to know how to call
 * tools cross-vendor). Each input gets one run; latency is measured
 * per run with a wall-clock timer; errors are caught.
 */
export async function runProbeBattery(input: {
  toolName: string;
  inputs: ProbeInput[];
  invoke: (toolName: string, args: Record<string, unknown>) => Promise<unknown>;
  latencyBudgetMs?: number;
  latencyHalfLifeMs?: number;
  probedAt?: number;
  secret?: string;
}): Promise<ToolProbeReport> {
  const runs: ProbeRun[] = [];
  for (const inp of input.inputs) {
    const start = Date.now();
    try {
      const r = await input.invoke(input.toolName, inp.args);
      runs.push({
        inputLabel: inp.label,
        inputSource: inp.source,
        latencyMs: Date.now() - start,
        ok: true,
        result: r,
      });
    } catch (e) {
      runs.push({
        inputLabel: inp.label,
        inputSource: inp.source,
        latencyMs: Date.now() - start,
        ok: false,
        result: undefined,
        errorMessage: (e as Error).message,
      });
    }
  }
  return finaliseProbe({
    toolName: input.toolName,
    runs,
    latencyBudgetMs: input.latencyBudgetMs,
    latencyHalfLifeMs: input.latencyHalfLifeMs,
    probedAt: input.probedAt,
    secret: input.secret,
  });
}

/**
 * Aggregate a list of runs into a ToolProbeReport. Pure function so
 * tests can feed deterministic run arrays without needing async invoke.
 */
export function finaliseProbe(input: {
  toolName: string;
  runs: ProbeRun[];
  latencyBudgetMs?: number;
  latencyHalfLifeMs?: number;
  probedAt?: number;
  secret?: string;
}): ToolProbeReport {
  const meanLatency = input.runs.length === 0
    ? 0
    : input.runs.reduce((s, r) => s + r.latencyMs, 0) / input.runs.length;
  const lat = latencyScore(meanLatency, input.latencyBudgetMs, input.latencyHalfLifeMs);
  const ent = outputShapeEntropy(input.runs.filter((r) => r.ok).map((r) => r.result));
  const err = errorRate(input.runs);
  const util = utilityScore(input.runs);
  const fit = aggregateFitness({ latencyScore: lat, outputEntropy: ent, errorRate: err, utilityScore: util });
  const synthetic = input.runs.filter((r) => r.inputSource === "synthetic").length;
  const real = input.runs.filter((r) => r.inputSource === "real").length;
  const body: Omit<ToolProbeReport, "sig"> = {
    v: PROTOCOL_VERSION,
    toolName: input.toolName,
    runs: input.runs,
    metrics: { latencyScore: lat, outputEntropy: ent, errorRate: err, utilityScore: util, fitnessScore: fit },
    totalInputs: input.runs.length,
    syntheticInputs: synthetic,
    realInputs: real,
    probedAt: input.probedAt ?? Date.now(),
  };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function verifyProbeReport(r: ToolProbeReport, secret?: string): boolean {
  const { sig, ...body } = r;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

export function formatProbeLine(r: ToolProbeReport): string {
  const f = (r.metrics.fitnessScore * 100).toFixed(0);
  return `🔬 PROBE ${r.toolName} · fitness=${f}% · lat=${(r.metrics.latencyScore * 100).toFixed(0)}% · ent=${(r.metrics.outputEntropy * 100).toFixed(0)}% · err=${(r.metrics.errorRate * 100).toFixed(0)}% · util=${(r.metrics.utilityScore * 100).toFixed(0)}%`;
}
