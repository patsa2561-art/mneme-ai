/**
 * v2.30.0 — Calibration scorer for HONEST MIRROR.
 *
 * Given the vendor's answer + the accepted answer (commit diff /
 * landed code), compute:
 *   - semanticSimilarity (0..1) — embedder cosine OR fallback to
 *     token-Jaccard when no embedder is available
 *   - measuredCorrectness — same as semanticSimilarity (rename for
 *     clarity in the report)
 *   - calibrationDelta = reportedConfidence - measuredCorrectness
 *
 * Plus a plain-English interpretation:
 *   "well-calibrated"   |delta| < 0.10
 *   "over-confident"    delta > 0.10
 *   "under-confident"   delta < -0.10
 */

import type { CalibrationDelta, VendorReplayResult, AcceptedAnswer } from "./types.js";

/** Tokenize for fallback Jaccard. Lower-cased, alpha-num + dash + dot. */
function tokenize(s: string): Set<string> {
  return new Set(
    s.toLowerCase().split(/[^a-z0-9.\-_]+/g).filter((t) => t.length >= 3),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

/**
 * Compute calibration delta for ONE vendor's reply vs the accepted
 * answer. Uses an embedder when available; falls back to token-Jaccard
 * so the calibrator works even without a fancy model.
 */
export async function computeDelta(
  artifactId: string,
  vendorReply: VendorReplayResult,
  accepted: AcceptedAnswer,
  opts: { embed?: (texts: string[]) => Promise<Float32Array[]> } = {},
): Promise<CalibrationDelta> {
  let semanticSimilarity = 0;
  if (opts.embed) {
    try {
      const vecs = await opts.embed([vendorReply.answer, accepted.text]);
      const a = vecs[0]!;
      const b = vecs[1]!;
      semanticSimilarity = cosine(a, b);
    } catch {
      semanticSimilarity = jaccard(tokenize(vendorReply.answer), tokenize(accepted.text));
    }
  } else {
    semanticSimilarity = jaccard(tokenize(vendorReply.answer), tokenize(accepted.text));
  }
  const measuredCorrectness = semanticSimilarity;
  const calibrationDelta = vendorReply.confidence - measuredCorrectness;
  let interpretation: string;
  if (Math.abs(calibrationDelta) < 0.10) {
    interpretation = `well-calibrated (Δ=${(calibrationDelta * 100).toFixed(0)}%)`;
  } else if (calibrationDelta > 0) {
    interpretation = `over-confident — said ${Math.round(vendorReply.confidence * 100)}% sure but answer matched only ${Math.round(measuredCorrectness * 100)}%`;
  } else {
    interpretation = `under-confident — said ${Math.round(vendorReply.confidence * 100)}% sure but answer matched ${Math.round(measuredCorrectness * 100)}%`;
  }
  return {
    vendor: vendorReply.vendor,
    artifactId,
    semanticSimilarity,
    reportedConfidence: vendorReply.confidence,
    measuredCorrectness,
    calibrationDelta,
    interpretation,
  };
}

function cosine(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y; na += x * x; nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : Math.max(-1, Math.min(1, dot / denom));
}

/**
 * From a list of CalibrationDelta for ONE vendor, derive an aggregate
 * weight in [0, 1] suitable for feeding back into CONCLAVE Aletheia
 * scoring. The rule:
 *   - start at 0.5 neutral
 *   - reward measured correctness: +0.5 × mean(correctness)
 *   - punish over-confidence: -0.3 × max(0, mean(delta))
 *   - clamp to [0.1, 0.95] (never drop a vendor below 0.1; never
 *     trust above 0.95 because the floor of calibration is statistical)
 */
export function suggestedWeight(deltas: CalibrationDelta[]): number {
  if (deltas.length === 0) return 0.5;
  const meanCorrect = deltas.reduce((s, d) => s + d.measuredCorrectness, 0) / deltas.length;
  const meanDelta = deltas.reduce((s, d) => s + d.calibrationDelta, 0) / deltas.length;
  const raw = 0.5 + 0.5 * meanCorrect - 0.3 * Math.max(0, meanDelta);
  return Math.max(0.1, Math.min(0.95, Number(raw.toFixed(3))));
}
