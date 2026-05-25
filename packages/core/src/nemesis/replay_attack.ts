/**
 * v2.46.0 — NEMESIS ORGAN 5: REPLAY ATTACK DETECTOR.
 *
 * Same vendor claimed; same/similar prompt fired twice; fingerprints
 * diverge significantly → vendor likely swapped models silently
 * ("stealth-upgrade" or "stealth-downgrade").
 *
 * Pure deterministic; takes two Fingerprint records + returns a flag.
 *
 * Heuristic: Euclidean distance over a curated set of high-discriminator
 * features. Threshold > 1.0 = stealth swap. Direction is decided by the
 * sign of conditional_density delta (Claude-like up → "upgrade"; down →
 * "downgrade"). Generic vendors return "stealth-swap".
 */

const DISCRIMINATORS = [
  "conditional_density",
  "multiline_commit_ratio",
  "bullet_point_count",
  "hyperlink_count",
  "distributed_changes_score",
  "pr_desc_length_chars",
  "change_concentration",
  "mean_line_length",
];

export interface ReplayResult {
  vendor: string;
  alert: boolean;
  /** Euclidean distance across discriminator features. */
  distance: number;
  /** "stealth-upgrade" / "stealth-downgrade" / "stealth-swap". */
  kind: string;
  reasoning: string;
}

function safeNumber(fp: Record<string, number> | undefined, k: string): number {
  if (!fp) return 0;
  const v = fp[k];
  return Number.isFinite(v) ? (v as number) : 0;
}

export function detectReplayAttack(
  vendor: string,
  fpA: Record<string, number>,
  fpB: Record<string, number>,
  opts: { threshold?: number } = {},
): ReplayResult {
  const threshold = opts.threshold ?? 0.6;
  let sumSq = 0;
  for (const k of DISCRIMINATORS) {
    const a = safeNumber(fpA, k);
    const b = safeNumber(fpB, k);
    sumSq += (a - b) ** 2;
  }
  const distance = Math.sqrt(sumSq);
  const alert = distance >= threshold;
  let kind = "stable";
  let reasoning = "within expected variance";
  if (alert) {
    const deltaConditional = safeNumber(fpB, "conditional_density") - safeNumber(fpA, "conditional_density");
    if (deltaConditional > 0.20) {
      kind = "stealth-upgrade";
      reasoning = `${vendor} conditional density grew from ${safeNumber(fpA, "conditional_density").toFixed(2)} → ${safeNumber(fpB, "conditional_density").toFixed(2)} (model likely smarter)`;
    } else if (deltaConditional < -0.20) {
      kind = "stealth-downgrade";
      reasoning = `${vendor} conditional density dropped from ${safeNumber(fpA, "conditional_density").toFixed(2)} → ${safeNumber(fpB, "conditional_density").toFixed(2)} (model likely smaller)`;
    } else {
      kind = "stealth-swap";
      reasoning = `${vendor} fingerprint shifted by distance ${distance.toFixed(2)} across ${DISCRIMINATORS.length} features (model likely swapped)`;
    }
  }
  return { vendor, alert, distance, kind, reasoning };
}
