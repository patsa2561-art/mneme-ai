/**
 * v2.61.0 — PASSPORT trust score.
 *
 * Fuses multiple signals into a single 0..1 trust score for an agent
 * requesting capability. Composable on existing Mneme primitives —
 * doesn't duplicate logic.
 *
 * Signals (weighted):
 *  - NEMESIS env-scan confidence (agent vendor known with high confidence?)
 *  - NEMESIS verify_identity verdict (claimed vs detected)
 *  - HONEST_MIRROR weight per vendor (calibrated from past performance)
 *  - STEALTH score INVERTED (stealthy agents = harder to attribute = lower trust)
 *  - Past PASSPORT request approval rate (behavior history)
 *
 * Each signal is optional; missing signals contribute neutral 0.5.
 * Output: { score, reason, signals } — score is HMAC-friendly determinism.
 */

export interface TrustInputs {
  /** NEMESIS env-scan confidence 0..1 (how sure are we of the vendor identity). */
  envScanConfidence?: number;
  /** NEMESIS verify_identity verdict if available. */
  identityVerdict?: "CONFIRMED" | "DISPUTED" | "IMPOSSIBLE" | "INCONCLUSIVE";
  /** HONEST_MIRROR per-vendor weight 0..1 (calibrated honesty). */
  honestMirrorWeight?: number;
  /** STEALTH score 0..1 (1 = perfectly anonymous; lower trust for sensitive ops). */
  stealthScore?: number;
  /** Past PASSPORT approval rate 0..1 (count approved / total requested). */
  historicalApprovalRate?: number;
  /** Per-capability-class score (e.g. write_fs has been used successfully 50× without incident). */
  perCapabilityScore?: number;
}

export interface TrustResult {
  /** Final fused score 0..1. */
  score: number;
  /** Plain-English explanation. */
  reason: string;
  /** Per-signal breakdown (transparency for audit). */
  signals: Array<{ name: string; value: number; weight: number; contribution: number }>;
}

// Verdict → numeric value
const VERDICT_VALUE: Record<NonNullable<TrustInputs["identityVerdict"]>, number> = {
  CONFIRMED: 1.0,
  DISPUTED: 0.3,
  IMPOSSIBLE: 0.0,
  INCONCLUSIVE: 0.5,
};

// Weights (sum to 1.0 across present signals).
const WEIGHTS = {
  envScanConfidence: 0.20,
  identityVerdict: 0.25,
  honestMirrorWeight: 0.25,
  stealthScoreInverted: 0.10,
  historicalApprovalRate: 0.10,
  perCapabilityScore: 0.10,
};

function clamp(x: number): number { return Math.max(0, Math.min(1, x)); }

export function computeTrust(inputs: TrustInputs): TrustResult {
  const signals: TrustResult["signals"] = [];
  let totalWeight = 0;
  let weightedSum = 0;

  const add = (name: string, valueOpt: number | undefined, weight: number, neutral = 0.5) => {
    const v = typeof valueOpt === "number" && Number.isFinite(valueOpt) ? clamp(valueOpt) : neutral;
    const present = typeof valueOpt === "number" && Number.isFinite(valueOpt);
    if (present) {
      signals.push({ name, value: v, weight, contribution: +(v * weight).toFixed(4) });
      totalWeight += weight;
      weightedSum += v * weight;
    } else {
      signals.push({ name, value: v, weight: 0, contribution: 0 });
    }
  };

  add("envScanConfidence", inputs.envScanConfidence, WEIGHTS.envScanConfidence);
  add("identityVerdict",
    inputs.identityVerdict ? VERDICT_VALUE[inputs.identityVerdict] : undefined,
    WEIGHTS.identityVerdict);
  add("honestMirrorWeight", inputs.honestMirrorWeight, WEIGHTS.honestMirrorWeight);
  add("stealthScoreInverted",
    typeof inputs.stealthScore === "number" ? 1 - clamp(inputs.stealthScore) : undefined,
    WEIGHTS.stealthScoreInverted);
  add("historicalApprovalRate", inputs.historicalApprovalRate, WEIGHTS.historicalApprovalRate);
  add("perCapabilityScore", inputs.perCapabilityScore, WEIGHTS.perCapabilityScore);

  const score = totalWeight > 0 ? +(weightedSum / totalWeight).toFixed(4) : 0.5;
  const presentCount = signals.filter((s) => s.weight > 0).length;
  const reason = presentCount === 0
    ? "no trust signals provided — defaulting to neutral 0.5"
    : `fused ${presentCount}/${signals.length} signals → score ${(score * 100).toFixed(0)}%`;

  return { score, reason, signals };
}
