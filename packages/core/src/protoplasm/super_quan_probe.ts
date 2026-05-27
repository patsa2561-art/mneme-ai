/**
 * 🦠 PROTOPLASM — super_quan_probe decorator
 *
 * The "live atom" that gets embedded in every function:
 *   const wrapped = withSuperQuanProbe("module.fn", fn);
 *
 * On every call:
 *   - records InvocationSnapshot to in-memory rolling buffer
 *   - if buffer reaches probe interval → run quantum probe → emit finding
 *
 * Zero behavioral change to wrapped fn. Sync + async supported.
 * Hot-path overhead target: <50µs per call (only timing + shape).
 */

import type { InvocationSnapshot, FunctionBaseline, ProtoplasmConfig, SuperQuanFinding } from "./types.js";
import { buildBaseline, runQuantumProbe } from "./quantum_probe.js";
import { appendFinding } from "./findings_ledger.js";

/** Cheap structural fingerprint — count + top-level type pattern, no values. */
function argShape(args: ArrayLike<unknown>): string {
  return Array.from(args, (a) => {
    if (a === null) return "null";
    if (a === undefined) return "undef";
    if (Array.isArray(a)) return `arr[${a.length}]`;
    const t = typeof a;
    if (t === "object") return `obj{${Object.keys(a as object).length}}`;
    return t;
  }).join(",");
}

function outputShape(value: unknown): string {
  if (value === null) return "null";
  if (value === undefined) return "undef";
  if (Array.isArray(value)) return `arr[${value.length}]`;
  if (typeof value === "object") return `obj{${Object.keys(value as object).length}}`;
  return typeof value;
}

interface ProbeState {
  buffer: InvocationSnapshot[];
  baseline: FunctionBaseline | null;
  callsSinceLastProbe: number;
  bufferLimit: number;
  probeEveryNCalls: number;
}

const REGISTRY = new Map<string, ProbeState>();
const PROBE_LISTENERS: Array<(finding: SuperQuanFinding) => void> = [];

export function onFinding(listener: (f: SuperQuanFinding) => void): () => void {
  PROBE_LISTENERS.push(listener);
  return () => { const i = PROBE_LISTENERS.indexOf(listener); if (i >= 0) PROBE_LISTENERS.splice(i, 1); };
}

function ensureState(fnId: string): ProbeState {
  let s = REGISTRY.get(fnId);
  if (!s) {
    s = { buffer: [], baseline: null, callsSinceLastProbe: 0, bufferLimit: 200, probeEveryNCalls: 25 };
    REGISTRY.set(fnId, s);
  }
  return s;
}

function record(state: ProbeState, snapshot: InvocationSnapshot, cfg: ProtoplasmConfig | undefined) {
  state.buffer.push(snapshot);
  if (state.buffer.length > state.bufferLimit) state.buffer.shift();
  state.callsSinceLastProbe++;

  // Rebuild baseline when enough samples; refresh slowly.
  if (state.baseline === null && state.buffer.length >= 5) state.baseline = buildBaseline(snapshot.fnId, state.buffer);
  else if (state.baseline !== null && state.buffer.length % 50 === 0) state.baseline = buildBaseline(snapshot.fnId, state.buffer);

  if (state.callsSinceLastProbe >= state.probeEveryNCalls && state.baseline && cfg) {
    state.callsSinceLastProbe = 0;
    const recentWindow = state.buffer.slice(-state.probeEveryNCalls);
    const partial = runQuantumProbe(snapshot.fnId, recentWindow, state.baseline, cfg);
    try {
      const finding = appendFinding(cfg.ledgerDir + "/findings.jsonl", partial, cfg.hmacKey);
      PROBE_LISTENERS.forEach((l) => { try { l(finding); } catch { /* ignore */ } });
    } catch { /* ledger optional — never block hot path */ }
  }
}

export function withSuperQuanProbe<F extends (...args: any[]) => any>(fnId: string, fn: F, cfg?: ProtoplasmConfig): F {
  const state = ensureState(fnId);
  const wrapped = function (this: unknown, ...args: Parameters<F>): ReturnType<F> {
    const t0 = performance.now();
    let result: any;
    let threwClass: string | undefined;
    try {
      result = (fn as any).apply(this, args);
    } catch (e: any) {
      threwClass = e?.constructor?.name ?? "Error";
      record(state, {
        fnId, ts: new Date().toISOString(), durationMs: performance.now() - t0,
        args: { count: args.length, shape: argShape(args) },
        output: { kind: "throw", errorClass: threwClass },
      }, cfg);
      throw e;
    }
    // async case
    if (result && typeof result.then === "function") {
      return result.then(
        (v: unknown) => {
          record(state, {
            fnId, ts: new Date().toISOString(), durationMs: performance.now() - t0,
            args: { count: args.length, shape: argShape(args) },
            output: { kind: "ok", shape: outputShape(v) },
          }, cfg);
          return v;
        },
        (e: any) => {
          record(state, {
            fnId, ts: new Date().toISOString(), durationMs: performance.now() - t0,
            args: { count: args.length, shape: argShape(args) },
            output: { kind: "throw", errorClass: e?.constructor?.name ?? "Error" },
          }, cfg);
          throw e;
        },
      ) as ReturnType<F>;
    }
    // sync case
    record(state, {
      fnId, ts: new Date().toISOString(), durationMs: performance.now() - t0,
      args: { count: args.length, shape: argShape(args) },
      output: { kind: "ok", shape: outputShape(result) },
    }, cfg);
    return result;
  };
  return wrapped as F;
}

/** Snapshot of the registry — for orchestrator / wisdom_space inspection. */
export function snapshotRegistry(): Array<{ fnId: string; samples: number; recent: InvocationSnapshot[] }> {
  return [...REGISTRY.entries()].map(([fnId, s]) => ({ fnId, samples: s.buffer.length, recent: s.buffer.slice(-25) }));
}

export function clearRegistry(): void { REGISTRY.clear(); }
