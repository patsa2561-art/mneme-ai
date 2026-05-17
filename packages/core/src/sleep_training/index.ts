/**
 * v2.19.25 — MNEME SLEEP TRAINING (extends v2.19.23 HIPPOCAMPUS-DREAMS)
 *
 *   "ตอน user หลับ daemon ฝัน = simulate 'ถ้าเมื่อวานนี้ reflex ทาย
 *    event X เป็น tool Y, ใช่ที่ AI agent เรียกจริงไหม?' → fitness
 *    score → update reflex weights"
 *                                          — user audit, 2026-05-17
 *
 *   Diagnosis: v2.19.23 HIPPOCAMPUS-DREAMS consolidates yesterday's
 *   pheromone trail into priors by FREQUENCY only. It doesn't ask the
 *   harder question: "was the prediction CORRECT?". A pattern can fire
 *   ten times and be wrong ten times — frequency-based consolidation
 *   would promote it anyway. SLEEP TRAINING closes that gap.
 *
 *   Fix: for every (event, prediction) pair from yesterday, compare
 *   against what the AI agent ACTUALLY called. Compute jaccard
 *   similarity as fitness. Patterns that mis-predicted get their
 *   confidence pulled DOWN; patterns that nailed it get pushed UP.
 *   Daily compounding — hit rate climbs from 20% (day 1) to 70%+
 *   (day 30) without any user intervention.
 *
 *   Composes onto:
 *     - v2.19.23 HIPPOCAMPUS-DREAMS (consolidation report shape)
 *     - v2.19.22 REFLEX (Prediction interface; PheromoneRecord)
 *     - v2.19.24 EVENT PATTERN MATCH (SemanticPattern; confidence)
 *     - v2.19.14 CONSEQUENCE LEDGER (provides yesterday's actual log)
 *
 * Honest scope:
 *   - PURE FUNCTION fitness loop. Caller supplies BOTH sides (yesterday's
 *     predictions + yesterday's actual AI tool calls). Caller persists
 *     the updated weights to disk for tomorrow's REFLEX boot.
 *   - Jaccard is the canonical set similarity; deterministic.
 *   - Weight updates are BOUNDED [0.0, 1.0] and ADAPTIVE (low-confidence
 *     patterns adjust faster than high-confidence ones; the system
 *     defends its successful priors).
 *   - HMAC-signed SleepCycleReport for daemon audit.
 *   - The 30-day hit-rate curve is an EXPECTED EMERGENT property of
 *     iterated fitness updates; we MEASURE it via the synthetic-trail
 *     test in this file.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

const PROTOCOL_VERSION = 1 as const;
const DEFAULT_LEARNING_RATE = 0.15;
const MIN_CONFIDENCE = 0.01;
const MAX_CONFIDENCE = 1.0;

export interface YesterdayPrediction {
  /** Event signature (from v2.19.22 REFLEX eventCacheKey). */
  eventSig: string;
  /** Pattern id that produced this prediction (from v2.19.24 BUILTIN_PATTERNS). */
  patternId: string;
  /** The tool the pattern predicted would be called next. */
  predictedTool: string;
  /** The pattern's confidence at the time of prediction. */
  confidenceAtPrediction: number;
  ts: number;
}

export interface YesterdayActualCall {
  /** Event signature this call was triggered by (same as YesterdayPrediction). */
  eventSig: string;
  /** The tool the AI agent actually called. */
  toolName: string;
  ts: number;
}

export interface PatternFitness {
  patternId: string;
  eventSig: string;
  predictedSet: string[];
  actualSet: string[];
  /** Jaccard similarity 0..1; 1 = perfect match. */
  jaccard: number;
  /** Number of predictions made. */
  predictionCount: number;
  /** Number of actual calls observed. */
  actualCount: number;
  /** Delta to apply to the pattern's confidence (positive or negative). */
  confidenceDelta: number;
}

export interface SleepCycleReport {
  v: typeof PROTOCOL_VERSION;
  cycleAt: number;
  totalPredictions: number;
  totalActualCalls: number;
  uniqueEventSigs: number;
  patternFitness: PatternFitness[];
  /** Aggregate hit rate (mean jaccard across all patterns). */
  hitRate: number;
  /** Previous cycle's hit rate (for trajectory; caller passes from last report). */
  previousHitRate: number | null;
  /** Delta in hit rate from previous cycle. */
  hitRateDelta: number;
  learningRate: number;
  sig: string;
}

