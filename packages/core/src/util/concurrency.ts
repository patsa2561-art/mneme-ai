/**
 * pLimit-style concurrency control with zero deps.
 *
 * Why we don't pull p-limit (≈3KB published, transitively pulls yocto-queue):
 * adding a dependency to a security-scanner crate-stack is a marketing-grade
 * decision. A 30-LOC inline implementation is identical in behaviour and
 * adds nothing to the install footprint.
 *
 * Semantics match p-limit exactly: `limit(fn)` returns a Promise that resolves
 * to the result of `fn()`. At most `n` `fn`s run concurrently. Tasks are
 * scheduled FIFO. An exception in `fn` rejects the corresponding Promise but
 * does not poison the pool — pending tasks keep running.
 */

export interface Limiter {
  <T>(fn: () => Promise<T>): Promise<T>;
  /** Number currently running. */
  readonly active: number;
  /** Number waiting for a slot. */
  readonly queued: number;
}

export function pLimit(concurrency: number): Limiter {
  if (concurrency < 1 || !Number.isFinite(concurrency)) {
    throw new Error(`pLimit: concurrency must be a positive integer, got ${concurrency}`);
  }
  const max = Math.floor(concurrency);
  let running = 0;
  const queue: Array<() => void> = [];

  const next = (): void => {
    if (running >= max) return;
    const task = queue.shift();
    if (!task) return;
    running += 1;
    task();
  };

  const fn = <T>(task: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = (): void => {
        // Use Promise.resolve to handle sync-throwing tasks uniformly.
        Promise.resolve()
          .then(task)
          .then(
            (value) => {
              running -= 1;
              resolve(value);
              next();
            },
            (err) => {
              running -= 1;
              reject(err);
              next();
            },
          );
      };
      queue.push(run);
      next();
    });
  };

  Object.defineProperty(fn, "active", { get: () => running });
  Object.defineProperty(fn, "queued", { get: () => queue.length });
  return fn as Limiter;
}

/**
 * Map an array through an async fn with bounded concurrency. Convenience
 * wrapper over pLimit for the most common case: "do this for every item,
 * up to N at a time".
 *
 * Returns results in INPUT ORDER (like Promise.all), not completion order.
 */
export async function pMap<T, U>(
  items: ReadonlyArray<T>,
  concurrency: number,
  fn: (item: T, index: number) => Promise<U>,
): Promise<U[]> {
  const limit = pLimit(concurrency);
  return Promise.all(items.map((item, idx) => limit(() => fn(item, idx))));
}

/**
 * Run an async fn for every item, accumulate failures rather than throwing
 * on the first one. Returns parallel arrays of (results, errors). Useful
 * when you want best-effort results from a flaky network.
 */
export async function pMapSettled<T, U>(
  items: ReadonlyArray<T>,
  concurrency: number,
  fn: (item: T, index: number) => Promise<U>,
): Promise<{ results: Array<U | undefined>; errors: Array<Error | undefined> }> {
  const limit = pLimit(concurrency);
  const results: Array<U | undefined> = new Array(items.length);
  const errors: Array<Error | undefined> = new Array(items.length);
  await Promise.all(
    items.map((item, idx) =>
      limit(async () => {
        try {
          results[idx] = await fn(item, idx);
        } catch (err) {
          errors[idx] = err as Error;
        }
      }),
    ),
  );
  return { results, errors };
}
