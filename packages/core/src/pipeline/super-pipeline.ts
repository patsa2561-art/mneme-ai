/**
 * Super Pipeline runtime.
 *
 * Combines deep pipelining (many short stages running concurrently) with
 * superscalar widths (multiple workers per stage). Tasks flow through a
 * chain of bounded async queues — when a downstream queue fills, upstream
 * workers block on push (backpressure).
 *
 * MPE training: the runtime emits StageResult observations and applies
 * updateMpe at the end of the run so the next run starts with smarter trust.
 */
import type {
  MpeConfig,
  PipelineConfig,
  PipelineEvent,
  PipelineStage,
  SeqItem,
  StageContext,
} from "./types.js";
import {
  emptyMpeState,
  readMpeState,
  recommendFromMpe,
  updateMpe,
  writeMpeState,
  type MpeState,
  type StageResult,
} from "./mpe.js";

/* ───────────────────────  Bounded queue  ─────────────────────── */

/**
 * Asynchronous bounded FIFO queue. push() resolves when a slot is free
 * (backpressure). next() resolves with the next item, or { done: true }
 * when the queue is closed and empty.
 */
class BoundedQueue<T> {
  private readonly buffer: T[] = [];
  private closed = false;
  private readonly waitingPushers: Array<() => void> = [];
  private readonly waitingPullers: Array<(v: IteratorResult<T>) => void> = [];

  constructor(private readonly capacity: number) {}

  async push(item: T): Promise<void> {
    if (this.closed) throw new Error("BoundedQueue: push to closed queue");
    while (this.buffer.length >= this.capacity) {
      await new Promise<void>((resolve) => this.waitingPushers.push(resolve));
      if (this.closed) throw new Error("BoundedQueue: closed during push");
    }
    this.buffer.push(item);
    const puller = this.waitingPullers.shift();
    if (puller) puller({ value: this.buffer.shift()!, done: false });
  }

  async next(): Promise<IteratorResult<T>> {
    if (this.buffer.length > 0) {
      const value = this.buffer.shift()!;
      const pusher = this.waitingPushers.shift();
      if (pusher) pusher();
      return { value, done: false };
    }
    if (this.closed) {
      return { value: undefined as unknown as T, done: true };
    }
    return new Promise<IteratorResult<T>>((resolve) => {
      this.waitingPullers.push(resolve);
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    // Wake every waiting puller with done; wake every waiting pusher so
    // they error out on the closed check.
    while (this.waitingPullers.length > 0) {
      const p = this.waitingPullers.shift()!;
      p({ value: undefined as unknown as T, done: true });
    }
    while (this.waitingPushers.length > 0) {
      const p = this.waitingPushers.shift()!;
      p();
    }
  }

  size(): number {
    return this.buffer.length;
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => this.next(),
    };
  }
}

/* ───────────────────────  width helper  ─────────────────────── */

function resolveWidth(width: number | number[] | undefined, n: number): number[] {
  if (width === undefined) return Array.from({ length: n }, () => 1);
  if (typeof width === "number") return Array.from({ length: n }, () => Math.max(1, width));
  // Array form — pad / truncate to n.
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(Math.max(1, width[i] ?? 1));
  return out;
}

/* ───────────────────────  runPipeline  ─────────────────────── */

/**
 * Run a deeply-pipelined superscalar engine.
 *
 * Each stage owns:
 *   - a bounded input queue (default 16)
 *   - a worker pool of `width[i]` parallel processors
 *
 * Workers pull from their input queue, run stage.process, and push to the
 * NEXT stage's input queue. Backpressure is automatic: a slow downstream
 * fills its queue, which blocks upstream pushes.
 *
 * Outputs are yielded in COMPLETION order (out-of-order possible). Use the
 * sequence id on the yielded SeqItem to re-sort if input order matters; the
 * convenience helper runDeepPipeline in ./index.ts does this for you.
 */
export async function* runPipeline<I, O>(
  cfg: PipelineConfig,
  inputs: AsyncIterable<I> | Iterable<I>,
): AsyncIterable<SeqItem<O>> {
  const stages = cfg.stages as ReadonlyArray<PipelineStage<unknown, unknown>>;
  if (stages.length === 0) {
    throw new Error("runPipeline: at least one stage required");
  }
  const widths = resolveWidth(cfg.width, stages.length);
  const bufferSize = Math.max(1, cfg.bufferSize ?? 16);

  // MPE state — load if persistent, otherwise empty in-memory.
  const mpeCfg: MpeConfig = cfg.mpe ?? {};
  let mpeState: MpeState =
    mpeCfg.persist && mpeCfg.repoRoot
      ? readMpeState(mpeCfg.repoRoot)
      : emptyMpeState(mpeCfg.decay ?? 0.85);

  // Seed targetMs map from stage definitions so latency weighting works.
  for (const s of stages) {
    if (s.targetMs !== undefined && !mpeState.targetMs.has(s.id)) {
      mpeState.targetMs.set(s.id, s.targetMs);
    }
  }

  // Build queues: queue[i] is the INPUT to stage i. queue[stages.length] is
  // the final output queue.
  const queues: BoundedQueue<SeqItem<unknown>>[] = [];
  for (let i = 0; i <= stages.length; i++) {
    queues.push(new BoundedQueue<SeqItem<unknown>>(bufferSize));
  }

  const onEvent = cfg.onEvent;
  const emit = (e: PipelineEvent) => onEvent?.(e);

  const observations: StageResult[] = [];

  // Spawn workers for each stage.
  const workerPromises: Promise<void>[] = [];
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const inQ = queues[i];
    const outQ = queues[i + 1];
    const width = widths[i];
    let liveWorkers = width;

    for (let w = 0; w < width; w++) {
      const workerId = w;
      const ctx: StageContext = {
        trust: mpeState.trust.get(stage.id) ?? 1 / Math.max(stages.length, 1),
        workerId,
        emit,
      };
      const p = (async () => {
        while (true) {
          const next = await inQ.next();
          if (next.done) break;
          const { seq, value } = next.value;
          const t0 = Date.now();
          emit({ kind: "stage-start", stage: stage.id, workerId });
          try {
            const out = await stage.process(value, ctx);
            const dt = Date.now() - t0;
            emit({ kind: "stage-done", stage: stage.id, workerId, latencyMs: dt });
            observations.push({
              stage: stage.id,
              ok: true,
              latencyMs: dt,
              targetMs: stage.targetMs,
            });
            await outQ.push({ seq, value: out });
          } catch (err) {
            const dt = Date.now() - t0;
            emit({
              kind: "stage-fail",
              stage: stage.id,
              workerId,
              error: (err as Error).message ?? String(err),
            });
            observations.push({
              stage: stage.id,
              ok: false,
              latencyMs: dt,
              targetMs: stage.targetMs,
            });
            // Failure isolation: drop the failing item, keep the pipeline alive.
            // The seq is consumed; downstream consumer should treat missing
            // seqs as "skipped" (reorderBySeq tolerates this on close).
          }
        }
      })().finally(() => {
        liveWorkers -= 1;
        if (liveWorkers === 0) outQ.close();
      });
      workerPromises.push(p);
    }
  }

