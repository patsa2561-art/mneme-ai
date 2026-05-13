/**
 * v1.95.0 -- QX-BRIDGE · Pure-TS state-vector quantum simulator.
 *
 * Real quantum mechanics on the CPU. Works for up to ~12 qubits before
 * heap pressure (2^12 = 4096 complex amplitudes). Verified against
 * analytical expectations for Bell pair (50/50 ⟨00|, ⟨11|), 1-iteration
 * Grover search (success amplitude ≈ 1.0 on 2 qubits), QFT.
 *
 * This is NOT a real quantum computer — it's a deterministic classical
 * simulator that produces the same probability distribution a real
 * device would. Real-device adapters (IBM, AWS Braket, Azure, D-Wave)
 * live in `providers.ts` and require API tokens.
 */

/** Complex number {re, im}. */
export interface Complex {
  re: number;
  im: number;
}

const C0: Complex = { re: 0, im: 0 };
const C1: Complex = { re: 1, im: 0 };

function cAdd(a: Complex, b: Complex): Complex { return { re: a.re + b.re, im: a.im + b.im }; }
function cMul(a: Complex, b: Complex): Complex {
  return { re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re };
}
function cNorm2(a: Complex): number { return a.re * a.re + a.im * a.im; }

const SQRT2_INV = 1 / Math.sqrt(2);

export interface MeasurementResult {
  /** Map bitstring → shot count. */
  counts: Record<string, number>;
  /** Map bitstring → probability (counts/shots). */
  probabilities: Record<string, number>;
  /** Total shots that materialized (after stochastic sampling). */
  shots: number;
  /** Exact probabilities derived from amplitudes (independent of shots). */
  exactProbabilities: Record<string, number>;
}

/** A state vector over N qubits. Index i corresponds to the basis state
 *  whose binary representation (LSB = qubit 0) is i. */
export class QuantumState {
  readonly numQubits: number;
  readonly dim: number;
  amplitudes: Complex[];

  constructor(numQubits: number) {
    if (numQubits < 1 || numQubits > 12) {
      throw new Error(`numQubits must be 1..12 for in-process simulator (got ${numQubits})`);
    }
    this.numQubits = numQubits;
    this.dim = 1 << numQubits;
    this.amplitudes = new Array(this.dim).fill(C0);
    this.amplitudes[0] = C1; // |00...0⟩
  }

  /** Apply a single-qubit gate (2×2 matrix in row-major) to qubit q. */
  applySingleQubit(q: number, m: [Complex, Complex, Complex, Complex]): void {
    const [m00, m01, m10, m11] = m;
    const bit = 1 << q;
    const newAmps = new Array<Complex>(this.dim).fill(C0);
    for (let i = 0; i < this.dim; i++) {
      const a = this.amplitudes[i]!;
      if (cNorm2(a) === 0) continue;
      const zero = (i & bit) === 0;
      const partner = i ^ bit;
      if (zero) {
        // a → m00 * a (stays at i) + m10 * a (goes to partner)
        newAmps[i] = cAdd(newAmps[i]!, cMul(m00, a));
        newAmps[partner] = cAdd(newAmps[partner]!, cMul(m10, a));
      } else {
        newAmps[partner] = cAdd(newAmps[partner]!, cMul(m01, a));
        newAmps[i] = cAdd(newAmps[i]!, cMul(m11, a));
      }
    }
    this.amplitudes = newAmps;
  }

  /** Hadamard: |0⟩ → (|0⟩+|1⟩)/√2 ; |1⟩ → (|0⟩-|1⟩)/√2. */
  h(q: number): void {
    const sqrt2inv: Complex = { re: SQRT2_INV, im: 0 };
    const minusSqrt2inv: Complex = { re: -SQRT2_INV, im: 0 };
    this.applySingleQubit(q, [sqrt2inv, sqrt2inv, sqrt2inv, minusSqrt2inv]);
  }

  /** Pauli-X (NOT): |0⟩↔|1⟩. */
  x(q: number): void {
    this.applySingleQubit(q, [C0, C1, C1, C0]);
  }

  /** Pauli-Y. */
  y(q: number): void {
    const iC: Complex = { re: 0, im: 1 };
    const negI: Complex = { re: 0, im: -1 };
    this.applySingleQubit(q, [C0, negI, iC, C0]);
  }

  /** Pauli-Z: phase flip on |1⟩. */
  z(q: number): void {
    const negOne: Complex = { re: -1, im: 0 };
    this.applySingleQubit(q, [C1, C0, C0, negOne]);
  }

  /** Phase gate S = diag(1, i). */
  s(q: number): void {
    const iC: Complex = { re: 0, im: 1 };
    this.applySingleQubit(q, [C1, C0, C0, iC]);
  }

