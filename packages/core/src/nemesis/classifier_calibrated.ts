/**
 * v2.47.0 — CALIBRATED CLASSIFIER (production-grade).
 *
 * Replaces v2.46.0's fixed-weight heuristic with a per-vendor
 * Mahalanobis-style log-likelihood score derived from the seed
 * calibration corpus + the (opt-in) self-calibrating learning ledger.
 *
 * Algorithm:
 *   For each vendor V with stats {feature_i: (mean_i, stdev_i)}:
 *     logL(fp | V) = − Σ_i ((fp[i] − mean_i) / max(stdev_i, ε))²
 *
 *   Top vendor = argmax logL. Confidence = softmax(logL) of the top.
 *
 * Only DISCRIMINATIVE features are used (the ones with high inter-vendor
 * variance) — others would just add noise. We compute discriminativeness
 * dynamically per feature.
 *
 * Falls back to v2.46.0 heuristic classifier when seed stats unavailable
 * (e.g. user has deleted the corpus). Defensive: never throws.
 */

import type { Fingerprint, AgentVerdict, VendorId } from "./types.js";
import { seedStats, buildSeedCorpus, type VendorStats } from "./calibration_corpus.js";
import { classifyAgent as heuristicClassify } from "./classifier.js";
import { extractFingerprint } from "./features.js";

const EPSILON_FLOOR = 1e-3;
/** Cap per-feature z² so a single zero-stdev mismatch can't dominate. */
const Z_SQUARED_CAP = 100;
/** EPSILON_FLOOR for any feature with stdev<= this threshold is set to 10% of mean (or floor). */
function effectiveStdev(mean: number, stdev: number): number {
  if (stdev > EPSILON_FLOOR) return stdev;
  // Zero-stdev: scale to mean's magnitude so features with large means don't
  // produce absurd z-scores. If mean is also tiny, use floor.
  const relative = Math.abs(mean) * 0.10;
  return Math.max(relative, EPSILON_FLOOR);
}

/**
 * Compute discriminativeness per feature: ratio of cross-vendor mean
 * variance to within-vendor variance. Higher = more discriminative.
 * Features with discriminativeness < threshold are excluded from scoring.
 */
function discriminativeFeatures(statsMap: Map<VendorId, VendorStats>, minDiscrim = 0.5): string[] {
  const featureKeys = new Set<string>();
  for (const s of statsMap.values()) for (const k of Object.keys(s.features)) featureKeys.add(k);
  const out: string[] = [];
  for (const k of featureKeys) {
    const means: number[] = [];
    const stdevs: number[] = [];
    for (const s of statsMap.values()) {
      const f = s.features[k];
      if (!f) continue;
      means.push(f.mean);
      stdevs.push(f.stdev);
    }
    if (means.length < 2) continue;
    const meanOfMeans = means.reduce((a, b) => a + b, 0) / means.length;
    const meansVar = means.reduce((s, m) => s + (m - meanOfMeans) ** 2, 0) / means.length;
    const meanStdev = stdevs.reduce((a, b) => a + b, 0) / stdevs.length;
    const denom = meanStdev * meanStdev + EPSILON_FLOOR;
    const discrim = meansVar / denom;
    if (discrim >= minDiscrim) out.push(k);
  }
  return out;
}

let _cachedDiscrim: string[] | null = null;
function getDiscriminativeFeatures(): string[] {
  if (_cachedDiscrim) return _cachedDiscrim;
  try {
    _cachedDiscrim = discriminativeFeatures(seedStats());
  } catch {
    _cachedDiscrim = [];
  }
  return _cachedDiscrim;
}

export function __resetCalibratedCacheForTest(): void { _cachedDiscrim = null; }

/**
 * Calibrated log-likelihood score per vendor. Pure deterministic.
 */
function scoreCalibrated(fp: Fingerprint): { scores: Partial<Record<VendorId, number>>; discrim: string[] } {
  const stats = (() => { try { return seedStats(); } catch { return new Map<VendorId, VendorStats>(); } })();
  if (stats.size === 0) return { scores: {}, discrim: [] };
  const discrim = getDiscriminativeFeatures();
  if (discrim.length === 0) return { scores: {}, discrim };
  const scores: Partial<Record<VendorId, number>> = {};
  const fpObj = fp as unknown as Record<string, number>;
  for (const [vendor, vstats] of stats) {
    let logL = 0;
    for (const k of discrim) {
      const f = vstats.features[k];
      if (!f) continue;
      const sd = effectiveStdev(f.mean, f.stdev);
      const z = (Number(fpObj[k] ?? 0) - f.mean) / sd;
      const zSq = Math.min(Z_SQUARED_CAP, z * z);
      logL -= zSq;
    }
    scores[vendor] = logL;
  }
  return { scores, discrim };
}

