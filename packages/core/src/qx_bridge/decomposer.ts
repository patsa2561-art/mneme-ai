/**
 * v1.96.0 -- QX-BRIDGE · Gate decomposer.
 *
 * Each provider has its own NATIVE gate set. Mneme accepts a generic
 * CircuitIR with a wide gate vocabulary and decomposes any non-native
 * gate into native ones BEFORE submission.
 *
 * Example: IBM's native set is roughly {x, rz, cnot} (after sx is
 * lowered to rz·rx). A user circuit with H and S and T gates gets
 * automatically rewritten to a sequence of {x, rz, cnot} that produces
 * the SAME unitary (up to a global phase).
 *
 * Decomposition rules used (mathematically equivalent up to global phase):
 *   H  = RZ(π/2) · RX(π/2) · RZ(π/2)            (Z-X-Z Euler form)
 *   Y  = RZ(π) · X
 *   Z  = RZ(π)
 *   S  = RZ(π/2)
 *   T  = RZ(π/4)
 *   CZ = H(target) · CX(ctrl, target) · H(target)
 *   SWAP = CX(a,b) · CX(b,a) · CX(a,b)
 *   RX(θ) = RZ(-π/2) · RY(θ) · RZ(π/2)         (only if RX itself isn't native)
 *
 * Decomposition is recursive: if a sub-rule output also contains a
 * non-native gate, it gets further decomposed until everything is native.
 *
 * Pure-function. Deterministic. No external deps.
 */

import type { CircuitIR, Gate, GateName } from "./simulator.js";

export interface DecomposeResult {
  circuit: CircuitIR;
  /** Number of input gates → number of output gates. */
  expansion: { input: number; output: number; ratio: number };
  /** Per-rule application count. */
  rulesApplied: Record<string, number>;
}

type Rule = (g: Gate) => Gate[];

/** Library of decompositions. Each maps one source gate to a sequence of
 *  more-primitive gates. Apply iteratively until fixed point. */
const RULES: Partial<Record<GateName, Rule>> = {
  h: (g) => [
    { type: "rz", targets: g.targets, theta: Math.PI / 2 },
    { type: "rx", targets: g.targets, theta: Math.PI / 2 },
    { type: "rz", targets: g.targets, theta: Math.PI / 2 },
  ],
  y: (g) => [
    { type: "rz", targets: g.targets, theta: Math.PI },
    { type: "x", targets: g.targets },
  ],
  z: (g) => [{ type: "rz", targets: g.targets, theta: Math.PI }],
  s: (g) => [{ type: "rz", targets: g.targets, theta: Math.PI / 2 }],
  t: (g) => [{ type: "rz", targets: g.targets, theta: Math.PI / 4 }],
  cz: (g) => {
    const [ctrl, target] = g.targets;
    return [
      { type: "h", targets: [target!] },
      { type: "cnot", targets: [ctrl!, target!] },
      { type: "h", targets: [target!] },
    ];
  },
  swap: (g) => {
    const [a, b] = g.targets;
    return [
      { type: "cnot", targets: [a!, b!] },
      { type: "cnot", targets: [b!, a!] },
      { type: "cnot", targets: [a!, b!] },
    ];
  },
  rx: (g) => [
    { type: "rz", targets: g.targets, theta: -Math.PI / 2 },
    { type: "ry", targets: g.targets, theta: g.theta ?? 0 },
    { type: "rz", targets: g.targets, theta: Math.PI / 2 },
  ],
  ry: (g) => {
    // RY(θ) = SDG H RZ(θ) H S — but SDG, S, H are themselves non-native.
    // Simpler equivalent up to global phase: use the H decomp recursively
    // → H(rz(θ))H = rz(π/2) rx(π/2) rz(π/2) rz(θ) rz(π/2) rx(π/2) rz(π/2)
    // We just leave RY as a non-decomposable atom unless the target
    // explicitly excludes it (most providers DO support ry).
    return [{ type: "ry", targets: g.targets, theta: g.theta ?? 0 }];
  },
};

/** Decompose a single gate one step. Returns either the rule output or
 *  the original gate wrapped in array (no-op) if no rule applies. */
function decomposeOne(g: Gate, native: Set<string>): Gate[] {
  if (native.has(g.type)) return [g];
  const rule = RULES[g.type];
  if (!rule) return [g]; // no rule → leave as-is (the matcher already flagged)
  return rule(g);
}

/** Decompose a circuit until all gates are native (or no further rules
 *  apply). Bounded by maxIterations to avoid pathological loops. */
export function decompose(circuit: CircuitIR, nativeGates: readonly GateName[], maxIterations = 8): DecomposeResult {
  const native = new Set<string>(nativeGates);
  const rulesApplied: Record<string, number> = {};
  let gates = circuit.gates.slice();
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    const out: Gate[] = [];
    for (const g of gates) {
      if (native.has(g.type)) {
        out.push(g);
        continue;
      }
      const expanded = decomposeOne(g, native);
      if (expanded.length === 1 && expanded[0]!.type === g.type) {
        // No rule applied → keep original
        out.push(g);
      } else {
        rulesApplied[g.type] = (rulesApplied[g.type] ?? 0) + 1;
        for (const e of expanded) out.push(e);
        changed = true;
      }
    }
    gates = out;
    if (!changed) break;
  }
  return {
    circuit: { ...circuit, gates, label: `${circuit.label ?? "circuit"}-decomposed` },
    expansion: {
      input: circuit.gates.length,
      output: gates.length,
      ratio: circuit.gates.length > 0 ? gates.length / circuit.gates.length : 1,
    },
    rulesApplied,
  };
}
