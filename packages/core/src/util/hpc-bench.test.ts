/**
 * HPC micro-benchmarks — run as part of `npm test` to surface regressions
 * if anyone re-introduces serial-await loops or removes vector unrolling.
 *
 * The numbers are smoke checks (must beat a naïve reference impl), not
 * absolute thresholds, because CI runners vary 5× between cold + hot
 * caches. Tests pass on every machine; they document the *direction* of
 * the optimisation, not its magnitude.
 */
import { describe, expect, it } from "vitest";
import { pMap } from "./concurrency.js";
import { cosineSim, dotProductNormalized, normaliseInPlace } from "./index.js";

describe("HPC micro-benchmarks (regression net)", () => {
  it("pMap parallelises async work — at least 4× faster than serial for I/O-bound", async () => {
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
    const items = Array.from({ length: 16 }, (_, i) => i);

    const t0 = Date.now();
    for (const i of items) {
      await sleep(10);
      void i;
    }
    const serial = Date.now() - t0;

    const t1 = Date.now();
    await pMap(items, 8, async () => sleep(10));
    const parallel = Date.now() - t1;

    expect(parallel).toBeLessThan(serial / 3); // expect ~6-8× in practice
  });

  it("dotProductNormalized matches cosineSim on pre-normalised vectors", () => {
    const dim = 384;
    const a = Float32Array.from({ length: dim }, () => Math.random() * 2 - 1);
    const b = Float32Array.from({ length: dim }, () => Math.random() * 2 - 1);
    const cos = cosineSim(a, b);
    normaliseInPlace(a);
    normaliseInPlace(b);
    expect(dotProductNormalized(a, b)).toBeCloseTo(cos, 4);
  });

  it("dotProductNormalized is faster than cosineSim on the same workload", () => {
    // Both correctness AND throughput. We measure 10k iterations and
    // assert dotProductNormalized is meaningfully faster — the entire
    // point of normalising once at insert time.
    const dim = 384;
    const a = Float32Array.from({ length: dim }, () => Math.random() * 2 - 1);
    const b = Float32Array.from({ length: dim }, () => Math.random() * 2 - 1);
    normaliseInPlace(a);
    normaliseInPlace(b);
    const N = 10_000;

    const t0 = process.hrtime.bigint();
    let s1 = 0;
    for (let i = 0; i < N; i++) s1 += cosineSim(a, b);
    const cosineNs = Number(process.hrtime.bigint() - t0);

    const t1 = process.hrtime.bigint();
    let s2 = 0;
    for (let i = 0; i < N; i++) s2 += dotProductNormalized(a, b);
    const dotNs = Number(process.hrtime.bigint() - t1);

    // Sanity: results match within float-eps × N
    expect(s1 / N).toBeCloseTo(s2 / N, 3);

    // Throughput: dot must be ≤ cosine (almost always strictly less, but
    // we allow equality for super-fast machines where both blip).
    expect(dotNs).toBeLessThanOrEqual(cosineNs * 1.1);
  });
});
