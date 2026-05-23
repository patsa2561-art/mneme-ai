/**
 * v2.29.0 — Byzantine fault-tolerant aggregator for CONCLAVE.
 *
 * Two operating modes:
 *   threshold (default): weighted-vote ratio ≥ `threshold` → CONSENSUS
 *   bft-strict          : enforces f < n/3 dissenters (PBFT lemma).
 *                         With 5 vendors: requires at LEAST 4 vendors
 *                         to agree (only 1 dissenter tolerated). With
 *                         3 vendors: requires unanimity.
 *
 * Weight source: per-vendor Aletheia trust score (0..1). Vendors with
 * higher historical truthfulness count for more.
 *
 * The aggregator is PURE (no IO) so the orchestrator can call it
 * deterministically + tests can pin it.
 */

import type { VendorStance, VendorAggregate, ConsensusOutcome } from "./types.js";

export interface BftConfig {
  threshold: number;       // 0..1, e.g. 0.66
  bftStrict: boolean;      // if true, require f < n/3 dissenters
}

export interface BftResult {
  outcome: ConsensusOutcome;
  winningStance?: VendorStance;
  weightedTallies: Record<VendorStance, number>;
  /** Fraction of total weight backing the winning stance. */
  winningFraction: number;
  /** Vendors flagged by AEAE (awareness < 0.7) are listed for the caller. */
  awarenessFlags: Array<{ vendor: string; score: number; reason: string }>;
  dissentBreakdown?: Array<{ stance: VendorStance; vendors: string[]; weight: number }>;
}

const STANCES: VendorStance[] = ["supports", "refutes", "uncertain", "refuses"];

/**
 * Aggregate per-vendor verdicts into a single Byzantine consensus
 * result. Vendors with awareness flags STILL count toward the vote
 * (we don't silently drop them); the caller decides whether to surface
 * the awareness flag in the final report.
 */
export function aggregate(
  perVendor: VendorAggregate[],
  config: BftConfig,
): BftResult {
  if (perVendor.length === 0) {
    return {
      outcome: "INSUFFICIENT_RESPONDERS",
      weightedTallies: { supports: 0, refutes: 0, uncertain: 0, refuses: 0 },
      winningFraction: 0,
      awarenessFlags: [],
    };
  }

  // Tally weighted votes by stance.
  const tallies: Record<VendorStance, number> = { supports: 0, refutes: 0, uncertain: 0, refuses: 0 };
  let totalWeight = 0;
  for (const v of perVendor) {
    tallies[v.dominantStance] += v.weight;
    totalWeight += v.weight;
  }
  // Normalise (defensive against zero-weight vendors).
  if (totalWeight <= 0) {
    return {
      outcome: "INSUFFICIENT_RESPONDERS",
      weightedTallies: tallies,
      winningFraction: 0,
      awarenessFlags: [],
    };
  }

  // Find the stance with the highest weight.
  let winning: VendorStance = "uncertain";
  let winningW = 0;
  for (const s of STANCES) {
    if (tallies[s] > winningW) { winning = s; winningW = tallies[s]; }
  }
  const winningFraction = winningW / totalWeight;

  // Awareness flags (carry forward, never block voting).
  const awarenessFlags = perVendor
    .filter((v) => v.awarenessScore < 0.7)
    .map((v) => {
      // Reason is per-vendor (set by orchestrator); we re-derive a short hint here.
      const reason = v.awarenessScore < 0.4 ? "high awareness — possible eval-mode switch" : "moderate awareness — variants disagreed";
      return { vendor: v.vendor, score: v.awarenessScore, reason };
    });

  // Decide outcome.
  // 1. BFT-strict: dissenter weight must be < n/3 of total (the classic
  //    PBFT safety threshold). Surface as DISSENT otherwise.
  if (config.bftStrict) {
    const dissenters = totalWeight - winningW;
    if (dissenters >= totalWeight / 3) {
      return {
        outcome: "DISSENT",
        weightedTallies: tallies,
        winningFraction,
        awarenessFlags,
        dissentBreakdown: breakdown(perVendor),
      };
    }
  }

  // 2. Threshold mode: winning fraction must clear `threshold`.
  if (winningFraction < config.threshold) {
    return {
      outcome: "DISSENT",
      weightedTallies: tallies,
      winningFraction,
      awarenessFlags,
      dissentBreakdown: breakdown(perVendor),
    };
  }

  // 3. AWARENESS_DETECTED — when ≥ half the vendors are awareness-flagged
  //    even though they agreed on a stance, surface it. This is the user
  //    needs to know that the consensus might be theater.
  if (awarenessFlags.length >= Math.ceil(perVendor.length / 2)) {
    return {
      outcome: "AWARENESS_DETECTED",
      winningStance: winning,
      weightedTallies: tallies,
      winningFraction,
      awarenessFlags,
    };
  }

  return {
    outcome: "CONSENSUS",
    winningStance: winning,
    weightedTallies: tallies,
    winningFraction,
    awarenessFlags,
  };
}

function breakdown(perVendor: VendorAggregate[]): Array<{ stance: VendorStance; vendors: string[]; weight: number }> {
  const groups = new Map<VendorStance, { vendors: string[]; weight: number }>();
  for (const v of perVendor) {
    const g = groups.get(v.dominantStance) ?? { vendors: [], weight: 0 };
    g.vendors.push(v.vendor);
    g.weight += v.weight;
    groups.set(v.dominantStance, g);
  }
  return [...groups.entries()].map(([stance, g]) => ({ stance, vendors: g.vendors, weight: g.weight }));
}