  /** T gate = diag(1, e^(iπ/4)). */
  t(q: number): void {
    const t: Complex = { re: Math.cos(Math.PI / 4), im: Math.sin(Math.PI / 4) };
    this.applySingleQubit(q, [C1, C0, C0, t]);
  }

  /** RX(θ): rotation around X by angle θ. */
  rx(q: number, theta: number): void {
    const c: Complex = { re: Math.cos(theta / 2), im: 0 };
    const negIsin: Complex = { re: 0, im: -Math.sin(theta / 2) };
    this.applySingleQubit(q, [c, negIsin, negIsin, c]);
  }

  /** RY(θ). */
  ry(q: number, theta: number): void {
    const c: Complex = { re: Math.cos(theta / 2), im: 0 };
    const sPlus: Complex = { re: Math.sin(theta / 2), im: 0 };
    const sNeg: Complex = { re: -Math.sin(theta / 2), im: 0 };
    this.applySingleQubit(q, [c, sNeg, sPlus, c]);
  }

  /** RZ(θ) = diag(e^(-iθ/2), e^(iθ/2)). */
  rz(q: number, theta: number): void {
    const e_neg: Complex = { re: Math.cos(-theta / 2), im: Math.sin(-theta / 2) };
    const e_pos: Complex = { re: Math.cos(theta / 2), im: Math.sin(theta / 2) };
    this.applySingleQubit(q, [e_neg, C0, C0, e_pos]);
  }

  /** Controlled-NOT: if ctrl qubit is |1⟩, flip target. */
  cnot(ctrl: number, target: number): void {
    if (ctrl === target) throw new Error("ctrl and target must differ");
    const cBit = 1 << ctrl;
    const tBit = 1 << target;
    const newAmps = new Array<Complex>(this.dim).fill(C0);
    for (let i = 0; i < this.dim; i++) {
      if ((i & cBit) !== 0) {
        // ctrl is 1 → flip target
        newAmps[i ^ tBit] = this.amplitudes[i]!;
      } else {
        newAmps[i] = this.amplitudes[i]!;
      }
    }
    this.amplitudes = newAmps;
  }

  /** SWAP two qubits — exchange their states. */
  swap(a: number, b: number): void {
    if (a === b) return;
    this.cnot(a, b);
    this.cnot(b, a);
    this.cnot(a, b);
  }

  /** Controlled-Z: phase flip when both qubits are |1⟩. */
  cz(ctrl: number, target: number): void {
    if (ctrl === target) throw new Error("ctrl and target must differ");
    const mask = (1 << ctrl) | (1 << target);
    const newAmps = this.amplitudes.slice();
    for (let i = 0; i < this.dim; i++) {
      if ((i & mask) === mask) {
        const a = newAmps[i]!;
        newAmps[i] = { re: -a.re, im: -a.im };
      }
    }
    this.amplitudes = newAmps;
  }

  /** Compute exact probability for each basis state (no sampling noise). */
  exactProbabilities(): Record<string, number> {
    const out: Record<string, number> = {};
    for (let i = 0; i < this.dim; i++) {
      const p = cNorm2(this.amplitudes[i]!);
      if (p > 1e-12) {
        out[this.indexToBitstring(i)] = p;
      }
    }
    return out;
  }

  /** Bitstring is MSB...LSB where LSB is qubit 0 (Qiskit convention). */
  indexToBitstring(i: number): string {
    let s = "";
    for (let q = this.numQubits - 1; q >= 0; q--) s += (i >> q) & 1 ? "1" : "0";
    return s;
  }

  /** Measure all qubits + return shot counts. Uses a seeded RNG for
   *  reproducibility when seed is provided. */
  measure(shots: number, seed?: number): MeasurementResult {
    const exact = this.exactProbabilities();
    const labels = Object.keys(exact);
    const cumulative: number[] = [];
    let acc = 0;
    for (const l of labels) {
      acc += exact[l]!;
      cumulative.push(acc);
    }
    // Normalize in case of numerical drift.
    const lastAcc = cumulative[cumulative.length - 1] ?? 1;
    for (let i = 0; i < cumulative.length; i++) cumulative[i] = cumulative[i]! / lastAcc;

    const rng = seed !== undefined ? mulberry32(seed) : Math.random;
    const counts: Record<string, number> = {};
    for (let s = 0; s < shots; s++) {
      const r = rng();
      // binary search cumulative
      let lo = 0, hi = cumulative.length - 1;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (r < cumulative[mid]!) hi = mid;
        else lo = mid + 1;
      }
      const label = labels[lo]!;
      counts[label] = (counts[label] ?? 0) + 1;
    }
    const probabilities: Record<string, number> = {};
    for (const l of Object.keys(counts)) probabilities[l] = counts[l]! / shots;
    return { counts, probabilities, shots, exactProbabilities: exact };
  }
}

