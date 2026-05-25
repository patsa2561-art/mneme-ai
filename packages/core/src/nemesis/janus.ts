/**
 * v2.53.0 — JANUS organ: cross-vendor cluster-boundary detector.
 *
 * The two-faced Roman god — looks at past + future simultaneously.
 *
 * Closes Eve's identity-swap blind spot from the Million Dollar Secret
 * simulation: MOLT (v2.52) detects INTRA-vendor drift (vendor X drifts
 * over time) but misses CROSS-vendor swaps (vendor X mid-session
 * starts behaving like vendor Y). The classifier might still pick Y as
 * the new winner, but neither MOLT nor verify_identity surfaces the
 * "you crossed a cluster boundary" event.
 *
 * Algorithm:
 *   1. Build cluster centroids from seed corpus (per vendor, per
 *      discriminative feature).
 *   2. For an observation O, compute distance d(O, centroid_V) for every
 *      known vendor V.
 *   3. Assign O to the nearest centroid → "current basin".
 *   4. Track per-session basin history. If basin changes between
 *      observations → cross-cluster transition event.
 *   5. Confidence: distance to old basin / distance to new basin (lower
 *      ratio = sharper swap).
 *
 * Different from MOLT because MOLT compares pre/post WINDOWS of the
 * SAME vendor's drift; JANUS detects the MOMENT a vendor's fingerprint
 * crosses into a DIFFERENT vendor's basin.
 *
 * Composes: extractFingerprint + seedStats.
 *
 * Pure deterministic + defensive; never throws.
 */

import { createHmac } from "node:crypto";
import { extractFingerprint } from "./features.js";
import { seedStats, type VendorStats } from "./calibration_corpus.js";
import type { Fingerprint, VendorId } from "./types.js";

const KEY_ENV = "MNEME_JANUS_KEY";
const DEFAULT_KEY = "mneme-janus-v1";

function keyOf(): string {
  return process.env[KEY_ENV] ?? DEFAULT_KEY;
}

export interface ClusterDistance {
  vendor: string;
  distance: number;
}

export interface JanusBasin {
  /** Nearest vendor centroid. */
  basin: string;
  /** Distance to nearest centroid. */
  basinDistance: number;
  /** Distance to SECOND-nearest centroid (margin signal). */
  secondNearest: ClusterDistance | null;
  /** Margin = secondNearest.distance - basinDistance. Larger = sharper assignment. */
  margin: number;
  /** All centroid distances, sorted ascending. */
  allDistances: ClusterDistance[];
}

export interface JanusObservation {
  fingerprint: Fingerprint;
  basin: JanusBasin;
}

export interface JanusTransition {
  fromBasin: string;
  toBasin: string;
  fromDistance: number;
  toDistance: number;
  /** Ratio of (distance to OLD basin from CURRENT obs) / (distance to NEW basin from CURRENT obs).
   *  > 1 means the obs is clearly closer to NEW than OLD → confident swap. */
  swapConfidence: number;
  /** Plain-English citation. */
  citation: string;
}

export interface JanusSessionResult {
  observations: JanusObservation[];
  transitions: JanusTransition[];
  /** Did at least one cross-cluster swap fire? */
  swapDetected: boolean;
  hmac: string;
}

/** Euclidean distance between fingerprint and a vendor's per-feature means. */
function distanceToCentroid(fp: Fingerprint, stats: VendorStats): number {
  let sumSq = 0;
  let count = 0;
  for (const k of Object.keys(stats.features)) {
    const v = (fp as unknown as Record<string, number>)[k];
    if (typeof v !== "number" || !Number.isFinite(v)) continue;
    const m = stats.features[k]!.mean;
    const stdev = Math.max(stats.features[k]!.stdev, Math.abs(m) * 0.1, 1e-3);
    // Normalized squared distance per feature
    const z = (v - m) / stdev;
    sumSq += z * z;
    count++;
  }
  if (count === 0) return Number.POSITIVE_INFINITY;
  return Math.sqrt(sumSq / count);
}

/**
 * Locate which vendor cluster an observation belongs to.
 * Defensive: empty stats → returns basin="unknown" with infinity distance.
 */
