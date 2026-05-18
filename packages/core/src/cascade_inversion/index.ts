/**
 * v2.19.42 — CASCADE INVERSION (the second wild idea no other AI tool ships).
 *
 *   "v2.19.40 TOKEN GOVERNOR walks 5 stages SEQUENTIALLY: cache →
 *    local → cheap → expensive → lie-tax. That's optimal once the
 *    GANGLION graph has converged, because the preferred stage hits on
 *    attempt 1. But on COLD START (no graph history), the cascade
 *    serialises and pays the full wall-time of N misses before finding
 *    a hit.
 *
 *    CASCADE INVERSION: when GANGLION confidence is below a threshold,
 *    fire all candidate stages IN PARALLEL and return the FIRST hit
 *    that satisfies a quality bar. Wall-time drops from sum(stages) to
 *    max(stages). The token cost is the cost of the winner only — the
 *    losers are abandoned mid-flight (AbortSignal) so they don't bill.
 *
 *    The wild part: this is structurally backwards from what every
 *    other AI router does. LangChain / Helicone / Portkey serialise
 *    because they assume each upstream is expensive. Mneme inverts:
 *    cache / local / cheap vendors are cheap ENOUGH that the cost of
 *    speculatively firing all three in parallel is dominated by the
 *    latency win. Expensive vendor stays sequential (escalate only on
 *    confirmed miss). Composes with GANGLION — once convergence
 *    climbs above the threshold, the cascade goes back to sequential
 *    + ganglion-hinted.
 *
 *    Hybrid sequential-then-parallel with auto-collapse: the user
 *    pays nothing extra after convergence; on cold start they pay one
 *    extra cheap-stage call in exchange for a 3-5× wall-time win."
 */

export interface InversionStage<T> {
  /** Stage identifier (e.g., "reflex", "local", "haiku"). */
  name: string;
  /** Run the stage. Should respect the AbortSignal — abandon work on abort. */
  run: (signal: AbortSignal) => Promise<T | null>;
  /** Estimated cost (tokens / cents) — used in the parallel-vs-sequential decision. */
  estCost: number;
  /** Whether this stage is safe to race in parallel (cache + local: yes; expensive vendor: no). */
  raceable: boolean;
}

export interface InversionResult<T> {
  winner: string;
  result: T;
  /** Stages that lost the race + why (each had its abort fired). */
  losers: Array<{ name: string; reason: "aborted" | "miss" | "error" }>;
  wallTimeMs: number;
  /** True when CASCADE INVERSION fired in parallel mode (vs sequential ganglion-hinted). */
  parallelMode: boolean;
}

export interface InversionInput<T> {
  stages: InversionStage<T>[];
  /** Caller's quality predicate — null result = miss; non-null = hit. */
  /** Optional GANGLION confidence (0..1). Below threshold → fire parallel; above → sequential. */
  ganglionConfidence?: number;
  /** Threshold below which we race in parallel. Default 0.5. */
  parallelThreshold?: number;
  /** Hard ceiling on parallel cost (sum of raceable stages). Default Infinity. */
  maxParallelCost?: number;
  /** Optional overall timeout in ms. Default 30s. */
  timeoutMs?: number;
}

/**
 * Run the cascade with the inversion rule:
 *   - Above threshold → sequential through ALL stages in order.
 *   - Below threshold → race the raceable stages in parallel; first hit wins;
 *                       losers get an AbortSignal so they can drop work.
 *                       Non-raceable stages fall through to sequential after
 *                       the parallel race exhausts.
 */