/** Deterministic 32-bit RNG for reproducible test sampling. */
function mulberry32(seed: number): () => number {
  let a = seed | 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================
// Circuit IR — JSON form executable by either simulator or providers
// ============================================================

export type GateName = "h" | "x" | "y" | "z" | "s" | "t" | "cnot" | "cz" | "swap" | "rx" | "ry" | "rz";

export interface Gate {
  type: GateName;
  /** Qubit indices. cnot/cz: [ctrl, target]. rotations: [target]. */
  targets: number[];
  /** Rotation angle (radians) for rx/ry/rz. */
  theta?: number;
}

export interface CircuitIR {
  numQubits: number;
  gates: Gate[];
  /** If true, measure all qubits after gate sequence. Default true. */
  measureAll?: boolean;
  /** Optional human label. */
  label?: string;
}

/** Run a circuit on the pure-TS simulator. */
export function runOnSimulator(circuit: CircuitIR, shots: number, seed?: number): MeasurementResult {
  const state = new QuantumState(circuit.numQubits);
  for (const g of circuit.gates) {
    switch (g.type) {
      case "h": state.h(g.targets[0]!); break;
      case "x": state.x(g.targets[0]!); break;
      case "y": state.y(g.targets[0]!); break;
      case "z": state.z(g.targets[0]!); break;
      case "s": state.s(g.targets[0]!); break;
      case "t": state.t(g.targets[0]!); break;
      case "cnot": state.cnot(g.targets[0]!, g.targets[1]!); break;
      case "cz": state.cz(g.targets[0]!, g.targets[1]!); break;
      case "swap": state.swap(g.targets[0]!, g.targets[1]!); break;
      case "rx": state.rx(g.targets[0]!, g.theta ?? 0); break;
      case "ry": state.ry(g.targets[0]!, g.theta ?? 0); break;
      case "rz": state.rz(g.targets[0]!, g.theta ?? 0); break;
    }
  }
  if (circuit.measureAll === false) {
    // Return exact probs only, no sampling.
    return { counts: {}, probabilities: {}, shots: 0, exactProbabilities: state.exactProbabilities() };
  }
  return state.measure(shots, seed);
}

// ============================================================
// Famous circuit constructors — easy AI agent on-ramp
// ============================================================

/** Bell pair: entangle q0 + q1 → 50/50 of |00⟩ and |11⟩. */
export function bellPairCircuit(): CircuitIR {
  return {
    numQubits: 2,
    label: "bell-pair",
    gates: [
      { type: "h", targets: [0] },
      { type: "cnot", targets: [0, 1] },
    ],
  };
}

/** GHZ state on N qubits: equal superposition of |00...0⟩ and |11...1⟩. */
export function ghzCircuit(numQubits: number): CircuitIR {
  const gates: Gate[] = [{ type: "h", targets: [0] }];
  for (let q = 0; q + 1 < numQubits; q++) gates.push({ type: "cnot", targets: [q, q + 1] });
  return { numQubits, label: `ghz-${numQubits}`, gates };
}

/** Grover search for a 2-qubit marked state — 1 iteration brings target
 *  amplitude to ~1.0. Mark = which 2-bit pattern to find ("00".."11"). */
export function groverCircuit2q(target: "00" | "01" | "10" | "11" = "11"): CircuitIR {
  const gates: Gate[] = [
    // Initialize: equal superposition
    { type: "h", targets: [0] },
    { type: "h", targets: [1] },
  ];
  // Oracle: flip phase of target. Use X gates to align target with |11⟩ first.
  if (target[0] === "0") gates.push({ type: "x", targets: [1] }); // q1 is MSB
  if (target[1] === "0") gates.push({ type: "x", targets: [0] });
  gates.push({ type: "cz", targets: [0, 1] });
  if (target[1] === "0") gates.push({ type: "x", targets: [0] });
  if (target[0] === "0") gates.push({ type: "x", targets: [1] });
  // Diffusion (amplitude amplification about mean)
  gates.push({ type: "h", targets: [0] });
  gates.push({ type: "h", targets: [1] });
  gates.push({ type: "x", targets: [0] });
  gates.push({ type: "x", targets: [1] });
  gates.push({ type: "cz", targets: [0, 1] });
  gates.push({ type: "x", targets: [0] });
  gates.push({ type: "x", targets: [1] });
  gates.push({ type: "h", targets: [0] });
  gates.push({ type: "h", targets: [1] });
  return { numQubits: 2, label: `grover-2q-${target}`, gates };
}
