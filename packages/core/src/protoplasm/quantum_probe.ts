/**
 * 🦠 PROTOPLASM — quantum_probe
 *
 * Statistical + quantum-inspired probe over recorded InvocationSnapshots.
 *
 * The "quantum-inspired" part is analogical, not literal QM:
 *   - outputEntropy: Shannon entropy of output shapes → high = decoherence
 *   - chaosDivergence: spread of output given structured input perturbation
 *   - collapseStability: proportion of calls that resolve cleanly (no throw)
 *   - neighborCorrelation: did this function break in same window as neighbors?
 *
 * Why quantum-inspired metaphor: standard means/stdev miss multi-modal
 * behavior. A function returning {success, fallback, throw} states needs
 * a distributional signal, not just a central tendency.
 */

import type {
  InvocationSnapshot,
  FunctionBaseline,
  QuantumSignals,
  SuperQuanFinding,
  ProtoplasmConfig,
  ProbeOutcome,
} from "./types.js";

/** Shannon entropy over a histogram (normalized to 1). */
function shannonEntropy(counts: Map<string, number>): number {
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  if (total === 0) return 0;
  let h = 0;
  for (const c of counts.values()) {
    if (c === 0) continue;
    const p = c / total;
    h -= p * Math.log2(p);
  }
  return h;
}

function shapeHistogram(snapshots: InvocationSnapshot[], key: "argShape" | "outputShape"): Map<string, number> {
  const h = new Map<string, number>();
  for (const s of snapshots) {
    const k = key === "argShape" ? s.args.shape : (s.output.shape ?? `throw:${s.output.errorClass}`);
    h.set(k, (h.get(k) ?? 0) + 1);
  }
  return h;
}

export function buildBaseline(fnId: string, snapshots: InvocationSnapshot[]): FunctionBaseline {
  if (snapshots.length === 0) {
    return { fnId, samples: 0, durationMean: 0, durationStdev: 0, errorRate: 0, argShapeEntropy: 0, outputShapeEntropy: 0, lastUpdate: new Date().toISOString() };
  }
  const durations = snapshots.map((s) => s.durationMs);
  const mean = durations.reduce((a, b) => a + b, 0) / durations.length;
  const variance = durations.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, durations.length - 1);
  const errorRate = snapshots.filter((s) => s.output.kind === "throw").length / snapshots.length;
  const argEntropy = shannonEntropy(shapeHistogram(snapshots, "argShape"));
  const outEntropy = shannonEntropy(shapeHistogram(snapshots, "outputShape"));
  return {
    fnId,
    samples: snapshots.length,
    durationMean: mean,
    durationStdev: Math.sqrt(variance),
    errorRate,
    argShapeEntropy: argEntropy,
    outputShapeEntropy: outEntropy,
    lastUpdate: new Date().toISOString(),
  };
}

function zScore(value: number, mean: number, stdev: number): number {
  if (stdev < 1e-9) return Math.abs(value - mean) < 1e-9 ? 0 : Number.POSITIVE_INFINITY;
  return (value - mean) / stdev;
}

export function computeQuantumSignals(recent: InvocationSnapshot[], baseline: FunctionBaseline, neighborBrokenRate: number): QuantumSignals {
  const outputEntropy = shannonEntropy(shapeHistogram(recent, "outputShape"));
  const throwCount = recent.filter((s) => s.output.kind === "throw").length;
  const collapseStability = recent.length === 0 ? 1 : 1 - throwCount / recent.length;

  // chaosDivergence: stdev of durations among non-throw calls / baseline.stdev
  const okDurations = recent.filter((s) => s.output.kind === "ok").map((s) => s.durationMs);
  let chaos = 0;
  if (okDurations.length >= 2) {
    const m = okDurations.reduce((a, b) => a + b, 0) / okDurations.length;
    const v = okDurations.reduce((a, b) => a + (b - m) ** 2, 0) / (okDurations.length - 1);
    const recentStdev = Math.sqrt(v);
    chaos = baseline.durationStdev < 1e-9 ? recentStdev : recentStdev / baseline.durationStdev;
  }

  return {
    outputEntropy,
    chaosDivergence: chaos,
    neighborCorrelation: neighborBrokenRate,
    collapseStability,
  };
}

export function gradeOutcome(zScores: Record<string, number>, quantum: QuantumSignals, cfg: ProtoplasmConfig): ProbeOutcome {
  const maxZ = Math.max(...Object.values(zScores).map((z) => Math.abs(z)));
  if (maxZ > cfg.zScoreBroken) return "broken";
  if (maxZ > cfg.zScoreWarn) return "warn";
  if (quantum.collapseStability < 0.7) return "broken";
  if (quantum.outputEntropy > 4 && quantum.collapseStability < 0.85) return "warn";
  if (quantum.neighborCorrelation > 0.5 && maxZ > 1.5) return "warn";
  return "healthy";
}

export function runQuantumProbe(
  fnId: string,
  recent: InvocationSnapshot[],
  baseline: FunctionBaseline,
  cfg: ProtoplasmConfig,
  neighborBrokenRate = 0,
): Omit<SuperQuanFinding, "hmac" | "prev"> {
  if (recent.length === 0) {
    return {
      fnId, at: new Date().toISOString(), outcome: "healthy",
      zScores: {}, quantumSignals: { outputEntropy: 0, chaosDivergence: 0, neighborCorrelation: 0, collapseStability: 1 },
      rootCauseHints: [], evidence: "no recent invocations to probe",
    };
  }
  const recentDur = recent.map((s) => s.durationMs);
  const recentMean = recentDur.reduce((a, b) => a + b, 0) / recentDur.length;
  const recentErrorRate = recent.filter((s) => s.output.kind === "throw").length / recent.length;

  const zScores = {
    duration: zScore(recentMean, baseline.durationMean, baseline.durationStdev),
    errorRate: baseline.errorRate < 1e-9 && recentErrorRate > 0 ? Number.POSITIVE_INFINITY : (recentErrorRate - baseline.errorRate) / Math.max(0.01, baseline.errorRate),
  };
  const quantum = computeQuantumSignals(recent, baseline, neighborBrokenRate);
  const outcome = gradeOutcome(zScores, quantum, cfg);
  const evidence = `${recent.length} recent calls · meanDur ${recentMean.toFixed(1)}ms (z=${zScores.duration.toFixed(2)}) · errRate ${(recentErrorRate * 100).toFixed(1)}% · entropy ${quantum.outputEntropy.toFixed(2)} · stability ${(quantum.collapseStability * 100).toFixed(0)}%`;
  return { fnId, at: new Date().toISOString(), outcome, zScores, quantumSignals: quantum, rootCauseHints: [], evidence };
}
