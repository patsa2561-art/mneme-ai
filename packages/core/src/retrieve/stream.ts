/**
 * Speculative-reasoning event stream — pub/sub layer for the retrieval
 * pipeline so callers (CLI, MCP, audit logs) can render the model's "thought
 * trace" in real time, not just the final answer.
 *
 * Inspired by the KAT-0B Try / Accept / Contradiction / Backtrack / Solved
 * trace. In Mneme's flavor:
 *   - `consider`   — a candidate commit was scored
 *   - `accept`     — the candidate cleared the score floor
 *   - `prune`      — the candidate was rejected (with a human reason)
 *   - `contradict` — two commits disagree on the verdict
 *   - `backtrack`  — the synthesizer abandoned a hypothesis
 *   - `synthesize` — the LLM was invoked with N citations
 *   - `verify`     — Leviathan verified (or rejected) a single claim
 *   - `done`       — the pipeline finished (with total wallclock)
 *
 * Sinks are intentionally trivial. The `EventSink` interface keeps core
 * dependency-free; callers wire in callbacks (CLI), arrays (tests), or null
 * (production-quiet).
 */

export type StreamEvent =
  | { kind: "consider"; commit: { shortHash: string; subject: string }; score: number }
  | { kind: "accept"; commit: { shortHash: string; subject: string }; reason: string }
  | { kind: "prune"; commit: { shortHash: string; subject: string }; reason: string }
  | { kind: "contradict"; commit: { shortHash: string; subject: string }; against: string }
  | { kind: "backtrack"; from: string; to: string }
  | { kind: "synthesize"; citationsCount: number }
  | { kind: "verify"; claim: string; ok: boolean; reason?: string }
  | { kind: "done"; durationMs: number };

/**
 * Output port for stream events. Implementations decide where events go —
 * stdout, an array, a websocket, or /dev/null.
 */
export interface EventSink {
  emit(ev: StreamEvent): void;
}

/** Quiet sink — drops everything. The default. */
export class NullSink implements EventSink {
  emit(_: StreamEvent): void {
    /* intentionally empty */
  }
}

/** Test-friendly sink — appends to an in-memory array for assertions. */
export class InMemorySink implements EventSink {
  events: StreamEvent[] = [];
  emit(ev: StreamEvent): void {
    this.events.push(ev);
  }

  /** Convenience: filter events by kind, useful in tests. */
  byKind<K extends StreamEvent["kind"]>(kind: K): Array<Extract<StreamEvent, { kind: K }>> {
    return this.events.filter((e) => e.kind === kind) as Array<
      Extract<StreamEvent, { kind: K }>
    >;
  }

  /** Reset between test cases without re-allocating the sink. */
  clear(): void {
    this.events = [];
  }
}

/** Callback sink — bridge to external transports (CLI renderer, MCP). */
export class CallbackSink implements EventSink {
  constructor(private readonly cb: (e: StreamEvent) => void) {}
  emit(ev: StreamEvent): void {
    this.cb(ev);
  }
}
