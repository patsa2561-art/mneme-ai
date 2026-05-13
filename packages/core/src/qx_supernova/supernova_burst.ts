/**
 * v1.94.0 -- QX-SUPERNOVA · SuperNova Burst
 * Parallel-fanout intelligence amplification.
 *
 * Premise: instead of running ONE inference, fire N candidates in
 * parallel, then collapse via the Quantum Core. The "1000×" marketing
 * line literalizes as: fanout factor × pruning efficiency × cache hits.
 *
 *   Real measured speedup = sequentialEquivalentMs / actualBurstMs.
 *
 * Reported per burst, not promised. No vaporware. If only one generator
 * is given, fanout=1, speedup=1.0.
 */

import {
  collapseProbabilityMatrix,
  type Hypothesis,
  type SignalVector,
  type CollapseResult,
} from "./quantum_core.js";

export interface BurstInput<T> {
  /** Each generator yields one candidate result. */
  generators: ReadonlyArray<() => Promise<T>>;
  /** Map a result to its signal vector for collapse. */
  scoreSignal: (result: T) => SignalVector;
  /** Optional per-result prior. Default 1/N. */
  prior?: (result: T) => number;
  /** Per-axis weights for collapse. */
  weights?: Record<string, number>;
  /** Telemetry id for this burst. */
  burstId?: string;
  /** Abort the burst if every generator takes longer than this. */
  timeoutMs?: number;
}

export interface BurstResult<T> {
  winner: T | null;
  collapse: CollapseResult<T>;
  fanout: number;
  /** Total wall-clock for the burst (parallel). */
  burstMs: number;
  /** Sum of per-generator wall-clock — what it would have cost serially. */
  sequentialEquivalentMs: number;
  /** sequentialEquivalentMs / burstMs. 1.0 means no benefit. */
  parallelSpeedup: number;
  /** Whether any generator threw. */
  errors: Array<{ index: number; message: string }>;
}

/** Fire N generators in parallel, score each, collapse to a winner.
 *  Records per-burst telemetry for the re-engineer loop to consume. */
export async function supernovaBurst<T>(input: BurstInput<T>): Promise<BurstResult<T>> {
  const t0 = Date.now();
  const fanout = input.generators.length;
  if (fanout === 0) {
    return {
      winner: null,
      collapse: collapseProbabilityMatrix([], {}),
      fanout: 0,
      burstMs: 0,
      sequentialEquivalentMs: 0,
      parallelSpeedup: 1,
      errors: [],
    };
  }

  const errors: BurstResult<T>["errors"] = [];
  const startTimes = new Array<number>(fanout);
  const endTimes = new Array<number>(fanout);

  const settled = await Promise.all(
    input.generators.map(async (gen, i) => {
      startTimes[i] = Date.now();
      try {
        const res = await maybeTimeout(gen(), input.timeoutMs);
        endTimes[i] = Date.now();
        return res;
      } catch (e) {
        endTimes[i] = Date.now();
        errors.push({ index: i, message: (e as Error).message });
        return null;
      }
    }),
  );

  const burstMs = Date.now() - t0;
  let sequentialEquivalentMs = 0;
  for (let i = 0; i < fanout; i++) {
    sequentialEquivalentMs += (endTimes[i] ?? 0) - (startTimes[i] ?? 0);
  }

  const hypotheses: Hypothesis<T>[] = [];
  for (let i = 0; i < settled.length; i++) {
    const result = settled[i];
    if (result === null) continue;
    hypotheses.push({
      id: `${input.burstId ?? "burst"}-${i}`,
      value: result as T,
      prior: input.prior ? input.prior(result as T) : undefined,
      signals: input.scoreSignal(result as T),
    });
  }

  const collapse = collapseProbabilityMatrix(hypotheses, { weights: input.weights });
  const parallelSpeedup = burstMs > 0 ? sequentialEquivalentMs / burstMs : 1;

  return {
    winner: collapse.winner ? collapse.winner.value : null,
    collapse,
    fanout,
    burstMs,
    sequentialEquivalentMs,
    parallelSpeedup,
    errors,
  };
}

function maybeTimeout<T>(p: Promise<T>, ms: number | undefined): Promise<T> {
  if (!ms || ms <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`burst-timeout-${ms}ms`)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