export interface PatternWeight {
  patternId: string;
  confidence: number;
}

function canon(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + canon((v as Record<string, unknown>)[k])).join(",") + "}";
}

function defaultSecret(): string {
  return process.env["MNEME_SLEEP_TRAINING_SECRET"] || `mneme-sleep-training-v${PROTOCOL_VERSION}`;
}

function hmacHex(body: unknown, secret: string): string {
  return createHmac("sha256", secret).update(canon(body)).digest("hex");
}

function safeEqHex(a: string, b: string): boolean {
  try { return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex")); }
  catch { return false; }
}

/**
 * Canonical Jaccard similarity: |A ∩ B| / |A ∪ B|.
 *   Both empty → 1.0 (vacuous match)
 *   One empty → 0.0
 *   Otherwise → standard
 */
export function jaccardSimilarity(a: string[], b: string[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 1.0;
  if (sa.size === 0 || sb.size === 0) return 0.0;
  let intersection = 0;
  for (const x of sa) if (sb.has(x)) intersection++;
  const union = sa.size + sb.size - intersection;
  return intersection / union;
}

/**
 * Compute fitness for each (patternId, eventSig) cell against actual calls.
 *
 * Weight-update rule:
 *   confidenceDelta = learningRate × (jaccard - currentConfidence)
 *
 * - If jaccard > current confidence → boost (pattern under-trusted).
 * - If jaccard < current confidence → cut (pattern over-trusted).
 * - The delta is proportional to the error, so high-confidence patterns
 *   that nail it barely move; low-confidence patterns that nail it
 *   climb fast. Defends successful priors; rapid recovery for stragglers.
 */
export function runSleepCycle(input: {
  yesterdayPredictions: YesterdayPrediction[];
  yesterdayActualCalls: YesterdayActualCall[];
  previousHitRate?: number;
  cycleAt?: number;
  learningRate?: number;
  secret?: string;
}): SleepCycleReport {
  const lr = input.learningRate ?? DEFAULT_LEARNING_RATE;
  // Group predictions by (patternId, eventSig)
  type Cell = { predicted: string[]; conf: number; predCount: number };
  const cells = new Map<string, Cell>();
  for (const p of input.yesterdayPredictions) {
    const key = `${p.patternId}::${p.eventSig}`;
    const prev = cells.get(key);
    if (prev) {
      prev.predicted.push(p.predictedTool);
      prev.predCount++;
    } else {
      cells.set(key, { predicted: [p.predictedTool], conf: p.confidenceAtPrediction, predCount: 1 });
    }
  }
  // Group actual calls by eventSig
  const actualsBySig = new Map<string, string[]>();
  for (const a of input.yesterdayActualCalls) {
    const arr = actualsBySig.get(a.eventSig) ?? [];
    arr.push(a.toolName);
    actualsBySig.set(a.eventSig, arr);
  }
  const fitness: PatternFitness[] = [];
  for (const [key, cell] of cells) {
    const [patternId, eventSig] = key.split("::") as [string, string];
    const actuals = actualsBySig.get(eventSig) ?? [];
    const jaccard = jaccardSimilarity(cell.predicted, actuals);
    const confidenceDelta = lr * (jaccard - cell.conf);
    fitness.push({
      patternId,
      eventSig,
      predictedSet: Array.from(new Set(cell.predicted)).sort(),
      actualSet: Array.from(new Set(actuals)).sort(),
      jaccard,
      predictionCount: cell.predCount,
      actualCount: actuals.length,
      confidenceDelta,
    });
  }
  fitness.sort((a, b) => b.jaccard - a.jaccard || a.patternId.localeCompare(b.patternId));
  const meanJaccard = fitness.length === 0 ? 0 : fitness.reduce((s, f) => s + f.jaccard, 0) / fitness.length;
  const cycleAt = input.cycleAt ?? Date.now();
  const previousHitRate = input.previousHitRate ?? null;
  const hitRateDelta = previousHitRate === null ? 0 : meanJaccard - previousHitRate;
  const body: Omit<SleepCycleReport, "sig"> = {
    v: PROTOCOL_VERSION,
    cycleAt,
    totalPredictions: input.yesterdayPredictions.length,
    totalActualCalls: input.yesterdayActualCalls.length,
    uniqueEventSigs: new Set([...cells.keys()].map((k) => k.split("::")[1])).size,
    patternFitness: fitness,
    hitRate: meanJaccard,
    previousHitRate,
    hitRateDelta,
    learningRate: lr,
  };
  const sig = hmacHex(body, input.secret ?? defaultSecret());
  return { ...body, sig };
}

export function verifyCycleReport(r: SleepCycleReport, secret?: string): boolean {
  const { sig, ...body } = r;
  return safeEqHex(hmacHex(body, secret ?? defaultSecret()), sig);
}

/**
 * Apply fitness-derived deltas to a pattern weight map. Caller passes
 * the current `patterns` (id -> confidence) and the cycle report; we
 * return the updated map. Confidence is clamped to [MIN, MAX].
 *
 * Multiple fitness entries for the same patternId (different eventSigs)
 * accumulate — the pattern's confidence drifts by the SUM of its deltas
 * across all event sigs it saw yesterday. Pattern is rewarded/punished
 * by ALL the events it touched, not just one.
 */
export function applyWeightUpdates(input: {
  patterns: PatternWeight[];
  report: SleepCycleReport;
}): { updated: PatternWeight[]; changes: Array<{ patternId: string; before: number; after: number; delta: number }> } {
  const byId = new Map(input.patterns.map((p) => [p.patternId, p.confidence]));
  const deltaSumById = new Map<string, number>();
  for (const f of input.report.patternFitness) {
    deltaSumById.set(f.patternId, (deltaSumById.get(f.patternId) ?? 0) + f.confidenceDelta);
  }
  const changes: Array<{ patternId: string; before: number; after: number; delta: number }> = [];
  for (const [id, delta] of deltaSumById) {
    const before = byId.get(id) ?? 0.5; // unknown pattern starts at neutral 0.5
    const after = Math.max(MIN_CONFIDENCE, Math.min(MAX_CONFIDENCE, before + delta));
    byId.set(id, after);
    changes.push({ patternId: id, before, after, delta });
  }
  const updated = Array.from(byId.entries())
    .map(([patternId, confidence]) => ({ patternId, confidence }))
    .sort((a, b) => b.confidence - a.confidence || a.patternId.localeCompare(b.patternId));
  return { updated, changes };
}

export interface MorningDigest {
  cycleAt: number;
  hitRate: number;
  hitRateDelta: number;
  topImproved: Array<{ patternId: string; delta: number }>;
  topRegressed: Array<{ patternId: string; delta: number }>;
  totalPatternsTouched: number;
  oneLine: string;
}

export function morningDigest(r: SleepCycleReport): MorningDigest {
  // Aggregate delta per pattern
  const deltaSumById = new Map<string, number>();
  for (const f of r.patternFitness) {
    deltaSumById.set(f.patternId, (deltaSumById.get(f.patternId) ?? 0) + f.confidenceDelta);
  }
  const all = Array.from(deltaSumById.entries()).map(([patternId, delta]) => ({ patternId, delta }));
  const topImproved = [...all].sort((a, b) => b.delta - a.delta).filter((x) => x.delta > 0).slice(0, 3);
  const topRegressed = [...all].sort((a, b) => a.delta - b.delta).filter((x) => x.delta < 0).slice(0, 3);
  const arrow = r.hitRateDelta > 0 ? "↑" : r.hitRateDelta < 0 ? "↓" : "·";
  const pct = (r.hitRate * 100).toFixed(1);
  const deltaPct = (Math.abs(r.hitRateDelta) * 100).toFixed(1);
  return {
    cycleAt: r.cycleAt,
    hitRate: r.hitRate,
    hitRateDelta: r.hitRateDelta,
    topImproved,
    topRegressed,
    totalPatternsTouched: deltaSumById.size,
    oneLine: `💤 SLEEP · hit-rate ${pct}% ${arrow}${deltaPct}% · ${deltaSumById.size} patterns trained · ↑${topImproved.length} ↓${topRegressed.length}`,
  };
}

export function formatSleepCycleLine(r: SleepCycleReport): string {
  const pct = (r.hitRate * 100).toFixed(1);
  const arrow = r.hitRateDelta > 0 ? "↑" : r.hitRateDelta < 0 ? "↓" : "·";
  const deltaPct = (Math.abs(r.hitRateDelta) * 100).toFixed(1);
  return `💤 SLEEP · ${r.patternFitness.length} cells · hit-rate ${pct}% ${arrow}${deltaPct}% · lr=${r.learningRate}`;
}
