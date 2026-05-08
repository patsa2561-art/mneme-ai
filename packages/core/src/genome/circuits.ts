/**
 * G2 — Genetic Circuits.
 *
 * Synthetic biology builds biological logic gates (toggle, AND, OR, NOT,
 * oscillators) from genes. We build the same primitives for MCP — they
 * compose like Boolean algebra over tool execution.
 *
 *   • Toggle    — stateful flag
 *   • AND       — fire only when ALL inputs present/true
 *   • OR        — fire when ANY input present/true
 *   • NOT       — invert (reject when input present)
 *   • OSCILLATOR — rotates between strategies (deterministic given seed)
 *
 * Pure functions. Toggle state lives in the caller's storage (we expose
 * pure logic). Composes via the orchestrator's `Circuit` interface.
 */

// ─── Generic Circuit interface ────────────────────────────────────────

export interface CircuitInput<T = unknown> {
  /** Boolean signal sources (named). */
  signals: Record<string, boolean>;
  /** Optional payload that downstream tools consume. */
  payload?: T;
  /** Toggle state from prior call (caller-managed persistence). */
  toggleState?: Record<string, boolean>;
  /** Oscillator tick count. */
  oscillatorTick?: number;
}

export interface CircuitOutput<T = unknown> {
  /** Did the circuit fire / pass-through? */
  fired: boolean;
  /** Optional payload (transformed or pass-through). */
  payload?: T;
  /** Updated toggle state to persist. */
  toggleState?: Record<string, boolean>;
  /** Reason string for transparency. */
  reason: string;
}

// ─── Toggle ──────────────────────────────────────────────────────────

export interface ToggleConfig {
  /** Toggle's stable id (used as key in toggleState). */
  id: string;
  /** Default state when not yet stored. */
  defaultState?: boolean;
  /** Operation: "set" sets to value, "flip" inverts, "read" returns current. */
  op: "set" | "flip" | "read";
  /** Value for "set" operation. */
  value?: boolean;
}

export function toggle(config: ToggleConfig, input: CircuitInput): CircuitOutput<boolean> {
  const stored = input.toggleState ?? {};
  const current = stored[config.id] ?? config.defaultState ?? false;
  let next = current;
  let reason: string;
  switch (config.op) {
    case "read":
      reason = `read toggle ${config.id} = ${current}`;
      break;
    case "set":
      next = config.value === true;
      reason = `set toggle ${config.id} = ${next}`;
      break;
    case "flip":
      next = !current;
      reason = `flip toggle ${config.id} from ${current} to ${next}`;
      break;
  }
  return {
    fired: next,
    payload: next,
    toggleState: { ...stored, [config.id]: next },
    reason,
  };
}

// ─── AND / OR / NOT ──────────────────────────────────────────────────

export function andGate(signalNames: string[], input: CircuitInput): CircuitOutput {
  if (signalNames.length === 0) {
    return { fired: true, reason: "AND with 0 inputs is vacuously true" };
  }
  for (const n of signalNames) {
    if (!input.signals[n]) {
      return { fired: false, reason: `AND blocked: signal ${n} is false/missing` };
    }
  }
  return { fired: true, payload: input.payload, reason: `AND fired: all ${signalNames.length} signals true` };
}

export function orGate(signalNames: string[], input: CircuitInput): CircuitOutput {
  if (signalNames.length === 0) {
    return { fired: false, reason: "OR with 0 inputs is vacuously false" };
  }
  for (const n of signalNames) {
    if (input.signals[n]) {
      return { fired: true, payload: input.payload, reason: `OR fired: ${n} is true` };
    }
  }
  return { fired: false, reason: "OR blocked: no signal is true" };
}

export function notGate(signalName: string, input: CircuitInput): CircuitOutput {
  const v = input.signals[signalName] ?? false;
  return {
    fired: !v,
    payload: input.payload,
    reason: `NOT(${signalName}=${v}) → ${!v}`,
  };
}

// ─── Oscillator ──────────────────────────────────────────────────────

export interface OscillatorConfig {
  /** Strategy names to rotate through. */
  strategies: string[];
  /** Period (in ticks) before advancing. */
  period?: number;
}

export function oscillator(config: OscillatorConfig, input: CircuitInput): CircuitOutput<string> {
  if (config.strategies.length === 0) {
    return { fired: false, reason: "oscillator: no strategies configured" };
  }
  const period = Math.max(1, config.period ?? 1);
  const tick = Math.max(0, input.oscillatorTick ?? 0);
  const idx = Math.floor(tick / period) % config.strategies.length;
  const chosen = config.strategies[idx]!;
  return {
    fired: true,
    payload: chosen,
    reason: `oscillator tick=${tick} period=${period} → strategy[${idx}]=${chosen}`,
  };
}

// ─── Circuit composition ─────────────────────────────────────────────
//
// The composeCircuits helper lets you describe a CIRCUIT NETWORK
// declaratively (gate → next-gate). Each step's output payload becomes
// the next step's input payload. If any step fires=false, the chain
// halts at that point with the reason from the failing gate.

export type CircuitStep =
  | { kind: "toggle"; config: ToggleConfig }
  | { kind: "and"; signals: string[] }
  | { kind: "or"; signals: string[] }
  | { kind: "not"; signal: string }
  | { kind: "oscillator"; config: OscillatorConfig };

export interface CircuitNetwork {
  steps: CircuitStep[];
}

export function runCircuit(network: CircuitNetwork, input: CircuitInput): CircuitOutput {
  let current: CircuitOutput = { fired: true, payload: input.payload, reason: "network start" };
  let toggleState = { ...(input.toggleState ?? {}) };
  for (const step of network.steps) {
    const stepInput: CircuitInput = {
      signals: input.signals,
      payload: current.payload,
      toggleState,
      oscillatorTick: input.oscillatorTick,
    };
    let out: CircuitOutput;
    switch (step.kind) {
      case "toggle": out = toggle(step.config, stepInput); break;
      case "and":    out = andGate(step.signals, stepInput); break;
      case "or":     out = orGate(step.signals, stepInput); break;
      case "not":    out = notGate(step.signal, stepInput); break;
      case "oscillator": out = oscillator(step.config, stepInput); break;
    }
    if (out.toggleState) toggleState = out.toggleState;
    if (!out.fired) {
      return { fired: false, payload: out.payload, toggleState, reason: out.reason };
    }
    current = { ...out, toggleState };
  }
  return { ...current, toggleState };
}
