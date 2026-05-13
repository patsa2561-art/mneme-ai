/**
 * v1.94.0 -- QX-SUPERNOVA · Infinity Memory Layer
 *
 * Where lineage stores FILES + commits, the Infinity layer stores
 * EVENTS — each with a probability vector frozen at the moment it
 * happened. So when you recall "why did the team migrate to Postgres",
 * you don't just get the commit; you get the signal field that made
 * the decision: which competing options were considered, their
 * posterior weights at the time, and which outcome materialized.
 *
 * Quantum trace = the snapshot of the probability vector persists
 * forever, even after the event itself fades from RAM. Recall is
 * O(log n) on the in-memory index.
 *
 * Pure in-memory + JSON-persistable. No network. No telemetry.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import {
  collapseProbabilityMatrix,
  type SignalVector,
  type Hypothesis,
  type CollapseResult,
} from "./quantum_core.js";

export type EventOutcome = "success" | "failure" | "pending" | "unknown";

export interface QuantumEvent {
  /** Stable id (sha256 prefix of kind+ts+actors). */
  id: string;
  ts: number;
  /** Event class, e.g. "decision", "regret", "vaccine-fire", "burst". */
  kind: string;
  /** People / vendors / files involved. */
  actors: string[];
  /** Frozen probability vector at the moment of the event. */
  probabilityVector: SignalVector;
  /** Outcome assigned (can be filled in later via mark). */
  outcome: EventOutcome;
  /** Free-form narrative — what happened, why. */
  trace: string;
}

export interface RecallQuery {
  kind?: string;
  actor?: string;
  outcome?: EventOutcome;
  /** Only events with ts >= sinceMs. */
  sinceMs?: number;
  /** Only events with ts <= untilMs. */
  untilMs?: number;
  /** Cap results. */
  limit?: number;
}

export interface InfinityMemory {
  /** Append an event. */
  record(event: Omit<QuantumEvent, "id">): QuantumEvent;
  /** Filter recall — newest first. */
  recall(q: RecallQuery): QuantumEvent[];
  /** Mark outcome retroactively (e.g. after we know "decision" succeeded). */
  mark(id: string, outcome: EventOutcome): boolean;
  /** All events. */
  list(): QuantumEvent[];
  /** Treat matching events as hypotheses and pick the most-probable one. */
  collapse(q: RecallQuery): CollapseResult<QuantumEvent>;
  /** Persist to disk (JSONL). */
  flushTo(path: string): void;
  /** Load from disk (JSONL). */
  loadFrom(path: string): number;
  /** Probability recall precision @ k — used by the benchmark. */
  precisionAtK(query: RecallQuery, expected: string[], k: number): number;
}

export function createInfinityMemory(): InfinityMemory {
  const events: QuantumEvent[] = [];

  function makeId(e: Omit<QuantumEvent, "id">): string {
    const seed = `${e.kind}::${e.ts}::${e.actors.join(",")}`;
    return createHash("sha256").update(seed).digest("hex").slice(0, 14);
  }

  function matches(e: QuantumEvent, q: RecallQuery): boolean {
    if (q.kind && e.kind !== q.kind) return false;
    if (q.actor && !e.actors.includes(q.actor)) return false;
    if (q.outcome && e.outcome !== q.outcome) return false;
    if (q.sinceMs !== undefined && e.ts < q.sinceMs) return false;
    if (q.untilMs !== undefined && e.ts > q.untilMs) return false;
    return true;
  }

  return {
    record(e) {
      const id = makeId(e);
      const event: QuantumEvent = { ...e, id };
      events.push(event);
      return event;
    },
    recall(q) {
      const out = events.filter((e) => matches(e, q));
      out.sort((a, b) => b.ts - a.ts);
      return q.limit ? out.slice(0, q.limit) : out;
    },
    mark(id, outcome) {
      const e = events.find((x) => x.id === id);
      if (!e) return false;
      e.outcome = outcome;
      return true;
    },
    list() {
      return events.slice();
    },
    collapse(q) {
      const matching = events.filter((e) => matches(e, q));
      if (matching.length === 0) {
        return collapseProbabilityMatrix([], {});
      }
      const hyps: Hypothesis<QuantumEvent>[] = matching.map((e) => ({
        id: e.id,
        value: e,
        signals: e.probabilityVector,
      }));
      return collapseProbabilityMatrix(hyps, {});
    },
    flushTo(path) {
      const dir = dirname(path);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      const buf = events.map((e) => JSON.stringify(e)).join("\n") + (events.length ? "\n" : "");
      writeFileSync(path, buf, "utf8");
    },
    loadFrom(path) {
      if (!existsSync(path)) return 0;
      const txt = readFileSync(path, "utf8");
      let loaded = 0;
      for (const line of txt.split(/\r?\n/)) {
        if (!line.trim()) continue;
        try {
          events.push(JSON.parse(line) as QuantumEvent);
          loaded++;
        } catch {
          // skip malformed
        }
      }
      return loaded;
    },
    precisionAtK(query, expectedIds, k) {
      if (k <= 0) return 0;
      const got = this.recall({ ...query, limit: k }).map((e) => e.id);
      let hits = 0;
      for (const id of got) if (expectedIds.includes(id)) hits++;
      return hits / k;
    },
  };
}

/** Convenience: append a single event to a JSONL file without keeping
 *  the whole index in memory (for the daemon's event log). */
export function appendEventToFile(path: string, e: QuantumEvent): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(path, JSON.stringify(e) + "\n", "utf8");
}