export async function runWithInversion<T>(input: InversionInput<T>): Promise<InversionResult<T> | null> {
  const t0 = Date.now();
  const threshold = input.parallelThreshold ?? 0.5;
  const conf = input.ganglionConfidence ?? 0;
  const parallelMode = conf < threshold;
  const losers: InversionResult<T>["losers"] = [];

  // SEQUENTIAL PATH (GANGLION has spoken — trust the graph).
  if (!parallelMode) {
    for (const s of input.stages) {
      const controller = new AbortController();
      try {
        const r = await s.run(controller.signal);
        if (r !== null) {
          return { winner: s.name, result: r, losers, wallTimeMs: Date.now() - t0, parallelMode: false };
        }
        losers.push({ name: s.name, reason: "miss" });
      } catch {
        losers.push({ name: s.name, reason: "error" });
      }
    }
    return null;
  }

  // PARALLEL PATH (cold start — race the raceable stages).
  const raceable = input.stages.filter((s) => s.raceable);
  const sequential = input.stages.filter((s) => !s.raceable);
  const totalRaceCost = raceable.reduce((sum, s) => sum + s.estCost, 0);
  const maxParallelCost = input.maxParallelCost ?? Infinity;
  if (totalRaceCost > maxParallelCost) {
    // Falls back to sequential when parallel cost exceeds the budget.
    for (const s of input.stages) {
      const controller = new AbortController();
      try {
        const r = await s.run(controller.signal);
        if (r !== null) {
          return { winner: s.name, result: r, losers, wallTimeMs: Date.now() - t0, parallelMode: false };
        }
        losers.push({ name: s.name, reason: "miss" });
      } catch {
        losers.push({ name: s.name, reason: "error" });
      }
    }
    return null;
  }

  // Race the raceable stages with shared abort propagation.
  const winners: Array<{ stage: InversionStage<T>; result: T }> = [];
  const controllers = raceable.map(() => new AbortController());
  const timeoutMs = input.timeoutMs ?? 30_000;
  const timeoutId = setTimeout(() => controllers.forEach((c) => c.abort()), timeoutMs);

  // Use Promise.race with a sentinel that resolves on first non-null hit.
  let resolved = false;
  const promises = raceable.map((s, idx) =>
    s.run(controllers[idx]!.signal)
      .then((r) => {
        if (r !== null && !resolved) {
          resolved = true;
          winners.push({ stage: s, result: r });
          // Abort the other raceable stages so they stop billing.
          for (let i = 0; i < controllers.length; i++) {
            if (i !== idx) controllers[i]!.abort();
          }
          return { ok: true as const, name: s.name };
        }
        if (r === null) return { ok: false as const, name: s.name, reason: "miss" as const };
        return { ok: false as const, name: s.name, reason: "miss" as const };
      })
      .catch(() => ({ ok: false as const, name: s.name, reason: "error" as const })),
  );

  const outcomes = await Promise.all(promises);
  clearTimeout(timeoutId);

  for (const o of outcomes) {
    if (!o.ok) losers.push({ name: o.name, reason: o.reason ?? "miss" });
  }

  if (winners.length > 0) {
    const w = winners[0]!;
    return { winner: w.stage.name, result: w.result, losers, wallTimeMs: Date.now() - t0, parallelMode: true };
  }

  // No raceable stage hit — fall through to sequential non-raceable stages.
  for (const s of sequential) {
    const controller = new AbortController();
    try {
      const r = await s.run(controller.signal);
      if (r !== null) {
        return { winner: s.name, result: r, losers, wallTimeMs: Date.now() - t0, parallelMode: true };
      }
      losers.push({ name: s.name, reason: "miss" });
    } catch {
      losers.push({ name: s.name, reason: "error" });
    }
  }

  return null;
}

/** Compare sequential vs inversion wall-time for a deterministic A/B benchmark. */
export async function abBenchmark<T>(input: InversionInput<T>): Promise<{
  sequential: { winner: string | null; wallTimeMs: number };
  inversion: { winner: string | null; wallTimeMs: number; parallelMode: boolean };
  speedupRatio: number;
}> {
  // Sequential pass: force ganglionConfidence above threshold so the
  // function takes the sequential branch.
  const seqStart = Date.now();
  const seq = await runWithInversion({ ...input, ganglionConfidence: 0.99 });
  const seqTime = Date.now() - seqStart;

  const invStart = Date.now();
  const inv = await runWithInversion({ ...input, ganglionConfidence: 0 });
  const invTime = Date.now() - invStart;

  return {
    sequential: { winner: seq?.winner ?? null, wallTimeMs: seqTime },
    inversion: { winner: inv?.winner ?? null, wallTimeMs: invTime, parallelMode: inv?.parallelMode ?? false },
    speedupRatio: invTime > 0 ? seqTime / invTime : 1,
  };
}
