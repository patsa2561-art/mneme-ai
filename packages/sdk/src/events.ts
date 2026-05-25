/**
 * @mneme-ai/sdk — async-iterator event bus.
 *
 * Wild feature: every primitive can stream EVENTS as the work happens
 * (tournament rounds, drift detections, audit findings, etc) — no SDK
 * I've seen does this. Pattern:
 *
 *   for await (const ev of mneme.tournament.events()) {
 *     console.log(ev.round, ev.caught);
 *   }
 *
 * Implemented as a tiny in-process pub/sub with AbortSignal support.
 * No external dep; zero overhead when nobody subscribes.
 */

export type MnemeEventKind =
  | "tournament.round"
  | "tournament.complete"
  | "molt.detected"
  | "swap.detected"
  | "stamp.issued"
  | "verify.complete"
  | "lethe.forgotten"
  | "gavel.packed"
  | "nimbus.published"
  | "perf.budget.exceeded";

export interface MnemeEvent<T = unknown> {
  kind: MnemeEventKind;
  at: number;
  data: T;
}

type Listener<T = unknown> = (ev: MnemeEvent<T>) => void;

class EventBus {
  private listeners: Map<MnemeEventKind, Set<Listener>> = new Map();
  private globalListeners: Set<Listener> = new Set();

  on(kind: MnemeEventKind, listener: Listener): () => void {
    if (!this.listeners.has(kind)) this.listeners.set(kind, new Set());
    this.listeners.get(kind)!.add(listener);
    return () => this.listeners.get(kind)?.delete(listener);
  }

  onAny(listener: Listener): () => void {
    this.globalListeners.add(listener);
    return () => this.globalListeners.delete(listener);
  }

  emit<T>(ev: MnemeEvent<T>): void {
    const ls = this.listeners.get(ev.kind);
    if (ls) for (const l of ls) {
      try { l(ev as MnemeEvent); } catch { /* swallow — never let a bad subscriber kill the bus */ }
    }
    for (const l of this.globalListeners) {
      try { l(ev as MnemeEvent); } catch { /* */ }
    }
  }

  listenerCount(): number {
    let n = this.globalListeners.size;
    for (const s of this.listeners.values()) n += s.size;
    return n;
  }
}

const _globalBus = new EventBus();
export function getEventBus(): EventBus { return _globalBus; }

/**
 * Get an async iterator over events matching `kinds` (all kinds if omitted).
 * Stops when AbortSignal aborts.
 *
 *   const ac = new AbortController();
 *   for await (const ev of subscribeEvents(["tournament.round"], { signal: ac.signal })) {
 *     if (ev.data.round >= 10) ac.abort();
 *   }
 */
export async function* subscribeEvents(
  kinds?: MnemeEventKind[],
  opts: { signal?: AbortSignal } = {},
): AsyncIterableIterator<MnemeEvent> {
  const bus = getEventBus();
  const queue: MnemeEvent[] = [];
  let resolveNext: ((v: IteratorResult<MnemeEvent>) => void) | null = null;
  let aborted = false;

  const off = kinds && kinds.length > 0
    ? kinds.map((k) => bus.on(k, (ev) => push(ev)))
    : [bus.onAny((ev) => push(ev))];

  function push(ev: MnemeEvent) {
    if (resolveNext) {
      resolveNext({ value: ev, done: false });
      resolveNext = null;
    } else {
      queue.push(ev);
    }
  }

  if (opts.signal) {
    opts.signal.addEventListener("abort", () => {
      aborted = true;
      if (resolveNext) {
        resolveNext({ value: undefined as unknown as MnemeEvent, done: true });
        resolveNext = null;
      }
    });
  }

  try {
    while (!aborted) {
      if (queue.length > 0) {
        yield queue.shift()!;
        continue;
      }
      const next = await new Promise<IteratorResult<MnemeEvent>>((resolve) => {
        resolveNext = resolve;
      });
      if (next.done) break;
      yield next.value;
    }
  } finally {
    for (const fn of off) fn();
  }
}
