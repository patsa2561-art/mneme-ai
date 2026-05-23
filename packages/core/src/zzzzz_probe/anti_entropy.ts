/**
 * v2.39.0 — Anti-Entropy text/code analyzer.
 *
 * 4 measurable signals AI-generated text leaks (well-cited in
 * Mitchell et al. 2023 "DetectGPT" and academic AI-text-detection
 * literature). No GPU, no ML model, pure deterministic math.
 *
 *   1. Shannon entropy bits/char — AI text often clusters near
 *      4.0-4.5 bits/char (natural English ~3.9-4.7).
 *   2. Repetition rate — dominant n-gram frequency. AI repeats.
 *   3. Sentence-variance ratio — sigma/mean of sentence length.
 *      AI text often uniform (low ratio).
 *   4. Zipf deviation — top-K word frequency vs Zipf's law (k/rank).
 *      AI text under-represents stop-word power-law tail.
 *
 * Each signal contributes to a composite `anomalyScore` in [0, 1].
 */

import type { AntiEntropyMetrics } from "./types.js";

// ── 1. Shannon entropy ────────────────────────────────────────────────

export function shannonBitsPerChar(text: string): number {
  if (text.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const ch of text) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  const total = text.length;
  let h = 0;
  for (const c of counts.values()) {
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

// ── 2. Repetition rate ────────────────────────────────────────────────

export function repetitionRate(text: string): number {
  const tokens = text.toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return 0;
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  let maxCount = 0;
  for (const c of counts.values()) if (c > maxCount) maxCount = c;
  return maxCount / tokens.length;
}

// ── 3. Sentence-length variance ratio ─────────────────────────────────

export function sentenceVarianceRatio(text: string): number {
  // Sentences = runs separated by . ! ? + whitespace.
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0);
  if (sentences.length < 2) return 0;
  const lengths = sentences.map((s) => s.length);
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  if (mean === 0) return 0;
  const variance = lengths.reduce((a, n) => a + (n - mean) ** 2, 0) / lengths.length;
  const stddev = Math.sqrt(variance);
  return stddev / mean;
}

// ── 4. Zipf deviation ─────────────────────────────────────────────────

export function zipfDeviation(text: string): number {
  const tokens = text.toLowerCase().match(/[a-z]+/g) ?? [];
  if (tokens.length < 50) return 0; // not enough sample
  const counts = new Map<string, number>();
  for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]).slice(0, 50);
  if (sorted.length < 10) return 0;
  // Expected Zipf: freq(rank=r) ≈ freq(rank=1) / r
  const top = sorted[0]![1];
  let deviationSum = 0;
  let denom = 0;
  for (let i = 1; i < sorted.length; i++) {
    const expected = top / (i + 1);
    const observed = sorted[i]![1];
    const ratio = observed / Math.max(1, expected);
    // Penalty grows as ratio deviates from 1.0 (in EITHER direction).
    deviationSum += Math.abs(Math.log(ratio));
    denom++;
  }
  return denom === 0 ? 0 : deviationSum / denom;
}

// ── Composite ─────────────────────────────────────────────────────────

/**
 * Compute all 4 metrics + composite anomalyScore.
 *
 * Each signal is normalized to [0, 1] via these heuristics:
 *   - Shannon: distance from natural-English range 3.9-4.7 bits/char
 *   - Repetition: rate * 4 clamped (0.25 = 1.0 anomaly)
 *   - Variance: distance from natural 0.3-0.6 range
 *   - Zipf: deviation > 1.5 = 1.0 anomaly
 *
 * Composite = mean of 4 individual scores. > 0.55 = REFUTED;
 * > 0.40 = PROBE_DRIFT; ≤ 0.40 = CRYSTAL_CLEAR.
 */
export function analyzeText(text: string): AntiEntropyMetrics {
  const shannon = shannonBitsPerChar(text);
  const rep = repetitionRate(text);
  const sentVar = sentenceVarianceRatio(text);
  const zipf = zipfDeviation(text);

  // Normalize each to [0, 1] anomaly contribution.
  const shannonAnomaly = (() => {
    if (text.length < 20) return 0;
    // Natural English is 3.9-4.7 bits/char. Distance outside this range = anomaly.
    if (shannon >= 3.9 && shannon <= 4.7) return 0;
    if (shannon < 3.9) return Math.min(1, (3.9 - shannon) / 2);
    return Math.min(1, (shannon - 4.7) / 2);
  })();
  // Natural English has 15-20% dominant-token rate (the / a / of /
  // and). Suspicious starts above 30%. Floor at 0.20 (no signal); ramp
  // linearly to 1.0 at rep=1.0 (a single token = 100% of text).
  const repAnomaly = Math.max(0, Math.min(1, (rep - 0.20) * 1.25));
  const variAnomaly = (() => {
    if (sentVar === 0) return 0;
    // Natural prose tends to 0.3-0.7 ratio. AI tends to be lower (uniform).
    if (sentVar >= 0.3 && sentVar <= 0.7) return 0;
    if (sentVar < 0.3) return Math.min(1, (0.3 - sentVar) / 0.3);
    return Math.min(1, (sentVar - 0.7) / 0.7);
  })();
  const zipfAnomaly = Math.min(1, zipf / 1.5);

  // Composite: average of the 4 signals, BUT if any single signal is
  // maxed, boost the composite so a single-axis red flag still drives
  // a refute. Otherwise high-repetition AI loops would land at composite
  // 0.30 because the other 3 signals were quiet. Real AI hallucinations
  // often light up just ONE axis hard — that signal alone should refute.
  const plainComposite = (shannonAnomaly + repAnomaly + variAnomaly + zipfAnomaly) / 4;
  const maxSingle = Math.max(shannonAnomaly, repAnomaly, variAnomaly, zipfAnomaly);
  const composite = Math.max(plainComposite, maxSingle * 0.7);

  return {
    shannonBitsPerChar: round3(shannon),
    repetitionRate: round3(rep),
    sentenceVarianceRatio: round3(sentVar),
    zipfDeviation: round3(zipf),
    anomalyScore: round3(composite),
  };
}

function round3(n: number): number { return Number(n.toFixed(3)); }
