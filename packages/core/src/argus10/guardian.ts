/**
 * v2.40.0 — ARGUS-10 GUARDIAN: graceful degradation.
 *
 * When an eye returns CLOSED (no embedder, no .mneme/, no metadata),
 * its weight drops to zero. The remaining eye weights are softmax-
 * rebalanced so the bundle always sums to 1.
 *
 * This implements the Greek-myth property: "if one of Argus's eyes
 * sleeps, the rest stay open" — no blind spot, no silent fallback to
 * a worse answer.
 */

import type { Eye, EyeHealth, EyeId } from "./types.js";

export interface RebalancedEyes {
  /** Eyes whose probe() returned OPEN. */
  liveEyes: Eye[];
  /** IDs of eyes that came back CLOSED. */
  closedIds: EyeId[];
  /** New per-eye weight after softmax-rebalance. Maps liveEye.id → weight. */
  newWeights: Map<EyeId, number>;
}

/**
 * Softmax-rebalance live eye weights so they sum to 1, preserving the
 * RELATIVE weight ordering from the original bundle.
 *
 * We use a temperature τ = 1 (i.e. ordinary softmax) over the eye's
 * original weight as the logit. With τ=1 the largest original weights
 * receive proportionally more boost, but no eye gets infinite mass.
 *
 * Edge cases:
 *   - 0 live eyes  → empty map (engine returns score=0 with all-closed note)
 *   - 1 live eye   → that eye gets weight 1
 *   - duplicate weights → tied softmax mass
 */
export function rebalanceEyeWeights(eyes: Eye[], probeOverride?: Map<EyeId, EyeHealth>): RebalancedEyes {
  const liveEyes: Eye[] = [];
  const closedIds: EyeId[] = [];
  for (const e of eyes) {
    const h = probeOverride?.get(e.id) ?? e.probe();
    if (h === "OPEN" || h === "DEGRADED") liveEyes.push(e);
    else closedIds.push(e.id);
  }
  const newWeights = new Map<EyeId, number>();
  if (liveEyes.length === 0) return { liveEyes, closedIds, newWeights };
  if (liveEyes.length === 1) {
    newWeights.set(liveEyes[0]!.id, 1);
    return { liveEyes, closedIds, newWeights };
  }
  // Softmax over original weights (× scale 10 for sharper temperature).
  const scale = 10;
  const exps = liveEyes.map((e) => Math.exp(e.weight * scale));
  const sum = exps.reduce((a, b) => a + b, 0);
  for (let i = 0; i < liveEyes.length; i++) {
    newWeights.set(liveEyes[i]!.id, exps[i]! / sum);
  }
  return { liveEyes, closedIds, newWeights };
}