function softmaxTop(scores: Partial<Record<VendorId, number>>): { topVendor: VendorId; confidence: number } {
  const entries = Object.entries(scores) as Array<[VendorId, number]>;
  if (entries.length === 0) return { topVendor: "unknown", confidence: 0 };
  const maxLogL = Math.max(...entries.map(([, v]) => v));
  const exps = entries.map(([k, v]) => [k, Math.exp((v - maxLogL) / Math.max(1, entries.length))] as [VendorId, number]);
  const sum = exps.reduce((s, [, v]) => s + v, 0);
  const sorted = exps.sort((a, b) => b[1] - a[1]);
  const top = sorted[0]!;
  return { topVendor: top[0], confidence: sum === 0 ? 0 : top[1] / sum };
}

/**
 * Calibrated classification. Falls back to v2.46.0 heuristic when the
 * calibration corpus is unavailable.
 */
export function classifyAgentCalibrated(fp: Fingerprint): AgentVerdict {
  // v2.48.0 — LOW-SIGNAL GUARD: when the fingerprint has no real signal
  // (no added/removed lines + no PR description + no commits), the
  // classifier should NOT commit to a vendor with high confidence. The
  // Mahalanobis math always picks a winner when given an all-zero vector
  // (the vendor with the smallest mean wins), producing false-positive
  // 99% confidence on garbage/empty inputs (v2.47 B1 cluster).
  const fpObj0 = fp as unknown as Record<string, number>;
  const totalSignal =
    Number(fpObj0["added_lines"] ?? 0) +
    Number(fpObj0["removed_lines"] ?? 0) +
    Number(fpObj0["pr_desc_length_chars"] ?? 0) +
    Number(fpObj0["commit_count"] ?? 0);
  if (totalSignal < 3) {
    return {
      topVendor: "unknown",
      confidence: 0,
      scores: {},
      reasoning: `low-signal guard (total signal ${totalSignal} < 3) — refusing to commit to a vendor on empty/garbage input`,
    };
  }

  const { scores, discrim } = scoreCalibrated(fp);
  if (Object.keys(scores).length === 0) {
    // Fallback to heuristic; tag the reasoning so callers know
    const fallback = heuristicClassify(fp);
    return { ...fallback, reasoning: `heuristic fallback (no seed corpus): ${fallback.reasoning}` };
  }
  const { topVendor, confidence } = softmaxTop(scores);
  const driving = discrim.slice(0, 3).join(", ");
  return {
    topVendor,
    confidence,
    scores,
    reasoning: `calibrated log-likelihood over ${discrim.length} discriminative features (top: ${driving}); top vendor ${topVendor} (conf ${confidence.toFixed(2)})`,
  };
}

/**
 * Run the calibrated classifier across the entire seed corpus and
 * return the accuracy (correct / total) + per-vendor breakdown.
 *
 * Used by:
 *   - tests/regression/v47_0-nemesis-production.test.ts
 *   - probe.nemesis.world_first (upgraded to assert ≥95% accuracy)
 *   - mneme nemesis calibration_status CLI
 */
export interface AccuracyReport {
  total: number;
  correct: number;
  accuracy: number;
  perVendor: Partial<Record<VendorId, { total: number; correct: number; accuracy: number }>>;
}

export function evaluateSeedAccuracy(): AccuracyReport {
  const entries = buildSeedCorpus();
  const perVendor: AccuracyReport["perVendor"] = {};
  let total = 0;
  let correct = 0;
  for (const e of entries) {
    const fp = extractFingerprint(e.fixture);
    const v = classifyAgentCalibrated(fp);
    const isCorrect = v.topVendor === e.vendor;
    total++;
    if (isCorrect) correct++;
    const pv = perVendor[e.vendor] ?? { total: 0, correct: 0, accuracy: 0 };
    pv.total++;
    if (isCorrect) pv.correct++;
    pv.accuracy = pv.correct / pv.total;
    perVendor[e.vendor] = pv;
  }
  return { total, correct, accuracy: total === 0 ? 0 : correct / total, perVendor };
}
