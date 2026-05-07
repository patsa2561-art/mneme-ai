/**
 * Superscalar layer — N parallel workers per stage with sequence-id
 * preservation, plus speculative pre-fetch helpers.
 *
 * "Superscalar" here means: multiple identical workers can pull items from
 * the same input queue and process them concurrently. Outputs may complete
 * out of order (one item is slow while a later one is fast). Each item
 * carries a seq number so downstream code can re-sort if needed.
 */
import type { PipelineStage, StageContext, SeqItem } from "./types.js";

/**
 * Spawn `width` parallel workers for a single stage. Reads SeqItem<I> from
 * `inputs`, processes through `stage.process`, and yields SeqItem<O> in the
 * order they complete (NOT the order they entered — see reorderBySeq).
 */
export async function* superscalar<I, O>(
  stage: PipelineStage<I, O>,
  inputs: AsyncIterable<SeqItem<I>>,
  width: number,
  baseCtx: Omit<StageContext, "workerId">,
): AsyncIterable<SeqItem<O>> {
  // Bridge an AsyncIterator into a single shared "next()" channel that
  // multiple workers can pull from sequentially. JS iterators aren't
  // thread-safe, but they ARE single-threaded — calls to next() are atomic
  // with respect to each other on the event loop, so workers naturally
  // round-robin through the queue.
  const it = inputs[Symbol.asyncIterator]();

  // We use a small in-flight buffer + manual completion signalling so
  // outputs surface as soon as ANY worker finishes, not in worker-id order.
  const ready: SeqItem<O>[] = [];
  let pendingResolve: (() => void) | null = null;

  const wakeMain = () => {
    if (pendingResolve) {
      const r = pendingResolve;
      pendingResolve = null;
      r();
    }
  };

  let activeWorkers = width;

  const workerLoop = async (workerId: number): Promise<void> => {
    const ctx: StageContext = { ...baseCtx, workerId };
    while (true) {
      const next = await it.next();
      if (next.done) break;
      const { seq, value } = next.value;
      try {
        const out = await stage.process(value, ctx);
        ready.push({ seq, value: out });
      } catch (err) {
        // Re-throw on the main stream by stashing as a pending error.
        // We push a sentinel that downstream filters out via failure path.
        ready.push({ seq, value: err as never });
        wakeMain();
        throw err;
      }
      wakeMain();
    }
  };

  const workers = Array.from({ length: Math.max(1, width) }, (_, i) =>
    workerLoop(i).finally(() => {
      activeWorkers -= 1;
      wakeMain();
    }),
  );

  // Drain loop: yield whatever's ready; wait when nothing is.
  try {
    while (true) {
      while (ready.length > 0) {
        yield ready.shift()!;
      }
      if (activeWorkers === 0 && ready.length === 0) break;
      await new Promise<void>((resolve) => {
        pendingResolve = resolve;
      });
    }
    // Surface any worker-side errors.
    await Promise.all(workers);
  } catch (err) {
    // Make sure workers settle even if one threw.
    await Promise.allSettled(workers);
    throw err;
  }
}

/**
 * Re-emit SeqItem<T> in monotonically-increasing seq order. Buffers
 * out-of-order items in a small heap-like structure (insertion sort —
 * pipelines rarely have huge reorder windows so O(n) per insert is fine).
 *
 * `startAt` is the first seq number to emit (default 0).
 */
export async function* reorderBySeq<T>(
  inputs: AsyncIterable<SeqItem<T>>,
  startAt = 0,
): AsyncIterable<SeqItem<T>> {
  let next = startAt;
  const buffer: SeqItem<T>[] = [];

  for await (const item of inputs) {
    // Insert sorted by seq so the smallest is at index 0.
    let i = 0;
    while (i < buffer.length && buffer[i].seq < item.seq) i++;
    buffer.splice(i, 0, item);

    while (buffer.length > 0 && buffer[0].seq === next) {
      yield buffer.shift()!;
      next += 1;
    }
  }

  // Drain remaining (gaps surface naturally since we only advance on match).
  while (buffer.length > 0) {
    const head = buffer.shift()!;
    if (head.seq === next) {
      yield head;
      next += 1;
    } else {
      // Skipped seq — yield in order anyway (this should never happen if
      // the upstream is well-formed, but it's a safe fallback).
      yield head;
      next = head.seq + 1;
    }
  }
}

/**
 * Speculative pre-fetch: start nextStage on a predicted input before the
 * upstream finalizes. Returns a promise + a cancel() function. cancel()
 * does NOT abort the underlying process call (we can't cancel arbitrary
 * promises) but flips an internal flag so callers can ignore the result.
 */
export function speculatePrefetch<I, O>(
  nextStage: PipelineStage<I, O>,
  predicted: I,
  ctx: StageContext = { trust: 1, workerId: -1 },
): { promise: Promise<O>; cancel: () => void; cancelled: () => boolean } {
  let cancelled = false;
  const promise = nextStage.process(predicted, ctx).then((v) => {
    if (cancelled) {
      ctx.emit?.({ kind: "drop", stage: nextStage.id, reason: "speculation cancelled" });
    }
    return v;
  });
  ctx.emit?.({ kind: "speculate", stage: nextStage.id, reason: "prefetch" });
  return {
    promise,
    cancel: () => {
      cancelled = true;
    },
    cancelled: () => cancelled,
  };
}
