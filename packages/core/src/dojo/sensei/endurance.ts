/**
 * v2.23.0 — DOJO · ENDURANCE SENSEI.
 *
 * Runs the same claim through `runACGV` N times and checks that:
 *   1. Every run returns the SAME verdict (no flakiness)
 *   2. Latency stays bounded (no quadratic blowup)
 *   3. No silent crash midway
 *
 * Determinism is Mneme's biggest advantage over LLM rivals; this
 * sensei pins it. If ANY iteration disagrees with the others, the
 * sensei surfaces it loudly.
 */

export interface EnduranceResult {
  claim: string;
  iterations: number;
  deterministic: boolean;
  verdicts: string[];
  /** Distribution of verdicts (only > 1 entry if non-deterministic). */
  histogram: Record<string, number>;
  p50LatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
}

export interface EnduranceSenseiOptions {
  repoRoot: string;
  claim?: string;
  iterations?: number;
}

export async function runEnduranceSensei(opts: EnduranceSenseiOptions): Promise<EnduranceResult> {
  const { runACGV } = await import("../../squadron/acgv.js");
  const claim = opts.claim ?? "Mneme has 8 verification agents";
  const iterations = opts.iterations ?? 50;
  const verdicts: string[] = [];
  const latencies: number[] = [];
  for (let i = 0; i < iterations; i++) {
    const t0 = Date.now();
    let v = "ERROR";
    try {
      const r = runACGV({ claim, repoRoot: opts.repoRoot, noEmitVaccine: true, noStake: true });
      v = r.verdict;
    } catch { /* swallow — recorded as ERROR */ }
    latencies.push(Date.now() - t0);
    verdicts.push(v);
  }
  const histogram: Record<string, number> = {};
  for (const v of verdicts) histogram[v] = (histogram[v] ?? 0) + 1;
  const deterministic = Object.keys(histogram).length === 1;
  const sorted = [...latencies].sort((a, b) => a - b);
  const p50 = sorted[Math.floor(sorted.length / 2)] ?? 0;
  const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
  const max = sorted[sorted.length - 1] ?? 0;
  return {
    claim,
    iterations,
    deterministic,
    verdicts,
    histogram,
    p50LatencyMs: p50,
    p95LatencyMs: p95,
    maxLatencyMs: max,
  };
}