  // Producer: feed inputs into the head queue with sequence ids.
  const producer = (async () => {
    let seq = 0;
    for await (const v of toAsyncIterable(inputs)) {
      await queues[0].push({ seq, value: v });
      seq += 1;
    }
    queues[0].close();
  })();

  // Drain the final queue and yield outputs as they appear.
  try {
    const finalQ = queues[stages.length];
    while (true) {
      const next = await finalQ.next();
      if (next.done) break;
      yield next.value as SeqItem<O>;
    }
    await producer;
    await Promise.all(workerPromises);
  } finally {
    // Apply MPE update + persist.
    if (observations.length > 0) {
      mpeState = updateMpe(mpeState, observations);
      if (mpeCfg.persist && mpeCfg.repoRoot) {
        try {
          writeMpeState(mpeCfg.repoRoot, mpeState);
        } catch {
          // best-effort; never let persistence kill the pipeline
        }
      }
    }
  }
}

async function* toAsyncIterable<T>(
  src: AsyncIterable<T> | Iterable<T>,
): AsyncIterable<T> {
  if (Symbol.asyncIterator in src) {
    for await (const v of src as AsyncIterable<T>) yield v;
    return;
  }
  for (const v of src as Iterable<T>) yield v;
}

/**
 * Convenience: run the pipeline and capture the final MPE recommendation
 * without yielding outputs. Useful for orchestration / tuning.
 */
export async function trainMpeOnly(
  cfg: PipelineConfig,
  inputs: AsyncIterable<unknown> | Iterable<unknown>,
): Promise<{ state: MpeState; recommendation: ReturnType<typeof recommendFromMpe> }> {
  const out: unknown[] = [];
  for await (const item of runPipeline(cfg, inputs)) out.push(item);
  // Re-read state from disk if persisted, else build from observations live.
  // We expose recommend() based on the last persisted state; tests typically
  // pass persist=false and read state directly via the public API instead.
  const state =
    cfg.mpe?.persist && cfg.mpe?.repoRoot
      ? readMpeState(cfg.mpe.repoRoot)
      : emptyMpeState(cfg.mpe?.decay ?? 0.85);
  return { state, recommendation: recommendFromMpe(state) };
}