export function locateBasin(fingerprint: Fingerprint): JanusBasin {
  let stats: Map<VendorId, VendorStats>;
  try {
    stats = seedStats();
  } catch {
    return { basin: "unknown", basinDistance: Number.POSITIVE_INFINITY, secondNearest: null, margin: 0, allDistances: [] };
  }
  const distances: ClusterDistance[] = [];
  for (const [vendor, s] of stats) {
    distances.push({ vendor, distance: distanceToCentroid(fingerprint, s) });
  }
  distances.sort((a, b) => a.distance - b.distance);
  if (distances.length === 0) {
    return { basin: "unknown", basinDistance: Number.POSITIVE_INFINITY, secondNearest: null, margin: 0, allDistances: [] };
  }
  const nearest = distances[0]!;
  const second = distances[1] ?? null;
  const margin = second ? second.distance - nearest.distance : 0;
  return {
    basin: nearest.vendor,
    basinDistance: nearest.distance,
    secondNearest: second,
    margin,
    allDistances: distances,
  };
}

/**
 * Observe a fixture; return {fingerprint, basin}.
 */
export function observe(fixture: { diff: string; prDescription: string; commitMessages: string[] } | Fingerprint): JanusObservation {
  const fp = "multiline_commit_ratio" in (fixture as object)
    ? (fixture as Fingerprint)
    : extractFingerprint(fixture as { diff: string; prDescription: string; commitMessages: string[] });
  const basin = locateBasin(fp);
  return { fingerprint: fp, basin };
}

/**
 * Walk a sequence of observations from the SAME session; surface
 * cross-cluster transitions + an HMAC-signed verdict.
 */
export function detectIdentitySwap(
  observations: JanusObservation[],
  opts: { minMargin?: number } = {},
): JanusSessionResult {
  const minMargin = opts.minMargin ?? 0.5;
  const transitions: JanusTransition[] = [];
  if (!Array.isArray(observations) || observations.length < 2) {
    return signed({ observations: observations ?? [], transitions: [], swapDetected: false });
  }
  let prev = observations[0]!;
  for (let i = 1; i < observations.length; i++) {
    const cur = observations[i]!;
    if (prev.basin.basin === cur.basin.basin) {
      prev = cur;
      continue;
    }
    // Only surface as a real swap when the new basin is clearly nearer.
    if (cur.basin.margin < minMargin) {
      prev = cur;
      continue;
    }
    // Distance from CURRENT obs to PREVIOUS basin vs current basin
    const prevBasinDistInCur = cur.basin.allDistances.find((d) => d.vendor === prev.basin.basin);
    if (!prevBasinDistInCur || !Number.isFinite(prevBasinDistInCur.distance)) {
      prev = cur;
      continue;
    }
    const swapConfidence = prevBasinDistInCur.distance / Math.max(cur.basin.basinDistance, 1e-6);
    transitions.push({
      fromBasin: prev.basin.basin,
      toBasin: cur.basin.basin,
      fromDistance: prevBasinDistInCur.distance,
      toDistance: cur.basin.basinDistance,
      swapConfidence,
      citation: `JANUS: identity swap detected — fingerprint crossed from ${prev.basin.basin} basin to ${cur.basin.basin} basin (swap confidence ${swapConfidence.toFixed(2)}x).`,
    });
    prev = cur;
  }
  return signed({ observations, transitions, swapDetected: transitions.length > 0 });
}

function signed(body: Omit<JanusSessionResult, "hmac">): JanusSessionResult {
  const hmac = createHmac("sha256", keyOf()).update(JSON.stringify({
    transitions: body.transitions,
    swapDetected: body.swapDetected,
    obsCount: body.observations.length,
  })).digest("hex");
  return { ...body, hmac };
}

/** Verify a session-result's HMAC. */
export function verifyJanusResult(r: JanusSessionResult): boolean {
  if (!r || typeof r.hmac !== "string") return false;
  const expected = createHmac("sha256", keyOf()).update(JSON.stringify({
    transitions: r.transitions,
    swapDetected: r.swapDetected,
    obsCount: r.observations.length,
  })).digest("hex");
  return expected === r.hmac;
}
