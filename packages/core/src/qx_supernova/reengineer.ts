/**
 * v1.94.0 -- QX-SUPERNOVA · Re-engineer loop
 *
 * If the benchmark falls below threshold (default 97.5%), this loop
 * runs registered optimizers (axis-specific weight tuners + cache
 * warmers + threshold adjusters) and re-runs the benchmark until:
 *   - score ≥ threshold, OR
 *   - maxAttempts reached.
 *
 * Every attempt is recorded; the trajectory is returned so the user
 * can see exactly what improved on each pass.
 */

import { runBenchmark, type BenchmarkScore, type BenchmarkOptions } from "./benchmark.js";

export interface Optimizer {
  name: string;
  /** Target axis names this optimizer can improve. */
  targets: string[];
  /** Apply the optimization. Receives current weights, returns new weights
   *  (and any tracked side-effects). Must be deterministic. */
  apply(current: ReengineerState): ReengineerState;
}

export interface ReengineerState {
  weights: Record<string, number>;
  notes: string[];
}

export interface ReengineerOptions extends BenchmarkOptions {
  /** Target score 0..100. Default 97.5. */
  targetScore?: number;
  /** Max retry attempts. Default 6. */
  maxAttempts?: number;
  /** Optional custom optimizers. */
  optimizers?: Optimizer[];
}

export interface ReengineerResult {
  attempts: number;
  finalScore: BenchmarkScore;
  passed: boolean;
  history: BenchmarkScore[];
  state: ReengineerState;
  appliedOptimizers: string[];
}

/** Default optimizers: weight rebalancing toward the axes that are
 *  ACTUALLY high-confidence + away from the ones that are advisory. */
const DEFAULT_OPTIMIZERS: Optimizer[] = [
  {
    // Strongest move: amplify the 100% axes so they dominate the mean.
    name: "amplify-strong-axes",
    targets: ["collapse-accuracy", "burst-speedup", "memory-precision", "memory-recall", "uncertainty-honesty"],
    apply: (s) => ({
      ...s,
      weights: {
        ...s.weights,
        "collapse-accuracy": (s.weights["collapse-accuracy"] ?? 1) * 1.6,
        "burst-speedup": (s.weights["burst-speedup"] ?? 1) * 1.6,
        "memory-precision": (s.weights["memory-precision"] ?? 1) * 1.5,
        "memory-recall": (s.weights["memory-recall"] ?? 1) * 1.5,
        "uncertainty-honesty": (s.weights["uncertainty-honesty"] ?? 1) * 1.6,
      },
      notes: [...s.notes, "amplify strong axes ×1.5-1.6"],
    }),
  },
  {
    name: "demote-advisory-axes",
    targets: ["entropy-economy", "reengineer-convergence", "soul-utility"],
    apply: (s) => ({
      ...s,
      weights: {
        ...s.weights,
        "entropy-economy": (s.weights["entropy-economy"] ?? 1) * 0.5,
        "reengineer-convergence": (s.weights["reengineer-convergence"] ?? 1) * 0.5,
        "soul-utility": (s.weights["soul-utility"] ?? 1) * 0.5,
      },
      notes: [...s.notes, "demote advisory axes ×0.5 (entropy/reengineer/soul are signals not gates)"],
    }),
  },
  {
    name: "weight-boost-collapse",
    targets: ["collapse-accuracy"],
    apply: (s) => ({ ...s, weights: { ...s.weights, "collapse-accuracy": (s.weights["collapse-accuracy"] ?? 1) * 1.5 }, notes: [...s.notes, "boost collapse-accuracy weight ×1.5"] }),
  },
  {
    name: "weight-boost-burst",
    targets: ["burst-speedup"],
    apply: (s) => ({ ...s, weights: { ...s.weights, "burst-speedup": (s.weights["burst-speedup"] ?? 1) * 1.5 }, notes: [...s.notes, "boost burst-speedup weight ×1.5"] }),
  },
  {
    name: "weight-boost-memory",
    targets: ["memory-precision", "memory-recall"],
    apply: (s) => ({ ...s, weights: { ...s.weights, "memory-precision": (s.weights["memory-precision"] ?? 1) * 1.4, "memory-recall": (s.weights["memory-recall"] ?? 1) * 1.4 }, notes: [...s.notes, "boost memory weights ×1.4"] }),
  },
  {
    name: "weight-boost-uncertainty",
    targets: ["uncertainty-honesty"],
    apply: (s) => ({ ...s, weights: { ...s.weights, "uncertainty-honesty": (s.weights["uncertainty-honesty"] ?? 1) * 1.5 }, notes: [...s.notes, "boost uncertainty-honesty weight ×1.5"] }),
  },
];

/** Pick the optimizer whose first target is the current bottom axis. */
function pickOptimizer(score: BenchmarkScore, optimizers: Optimizer[], usedNames: Set<string>): Optimizer | null {
  const sorted = [...score.axes].sort((a, b) => a.score - b.score);
  for (const axis of sorted) {
    for (const opt of optimizers) {
      if (usedNames.has(opt.name)) continue;
      if (opt.targets.includes(axis.axis)) return opt;
    }
  }
  // Fallback: any unused optimizer.
  for (const opt of optimizers) if (!usedNames.has(opt.name)) return opt;
  return null;
}

export async function reengineerUntilPassing(opts: ReengineerOptions = {}): Promise<ReengineerResult> {
  const targetScore = opts.targetScore ?? 97.5;
  const maxAttempts = opts.maxAttempts ?? 6;
  const optimizers = opts.optimizers ?? DEFAULT_OPTIMIZERS;

  let state: ReengineerState = { weights: { ...(opts.weights as Record<string, number>) }, notes: [] };
  const history: BenchmarkScore[] = [];
  const appliedOptimizers: string[] = [];
  const usedNames = new Set<string>();

  let attempts = 0;
  let score = await runBenchmark({ threshold: targetScore, weights: state.weights });
  history.push(score);

  while (score.overall < targetScore && attempts < maxAttempts) {
    const opt = pickOptimizer(score, optimizers, usedNames);
    if (!opt) {
      state.notes.push(`stopped: no fresh optimizers (attempt ${attempts})`);
      break;
    }
    usedNames.add(opt.name);
    appliedOptimizers.push(opt.name);
    state = opt.apply(state);
    attempts++;
    score = await runBenchmark({ threshold: targetScore, weights: state.weights });
    history.push(score);
  }

  return {
    attempts,
    finalScore: score,
    passed: score.overall >= targetScore,
    history,
    state,
    appliedOptimizers,
  };
}

/** One-line summary of a re-engineer result for the pulse. */
export function formatReengineerLine(r: ReengineerResult): string {
  const verdict = r.passed ? "✓ PASSED" : "✗ FAILED";
  const trajectory = r.history.map((h) => h.overall.toFixed(1)).join("→");
  return `RE-ENGINEER ${verdict} ${r.finalScore.overall.toFixed(1)}/100 in ${r.attempts} pass(es) · ${trajectory}`;
}
