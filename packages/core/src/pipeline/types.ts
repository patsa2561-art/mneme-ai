/**
 * Super Pipeline Engine — types.
 *
 * Borrows two ideas from CPU architecture:
 *   1. Deep pipelining — many small stages, each running concurrently on
 *      different items (high throughput, item-level parallelism).
 *   2. Superscalar — each stage may have multiple workers (width N) so
 *      independent items at the same stage run in parallel.
 *
 * The novel ingredient is MPE (Multi-stage Pipelined Eigentrust): an
 * eigentrust-style update that auto-tunes per-stage trust + width based
 * on success rate and latency. See ./mpe.ts.
 */

/**
 * A single stage in the deep pipeline. Tasks flow through stages; each stage
 * runs in its own worker pool (superscalar width N) and can speculatively
 * pre-fetch from the next stage's input queue.
 */
export interface PipelineStage<I, O> {
  /** Stage identifier — used by MPE for trust tracking. */
  readonly id: string;
  /** Plain-English name for events / logs. */
  readonly description: string;
  /** Pure function: input → output. Called with the stage's allocated worker. */
  process(input: I, ctx: StageContext): Promise<O>;
  /** Soft target latency (ms). MPE uses this for backpressure. */
  readonly targetMs?: number;
}

/**
 * Per-call context passed into PipelineStage.process(). Workers receive a
 * read-only view of their stage's running trust score plus an optional event
 * sink for telemetry.
 */
export interface StageContext {
  /** Stage's running success rate (0..1) per MPE. */
  trust: number;
  /** Worker index (0..width-1) — for tracing. */
  workerId: number;
  /** Optional event sink — emits stage-start, stage-done, etc. */
  emit?: (e: PipelineEvent) => void;
}

/**
 * Events emitted by the runtime for tracing + MPE training. Consumers may
 * subscribe via PipelineConfig.onEvent (added by super-pipeline.ts).
 */
export type PipelineEvent =
  | { kind: "stage-start"; stage: string; workerId: number; inputHash?: string }
  | { kind: "stage-done"; stage: string; workerId: number; latencyMs: number }
  | { kind: "stage-fail"; stage: string; workerId: number; error: string }
  | { kind: "speculate"; stage: string; reason: string }
  | { kind: "drop"; stage: string; reason: string };

/** MPE configuration block. See ./mpe.ts for the math. */
export interface MpeConfig {
  /** PageRank-style decay (0..1). Higher = more recency bias. Default 0.85. */
  decay?: number;
  /** Trust threshold below which speculative pre-fetch is suppressed. Default 0.3. */
  speculateThreshold?: number;
  /** Whether to read/write .mneme/mpe.json — false in tests. Default false. */
  persist?: boolean;
  /** Repo root for persistence (only used when persist=true). */
  repoRoot?: string;
}

/**
 * Configuration for runPipeline. `Stages` is an ordered tuple — the runtime
 * does not check type compatibility between adjacent stages, but the helper
 * runDeepPipeline in pipeline/index.ts does at the type level.
 */
export interface PipelineConfig<
  Stages extends ReadonlyArray<PipelineStage<unknown, unknown>> = ReadonlyArray<
    PipelineStage<unknown, unknown>
  >,
> {
  stages: Stages;
  /** Superscalar width per stage (default 1). Pass an array to vary per-stage. */
  width?: number | number[];
  /** Backpressure queue size between stages (default 16). */
  bufferSize?: number;
  /** MPE config — auto-tune trust eigenvector per stage. */
  mpe?: MpeConfig;
  /** Optional event subscriber. Receives every PipelineEvent. */
  onEvent?: (e: PipelineEvent) => void;
}

/** Internal envelope: items flow through the pipeline tagged with a sequence id
 *  so the runtime can yield outputs in original input order even when stages
 *  complete out of order. */
export interface SeqItem<T> {
  readonly seq: number;
  readonly value: T;
}
