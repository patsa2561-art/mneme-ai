/**
 * Super Pipeline Engine — barrel.
 *
 * Public surface for Mneme v0.26.0:
 *   - types.ts          — PipelineStage, PipelineConfig, PipelineEvent
 *   - super-pipeline.ts — runPipeline (the deeply-pipelined runtime)
 *   - superscalar.ts    — superscalar / reorderBySeq / speculatePrefetch
 *   - mpe.ts            — Multi-stage Pipelined Eigentrust
 *
 * The novel contribution: MPE composes Eigentrust (P2P reputation) with
 * pipeline scheduling (CPU architecture) and adds latency-weighted success.
 * Mneme is the first CLI memory layer to use this combination.
 */
export * from "./types.js";
export * from "./super-pipeline.js";
export * from "./superscalar.js";
export * from "./mpe.js";

import type { PipelineConfig, PipelineStage, SeqItem } from "./types.js";
import { runPipeline } from "./super-pipeline.js";
import { reorderBySeq } from "./superscalar.js";

/**
 * Run any sequence of stages as a deeply-pipelined superscalar engine and
 * return the outputs in INPUT ORDER. Auto-tunes via MPE if `mpe` is set.
 *
 * For streaming use cases (or when input order doesn't matter) prefer
 * runPipeline directly — it yields out-of-order with seq tags.
 */
export async function runDeepPipeline<I, O>(
  cfg: PipelineConfig,
  inputs: AsyncIterable<I> | Iterable<I>,
): Promise<O[]> {
  const out: O[] = [];
  // runPipeline yields SeqItem<O> in completion order; reorderBySeq
  // restores input order before we collect.
  const ordered = reorderBySeq(runPipeline<I, O>(cfg, inputs) as AsyncIterable<SeqItem<O>>);
  for await (const item of ordered) {
    out.push(item.value);
  }
  return out;
}

/**
 * Build a PipelineStage from a plain function + id. Convenience for tests
 * and for ad-hoc pipelines where defining a class is overkill.
 */
export function defineStage<I, O>(
  id: string,
  description: string,
  fn: (input: I) => O | Promise<O>,
  opts: { targetMs?: number } = {},
): PipelineStage<I, O> {
  return {
    id,
    description,
    targetMs: opts.targetMs,
    async process(input) {
      return await fn(input);
    },
  };
}
